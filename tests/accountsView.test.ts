import { describe, expect, it } from 'vitest';
import { accountReferences, brokerReferences, cashTotals, computePortfolio, filterTransactions, positionTotals } from '@core/index';
import { fresh, NOW, setPrice, tx } from './helpers';

describe('filterTransactions', () => {
  const txs = [
    tx({ id: 'a', type: 'deposit', date: '2026-01-01' }),
    tx({ id: 'b', type: 'buy', date: '2026-01-03', instrumentId: 'tw_0050' }),
    tx({ id: 'c', type: 'deposit', date: '2026-01-03', accountId: 'sinopac_tw' }),
    tx({ id: 'd', type: 'transfer', date: '2026-01-05', toAccountId: 'sinopac_tw' }),
  ];
  it('sorts newest first, later entries first within a day', () => {
    expect(filterTransactions(txs, {}).map((t) => t.id)).toEqual(['d', 'c', 'b', 'a']);
  });
  it('filters by account (either side), type, instrument and date range', () => {
    expect(filterTransactions(txs, { accountId: 'sinopac_tw' }).map((t) => t.id)).toEqual(['d', 'c']);
    expect(filterTransactions(txs, { type: 'deposit' }).map((t) => t.id)).toEqual(['c', 'a']);
    expect(filterTransactions(txs, { instrumentId: 'tw_0050' }).map((t) => t.id)).toEqual(['b']);
    expect(filterTransactions(txs, { from: '2026-01-02', to: '2026-01-03' }).map((t) => t.id)).toEqual(['c', 'b']);
  });
});

describe('totals and references', () => {
  it('sums positions and flags overdrawn cash', () => {
    const data = fresh();
    data.transactions.push(
      tx({ type: 'deposit', date: '2026-01-01', amount: 10_000 }),
      tx({ type: 'buy', date: '2026-01-02', instrumentId: 'tw_0050', quantity: 100, price: 100 }),
      tx({ type: 'sell', date: '2026-01-03', instrumentId: 'tw_0050', quantity: 40, price: 110 }),
    );
    setPrice(data, 'tw_0050', 120);
    const { valuation: v } = computePortfolio(data, { now: NOW });
    const t = positionTotals(v.positions, v.nav);
    expect(t.marketValue).toBe(7200);
    expect(t.unrealizedPnl).toBe(1200);
    expect(t.realizedPnl).toBe(400);
    expect(t.exposureToNav).toBeCloseTo(7200 / v.nav);
    // 10000 - 10000 + 4400 = 4400 cash; add an overdrawn account
    data.transactions.push(tx({ type: 'withdraw', date: '2026-01-04', amount: 5000, accountId: 'sinopac_tw' }));
    const c = cashTotals(computePortfolio(data, { now: NOW }).valuation.cash);
    expect(c.overdrawn).toBe(5000);
    expect(c.total).toBe(-600);
  });

  it('counts references for accounts and brokers', () => {
    const data = fresh();
    data.transactions.push(tx({ type: 'deposit', date: '2026-01-01', amount: 1, toAccountId: 'sinopac_tw' }));
    expect(accountReferences(data, 'kgi_tw').transactions).toBe(1);
    expect(accountReferences(data, 'sinopac_tw').transactions).toBe(1);
    expect(accountReferences(data, 'binance_main').transactions).toBe(0);
    expect(brokerReferences(data, 'kgi').accounts).toBe(2);
  });
});
