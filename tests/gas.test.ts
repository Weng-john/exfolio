import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { beforeEach, describe, expect, it } from 'vitest';
import { TABLE_NAMES } from '@core/index';

// Runs gas/Code.gs against in-memory stand-ins for the Apps Script
// services. It checks the script's own logic; it cannot prove behaviour of
// the real Google services.

class FakeRange {
  constructor(private sheet: FakeSheet, private row: number, private col: number, private rows: number, private cols: number) {}
  getValues() {
    return Array.from({ length: this.rows }, (_, r) =>
      Array.from({ length: this.cols }, (_, c) => this.sheet.cells[this.row - 1 + r]?.[this.col - 1 + c] ?? ''),
    );
  }
  getValue() {
    return this.getValues()[0][0];
  }
  setValues(values: unknown[][]) {
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
    this.cells = [];
  }
  setFrozenRows() {}
}

function makeRuntime(fetchAll: (reqs: Array<{ url: string }>) => Array<{ code: number; text: string }>) {
  const sheets = new Map<string, FakeSheet>();
  const props = new Map<string, string>();
  const cache = new Map<string, string>();
  const ss = {
    getSheetByName: (n: string) => sheets.get(n) ?? null,
    insertSheet: (n: string) => {
      const s = new FakeSheet();
      sheets.set(n, s);
      return s;
    },
  };
  const context = vm.createContext({
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: string) => props.get(k) ?? null,
        setProperty: (k: string, v: string) => props.set(k, v),
      }),
    },
    CacheService: {
      getScriptCache: () => ({ get: (k: string) => cache.get(k) ?? null, put: (k: string, v: string) => cache.set(k, v) }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (text: string) => ({ text, setMimeType() { return this; } }),
    },
    UrlFetchApp: {
      fetchAll: (reqs: Array<{ url: string }>) =>
        fetchAll(reqs).map((r) => ({ getResponseCode: () => r.code, getContentText: () => r.text })),
    },
    Utilities: { getUuid: () => '00000000-0000-0000-0000-000000000000' },
    Logger: { log() {} },
  });
  vm.runInContext(readFileSync('gas/Code.gs', 'utf8'), context);
  const post = (body: object) =>
    JSON.parse((context as any).doPost({ postData: { contents: JSON.stringify(body) } }).text);
  return { post, props, sheets, cache };
}

const TOKEN = 'test-token-not-a-real-secret';

describe('GAS backend', () => {
  let rt: ReturnType<typeof makeRuntime>;
  beforeEach(() => {
    rt = makeRuntime(() => []);
    rt.props.set('EXFOLIO_TOKEN', TOKEN);
  });

  it('lists the same tables as the core data model', () => {
    const source = readFileSync('gas/Code.gs', 'utf8');
    const listed = /var TABLES = \[([\s\S]*?)\]/.exec(source)![1].match(/'(\w+)'/g)!.map((s) => s.slice(1, -1));
    expect(listed).toEqual(TABLE_NAMES);
  });

  it('refuses everything until a token is configured', () => {
    rt.props.delete('EXFOLIO_TOKEN');
    expect(rt.post({ action: 'ping' }).ok).toBe(false);
  });

  it('refuses a wrong or missing token and locks out after repeated failures', () => {
    expect(rt.post({ action: 'load' })).toEqual({ ok: false, error: 'Unauthorized' });
    expect(rt.post({ action: 'load', token: TOKEN + 'x' }).error).toBe('Unauthorized');
    expect(rt.post({ action: 'load', token: 'test' }).error).toBe('Unauthorized');
    for (let i = 0; i < 10; i++) rt.post({ action: 'load', token: 'nope' });
    expect(rt.post({ action: 'ping', token: TOKEN }).error).toMatch(/Too many/);
  });

  it('round-trips rows without losing types or leading zeros', () => {
    const instruments = [
      { id: 'tw_0050', symbol: '0050', leverage: 1, active: true, brokerIds: ['a', 'b'], note: 'x, "y"' },
      { id: 'n', symbol: '123', leverage: -2, active: false },
    ];
    const saved = rt.post({ action: 'save', token: TOKEN, tables: { instruments }, baseRevision: 0 });
    expect(saved).toEqual({ ok: true, revision: 1 });
    const loaded = rt.post({ action: 'load', token: TOKEN });
    expect(loaded.revision).toBe(1);
    expect(loaded.tables.instruments).toEqual(instruments);
    expect(loaded.tables.transactions).toEqual([]);
    // Mirror columns are text, so Sheets cannot reinterpret them.
    expect(rt.sheets.get('instruments')!.cells[1][1]).toBe('0050');
  });

  it('rejects a stale revision and leaves data untouched', () => {
    rt.post({ action: 'save', token: TOKEN, tables: { brokers: [{ id: 'a', name: 'A' }] }, baseRevision: 0 });
    const stale = rt.post({ action: 'save', token: TOKEN, tables: { brokers: [] }, baseRevision: 0 });
    expect(stale).toEqual({ ok: false, error: 'conflict', revision: 1 });
    expect(rt.post({ action: 'load', token: TOKEN }).tables.brokers).toHaveLength(1);
  });

  it('shrinks a table when rows are removed and ignores unknown tables', () => {
    rt.post({ action: 'save', token: TOKEN, tables: { brokers: [{ id: 'a' }, { id: 'b' }] } });
    rt.post({ action: 'save', token: TOKEN, tables: { brokers: [{ id: 'b' }], evil: [{ id: 1 }] } });
    expect(rt.post({ action: 'load', token: TOKEN }).tables.brokers).toEqual([{ id: 'b' }]);
    expect(rt.sheets.has('evil')).toBe(false);
  });

  it('rejects rows without an id', () => {
    const res = rt.post({ action: 'save', token: TOKEN, tables: { brokers: [{ name: 'no id' }] } });
    expect(res.ok).toBe(false);
  });

  it('fetches quotes, reports per-item errors and caches successes', () => {
    let calls = 0;
    rt = makeRuntime((reqs) => {
      calls += reqs.length;
      return reqs.map((r) =>
        r.url.includes('yahoo')
          ? { code: 200, text: JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 100.5, currency: 'TWD', regularMarketTime: 1_700_000_000 } }] } }) }
          : r.url.includes('BTCUSDT')
            ? { code: 200, text: JSON.stringify({ price: '50000.10' }) }
            : { code: 451, text: '' },
      );
    });
    rt.props.set('EXFOLIO_TOKEN', TOKEN);
    const items = [
      { source: 'yahoo', symbol: '0050.TW' },
      { source: 'binance', symbol: 'BTCUSDT' },
      { source: 'binance', symbol: 'NOPE' },
      { source: 'manual', symbol: 'TX' },
    ];
    const { quotes } = rt.post({ action: 'quotes', token: TOKEN, items });
    expect(quotes[0]).toMatchObject({ symbol: '0050.TW', price: 100.5, currency: 'TWD', status: 'delayed' });
    expect(quotes[1]).toMatchObject({ price: 50000.1, status: 'realtime' });
    expect(quotes[2].error).toBe('HTTP 451');
    expect(quotes[3].error).toMatch(/Manual/);
    expect(calls).toBe(3);
    rt.post({ action: 'quotes', token: TOKEN, items });
    expect(calls).toBe(4); // only the failed one is fetched again
  });
});
