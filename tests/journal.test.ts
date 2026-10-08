import { describe, expect, it } from 'vitest';
import {
  buildLedger,
  journalEntries,
  replayTrades,
  roundTrips,
  tradeGroupSummary,
  tradeStats,
  type AppData,
  type RoundTrip,
} from '@core/index';
import { fresh, tx } from './helpers';

function journalData(): AppData {
  const data = fresh();
  data.strategies.push(
    { id: 's1', name: '示範策略甲', status: 'active' },
    { id: 's2', name: '示範策略乙', status: 'active' },
  );
  data.tradeGroups.push({ id: 'g1', strategyId: 's1', name: '示範價差', status: 'open' });
  data.transactions.push(
    tx({ type: 'deposit', date: '2026-01-01', amount: 1_000_000 }),
    // same ticker in core and in s1: separate FIFO queues
    tx({
      type: 'buy',
      date: '2026-01-02',
      instrumentId: 'tw_0050',
      quantity: 100,
      price: 100,
      fee: 10,
    }),
    tx({
      type: 'buy',
      date: '2026-01-02',
      instrumentId: 'tw_0050',
      quantity: 100,
      price: 50,
      fee: 10,
      bucket: 's1',
      reason: '回檔布局',
      tags: ['swing'],
    }),
    tx({
      type: 'buy',
      date: '2026-01-10',
      instrumentId: 'tw_0050',
      quantity: 100,
      price: 60,
      fee: 10,
      bucket: 's1',
      tags: ['swing'],
      tradeGroupId: 'g1',
    }),
    tx({
      type: 'sell',
      date: '2026-01-20',
      instrumentId: 'tw_0050',
      quantity: 150,
      price: 70,
      fee: 10,
      tax: 20,
      bucket: 's1',
      tradeGroupId: 'g1',
    }),
    tx({
      type: 'sell',
      date: '2026-01-25',
      instrumentId: 'tw_0050',
      quantity: 50,
      price: 55,
      fee: 5,
      bucket: 's2',
    }), // short in s2
    tx({
      type: 'buy',
      date: '2026-02-01',
      instrumentId: 'tw_0050',
      quantity: 50,
      price: 50,
      fee: 5,
      bucket: 's2',
    }),
  );
  return data;
}

describe('journalEntries', () => {
  it('shows strategy trades only unless core is requested', () => {
    const data = journalData();
    expect(journalEntries(data).every((e) => e.strategyId !== 'core')).toBe(true);
    expect(journalEntries(data)).toHaveLength(5);
    expect(journalEntries(data, { includeCore: true })).toHaveLength(6);
    expect(journalEntries(data, { strategyId: 'core' })).toHaveLength(1);
  });

  it('agrees with the ledger on realized P&L per position', () => {
    const data = journalData();
    const ledger = buildLedger(data);
    const replay = replayTrades(data);
    for (const pos of ledger.positions) {
      const sum = replay.entries
        .filter(
          (e) =>
            e.accountId === pos.accountId &&
            e.instrumentId === pos.instrumentId &&
            e.strategyId === pos.bucket,
        )
        .reduce((s, e) => s + e.realizedPnl, 0);
      expect(sum).toBeCloseTo(pos.realizedPnl);
    }
    expect(replay.entries.reduce((s, e) => s + e.realizedPnlBase, 0)).toBeCloseTo(
      ledger.totals.realizedPnl,
    );
    expect(replay.entries.reduce((s, e) => s + e.costsBase, 0)).toBeCloseTo(ledger.totals.fees);
  });

  it('computes FIFO realized P&L of each trade', () => {
    const data = journalData();
    const sell = journalEntries(data, { strategyId: 's1' }).find((e) => e.side === 'sell')!;
    // 100 @50 then 50 of the 100 @60: (70-50)*100 + (70-60)*50
    expect(sell.realizedPnl).toBe(2_500);
    expect(sell.costs).toBe(30);
    expect(sell.reason).toBeUndefined();
    const buy = journalEntries(data, { strategyId: 's1' }).find((e) => e.date === '2026-01-10')!;
    expect(buy.openQuantity).toBe(50);
  });

  it('filters by instrument, date, tag, group', () => {
    const data = journalData();
    expect(journalEntries(data, { tag: 'swing' })).toHaveLength(2);
    expect(journalEntries(data, { tradeGroupId: 'g1' })).toHaveLength(2);
    expect(journalEntries(data, { from: '2026-01-20', to: '2026-01-31' })).toHaveLength(2);
    expect(journalEntries(data, { instrumentId: 'tw_00631L' })).toHaveLength(0);
  });
});

describe('round trips', () => {
  it('matches entry lots to exits, longs and shorts, with costs pro rata', () => {
    const data = journalData();
    const trips = roundTrips(data, { strategyId: 's1' });
    expect(trips).toHaveLength(2);
    const [a, b] = trips;
    expect(a.quantity).toBe(100);
    expect(a.grossPnl).toBe(2_000);
    expect(a.holdingDays).toBe(18);
    // entry fee 10 + exit costs 30 x 100/150
    expect(a.costs).toBeCloseTo(10 + 20);
    expect(a.netPnl).toBeCloseTo(1_970);
    expect(a.returnPct).toBeCloseTo(1_970 / 5_000);
    expect(b.quantity).toBe(50);
    expect(b.grossPnl).toBe(500);
    expect(b.costs).toBeCloseTo(5 + 10);
    expect(a.tags).toEqual(['swing']);
    expect(b.tradeGroupId).toBe('g1');

    const [short] = roundTrips(data, { strategyId: 's2' });
    expect(short.direction).toBe('short');
    expect(short.grossPnl).toBe(250);
    expect(short.costs).toBeCloseTo(10);
  });

  it('gives no return percentage for futures', () => {
    const data = fresh();
    data.transactions.push(
      tx({ type: 'deposit', date: '2026-01-01', amount: 500_000, accountId: 'kgi_fut' }),
      tx({
        type: 'buy',
        date: '2026-01-02',
        instrumentId: 'fut_MTX',
        quantity: 1,
        price: 20_000,
        accountId: 'kgi_fut',
        bucket: 's1',
        fee: 20,
      }),
      tx({
        type: 'sell',
        date: '2026-01-03',
        instrumentId: 'fut_MTX',
        quantity: 1,
        price: 20_100,
        accountId: 'kgi_fut',
        bucket: 's1',
        fee: 20,
      }),
    );
    const [t] = roundTrips(data, { strategyId: 's1' });
    expect(t.grossPnl).toBe(5_000);
    expect(t.netPnl).toBe(4_960);
    expect(t.returnPct).toBeUndefined();
  });
});

describe('tradeGroupSummary', () => {
  it('sums legs, costs and status', () => {
    const data = journalData();
    const g = tradeGroupSummary(data, 'g1');
    expect(g.legs).toHaveLength(2);
    expect(g.realizedPnlBase).toBe(2_500);
    expect(g.costsBase).toBe(40);
    expect(g.netPnlBase).toBe(2_460);
    expect(g.status).toBe('open');
    expect(g.fullyClosed).toBe(false); // 50 of the second leg are still open
    expect(g.firstDate).toBe('2026-01-10');
  });
});

describe('tradeStats', () => {
  const trip = (netPnlBase: number, exitDate: string, holdingDays = 10, costsBase = 1): RoundTrip =>
    ({ netPnlBase, exitDate, holdingDays, costsBase }) as RoundTrip;

  it('computes the standard figures', () => {
    const s = tradeStats([
      trip(300, '2026-01-01'),
      trip(-100, '2026-01-02', 20),
      trip(200, '2026-01-03'),
      trip(-400, '2026-01-04', 30),
      trip(100, '2026-01-05'),
    ]);
    expect(s.count).toBe(5);
    expect(s.winRate).toBeCloseTo(0.6);
    expect(s.averageWin).toBeCloseTo(200);
    expect(s.averageLoss).toBeCloseTo(-250);
    expect(s.profitFactor).toBeCloseTo(600 / 500);
    expect(s.expectancy).toBeCloseTo(20);
    expect(s.totalCosts).toBe(5);
    expect(s.averageHoldingDays).toBeCloseTo(16);
    expect(s.largestWin).toBe(300);
    expect(s.largestLoss).toBe(-400);
    // cumulative 300, 200, 400, 0, 100 -> peak 400, trough 0
    expect(s.maxDrawdown).toBe(400);
  });

  it('handles no trades without dividing by zero', () => {
    const s = tradeStats([]);
    expect(s.count).toBe(0);
    expect(s.winRate).toBeUndefined();
    expect(s.expectancy).toBeUndefined();
    expect(s.profitFactor).toBeUndefined();
    expect(s.averageHoldingDays).toBeUndefined();
    expect(s.maxDrawdown).toBe(0);
  });

  it('leaves profit factor undefined when every trade wins', () => {
    const s = tradeStats([trip(100, '2026-01-01'), trip(50, '2026-01-02')]);
    expect(s.winRate).toBe(1);
    expect(s.profitFactor).toBeUndefined();
    expect(s.averageLoss).toBeUndefined();
    expect(s.largestLoss).toBeUndefined();
    expect(s.maxDrawdown).toBe(0);
  });

  it('gives profit factor 0 and a drawdown when every trade loses', () => {
    const s = tradeStats([trip(-100, '2026-01-01'), trip(-50, '2026-01-02')]);
    expect(s.winRate).toBe(0);
    expect(s.profitFactor).toBe(0);
    expect(s.averageWin).toBeUndefined();
    expect(s.maxDrawdown).toBe(150);
  });
});
