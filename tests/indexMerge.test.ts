import { describe, expect, it } from 'vitest';
import { computePortfolio, mergeIndices } from '@core/index';
import { fresh, NOW, setPrice, tx } from './helpers';

function held() {
  const data = fresh();
  data.transactions.push(
    tx({ type: 'deposit', date: '2026-01-01', amount: 1_000_000 }),
    tx({ type: 'buy', date: '2026-01-02', instrumentId: 'tw_0050', quantity: 1000, price: 100 }),
    tx({ type: 'deposit', date: '2026-01-01', accountId: 'kgi_fut', amount: 200_000 }),
    tx({
      type: 'buy',
      date: '2026-01-02',
      accountId: 'kgi_fut',
      instrumentId: 'fut_TMF',
      quantity: 2,
      price: 20_000,
    }),
  );
  setPrice(data, 'tw_0050', 100);
  setPrice(data, 'fut_TMF', 20_000);
  return data;
}

describe('mergeIndices', () => {
  it('counts the merged index under the kept one, leaving totals unchanged', () => {
    const data = held();
    const before = computePortfolio(data, { now: NOW }).valuation;
    const { data: merged, summary } = mergeIndices(data, 'taiex', 'tw50');
    const after = computePortfolio(merged, { now: NOW }).valuation;

    expect(before.byIndex.map((i) => i.indexId).sort()).toEqual(['taiex', 'tw50']);
    expect(after.byIndex.map((i) => i.indexId)).toEqual(['tw50']);
    expect(after.byIndex[0].net).toBe(100_000 + 2 * 20_000 * 10);
    expect(after.nav).toBe(before.nav);
    expect(after.grossExposure).toBe(before.grossExposure);
    expect(merged.indices.some((i) => i.id === 'taiex')).toBe(false);
    expect(merged.instruments.filter((i) => i.indexId === 'taiex')).toEqual([]);
    expect(summary.instruments).toBe(data.instruments.filter((i) => i.indexId === 'taiex').length);
  });

  it('adds targets together and keeps the tighter tolerance', () => {
    const data = held();
    data.targets = [
      { id: 'a', indexId: 'tw50', targetWeight: 0.6, tolerance: 0.05 },
      {
        id: 'b',
        indexId: 'taiex',
        targetWeight: 0.3,
        tolerance: 0.02,
        preferredInstrumentId: 'fut_TMF',
      },
      { id: 'c', indexId: 'sp500', targetWeight: 0.4, tolerance: 0.05 },
    ];
    const { data: merged, summary } = mergeIndices(data, 'taiex', 'tw50');
    expect(merged.targets).toHaveLength(2);
    expect(merged.targets.find((t) => t.indexId === 'tw50')).toMatchObject({
      id: 'a',
      tolerance: 0.02,
      preferredInstrumentId: 'fut_TMF',
    });
    expect(merged.targets.find((t) => t.indexId === 'tw50')!.targetWeight).toBeCloseTo(0.9);
    expect(summary.targets).toBe(1);
  });

  it('moves a lone target, strategy benchmarks and snapshot history', () => {
    const data = held();
    data.targets = [{ id: 'b', indexId: 'taiex', targetWeight: 0.3, tolerance: 0.02 }];
    data.strategies = [{ id: 's', name: '示範策略', status: 'active', benchmarkIndexId: 'taiex' }];
    data.snapshots = [
      {
        id: '2026-01-05',
        date: '2026-01-05',
        nav: 1,
        assets: 1,
        liabilities: 0,
        cash: 0,
        grossExposure: 3,
        netExposure: 3,
        contributedCapital: 1,
        byIndex: { tw50: 1, taiex: 2 },
      },
    ];
    const { data: merged, summary } = mergeIndices(data, 'taiex', 'tw50');
    expect(merged.targets).toEqual([
      { id: 'b', indexId: 'tw50', targetWeight: 0.3, tolerance: 0.02 },
    ]);
    expect(merged.strategies[0].benchmarkIndexId).toBe('tw50');
    expect(merged.snapshots[0].byIndex).toEqual({ tw50: 3 });
    expect(summary).toMatchObject({ strategies: 1, snapshots: 1 });
  });

  it('does not change the input and points out saved scenarios to review', () => {
    const data = held();
    data.scenarios = [
      { id: 'x', kind: 'stress', name: '示範', params: { shocks: { taiex: -0.2 } } },
    ];
    const copy = JSON.stringify(data);
    const { summary } = mergeIndices(data, 'taiex', 'tw50');
    expect(JSON.stringify(data)).toBe(copy);
    expect(summary.scenariosToReview).toBe(1);
  });

  it('refuses a merge into itself or with an unknown index', () => {
    const data = held();
    expect(() => mergeIndices(data, 'tw50', 'tw50')).toThrow();
    expect(() => mergeIndices(data, 'nope', 'tw50')).toThrow();
    expect(() => mergeIndices(data, 'tw50', 'nope')).toThrow();
  });
});
