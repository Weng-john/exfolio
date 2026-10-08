import { describe, expect, it } from 'vitest';
import {
  calendarReturns,
  drawdownTable,
  historyFlows,
  indexOverlap,
  leverageAttribution,
  pnlContribution,
  reconstructHistory,
  rollingReturns,
  type HistoryRow,
} from '@core/index';
import { computePortfolio } from '@core/valuation';
import { fresh, setPrice, tx } from './helpers';

const D1 = '2026-01-01';
const D2 = '2026-01-02';
const D3 = '2026-01-03';

function point(instrumentId: string, date: string, close: number, adjClose = close) {
  return { id: `${instrumentId}|${date}`, instrumentId, date, close, adjClose };
}

function row(date: string, nav: number, incomplete = false): HistoryRow {
  return {
    date,
    totalAssets: nav,
    liabilities: 0,
    nav,
    cash: nav,
    grossExposure: nav,
    netExposure: nav,
    grossLeverage: 1,
    netLeverage: 1,
    debtToNav: 0,
    contributedCapital: nav,
    netExposureByIndex: {},
    incomplete,
    missing: [],
  };
}

describe('daily historical reconstruction', () => {
  it('uses valuation accounting for a leveraged ETF, future, and loan', () => {
    const data = fresh();
    data.transactions.push(
      tx({ type: 'deposit', date: D1, amount: 300 }),
      tx({ type: 'loan_draw', date: D1, amount: 100, loanId: 'loan_demo' }),
      tx({ type: 'buy', date: D1, instrumentId: 'tw_00631L', quantity: 1, price: 100 }),
      tx({ type: 'buy', date: D1, instrumentId: 'fut_TMF', quantity: 1, price: 10 }),
    );
    data.priceHistory = [
      point('tw_00631L', D1, 100),
      point('tw_00631L', D2, 120),
      point('tw_00631L', D3, 100),
      point('fut_TMF', D1, 10),
      point('fut_TMF', D2, 12),
      point('fut_TMF', D3, 11),
    ];
    setPrice(data, 'tw_00631L', 100);
    setPrice(data, 'fut_TMF', 11);
    const history = reconstructHistory(data, D1, D3, D3).rows;
    expect(history.map((item) => item.nav)).toEqual([300, 340, 310]);
    expect(history.map((item) => item.grossExposure)).toEqual([300, 360, 310]);
    expect(history[0].grossLeverage).toBeCloseTo(1);
    expect(history[1].grossLeverage).toBeCloseTo(360 / 340);
    expect(history[2].netExposureByIndex).toMatchObject({ tw50: 200, taiex: 110 });
    const current = computePortfolio(data).valuation;
    expect(history[2].nav).toBeCloseTo(current.nav);
    expect(history[2].grossLeverage).toBeCloseTo(current.grossLeverage!);
  });

  it('marks a holding without a usable historical close incomplete', () => {
    const data = fresh();
    data.transactions.push(
      tx({ type: 'deposit', date: D1, amount: 100 }),
      tx({ type: 'buy', date: D2, instrumentId: 'tw_00631L', quantity: 1, price: 100 }),
    );
    data.priceHistory = [point('tw_0050', D1, 100)];
    const history = reconstructHistory(data, D1, D2, '2026-02-01').rows;
    expect(history.find((item) => item.date === D2)).toMatchObject({
      incomplete: true,
      missing: ['tw_00631L'],
    });
  });
});

describe('flow-adjusted returns and drawdowns', () => {
  it('does not turn a deposit into a gain', () => {
    const report = drawdownTable([row(D1, 100), row(D2, 200)], [{ date: D2, amount: 100 }], 3);
    expect(report.index.map((item) => item.index)).toEqual([1, 1]);
  });

  it('reports recovered and current drawdowns', () => {
    const recovered = drawdownTable(
      [row(D1, 100), row(D2, 120), row(D3, 90), row('2026-01-04', 120)],
      [],
      3,
    );
    expect(recovered.drawdowns[0]).toMatchObject({
      peakDate: D2,
      troughDate: D3,
      depth: -0.25,
      recoveryDate: '2026-01-04',
    });
    const unrecovered = drawdownTable([row(D1, 100), row(D2, 80)], [], 3);
    expect(unrecovered.current).toMatchObject({ peakDate: D1, troughDate: D2 });
    expect(unrecovered.current?.depth).toBeCloseTo(-0.2);
    expect(unrecovered.current?.recoveryDate).toBeUndefined();
  });

  it('compounds calendar months and supplies rolling series', () => {
    const history = [
      row('2026-01-01', 100),
      row('2026-01-31', 110),
      row('2026-02-01', 110),
      row('2026-02-28', 132),
    ];
    const calendar = calendarReturns(history, []);
    expect(calendar[0].months['01']).toBeCloseTo(0.1);
    expect(calendar[0].months['02']).toBeCloseTo(0.2);
    expect(calendar[0].total).toBeCloseTo(0.32);
    expect(rollingReturns(history, [])['1M']).toHaveLength(history.length);
  });
});

describe('gross leverage attribution', () => {
  it('reconciles market-only movement', () => {
    const data = fresh();
    data.transactions.push(
      tx({ type: 'deposit', date: D1, amount: 100 }),
      tx({ type: 'loan_draw', date: D1, amount: 100, loanId: 'loan_demo' }),
      tx({ type: 'buy', date: D1, instrumentId: 'tw_0050', quantity: 2, price: 100 }),
    );
    data.priceHistory = [point('tw_0050', D1, 100), point('tw_0050', D2, 120)];
    const result = leverageAttribution(
      reconstructHistory(data, D1, D2, D3).rows,
      historyFlows(data, D1, D2),
    );
    expect(result.marketMoves).toBeCloseTo(240 / 140 - 2);
    expect(result.externalFlows).toBeCloseTo(0);
    expect(result.trading).toBeCloseTo(0);
    expect(
      result.marketMoves +
        result.externalFlows +
        result.debtChanges +
        result.trading +
        result.residual,
    ).toBeCloseTo(result.totalChange!);
  });

  it('attributes external loan repayment to external capital, not market movement', () => {
    const data = fresh();
    data.transactions.push(
      tx({ type: 'deposit', date: D1, amount: 100 }),
      tx({ type: 'loan_draw', date: D1, amount: 100, loanId: 'loan_demo' }),
      tx({ type: 'buy', date: D1, instrumentId: 'tw_0050', quantity: 2, price: 100 }),
      tx({
        type: 'loan_repay',
        date: D2,
        amount: 50,
        principal: 50,
        loanId: 'loan_demo',
        source: 'external',
      }),
    );
    data.priceHistory = [point('tw_0050', D1, 100), point('tw_0050', D2, 100)];
    const result = leverageAttribution(
      reconstructHistory(data, D1, D2, D3).rows,
      historyFlows(data, D1, D2),
    );
    expect(result.externalFlows).toBeCloseTo(200 / 150 - 2);
    expect(result.marketMoves).toBeCloseTo(0);
    expect(result.trading).toBeCloseTo(0);
  });

  it('attributes an exposure purchase to trading', () => {
    const data = fresh();
    data.transactions.push(
      tx({ type: 'deposit', date: D1, amount: 200 }),
      tx({ type: 'buy', date: D1, instrumentId: 'tw_0050', quantity: 1, price: 100 }),
      tx({ type: 'buy', date: D2, instrumentId: 'tw_0050', quantity: 1, price: 100 }),
    );
    data.priceHistory = [point('tw_0050', D1, 100), point('tw_0050', D2, 100)];
    const result = leverageAttribution(
      reconstructHistory(data, D1, D2, D3).rows,
      historyFlows(data, D1, D2),
    );
    expect(result.trading).toBeCloseTo(0.5);
    expect(result.residual).toBeCloseTo(0);
  });
});

describe('P&L contribution and index overlap', () => {
  it('reconciles price effect and dividends to NAV change, retaining a remainder', () => {
    const data = fresh();
    data.transactions.push(
      tx({ type: 'deposit', date: D1, amount: 100 }),
      tx({ type: 'buy', date: D1, instrumentId: 'tw_0050', quantity: 1, price: 100 }),
      tx({ type: 'dividend', date: D2, instrumentId: 'tw_0050', amount: 2 }),
    );
    data.priceHistory = [point('tw_0050', D1, 100), point('tw_0050', D2, 110)];
    const history = reconstructHistory(data, D1, D2, D3).rows;
    const result = pnlContribution(data, history, historyFlows(data, D1, D2));
    expect(result.explained).toBeCloseTo(12);
    expect(result.navChangeNetOfFlows).toBeCloseTo(12);
    expect(result.unexplained).toBeCloseTo(0);
  });

  it('calculates +1 and -1 correlations and withholds too-small samples', () => {
    const data = fresh();
    const dates = [
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
      '2026-01-04',
      '2026-01-05',
      '2026-01-06',
    ];
    const left = [100, 110, 99, 118.8, 95.04, 114.048];
    const right = [100, 110, 99, 118.8, 95.04, 114.048];
    const inverse = [100, 90, 99, 79.2, 95.04, 76.032];
    data.priceHistory = dates.flatMap((date, index) => [
      point('us_VOO', date, left[index]),
      point('us_QQQ', date, inverse[index]),
      point('us_VXUS', date, right[index]),
    ]);
    const history = [
      { ...row(D1, 100), netExposureByIndex: { sp500: 1, ndx: 1, global_ex_us: 1 } },
    ];
    const overlap = indexOverlap(data, history);
    const sp500 = overlap.rows.find((item) => item.indexId === 'sp500')!;
    expect(sp500.correlations.global_ex_us).toBeCloseTo(1);
    expect(sp500.correlations.ndx).toBeCloseTo(-1);
    data.priceHistory = data.priceHistory.slice(0, 4);
    expect(indexOverlap(data, history).rows[0].correlations.ndx).toBeUndefined();
  });
});
