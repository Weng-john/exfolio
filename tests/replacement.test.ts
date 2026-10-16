import { describe, expect, it } from 'vitest';
import {
  capitalEfficiency,
  computePortfolio,
  DEFAULT_ASSUMPTIONS,
  historicalComparison,
  holdingCost,
  replacementAnalysis,
  substitutionEffect,
  type AppData,
  type Instrument,
  type ReplacementAssumptions,
} from '@core/index';
import { fresh, NOW, setFx, setPrice, tx } from './helpers';

const A: ReplacementAssumptions = {
  financingRate: 0.05,
  cashRate: 0.02,
  volatility: 0.2,
  rollsPerYear: 4,
  slippage: 0.001,
};
const opts = { now: NOW };

function setup(): AppData {
  const data = fresh();
  const set = (id: string, patch: Partial<Instrument>) => {
    const i = data.instruments.find((x) => x.id === id)!;
    Object.assign(i, patch);
  };
  set('tw_0050', { expenseRatio: 0.003 });
  set('tw_00631L', { expenseRatio: 0.01 });
  set('us_VOO', { expenseRatio: 0.0003 });
  set('fut_TX', { initialMargin: 300_000 });
  set('fut_ES', { initialMargin: 12_000 });
  data.brokers[0].fees = {
    etf: { rate: 0.001425, discount: 0.5, sellTaxRate: 0.001 },
    future: { perUnit: 30, taxRate: 0.00002 },
  };
  data.brokers[1].fees = { future: { perUnit: 2 } };
  setPrice(data, 'tw_0050', 100);
  setPrice(data, 'tw_00631L', 50);
  setPrice(data, 'fut_TX', 20_000);
  setPrice(data, 'us_VOO', 400, 'USD');
  setPrice(data, 'fut_ES', 5000, 'USD');
  setFx(data, 'USD', 'TWD', 30);
  return data;
}
const inst = (d: AppData, id: string) => d.instruments.find((i) => i.id === id)!;
const comp = (h: ReturnType<typeof holdingCost>, key: string) =>
  h.components.find((c) => c.key === key);

describe('holdingCost', () => {
  it('charges only the expense ratio on an unleveraged ETF', () => {
    const d = setup();
    const h = holdingCost(inst(d, 'tw_0050'), 1_000_000, A, { price: 100, fxRate: 1 });
    expect(comp(h, 'expense')!.annual).toBeCloseTo(3000);
    expect(h.totalAnnual).toBeCloseTo(3000);
    expect(h.capital).toBeCloseTo(1_000_000);
    expect(h.flags).toEqual([]);
  });

  it('adds embedded financing, volatility drag and a cash offset for a 2x ETF', () => {
    const d = setup();
    const h = holdingCost(inst(d, 'tw_00631L'), 1_000_000, A, { price: 50, fxRate: 1 });
    expect(h.capital).toBeCloseTo(500_000);
    expect(comp(h, 'expense')!.annual).toBeCloseTo(5000);
    expect(comp(h, 'embeddedFinancing')!.annual).toBeCloseTo(25_000);
    // 0.5 x 2 x 1 x 0.2^2 x 500,000
    expect(comp(h, 'volatilityDrag')!.annual).toBeCloseTo(20_000);
    expect(comp(h, 'cashOffset')!.annual).toBeCloseTo(-10_000);
    expect(h.totalAnnual).toBeCloseTo(40_000);
    expect(h.grossAnnual).toBeCloseTo(50_000);
  });

  it('uses 1/2 L (L-1) sigma^2 for a 3x ETF', () => {
    const d = setup();
    const three = { ...inst(d, 'tw_00631L'), leverage: 3 };
    const h = holdingCost(three, 900_000, A, { price: 50, fxRate: 1 });
    // capital 300,000; 0.5 x 3 x 2 x 0.04 x 300,000
    expect(comp(h, 'volatilityDrag')!.annual).toBeCloseTo(36_000);
    expect(comp(h, 'embeddedFinancing')!.annual).toBeCloseTo(2 * 300_000 * 0.05);
  });

  it('flags an unknown expense ratio instead of assuming zero', () => {
    const d = setup();
    const i = { ...inst(d, 'tw_0050'), expenseRatio: undefined };
    const h = holdingCost(i, 1_000_000, A, { price: 100, fxRate: 1 });
    expect(comp(h, 'expense')).toMatchObject({ known: false, annual: 0 });
    expect(h.flags.join()).toContain('expenseRatio');
  });

  it('prices futures: implied financing, roll cost from the fee rule, margin cash offset', () => {
    const d = setup();
    const h = holdingCost(inst(d, 'fut_TX'), 8_000_000, A, {
      price: 20_000,
      fxRate: 1,
      broker: d.brokers[0],
    });
    expect(comp(h, 'impliedFinancing')!.annual).toBeCloseTo(400_000);
    // 2 contracts: per side 60 fee + 160 tax; both sides 440; + 0.1% x 8M = 8,000
    expect(comp(h, 'rollCost')!.annual).toBeCloseTo(4 * (440 + 8000));
    expect(h.capital).toBeCloseTo(600_000);
    expect(comp(h, 'cashOffset')!.annual).toBeCloseTo(-(8_000_000 - 600_000) * 0.02);
    expect(h.totalAnnual).toBeCloseTo(400_000 + 33_760 - 148_000);
  });

  it('flags a missing margin and a missing fee rule, not zero', () => {
    const d = setup();
    const noMargin = { ...inst(d, 'fut_TX'), initialMargin: undefined };
    const h = holdingCost(noMargin, 8_000_000, A, { price: 20_000, fxRate: 1 });
    expect(h.capital).toBeUndefined();
    expect(comp(h, 'cashOffset')).toBeUndefined();
    expect(h.flags.join()).toContain('保證金');
    expect(h.flags.join()).toContain('手續費規則');
    expect(comp(h, 'rollCost')!.known).toBe(false);
  });

  it('converts a USD future roll fee to the base currency', () => {
    const d = setup();
    const h = holdingCost(
      inst(d, 'fut_ES'),
      7_500_000,
      { ...A, slippage: 0 },
      { price: 5000, fxRate: 30, broker: d.brokers[1] },
    );
    // 1 contract, USD 2 per side x 2 sides x 30
    expect(comp(h, 'rollCost')!.annual).toBeCloseTo(4 * 120);
    expect(h.capital).toBeCloseTo(12_000 * 30);
  });
});

describe('capitalEfficiency', () => {
  it('rounds an ETF down to the lot and reports the error', () => {
    const d = setup();
    const c = capitalEfficiency(inst(d, 'tw_0050'), 1_050_050, { price: 100, fxRate: 1 });
    expect(c.quantity).toBe(10_500);
    expect(c.exposure).toBe(1_050_000);
    expect(c.exposureError).toBe(-50);
    expect(c.capital).toBe(1_050_000);
  });

  it('ties up half the capital in a 2x ETF', () => {
    const d = setup();
    const c = capitalEfficiency(inst(d, 'tw_00631L'), 1_000_050, { price: 50, fxRate: 1 });
    expect(c.quantity).toBe(10_000);
    expect(c.exposure).toBe(1_000_000);
    expect(c.capital).toBe(500_000);
    expect(c.freeCashVsUnleveraged).toBeCloseTo(1_000_050 - 500_000);
  });

  it('uses whole contracts and initial margin for futures', () => {
    const d = setup();
    const c = capitalEfficiency(inst(d, 'fut_TX'), 9_000_000, { price: 20_000, fxRate: 1 });
    expect(c.quantity).toBe(2);
    expect(c.exposureError).toBe(-1_000_000);
    expect(c.capital).toBe(600_000);
    expect(c.isMargin).toBe(true);
  });

  it('flags a missing margin', () => {
    const d = setup();
    const i = { ...inst(d, 'fut_TX'), initialMargin: undefined };
    const c = capitalEfficiency(i, 8_000_000, { price: 20_000, fxRate: 1 });
    expect(c.capital).toBeUndefined();
    expect(c.flags.join()).toContain('保證金');
  });

  it('converts a USD ETF into TWD', () => {
    const d = setup();
    const c = capitalEfficiency(inst(d, 'us_VOO'), 1_200_000, { price: 400, fxRate: 30 });
    expect(c.quantity).toBe(100);
    expect(c.capital).toBe(1_200_000);
  });
});

function addHistory(d: AppData, id: string, rows: Array<[string, number, number?]>) {
  for (const [date, close, adjClose] of rows)
    d.priceHistory.push({ id: `${id}|${date}`, instrumentId: id, date, close, adjClose });
}

describe('historicalComparison', () => {
  it('measures decay of a 2x ETF against L x index on an alternating path', () => {
    const d = setup();
    addHistory(d, 'tw_0050', [
      ['2026-03-02', 100],
      ['2026-03-03', 110],
      ['2026-03-04', 99],
    ]);
    addHistory(d, 'tw_00631L', [
      ['2026-03-02', 100],
      ['2026-03-03', 120],
      ['2026-03-04', 96],
    ]);
    const h = historicalComparison(d, 'tw_0050', 'tw_00631L', '2026-03-01', '2026-03-31');
    expect(h.daysUsed).toBe(3);
    expect(h.base!.totalReturn).toBeCloseTo(-0.01);
    expect(h.candidate!.totalReturn).toBeCloseTo(-0.04);
    // (1-x^2) vs (1-4x^2) with x = 0.1: closed form
    expect(h.candidate!.totalReturn).toBeCloseTo(1.2 * 0.8 - 1);
    expect(h.naive).toMatchObject({ ratio: 2 });
    expect(h.naive!.naiveReturn).toBeCloseTo(-0.02);
    expect(h.naive!.realisedGap).toBeCloseTo(-0.02);
    expect(h.base!.maxDrawdown).toBeCloseTo(-0.1);
    expect(h.candidate!.maxDrawdown).toBeCloseTo(-0.2);
    expect(h.correlation).toBeCloseTo(1);
    expect(h.base!.volatility).toBeCloseTo(Math.sqrt(0.02 * 252));
    expect(h.series.at(-1)).toMatchObject({ naive: expect.closeTo(-0.02) });
  });

  it('aligns on common dates, lists the rest and prefers adjClose', () => {
    const d = setup();
    addHistory(d, 'tw_0050', [
      ['2026-03-02', 1, 100],
      ['2026-03-03', 1, 110],
      ['2026-03-04', 1, 121],
      ['2026-03-05', 130],
    ]);
    addHistory(d, 'tw_00631L', [
      ['2026-03-02', 100],
      ['2026-03-04', 144],
    ]);
    const h = historicalComparison(d, 'tw_0050', 'tw_00631L', '2026-03-01', '2026-03-31');
    expect(h.daysUsed).toBe(2);
    expect(h.base!.totalReturn).toBeCloseTo(0.21);
    expect(h.missing.map((m) => [m.instrumentId, m.date])).toEqual([
      ['tw_00631L', '2026-03-03'],
      ['tw_00631L', '2026-03-05'],
    ]);
  });

  it('reports an instrument with no data rather than inventing it', () => {
    const d = setup();
    addHistory(d, 'tw_0050', [['2026-03-02', 100]]);
    const h = historicalComparison(d, 'tw_0050', 'tw_00631L', '2026-03-01', '2026-03-31');
    expect(h.daysUsed).toBe(0);
    expect(h.base).toBeUndefined();
    expect(h.missing).toEqual([expect.objectContaining({ instrumentId: 'tw_00631L' })]);
  });
});

describe('replacementAnalysis', () => {
  function held(): AppData {
    const d = setup();
    d.transactions.push(
      tx({ type: 'deposit', date: '2026-01-01', amount: 2_000_000 }),
      tx({
        type: 'buy',
        date: '2026-01-02',
        instrumentId: 'tw_00631L',
        quantity: 10_000,
        price: 50,
      }),
    );
    return d;
  }
  const run = (d: AppData, from: string) =>
    replacementAnalysis(d, computePortfolio(d, opts).valuation, {
      indexId: 'tw50',
      fromInstrumentId: from,
      exposure: 1_000_000,
      assumptions: A,
      accountId: 'kgi_tw',
    });

  it('computes switching cost and break-even from the current holding', () => {
    const d = held();
    const a = run(d, 'tw_00631L');
    expect(a.rows.map((r) => r.symbol)).toEqual(expect.arrayContaining(['0050', '00631L']));
    expect(a.rows.some((r) => r.instrumentId === 'tw_00632R')).toBe(false);
    const r = a.rows.find((x) => x.symbol === '0050')!;
    // sell 500,000: 356.25 fee + 500 tax; buy 1,000,000: 712.5 fee; slippage 0.1% x 1.5M
    expect(r.switching!.total).toBeCloseTo(356.25 + 500 + 712.5 + 1500);
    expect(r.annualSaving).toBeCloseTo(37_000);
    expect(r.breakEvenYears).toBeCloseTo(3068.75 / 37_000);
    expect(a.rows.find((r) => r.symbol === '00631L')!.isCurrent).toBe(true);
    expect(a.rows.find((r) => r.symbol === '00631L')!.notes.join()).toContain('路徑相依');
  });

  it('leaves break-even undefined when the candidate costs more', () => {
    const d = held();
    d.transactions = [];
    d.transactions.push(
      tx({ type: 'deposit', date: '2026-01-01', amount: 2_000_000 }),
      tx({
        type: 'buy',
        date: '2026-01-02',
        instrumentId: 'tw_0050',
        quantity: 10_000,
        price: 100,
      }),
    );
    const a = run(d, 'tw_0050');
    const lev = a.rows.find((x) => x.symbol === '00631L')!;
    expect(lev.annualSaving).toBeLessThan(0);
    expect(lev.breakEvenYears).toBeUndefined();
    expect(lev.switching!.total).toBeGreaterThan(0);
  });

  it('defaults to the core exposure and notes FX and futures caveats', () => {
    const d = held();
    const v = computePortfolio(d, opts).valuation;
    const a = replacementAnalysis(d, v, { indexId: 'tw50', assumptions: DEFAULT_ASSUMPTIONS });
    expect(a.exposure).toBeCloseTo(1_000_000);
    const sp = replacementAnalysis(d, v, { indexId: 'sp500', exposure: 1_200_000, assumptions: A });
    expect(sp.rows.find((r) => r.symbol === 'VOO')!.notes.join()).toContain('USD/TWD');
    const es = sp.rows.find((r) => r.symbol === 'ES')!;
    expect(es.notes.join()).toContain('追繳');
    expect(sp.rows.every((r) => !('best' in r))).toBe(true);
  });
});

describe('substitutionEffect', () => {
  function held(shares = 10_000): AppData {
    const d = setup();
    d.transactions.push(
      tx({ type: 'deposit', date: '2026-01-01', amount: 5_000_000 }),
      tx({
        type: 'buy',
        date: '2026-01-02',
        instrumentId: 'tw_00631L',
        quantity: shares,
        price: 50,
      }),
    );
    return d;
  }
  const key = (p: ReturnType<typeof computePortfolio>) =>
    p.valuation.positions.find((x) => x.instrumentId === 'tw_00631L')!.key;

  it('keeps exposure unchanged when half a position moves to the plain ETF', () => {
    const d = held();
    const p = computePortfolio(d, opts);
    const e = substitutionEffect(d, p, {
      fromPositionKey: key(p),
      toInstrumentId: 'tw_0050',
      fraction: 0.5,
      assumptions: A,
    });
    expect(e.feasible).toBe(true);
    expect(e.trades.map((t) => [t.side, t.symbol, t.quantity])).toEqual([
      ['sell', '00631L', 5000],
      ['buy', '0050', 5000],
    ]);
    expect(e.exposureResidual).toBeCloseTo(0);
    expect(e.grossExposureAfter).toBeCloseTo(e.grossExposureBefore);
    // sale 250,000 - purchase 500,000 - fees (178.125 + 250 sell, 356.25 buy)
    expect(e.tradeCashChange).toBeCloseTo(-250_000 - 784.375);
    expect(e.marginChange).toBe(0);
  });

  it('reports the rounding residual', () => {
    const d = held(10_001);
    setPrice(d, 'tw_0050', 101);
    const p = computePortfolio(d, opts);
    const e = substitutionEffect(d, p, {
      fromPositionKey: key(p),
      toInstrumentId: 'tw_0050',
      fraction: 1,
      assumptions: A,
    });
    // 1,000,100 moved; floor(1,000,100 / 101) = 9,901 shares = 1,000,001
    expect(e.exposureRemoved).toBeCloseTo(1_000_100);
    expect(e.trades[1].quantity).toBe(9901);
    expect(e.exposureResidual).toBeCloseTo(-99);
  });

  it('shows the margin requirement and released cash when moving to a future', () => {
    const d = held(40_000);
    inst(d, 'fut_TX').indexId = 'tw50';
    const p = computePortfolio(d, opts);
    const e = substitutionEffect(d, p, {
      fromPositionKey: key(p),
      toInstrumentId: 'fut_TX',
      fraction: 1,
      assumptions: A,
    });
    expect(e.trades[1]).toMatchObject({ side: 'buy', symbol: 'TX', quantity: 1 });
    expect(e.exposureResidual).toBeCloseTo(0);
    expect(e.marginChange).toBe(300_000);
    expect(e.freeCashChange).toBeCloseTo(e.tradeCashChange - 300_000);
    expect(e.tradeCashChange).toBeGreaterThan(1_900_000);
  });

  it('refuses a different index or a missing position', () => {
    const d = held();
    const p = computePortfolio(d, opts);
    expect(
      substitutionEffect(d, p, { fromPositionKey: 'nope', toInstrumentId: 'tw_0050', fraction: 1 })
        .feasible,
    ).toBe(false);
    const e = substitutionEffect(d, p, {
      fromPositionKey: key(p),
      toInstrumentId: 'us_VOO',
      fraction: 1,
    });
    expect(e.feasible).toBe(false);
  });
});
