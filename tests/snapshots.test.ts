import { describe, expect, it } from 'vitest';
import { computePortfolio, leverageHistory, makeSnapshot, portfolioAlerts, upsertSnapshot } from '@core/index';
import { fresh, NOW, setPrice, tx } from './helpers';

function leveraged() {
  const data = fresh();
  data.loans.push({
    id: 'credit1', name: '信貸', kind: 'credit', lender: '銀行', currency: 'TWD',
    principal: 100_000, annualRate: 0.03, method: 'annuity', startDate: '2026-01-01', active: true,
  });
  data.transactions.push(
    tx({ type: 'deposit', date: '2026-01-01', amount: 100_000 }),
    tx({ type: 'loan_draw', date: '2026-01-01', amount: 100_000, loanId: 'credit1' }),
    tx({ type: 'buy', date: '2026-01-02', instrumentId: 'tw_0050', quantity: 2000, price: 100 }),
  );
  setPrice(data, 'tw_0050', 100);
  return data;
}

describe('snapshots', () => {
  it('captures NAV, exposure and per-index net exposure', () => {
    const s = makeSnapshot(computePortfolio(leveraged(), { now: NOW }), '2026-10-09');
    expect(s).toMatchObject({ id: '2026-10-09', nav: 100_000, liabilities: 100_000, grossExposure: 200_000 });
    expect(s.byIndex.tw50).toBe(200_000);
  });

  it('keeps one snapshot per day and returns the same array when unchanged', () => {
    const data = leveraged();
    const first = makeSnapshot(computePortfolio(data, { now: NOW }), '2026-10-09');
    const list = upsertSnapshot([], first);
    expect(upsertSnapshot(list, { ...first })).toBe(list);
    setPrice(data, 'tw_0050', 125);
    const updated = upsertSnapshot(list, makeSnapshot(computePortfolio(data, { now: NOW }), '2026-10-09'));
    expect(updated).toHaveLength(1);
    expect(updated[0].nav).toBe(150_000);
    const earlier = upsertSnapshot(updated, { ...first, id: '2026-10-01', date: '2026-10-01' });
    expect(earlier.map((s) => s.date)).toEqual(['2026-10-01', '2026-10-09']);
  });

  it('derives leverage history, leaving ratios undefined when NAV is not positive', () => {
    const data = leveraged();
    const a = makeSnapshot(computePortfolio(data, { now: NOW }), '2026-10-01');
    const h = leverageHistory([{ ...a, id: 'x', date: '2026-10-02', nav: 0 }, a]);
    expect(h[0]).toMatchObject({ date: '2026-10-01', grossLeverage: 2, debtToNav: 1, pnl: 0 });
    expect(h[1].grossLeverage).toBeUndefined();
  });
});

describe('alerts', () => {
  it('stays quiet without thresholds and never blocks: it only reports', () => {
    const data = leveraged();
    expect(portfolioAlerts(data, computePortfolio(data, { now: NOW }).valuation)).toEqual([]);
  });

  it('flags thresholds, stale and missing quotes, and overdrawn cash', () => {
    const data = leveraged();
    data.settings[0].alerts = { grossLeverage: 1.5, debtToNav: 0.5, staleQuoteMinutes: 60 };
    data.transactions.push(tx({ type: 'buy', date: '2026-01-03', instrumentId: 'tw_00631L', quantity: 10, price: 100 }));
    data.prices[0].asOf = '2026-10-01T00:00:00Z';
    const ids = portfolioAlerts(data, computePortfolio(data, { now: NOW }).valuation).map((a) => a.id);
    expect(ids).toEqual(['gross-leverage', 'debt-to-nav', 'overdrawn', 'missing-price', 'stale-price']);
  });
});
