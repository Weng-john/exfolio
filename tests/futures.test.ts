import { describe, expect, it } from 'vitest';
import {
  bookRollover,
  buildLedger,
  computePortfolio,
  futuresPositions,
  marginByAccount,
  planRollover,
  seriesHistory,
  type AppData,
  type Instrument,
} from '@core/index';
import { fresh, setPrice, tx } from './helpers';

function contracts(): Instrument[] {
  return [
    {
      id: 'mtx_202610',
      symbol: 'MTX-2610',
      name: '小型臺指 2026-10',
      type: 'future',
      exchange: 'TAIFEX',
      currency: 'TWD',
      indexId: 'taiex',
      leverage: 1,
      multiplier: 10,
      lotSize: 1,
      quoteSource: 'manual',
      seriesId: 'mtx_series',
      expiry: '2026-10-16',
      initialMargin: 8_000,
      maintenanceMargin: 6_000,
      active: true,
    },
    {
      id: 'mtx_202611',
      symbol: 'MTX-2611',
      name: '小型臺指 2026-11',
      type: 'future',
      exchange: 'TAIFEX',
      currency: 'TWD',
      indexId: 'taiex',
      leverage: 1,
      multiplier: 10,
      lotSize: 1,
      quoteSource: 'manual',
      seriesId: 'mtx_series',
      expiry: '2026-11-20',
      initialMargin: 9_000,
      maintenanceMargin: 7_000,
      active: true,
    },
    {
      id: 'mtx_202612',
      symbol: 'MTX-2612',
      name: '小型臺指 2026-12',
      type: 'future',
      exchange: 'TAIFEX',
      currency: 'TWD',
      indexId: 'taiex',
      leverage: 1,
      multiplier: 10,
      lotSize: 1,
      quoteSource: 'manual',
      seriesId: 'mtx_series',
      expiry: '2026-12-18',
      initialMargin: 9_500,
      maintenanceMargin: 7_500,
      active: true,
    },
  ];
}

function dataWithContracts(): AppData {
  const data = fresh();
  data.instruments.push(...contracts());
  return data;
}

describe('futures engine', () => {
  it('calculates expiry days, base notional and NAV exposure', () => {
    const data = dataWithContracts();
    data.transactions.push(
      tx({ type: 'deposit', date: '2026-01-01', accountId: 'kgi_fut', amount: 100_000 }),
      tx({
        type: 'buy',
        date: '2026-01-02',
        accountId: 'kgi_fut',
        instrumentId: 'mtx_202610',
        quantity: 2,
        price: 20_000,
      }),
    );
    setPrice(data, 'mtx_202610', 20_500);
    const rows = futuresPositions(data, computePortfolio(data), '2026-10-09');
    expect(rows[0]).toMatchObject({
      contracts: 2,
      notionalInstrument: 410_000,
      notionalBase: 410_000,
      daysToExpiry: 7,
    });
    expect(rows[0].exposureNav).toBeCloseTo(410_000 / 110_000);
    expect(rows[0].unrealizedPnl).toBe(10_000);
  });

  it('flags missing margin specifications instead of turning them into zero', () => {
    const data = dataWithContracts();
    data.instruments[data.instruments.length - 3].initialMargin = undefined;
    data.instruments[data.instruments.length - 3].maintenanceMargin = undefined;
    data.transactions.push(
      tx({ type: 'deposit', date: '2026-01-01', accountId: 'kgi_fut', amount: 20_000 }),
      tx({
        type: 'buy',
        date: '2026-01-02',
        accountId: 'kgi_fut',
        instrumentId: 'mtx_202610',
        quantity: 1,
        price: 20_000,
      }),
    );
    setPrice(data, 'mtx_202610', 20_000);
    const portfolio = computePortfolio(data);
    const row = futuresPositions(data, portfolio, '2026-10-09')[0];
    const margin = marginByAccount(data, portfolio)[0];
    expect(row.marginSpecMissing).toBe(true);
    expect(row.initialMarginRequired).toBeUndefined();
    expect(margin.marginSpecMissing).toBe(true);
    expect(margin.initialMarginRequired).toBeUndefined();
  });

  it('reports a maintenance shortfall from account equity', () => {
    const data = dataWithContracts();
    data.transactions.push(
      tx({ type: 'deposit', date: '2026-01-01', accountId: 'kgi_fut', amount: 10_000 }),
      tx({
        type: 'buy',
        date: '2026-01-02',
        accountId: 'kgi_fut',
        instrumentId: 'mtx_202610',
        quantity: 1,
        price: 20_000,
      }),
    );
    setPrice(data, 'mtx_202610', 19_500);
    const row = marginByAccount(data, computePortfolio(data))[0];
    expect(row.equity).toBe(5_000);
    expect(row.maintenanceMarginRequired).toBe(6_000);
    expect(row.shortfall).toBe(1_000);
  });

  it('uses the signed contract quantity for long and short spread costs', () => {
    const data = dataWithContracts();
    const long = {
      accountId: 'kgi_fut',
      bucket: 'core',
      instrumentId: 'mtx_202610',
      quantity: 2,
      avgCost: 100,
      key: 'long',
      lots: [],
      realizedPnl: 0,
      dividends: 0,
      fees: 0,
    };
    const short = { ...long, key: 'short', quantity: -2 };
    expect(
      planRollover(data, long, 'mtx_202611', { mtx_202610: 100, mtx_202611: 110 }).spreadCost,
    ).toBe(200);
    expect(
      planRollover(data, short, 'mtx_202611', { mtx_202610: 100, mtx_202611: 110 }).spreadCost,
    ).toBe(-200);
  });

  it('books a close and open that replay as cash-settled continuous exposure', () => {
    const data = dataWithContracts();
    data.transactions.push(
      tx({ type: 'deposit', date: '2026-01-01', accountId: 'kgi_fut', amount: 100_000 }),
      tx({
        type: 'buy',
        date: '2026-01-02',
        accountId: 'kgi_fut',
        instrumentId: 'mtx_202610',
        quantity: 2,
        price: 100,
      }),
    );
    const initial = computePortfolio(data);
    const position = futuresPositions(data, initial, '2026-10-09')[0];
    const plan = planRollover(data, position, 'mtx_202611', { mtx_202610: 100, mtx_202611: 120 });
    const booked = bookRollover(data, plan, { mtx_202610: 110, mtx_202611: 120 }, '2026-10-09');
    const replay = buildLedger({
      ...data,
      transactions: [...data.transactions, ...booked.transactions],
    });
    expect(replay.positions.find((p) => p.instrumentId === 'mtx_202610')?.quantity).toBe(0);
    expect(replay.positions.find((p) => p.instrumentId === 'mtx_202611')?.quantity).toBe(2);
    expect(replay.cash.find((c) => c.accountId === 'kgi_fut')?.amount).toBe(100_000 + 200);
    expect(booked.rollover.transactionIds).toEqual(booked.transactions.map((t) => t.id));
  });

  it('keeps series P&L and roll cost continuous across two rolls', () => {
    const data = dataWithContracts();
    data.transactions.push(
      tx({
        type: 'buy',
        date: '2026-01-01',
        accountId: 'kgi_fut',
        instrumentId: 'mtx_202610',
        quantity: 2,
        price: 100,
      }),
      tx({
        type: 'sell',
        date: '2026-02-01',
        accountId: 'kgi_fut',
        instrumentId: 'mtx_202610',
        quantity: 2,
        price: 110,
      }),
      tx({
        type: 'buy',
        date: '2026-02-01',
        accountId: 'kgi_fut',
        instrumentId: 'mtx_202611',
        quantity: 2,
        price: 120,
      }),
      tx({
        type: 'sell',
        date: '2026-03-01',
        accountId: 'kgi_fut',
        instrumentId: 'mtx_202611',
        quantity: 2,
        price: 130,
      }),
      tx({
        type: 'buy',
        date: '2026-03-01',
        accountId: 'kgi_fut',
        instrumentId: 'mtx_202612',
        quantity: 2,
        price: 140,
      }),
    );
    data.rollovers.push(
      {
        id: 'r1',
        date: '2026-02-01',
        accountId: 'kgi_fut',
        bucket: 'core',
        seriesId: 'mtx_series',
        fromInstrumentId: 'mtx_202610',
        toInstrumentId: 'mtx_202611',
        quantity: 2,
        closePrice: 110,
        openPrice: 120,
      },
      {
        id: 'r2',
        date: '2026-03-01',
        accountId: 'kgi_fut',
        bucket: 'core',
        seriesId: 'mtx_series',
        fromInstrumentId: 'mtx_202611',
        toInstrumentId: 'mtx_202612',
        quantity: 2,
        closePrice: 130,
        openPrice: 140,
      },
    );
    const history = seriesHistory(data, 'mtx_series');
    expect(history.cumulativeRealizedPnl).toBe(400);
    expect(history.cumulativeRollCost).toBe(400);
    expect(history.rollovers).toHaveLength(2);
  });
});
