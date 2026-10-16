import { describe, expect, it } from 'vitest';
import {
  computePortfolio,
  customInstrument,
  quickPosition,
  searchInstruments,
  seedData,
  type AppData,
} from '@core/index';
import { fresh, NOW, setFx, setPrice } from './helpers';

const apply = (data: AppData, result: ReturnType<typeof quickPosition>) => {
  if (result.broker) data.brokers.push(result.broker);
  if (result.account) data.accounts.push(result.account);
  data.transactions.push(...result.transactions);
};

describe('quickPosition', () => {
  it('turns a holding into a funded opening trade: NAV equals market value, no debt', () => {
    const data = fresh();
    const r = quickPosition(data, {
      accountId: 'kgi_tw',
      instrumentId: 'tw_0050',
      quantity: 1000,
      side: 'long',
      averageCost: 100,
      date: '2026-01-02',
      fundFromOutside: true,
    });
    expect(r.errors).toEqual([]);
    expect(r.transactions.map((t) => t.type)).toEqual(['deposit', 'buy']);
    apply(data, r);
    setPrice(data, 'tw_0050', 120);
    const v = computePortfolio(data, { now: NOW }).valuation;
    expect(v.nav).toBe(120_000);
    expect(v.liabilities).toBe(0);
    expect(v.contributedCapital).toBe(100_000);
    expect(v.unrealizedPnl).toBe(20_000);
  });

  it('opens a short perpetual on an ETF with no deposit, counted as negative exposure', () => {
    const data = fresh();
    setFx(data, 'USDT', 'TWD', 32);
    data.transactions.push({
      id: 'm',
      date: '2026-01-01',
      type: 'deposit',
      accountId: 'binance_main',
      bucket: 'core',
      currency: 'USDT',
      amount: 5_000,
    });
    const r = quickPosition(data, {
      accountId: 'binance_main',
      instrumentId: 'perp_SPYUSDT',
      quantity: 10,
      side: 'short',
      averageCost: 700,
      fundFromOutside: true,
    });
    expect(r.transactions.map((t) => t.type)).toEqual(['sell']);
    apply(data, r);
    setPrice(data, 'perp_SPYUSDT', 700, 'USDT');
    const v = computePortfolio(data, { now: NOW }).valuation;
    expect(v.byIndex.find((i) => i.indexId === 'sp500')!.net).toBeCloseTo(-10 * 700 * 32);
    expect(v.nav).toBeCloseTo(5_000 * 32);
  });

  it('counts a leveraged perpetual at its multiple', () => {
    const data = fresh();
    setFx(data, 'USDT', 'USD', 1);
    setFx(data, 'USD', 'TWD', 32);
    data.transactions.push({
      id: 'm',
      date: '2026-01-01',
      type: 'deposit',
      accountId: 'binance_main',
      bucket: 'core',
      currency: 'USDT',
      amount: 1_000,
    });
    apply(
      data,
      quickPosition(data, {
        accountId: 'binance_main',
        instrumentId: 'perp_TQQQUSDT',
        quantity: 10,
        side: 'long',
        averageCost: 70,
        fundFromOutside: false,
      }),
    );
    setPrice(data, 'perp_TQQQUSDT', 70, 'USDT');
    expect(computePortfolio(data, { now: NOW }).valuation.byIndex[0]).toMatchObject({
      indexId: 'ndx',
    });
    expect(computePortfolio(data, { now: NOW }).valuation.netExposure).toBeCloseTo(
      10 * 70 * 3 * 32,
    );
  });

  it('creates an account (and an institution when there is none) on request', () => {
    const data = seedData();
    const r = quickPosition(data, {
      newAccountName: '我的美股',
      instrumentId: 'us_VOO',
      quantity: 5,
      side: 'long',
      averageCost: 500,
      fundFromOutside: true,
    });
    expect(r.errors).toEqual([]);
    expect(r.broker?.name).toBe('未指定機構');
    expect(r.account).toMatchObject({ name: '我的美股', baseCurrency: 'USD', type: 'securities' });
    expect(r.transactions.every((t) => t.accountId === r.account!.id)).toBe(true);
  });

  it('explains what is missing instead of guessing', () => {
    const data = fresh();
    const r = quickPosition(data, {
      instrumentId: 'nope',
      quantity: 0,
      side: 'long',
      averageCost: -1,
      fundFromOutside: true,
    });
    expect(r.transactions).toEqual([]);
    expect(r.errors.length).toBeGreaterThanOrEqual(3);
    expect(
      quickPosition(data, {
        accountId: 'kgi_tw',
        instrumentId: 'tw_0050',
        quantity: 1,
        side: 'short',
        averageCost: 1,
        fundFromOutside: false,
      }).errors[0],
    ).toContain('空單');
  });
});

describe('customInstrument', () => {
  it('builds an instrument the ledger and exposure maths can use', () => {
    const data = fresh();
    const { instrument, errors } = customInstrument(data, {
      symbol: 'XYZ2',
      name: '示範兩倍 ETF',
      type: 'etf',
      indexId: 'sp500',
      leverage: 2,
      multiplier: 1,
      currency: 'usd',
      quoteSource: 'manual',
    });
    expect(errors).toEqual([]);
    expect(instrument).toMatchObject({
      symbol: 'XYZ2',
      currency: 'USD',
      leverage: 2,
      lotSize: 1,
      active: true,
    });
  });

  it('rejects the mistakes that would distort exposure', () => {
    const { errors } = customInstrument(fresh(), {
      symbol: '',
      name: '',
      type: 'future',
      indexId: 'nope',
      leverage: 0,
      multiplier: 0,
      currency: 'dollars',
      quoteSource: 'yahoo',
    });
    expect(errors.length).toBeGreaterThanOrEqual(6);
  });
});

describe('searchInstruments', () => {
  it('finds by symbol first, then name and index', () => {
    const data = seedData();
    expect(searchInstruments(data, 'spy')[0].id).toBe('us_SPY');
    expect(searchInstruments(data, 'SPYUSDT').map((i) => i.id)).toContain('perp_SPYUSDT');
    expect(searchInstruments(data, '日經').some((i) => i.id === 'jp_1570')).toBe(true);
    expect(searchInstruments(data, 'KOSPI 200').length).toBeGreaterThan(3);
  });
});
