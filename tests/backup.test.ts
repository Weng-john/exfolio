import { describe, expect, it } from 'vitest';
import {
  addMissingSeed,
  backupFileName,
  indexReferences,
  instrumentReferences,
  parseBackup,
  rowCounts,
  seedData,
  serializeBackup,
  validateInstrument,
  type Instrument,
  SEED_INDICES,
} from '@core/index';
import { fresh, tx } from './helpers';

const base = (): Instrument => ({
  id: 'x1',
  symbol: 'XX',
  name: '測試',
  type: 'etf',
  exchange: 'TWSE',
  currency: 'TWD',
  leverage: 1,
  multiplier: 1,
  lotSize: 1,
  quoteSource: 'manual',
  active: true,
});

describe('backup round trip', () => {
  it('serializes and parses back to the same tables', () => {
    const data = fresh();
    data.transactions.push(tx({ type: 'deposit', date: '2026-01-01', amount: 1000 }));
    const text = serializeBackup(data, new Date('2026-10-09T00:00:00Z'));
    const file = JSON.parse(text);
    expect(file.format).toBe('exfolio-backup');
    expect(file.exportedAt).toBe('2026-10-09T00:00:00.000Z');
    const res = parseBackup(text);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual(data);
  });

  it('fills missing tables with empty arrays', () => {
    const res = parseBackup(JSON.stringify({ tables: { brokers: [{ id: 'b', name: 'B' }] } }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.brokers).toHaveLength(1);
      expect(res.data.transactions).toEqual([]);
      expect(res.data.settings).toHaveLength(1);
    }
  });

  it('rejects bad json, non-array tables, rows without id and duplicates', () => {
    expect(parseBackup('{oops').ok).toBe(false);
    expect(parseBackup('[]').ok).toBe(false);
    expect(parseBackup('{}').ok).toBe(false);
    const bad = parseBackup(
      JSON.stringify({
        tables: { brokers: {}, accounts: [{ name: 'a' }], loans: [{ id: 'l' }, { id: 'l' }] },
      }),
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors).toEqual(
        expect.arrayContaining([
          'brokers：必須是陣列',
          'accounts[0]：缺少 id',
          'loans[1]：id 重複（l）',
        ]),
      );
    }
  });

  it('rejects other formats and newer versions', () => {
    expect(parseBackup(JSON.stringify({ format: 'other', tables: {} })).ok).toBe(false);
    expect(parseBackup(JSON.stringify({ version: 99, tables: { brokers: [] } })).ok).toBe(false);
  });

  it('rejects malformed fields from each persisted table before restore', () => {
    const data = fresh();
    data.brokers[0] = { ...data.brokers[0], name: 12 as unknown as string };
    data.accounts[0] = { ...data.accounts[0], active: 'yes' as unknown as boolean };
    data.indices[0] = { ...data.indices[0], market: 'moon' as never };
    data.instruments[0] = { ...data.instruments[0], lotSize: Infinity };
    data.transactions.push(tx({ type: 'deposit', date: '2026-01-01', amount: Number.NaN }));
    data.loans.push({
      id: 'bad-loan',
      name: 'x',
      kind: 'credit',
      lender: 'y',
      currency: 'TWD',
      principal: 1,
      annualRate: 0,
      method: 'oops' as never,
      startDate: '2026-01-01',
      active: true,
    });
    data.prices.push({
      id: 'p',
      price: 1,
      currency: 'TWD',
      asOf: 'x',
      source: 'manual',
      status: 'wrong' as never,
    });
    data.fxRates.push({
      id: 'x',
      from: 'USD',
      to: 'TWD',
      rate: Number.NaN,
      asOf: 'x',
      source: 'manual',
    });
    data.targets.push({ id: 't', indexId: 'tw50', targetWeight: 1, tolerance: Number.NaN });
    data.strategies.push({ id: 's', name: 'x', status: 'wrong' as never });
    data.snapshots.push({
      id: 'n',
      date: '2026-01-01',
      nav: 1,
      assets: 1,
      liabilities: 0,
      cash: 1,
      grossExposure: 0,
      netExposure: 0,
      contributedCapital: 1,
      byIndex: [] as unknown as Record<string, number>,
    });
    data.settings[0] = {
      ...data.settings[0],
      alerts: [] as unknown as (typeof data.settings)[0]['alerts'],
    };
    data.tradeGroups.push({ id: 'g', strategyId: 's', name: 'x', status: 'wrong' as never });
    data.rotationCycles.push({
      id: 'r',
      strategyId: 's',
      name: 'x',
      fromInstrumentId: 'a',
      toInstrumentId: 'b',
      benchmarkInstrumentId: 'c',
      status: 'open',
      openedAt: 1 as unknown as string,
    });
    data.priceHistory.push({ id: 'h', instrumentId: 'x', date: '2026-01-01', close: Number.NaN });
    data.rollovers.push({
      id: 'r2',
      date: '2026-01-01',
      accountId: 'a',
      bucket: 'core',
      seriesId: 's',
      fromInstrumentId: 'a',
      toInstrumentId: 'b',
      quantity: 1,
      closePrice: 1,
      openPrice: Number.NaN,
    });
    data.cashflowItems.push({
      id: 'c',
      name: 'x',
      kind: 'income',
      amount: 1,
      currency: 'TWD',
      frequency: 'monthly',
      startDate: '2026-01-01',
      affectsPortfolio: 'yes' as unknown as boolean,
    });
    data.scenarios.push({
      id: 'sc',
      kind: 'stress',
      name: 'x',
      params: [] as unknown as Record<string, unknown>,
    });
    data.importProfiles.push({
      id: 'ip',
      name: 'x',
      mapping: [] as unknown as Record<string, string>,
      options: {},
    });
    const result = parseBackup(serializeBackup(data));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThanOrEqual(19);
  });

  it('names files so git ignores them', () => {
    expect(backupFileName(new Date('2026-10-09T05:00:00Z'))).toBe('exfolio-backup-2026-10-09.json');
  });

  it('counts rows per table', () => {
    expect(rowCounts(seedData()).indices).toBe(SEED_INDICES.length);
  });
});

describe('addMissingSeed', () => {
  it('adds only missing ids and keeps edited rows', () => {
    const data = seedData();
    data.instruments = data.instruments.filter((i) => i.id !== 'us_VOO');
    data.instruments.find((i) => i.id === 'tw_0050')!.name = '自訂名稱';
    const res = addMissingSeed(data);
    expect(res.added.instruments).toBe(1);
    expect(res.added.indices).toBe(0);
    expect(res.data.brokers).toEqual([]);
    expect(res.data.instruments.find((i) => i.id === 'tw_0050')!.name).toBe('自訂名稱');
    expect(res.data.instruments.some((i) => i.id === 'us_VOO')).toBe(true);
  });
});

describe('validateInstrument for options', () => {
  const underlying = {
    id: 'u',
    symbol: 'U',
    name: '標的',
    type: 'etf' as const,
    exchange: 'X',
    currency: 'TWD',
    leverage: 1,
    multiplier: 1,
    lotSize: 1,
    quoteSource: 'manual' as const,
    active: true,
  };
  const option = { ...underlying, id: 'o', symbol: 'O', type: 'option' as const, multiplier: 100 };

  it('asks for what the delta needs', () => {
    const errs = validateInstrument(option, [underlying], true);
    expect(errs).toEqual([
      '選擇權需選擇買權或賣權',
      '履約價必須大於 0',
      '選擇權需填寫到期日',
      '選擇權需指定標的商品',
    ]);
  });

  it('accepts a complete option and rejects a bad underlying or volatility', () => {
    const ok = {
      ...option,
      optionRight: 'put' as const,
      strike: 50,
      expiry: '2027-01-15',
      underlyingId: 'u',
    };
    expect(validateInstrument(ok, [underlying], true)).toEqual([]);
    expect(validateInstrument({ ...ok, underlyingId: 'o' }, [underlying], true)).toContain(
      '標的商品不可是選擇權本身',
    );
    expect(validateInstrument({ ...ok, underlyingId: 'zz' }, [underlying], true)).toContain(
      '找不到指定的標的商品',
    );
    expect(validateInstrument({ ...ok, impliedVol: 0 }, [underlying], true)).toContain(
      '波動率必須大於 0',
    );
  });
});

describe('validateInstrument', () => {
  it('accepts a valid instrument', () => {
    expect(validateInstrument(base(), [], true)).toEqual([]);
  });
  it('flags required, positive and leverage rules', () => {
    const errs = validateInstrument(
      { ...base(), symbol: '', multiplier: 0, lotSize: -1, leverage: 0 },
      [],
      true,
    );
    expect(errs.length).toBe(4);
  });
  it('requires a quote symbol unless manual', () => {
    expect(validateInstrument({ ...base(), quoteSource: 'yahoo' }, [], true)).toHaveLength(1);
    expect(
      validateInstrument({ ...base(), quoteSource: 'yahoo', quoteSymbol: 'XX.TW' }, [], true),
    ).toEqual([]);
  });
  it('checks id uniqueness only for new rows', () => {
    expect(validateInstrument(base(), [base()], true)).toHaveLength(1);
    expect(validateInstrument(base(), [base()], false)).toEqual([]);
  });
  it('allows negative leverage for inverse products', () => {
    expect(validateInstrument({ ...base(), leverage: -1 }, [], true)).toEqual([]);
  });
});

describe('references', () => {
  it('finds transactions, collateral and targets for an instrument', () => {
    const data = seedData();
    data.transactions.push(
      tx({ type: 'buy', date: '2026-01-02', instrumentId: 'tw_0050', quantity: 1, price: 10 }),
    );
    data.targets.push({
      id: 't',
      indexId: 'tw50',
      targetWeight: 1,
      tolerance: 0.05,
      preferredInstrumentId: 'tw_0050',
    });
    data.prices.push({
      id: 'tw_0050',
      price: 1,
      currency: 'TWD',
      asOf: '2026-01-01T00:00:00Z',
      source: 'manual',
      status: 'manual',
    });
    expect(instrumentReferences(data, 'tw_0050').map((r) => r.table)).toEqual([
      '交易紀錄',
      '配置目標',
    ]);
    expect(instrumentReferences(data, 'tw_0050', true).map((r) => r.table)).toContain('持倉報價');
    expect(instrumentReferences(data, 'us_VOO')).toEqual([]);
  });
  it('finds instruments and targets for an index', () => {
    const data = seedData();
    expect(indexReferences(data, 'tw50')[0]).toEqual({
      table: '商品',
      count: data.instruments.filter((i) => i.indexId === 'tw50').length,
    });
    expect(indexReferences(data, 'nope')).toEqual([]);
  });
});
