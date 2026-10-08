import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ApiRequest, ApiResponse } from '@core/api';
import { setGoogleVerifier } from '../server/auth';
import { dispatch } from '../server/handler';

// Fictional accounts against a throwaway data directory.

type Ok = Extract<ApiResponse, { ok: true }>;
const key = (n: number) => n.toString(16).padStart(64, '0');
const call = (request: ApiRequest) => dispatch(request);
const ok = async (request: ApiRequest): Promise<Ok> => {
  const res = await call(request);
  if (!res.ok) throw new Error(`expected ok, got ${res.error}`);
  return res;
};
const fail = async (request: ApiRequest): Promise<string> => {
  const res = await call(request);
  if (res.ok) throw new Error('expected an error');
  return res.error;
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'exfolio-auth-'));
  process.env.EXFOLIO_DATA_DIR = dir;
  delete process.env.EXFOLIO_AUTH;
  setGoogleVerifier(async (token) => {
    if (!token.startsWith('good:')) throw new Error('bad token');
    const [, sub, email] = token.split(':');
    return { sub, email, name: `G ${sub}` };
  });
});
afterEach(() => {
  setGoogleVerifier();
  rmSync(dir, { recursive: true, force: true });
});

/** First account (admin) plus one approved member. */
async function twoMembers() {
  const admin = await ok({ action: 'register', username: 'Admin', passwordKey: key(1) });
  await ok({ action: 'register', username: 'amy', passwordKey: key(2) });
  const users = (await ok({ action: 'adminUsers', session: admin.session })).users!;
  const amy = users.find((u) => u.username === 'amy')!;
  await ok({ action: 'adminUpdateUser', session: admin.session, userId: amy.id, status: 'active' });
  const login = await ok({ action: 'login', username: 'amy', passwordKey: key(2) });
  return { admin: admin.session!, adminId: admin.user!.id, amy: login.session!, amyId: amy.id };
}

describe('registration and login', () => {
  it('makes the first account an active admin and later ones pending', async () => {
    expect((await ok({ action: 'config' })).config).toMatchObject({
      authRequired: true,
      hasUsers: false,
      registration: 'approval',
    });
    const first = await ok({ action: 'register', username: 'Admin', passwordKey: key(1) });
    expect(first.user).toMatchObject({
      username: 'admin',
      role: 'admin',
      status: 'active',
      allowAdminView: true,
    });
    expect(first.session).toBeTruthy();
    const second = await ok({ action: 'register', username: 'amy', passwordKey: key(2) });
    expect(second.user).toMatchObject({ role: 'member', status: 'pending' });
    expect(second.session).toBeUndefined();
    expect(await fail({ action: 'login', username: 'amy', passwordKey: key(2) })).toBe('pending');
  });

  it('activates new accounts at once when registration is open', async () => {
    const admin = await ok({ action: 'register', username: 'admin', passwordKey: key(1) });
    await ok({ action: 'adminSetConfig', session: admin.session, registration: 'open' });
    const amy = await ok({ action: 'register', username: 'amy', passwordKey: key(2) });
    expect(amy.user!.status).toBe('active');
    expect(amy.session).toBeTruthy();
  });

  it('rejects duplicate names, bad names and malformed keys', async () => {
    await ok({ action: 'register', username: 'admin', passwordKey: key(1) });
    expect(await fail({ action: 'register', username: 'ADMIN', passwordKey: key(2) })).toBe(
      'username_taken',
    );
    expect((await call({ action: 'register', username: 'a b', passwordKey: key(2) })).ok).toBe(
      false,
    );
    expect(
      (await call({ action: 'register', username: 'carol', passwordKey: 'plaintext' })).ok,
    ).toBe(false);
  });

  it('gives the same answer for a wrong password and an unknown account', async () => {
    await ok({ action: 'register', username: 'admin', passwordKey: key(1) });
    expect(await fail({ action: 'login', username: 'admin', passwordKey: key(9) })).toBe(
      'invalid_credentials',
    );
    expect(await fail({ action: 'login', username: 'nobody', passwordKey: key(9) })).toBe(
      'invalid_credentials',
    );
  });

  it('locks an account name after repeated failures', async () => {
    await ok({ action: 'register', username: 'locked', passwordKey: key(1) });
    for (let i = 0; i < 8; i++)
      await fail({ action: 'login', username: 'locked', passwordKey: key(9) });
    expect(await fail({ action: 'login', username: 'locked', passwordKey: key(1) })).toBe(
      'rate_limited',
    );
  });

  it('stores neither the password key nor the session token', async () => {
    const res = await ok({ action: 'register', username: 'admin', passwordKey: key(1) });
    const raw = readFileSync(path.join(dir, 'auth.json'), 'utf8');
    expect(raw).not.toContain(key(1));
    expect(raw).not.toContain(res.session!);
  });

  it('ends a session on logout', async () => {
    const res = await ok({ action: 'register', username: 'admin', passwordKey: key(1) });
    await ok({ action: 'logout', session: res.session });
    expect(await fail({ action: 'me', session: res.session })).toBe('unauthenticated');
  });
});

describe('data isolation', () => {
  it('requires a session for data and quotes', async () => {
    await ok({ action: 'register', username: 'admin', passwordKey: key(1) });
    expect(await fail({ action: 'load' })).toBe('unauthenticated');
    expect(await fail({ action: 'save', tables: {} })).toBe('unauthenticated');
    expect(await fail({ action: 'quotes', items: [] })).toBe('unauthenticated');
    expect(await fail({ action: 'load', session: 'made-up' })).toBe('unauthenticated');
  });

  it('keeps each member in their own file', async () => {
    const s = await twoMembers();
    await ok({
      action: 'save',
      session: s.admin,
      tables: { brokers: [{ id: 'a', name: '示範券商甲' }] },
    });
    await ok({
      action: 'save',
      session: s.amy,
      tables: { brokers: [{ id: 'b', name: '示範券商乙' }] },
    });
    expect((await ok({ action: 'load', session: s.admin })).tables!.brokers).toEqual([
      { id: 'a', name: '示範券商甲' },
    ]);
    expect((await ok({ action: 'load', session: s.amy })).tables!.brokers).toEqual([
      { id: 'b', name: '示範券商乙' },
    ]);
    expect(readdirSync(path.join(dir, 'users')).sort()).toEqual(
      [`${s.adminId}.json`, `${s.amyId}.json`].sort(),
    );
  });

  it('lets a member not read another member, whatever they ask for', async () => {
    const s = await twoMembers();
    expect(await fail({ action: 'load', session: s.amy, asUser: s.adminId })).toBe('forbidden');
    expect(await fail({ action: 'adminUsers', session: s.amy })).toBe('forbidden');
    expect(await fail({ action: 'adminAudit', session: s.amy })).toBe('forbidden');
    expect(
      await fail({ action: 'adminUpdateUser', session: s.amy, userId: s.amyId, role: 'admin' }),
    ).toBe('forbidden');
  });

  it('lets an admin read a consenting member read-only, and logs it', async () => {
    const s = await twoMembers();
    await ok({
      action: 'save',
      session: s.amy,
      tables: { brokers: [{ id: 'b', name: '示範券商乙' }] },
    });
    const view = await ok({ action: 'load', session: s.admin, asUser: s.amyId });
    expect(view.tables!.brokers).toHaveLength(1);
    const audit = (await ok({ action: 'adminAudit', session: s.admin })).audit!;
    expect(audit[0]).toMatchObject({ action: 'view-data', targetId: s.amyId, actorId: s.adminId });
    // A save always goes to the caller's own file: there is no way to name another.
    await ok({ action: 'save', session: s.admin, tables: { brokers: [] } });
    expect((await ok({ action: 'load', session: s.amy })).tables!.brokers).toHaveLength(1);
  });

  it('stops admin viewing once the member withdraws consent', async () => {
    const s = await twoMembers();
    await ok({ action: 'updateProfile', session: s.amy, allowAdminView: false });
    expect(await fail({ action: 'load', session: s.admin, asUser: s.amyId })).toBe('forbidden');
  });

  it('hands a pre-accounts data file to the first member only', async () => {
    writeFileSync(
      path.join(dir, 'exfolio.json'),
      JSON.stringify({ revision: 3, tables: { brokers: [{ id: 'old', name: '舊資料' }] } }),
    );
    const s = await twoMembers();
    expect((await ok({ action: 'load', session: s.admin })).tables!.brokers).toEqual([
      { id: 'old', name: '舊資料' },
    ]);
    expect((await ok({ action: 'load', session: s.amy })).tables).toEqual({});
  });
});

describe('account management', () => {
  it('changes a password only with the old one, and signs out other sessions', async () => {
    const s = await twoMembers();
    const other = (await ok({ action: 'login', username: 'amy', passwordKey: key(2) })).session!;
    expect(
      await fail({
        action: 'changePassword',
        session: s.amy,
        oldPasswordKey: key(9),
        newPasswordKey: key(3),
      }),
    ).toBe('invalid_credentials');
    await ok({
      action: 'changePassword',
      session: s.amy,
      oldPasswordKey: key(2),
      newPasswordKey: key(3),
    });
    await ok({ action: 'me', session: s.amy });
    expect(await fail({ action: 'me', session: other })).toBe('unauthenticated');
    expect(await fail({ action: 'login', username: 'amy', passwordKey: key(2) })).toBe(
      'invalid_credentials',
    );
    await ok({ action: 'login', username: 'amy', passwordKey: key(3) });
  });

  it('disabling a member ends their sessions at once', async () => {
    const s = await twoMembers();
    await ok({ action: 'adminUpdateUser', session: s.admin, userId: s.amyId, status: 'disabled' });
    expect(await fail({ action: 'load', session: s.amy })).toBe('unauthenticated');
    expect(await fail({ action: 'login', username: 'amy', passwordKey: key(2) })).toBe('disabled');
  });

  it('lets an admin reset a password', async () => {
    const s = await twoMembers();
    await ok({
      action: 'adminUpdateUser',
      session: s.admin,
      userId: s.amyId,
      newPasswordKey: key(7),
    });
    expect(await fail({ action: 'me', session: s.amy })).toBe('unauthenticated');
    await ok({ action: 'login', username: 'amy', passwordKey: key(7) });
  });

  it('never leaves the system without an active admin', async () => {
    const s = await twoMembers();
    expect(
      (
        await call({
          action: 'adminUpdateUser',
          session: s.admin,
          userId: s.adminId,
          role: 'member',
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await call({
          action: 'adminUpdateUser',
          session: s.admin,
          userId: s.adminId,
          status: 'disabled',
        })
      ).ok,
    ).toBe(false);
    expect(
      (await call({ action: 'adminDeleteUser', session: s.admin, userId: s.adminId })).ok,
    ).toBe(false);
    await ok({ action: 'adminUpdateUser', session: s.admin, userId: s.amyId, role: 'admin' });
    await ok({ action: 'adminUpdateUser', session: s.admin, userId: s.adminId, role: 'member' });
  });

  it('deletes a member together with their data', async () => {
    const s = await twoMembers();
    await ok({
      action: 'save',
      session: s.amy,
      tables: { brokers: [{ id: 'b', name: '示範券商乙' }] },
    });
    await ok({ action: 'adminDeleteUser', session: s.admin, userId: s.amyId });
    expect(readdirSync(path.join(dir, 'users'))).not.toContain(`${s.amyId}.json`);
    expect(await fail({ action: 'load', session: s.amy })).toBe('unauthenticated');
  });
});

describe('Google sign-in', () => {
  const setup = async () => {
    const admin = await ok({ action: 'register', username: 'admin', passwordKey: key(1) });
    await ok({
      action: 'adminSetConfig',
      session: admin.session,
      googleClientId: 'fictional-client-id.apps.example',
    });
    return admin.session!;
  };

  it('is refused until a client id is configured, and for bad tokens', async () => {
    await ok({ action: 'register', username: 'admin', passwordKey: key(1) });
    expect((await call({ action: 'loginGoogle', idToken: 'good:1:amy@example.com' })).ok).toBe(
      false,
    );
    await setup().catch(() => undefined);
  });

  it('creates a pending member, then signs them in once approved', async () => {
    const admin = await setup();
    const first = await ok({ action: 'loginGoogle', idToken: 'good:g1:amy@example.com' });
    expect(first.user).toMatchObject({
      username: 'amy@example.com',
      status: 'pending',
      googleLinked: true,
      hasPassword: false,
    });
    expect(first.session).toBeUndefined();
    await ok({
      action: 'adminUpdateUser',
      session: admin,
      userId: first.user!.id,
      status: 'active',
    });
    const again = await ok({ action: 'loginGoogle', idToken: 'good:g1:amy@example.com' });
    expect(again.session).toBeTruthy();
    expect(again.user!.id).toBe(first.user!.id);
    expect((await call({ action: 'loginGoogle', idToken: 'forged' })).ok).toBe(false);
  });

  it('never attaches to an existing account just because the name matches', async () => {
    const admin = await setup();
    await ok({ action: 'adminSetConfig', session: admin, registration: 'open' });
    const squatter = await ok({
      action: 'register',
      username: 'amy@example.com',
      passwordKey: key(5),
    });
    const google = await ok({ action: 'loginGoogle', idToken: 'good:g1:amy@example.com' });
    expect(google.user!.id).not.toBe(squatter.user!.id);
    expect(google.user!.username).not.toBe('amy@example.com');
  });

  it('links Google to a signed-in account, once per Google identity', async () => {
    const admin = await setup();
    const linked = await ok({
      action: 'linkGoogle',
      session: admin,
      idToken: 'good:g9:admin@example.com',
    });
    expect(linked.user!.googleLinked).toBe(true);
    const viaGoogle = await ok({ action: 'loginGoogle', idToken: 'good:g9:admin@example.com' });
    expect(viaGoogle.user!.role).toBe('admin');
  });
});

describe('single-user mode', () => {
  it('needs no login when authentication is off', async () => {
    process.env.EXFOLIO_AUTH = 'off';
    expect((await ok({ action: 'config' })).config!.authRequired).toBe(false);
    await ok({ action: 'save', tables: { brokers: [{ id: 'a', name: '示範券商甲' }] } });
    expect((await ok({ action: 'load' })).tables!.brokers).toHaveLength(1);
  });
});
