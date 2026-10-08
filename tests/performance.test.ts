import { describe, expect, it } from 'vitest';
import {
  benchmarkReturn,
  externalFlows,
  moneyWeightedReturn,
  riskStatistics,
  timeWeightedReturn,
  valueAsOf,
  xirr,
} from '@core/index';
import { fresh, setPrice, tx } from './helpers';

const FROM = '2026-01-01';
const TO = '2026-01-03';
const TODAY = TO;

function point(instrumentId: string, date: string, close: number, adjClose = close) {
  return { id: `${instrumentId}|${date}`, instrumentId, date, close, adjClose };
}

function contributedPortfolio() {
  const data = fresh();
  data.transactions.push(
    tx({ type: 'deposit', date: FROM, amount: 100 }),
    tx({ type: 'buy', date: FROM, instrumentId: 'tw_0050', quantity: 1, price: 100 }),
    tx({ type: 'deposit', date: '2026-01-02', amount: 100 }),
    tx({ type: 'buy', date: '2026-01-02', instrumentId: 'tw_0050', quantity: 10 / 11, price: 110 }),
  );
  data.priceHistory = [
    point('tw_0050', FROM, 100),
    point('tw_0050', '2026-01-02', 110),
    point('tw_0050', TO, 121),
  ];
  setPrice(data, 'tw_0050', 121);
  return data;
}

describe('time-weighted performance', () => {
  it('chain-links a mid-period contribution instead of dividing profit by contributions', () => {
    const result = timeWeightedReturn(contributedPortfolio(), 'total', FROM, TO, TODAY);
    expect(result.periods).toHaveLength(2);
    expect(result.periods.map((period) => period.return)).toEqual(expect.arrayContaining([expect.closeTo(0.1), expect.closeTo(0.1)]));
    expect(result.cumulative).toBeCloseTo(0.21);
    // NAV ends at 231 against 200 contributed; this deliberately differs.
    expect(result.cumulative).not.toBeCloseTo(31 / 200);
  });

  it('uses the stated annualisation formula and marks short periods', () => {
    const result = timeWeightedReturn(contributedPortfolio(), 'total', FROM, TO, TODAY);
    expect(result.days).toBe(2);
    expect(result.shortPeriod).toBe(true);
    expect(result.annualized! / (1.21 ** (365 / 2) - 1)).toBeCloseTo(1, 10);
  });

  it('treats external loan repayment as total capital but not internal transfer', () => {
    const data = fresh();
    data.transactions.push(
      tx({ type: 'loan_repay', date: '2026-01-02', amount: 50, loanId: 'l1', source: 'external' }),
      tx({ type: 'transfer', date: '2026-01-02', amount: 40, bucket: 'core', toBucket: 's1' }),
    );
    expect(externalFlows(data, 'total', FROM, TO)).toEqual([{ date: '2026-01-02', amount: 50 }]);
    expect(externalFlows(data, 'core', FROM, TO)).toEqual([{ date: '2026-01-02', amount: 10 }]);
    expect(externalFlows(data, 's1', FROM, TO)).toEqual([{ date: '2026-01-02', amount: 40 }]);
  });

  it('provides XIRR for the same multi-contribution example', () => {
    const result = moneyWeightedReturn(contributedPortfolio(), 'total', FROM, TO, TODAY);
    expect(result.xirr! / (1.1 ** 365 - 1)).toBeCloseTo(1, 8);
    expect(result.flows).toEqual([{ date: '2026-01-02', amount: 100 }]);
    expect(result.xirr).toBeCloseTo(xirr([
      { date: FROM, amount: -100 }, { date: '2026-01-02', amount: -100 }, { date: TO, amount: 231 },
    ])!);
  });

  it('reports missing historical closes and makes non-positive starts undefined', () => {
    const data = fresh();
    data.transactions.push(tx({ type: 'deposit', date: FROM, amount: 100 }), tx({ type: 'buy', date: FROM, instrumentId: 'tw_0050', quantity: 1, price: 100 }));
    expect(valueAsOf(data, '2026-01-02', 'total', TODAY).missing).toEqual([{ instrumentId: 'tw_0050', date: '2026-01-02' }]);
    const empty = timeWeightedReturn(fresh(), 'total', FROM, TO, TODAY);
    expect(empty.undefinedPeriods).toBe(true);
    expect(empty.cumulative).toBeUndefined();
  });

  it('does not average bucket returns to make the total return', () => {
    const data = fresh();
    data.transactions.push(
      tx({ type: 'deposit', date: FROM, bucket: 'core', amount: 100 }),
      tx({ type: 'buy', date: FROM, bucket: 'core', instrumentId: 'tw_0050', quantity: 1, price: 100 }),
      tx({ type: 'deposit', date: FROM, bucket: 's1', amount: 300 }),
      tx({ type: 'buy', date: FROM, bucket: 's1', instrumentId: 'tw_00631L', quantity: 3, price: 100 }),
    );
    data.priceHistory = [point('tw_0050', FROM, 100), point('tw_0050', TO, 110), point('tw_00631L', FROM, 100), point('tw_00631L', TO, 120)];
    setPrice(data, 'tw_0050', 110);
    setPrice(data, 'tw_00631L', 120);
    const core = timeWeightedReturn(data, 'core', FROM, TO, TODAY).cumulative!;
    const strategy = timeWeightedReturn(data, 's1', FROM, TO, TODAY).cumulative!;
    const total = timeWeightedReturn(data, 'total', FROM, TO, TODAY).cumulative!;
    expect(core).toBeCloseTo(0.1);
    expect(strategy).toBeCloseTo(0.2);
    expect(total).toBeCloseTo(0.175);
    expect(total).not.toBeCloseTo((core + strategy) / 2);
  });
});

describe('benchmark and risk', () => {
  it('flow-matches benchmark cash flows rather than treating them as profit', () => {
    const data = contributedPortfolio();
    const benchmark = benchmarkReturn(data, 'tw_0050', FROM, TO, [
      { date: FROM, amount: 100 },
      { date: '2026-01-02', amount: 100 },
    ]);
    expect(benchmark.buyAndHold).toBeCloseTo(0.21);
    expect(benchmark.flowMatched.twr).toBeCloseTo(0.21);
    expect(benchmark.flowMatched.endingValue).toBeCloseTo(231);
  });

  it('calculates max drawdown from a known daily series', () => {
    const data = fresh();
    data.transactions.push(tx({ type: 'deposit', date: FROM, amount: 100 }), tx({ type: 'buy', date: FROM, instrumentId: 'tw_0050', quantity: 1, price: 100 }));
    data.priceHistory = [
      point('tw_0050', FROM, 100),
      point('tw_0050', '2026-01-02', 120),
      point('tw_0050', TO, 90),
    ];
    setPrice(data, 'tw_0050', 90);
    const risk = riskStatistics(data, 'total', FROM, TO, TODAY);
    expect(risk.maxDrawdown).toBeCloseTo(-0.25);
    expect(risk.peakDate).toBe('2026-01-02');
    expect(risk.troughDate).toBe(TO);
    expect(risk.sampling).toBe('daily');
  });
});

describe('window opening before inception', () => {
  it('starts measuring at the first money in, instead of reporting an undefined period', () => {
    const data = fresh();
    data.transactions.push(
      tx({ type: 'deposit', date: '2026-02-01', amount: 100_000 }),
      tx({ type: 'buy', date: '2026-02-01', instrumentId: 'tw_0050', quantity: 1000, price: 100 }),
    );
    data.priceHistory.push(
      { id: 'tw_0050|2026-02-01', instrumentId: 'tw_0050', date: '2026-02-01', close: 100 },
      { id: 'tw_0050|2026-03-01', instrumentId: 'tw_0050', date: '2026-03-01', close: 110 },
    );
    const result = timeWeightedReturn(data, 'total', '2026-01-01', '2026-03-01', '2026-06-01');
    expect(result.undefinedPeriods).toBe(false);
    expect(result.cumulative).toBeCloseTo(0.1);
  });
});

describe('benchmark window opening on a day without a close', () => {
  it('starts from the first close inside the window', () => {
    const data = fresh();
    data.priceHistory.push(
      { id: 'tw_0050|2026-01-02', instrumentId: 'tw_0050', date: '2026-01-02', close: 100 },
      { id: 'tw_0050|2026-03-01', instrumentId: 'tw_0050', date: '2026-03-01', close: 120 },
    );
    const result = benchmarkReturn(data, 'tw_0050', '2026-01-01', '2026-03-01', []);
    expect(result.buyAndHold).toBeCloseTo(0.2);
    expect(result.missing).toEqual([]);
  });
});
