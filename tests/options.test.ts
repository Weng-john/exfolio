import { describe, expect, it } from 'vitest';
import {
  bsGreeks,
  bsPrice,
  expiryProfile,
  impliedVol,
  netPremium,
  niceStep,
  normCdf,
  curveRange,
  payoffCurve,
  shiftLegs,
  pnlAtExpiry,
  profitProbability,
  strategyGreeks,
  strategyPnl,
  TEMPLATES,
  templateLegs,
  yearsToExpiry,
  type Leg,
  type OptionInputs,
} from '../src/core/options';

// Hull, "Options, Futures, and Other Derivatives", Example 15.6:
// S=42, K=40, r=10%, σ=20%, T=0.5 → call 4.76, put 0.81.
const HULL: Omit<OptionInputs, 'right'> = { spot: 42, strike: 40, years: 0.5, vol: 0.2, rate: 0.1 };

describe('normal distribution', () => {
  it('matches known values', () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 7);
    expect(normCdf(1.96)).toBeCloseTo(0.975, 4);
    expect(normCdf(-1)).toBeCloseTo(0.158655, 6);
  });
});

describe('Black-Scholes price', () => {
  it('reproduces the textbook example', () => {
    expect(bsPrice({ ...HULL, right: 'call' })).toBeCloseTo(4.76, 2);
    expect(bsPrice({ ...HULL, right: 'put' })).toBeCloseTo(0.81, 2);
  });

  it('satisfies put-call parity with a dividend yield', () => {
    const p = { spot: 100, strike: 95, years: 0.75, vol: 0.3, rate: 0.03, dividendYield: 0.02 };
    const c = bsPrice({ ...p, right: 'call' })!;
    const put = bsPrice({ ...p, right: 'put' })!;
    const parity = 100 * Math.exp(-0.02 * 0.75) - 95 * Math.exp(-0.03 * 0.75);
    expect(c - put).toBeCloseTo(parity, 8);
  });

  it('collapses to intrinsic value at expiry', () => {
    expect(bsPrice({ right: 'call', spot: 110, strike: 100, years: 0, vol: 0.2 })).toBe(10);
    expect(bsPrice({ right: 'put', spot: 110, strike: 100, years: 0, vol: 0.2 })).toBe(0);
  });

  it('refuses inputs it cannot price', () => {
    expect(bsPrice({ right: 'call', spot: 0, strike: 100, years: 1, vol: 0.2 })).toBeUndefined();
    expect(bsPrice({ right: 'call', spot: 100, strike: 100, years: -1, vol: 0.2 })).toBeUndefined();
    expect(bsPrice({ right: 'call', spot: 100, strike: 100, years: 1, vol: NaN })).toBeUndefined();
  });
});

describe('Greeks', () => {
  it('agree with finite differences of the price', () => {
    const base: OptionInputs = {
      right: 'put',
      spot: 100,
      strike: 105,
      years: 0.4,
      vol: 0.25,
      rate: 0.02,
    };
    const g = bsGreeks(base)!;
    const h = 0.01;
    const px = (o: Partial<OptionInputs>) => bsPrice({ ...base, ...o })!;
    expect(g.delta).toBeCloseTo((px({ spot: 100 + h }) - px({ spot: 100 - h })) / (2 * h), 5);
    expect(g.gamma).toBeCloseTo(
      (px({ spot: 100 + h }) - 2 * px({}) + px({ spot: 100 - h })) / (h * h),
      3,
    );
    expect(g.vega).toBeCloseTo((px({ vol: 0.26 }) - px({ vol: 0.24 })) / 2, 4);
    expect(g.theta).toBeCloseTo(px({ years: 0.4 - 1 / 365 }) - px({}), 3);
    expect(g.rho).toBeCloseTo((px({ rate: 0.03 }) - px({ rate: 0.01 })) / 2, 4);
  });

  it('call delta is between 0 and 1, put delta between −1 and 0', () => {
    for (const spot of [50, 100, 150]) {
      const c = bsGreeks({ right: 'call', spot, strike: 100, years: 0.5, vol: 0.3 })!;
      const p = bsGreeks({ right: 'put', spot, strike: 100, years: 0.5, vol: 0.3 })!;
      expect(c.delta).toBeGreaterThan(0);
      expect(c.delta).toBeLessThan(1);
      expect(p.delta).toBeLessThan(0);
      expect(c.delta - p.delta).toBeCloseTo(1, 10);
    }
  });

  it('at expiry delta is the exercise decision', () => {
    expect(bsGreeks({ right: 'call', spot: 101, strike: 100, years: 0, vol: 0.2 })!.delta).toBe(1);
    expect(bsGreeks({ right: 'put', spot: 101, strike: 100, years: 0, vol: 0.2 })!.delta).toBe(0);
  });
});

describe('implied volatility', () => {
  it('recovers the volatility that produced a price', () => {
    for (const vol of [0.08, 0.2, 0.65, 1.4]) {
      const p = { right: 'call' as const, spot: 100, strike: 110, years: 0.3, rate: 0.01 };
      const price = bsPrice({ ...p, vol })!;
      expect(impliedVol(price, p)).toBeCloseTo(vol, 5);
    }
  });

  it('gives up on prices outside the no-arbitrage range', () => {
    const p = { right: 'call' as const, spot: 100, strike: 90, years: 0.5 };
    expect(impliedVol(5, p)).toBeUndefined(); // below intrinsic 10
    expect(impliedVol(120, p)).toBeUndefined(); // above the spot
    expect(impliedVol(5, { ...p, years: 0 })).toBeUndefined();
  });
});

describe('yearsToExpiry', () => {
  it('counts calendar days and half a day on expiry day', () => {
    expect(yearsToExpiry('2026-01-01', '2026-12-31')).toBeCloseTo(364 / 365);
    expect(yearsToExpiry('2026-03-20', '2026-03-20')).toBeCloseTo(0.5 / 365);
    expect(yearsToExpiry('2026-03-21', '2026-03-20')).toBe(0);
  });
});

const ctx = { multiplier: 100 };
const call = (strike: number, quantity: number, premium: number): Leg => ({
  kind: 'option',
  right: 'call',
  strike,
  quantity,
  premium,
  vol: 0.2,
  years: 0.25,
});
const put = (strike: number, quantity: number, premium: number): Leg => ({
  ...(call(strike, quantity, premium) as Extract<Leg, { kind: 'option' }>),
  right: 'put',
});

describe('expiry profile', () => {
  it('bull call spread: bounded both ways, one break-even', () => {
    const legs = [call(100, 1, 5), call(110, -1, 2)];
    const r = expiryProfile(legs, ctx)!;
    expect(netPremium(legs, ctx)).toBe(300);
    expect(r.maxLoss).toBeCloseTo(-300);
    expect(r.maxProfit).toBeCloseTo(700);
    expect(r.breakevens).toHaveLength(1);
    expect(r.breakevens[0]).toBeCloseTo(103);
  });

  it('long call: unlimited profit, loss limited to the premium', () => {
    const r = expiryProfile([call(100, 1, 4)], ctx)!;
    expect(r.maxProfit).toBeUndefined();
    expect(r.maxLoss).toBeCloseTo(-400);
    expect(r.breakevens[0]).toBeCloseTo(104);
  });

  it('short strangle: unlimited loss, two break-evens', () => {
    const r = expiryProfile([put(90, -1, 2), call(110, -1, 3)], ctx)!;
    expect(r.maxLoss).toBeUndefined();
    expect(r.maxProfit).toBeCloseTo(500);
    expect(r.breakevens[0]).toBeCloseTo(85);
    expect(r.breakevens[1]).toBeCloseTo(115);
  });

  it('covered call: stock plus short call caps the upside', () => {
    const legs: Leg[] = [{ kind: 'underlying', quantity: 1, price: 100 }, call(110, -1, 3)];
    const r = expiryProfile(legs, ctx)!;
    expect(r.maxProfit).toBeCloseTo(1300);
    expect(r.maxLoss).toBeCloseTo(-9700); // the stock going to zero, less the premium
    expect(r.breakevens[0]).toBeCloseTo(97);
  });

  it('a P&L that touches zero at a strike counts once', () => {
    // Long butterfly bought for nothing: zero outside the wings.
    const legs = [call(90, 1, 0), call(100, -2, 0), call(110, 1, 0)];
    const r = expiryProfile(legs, ctx)!;
    expect(r.maxProfit).toBeCloseTo(1000);
    expect(r.maxLoss).toBeCloseTo(0);
  });

  it('declines legs with different expiries', () => {
    const legs = [
      call(100, 1, 5),
      { ...(call(100, -1, 3) as Leg & { kind: 'option' }), years: 0.5 },
    ];
    expect(expiryProfile(legs, ctx)).toBeUndefined();
  });
});

describe('strategy valuation', () => {
  it('today P&L of a freshly priced template is zero at the spot', () => {
    for (const t of TEMPLATES) {
      const legs = templateLegs(t.id, 100, 5, 0.25, 30 / 365);
      expect(strategyPnl(legs, 100, ctx), t.id).toBeCloseTo(0, 8);
    }
  });

  it('later legs of a calendar spread keep their time value at the first expiry', () => {
    const near = call(100, -1, 2);
    const far: Leg = { ...(call(100, 1, 4) as Leg & { kind: 'option' }), years: 0.5 };
    // At the near expiry with spot at the strike the short leg is worthless and
    // the long leg still has 0.25 years of value.
    const remaining = bsPrice({ right: 'call', spot: 100, strike: 100, years: 0.25, vol: 0.2 })!;
    expect(pnlAtExpiry([near, far], 100, ctx)).toBeCloseTo((2 + remaining - 4) * 100, 6);
  });

  it('aggregate Greeks: a straddle is near delta-neutral and long gamma and vega', () => {
    const legs = templateLegs('long_straddle', 100, 5, 0.2, 0.25);
    const g = strategyGreeks(legs, 100, ctx);
    expect(Math.abs(g.delta)).toBeLessThan(10);
    expect(g.gamma).toBeGreaterThan(0);
    expect(g.vega).toBeGreaterThan(0);
    expect(g.theta).toBeLessThan(0);
  });

  it('the underlying leg contributes delta of its quantity', () => {
    const g = strategyGreeks([{ kind: 'underlying', quantity: 2, price: 50 }], 60, ctx);
    expect(g.delta).toBe(200);
  });

  it('payoff curve includes the strikes and is ordered', () => {
    const curve = payoffCurve([call(103, 1, 2)], ctx, 80, 120, 8);
    expect(curve.map((p) => p.spot)).toContain(103);
    expect(curve.every((p, i) => i === 0 || p.spot > curve[i - 1].spot)).toBe(true);
    expect(payoffCurve([], ctx, 10, 5)).toEqual([]);
  });
});

describe('niceStep', () => {
  it('rounds to a readable grid', () => {
    expect(niceStep(100)).toBe(2);
    expect(niceStep(22600)).toBe(500);
    expect(niceStep(640)).toBe(20);
    expect(niceStep(0)).toBe(1);
  });
});

describe('profitProbability', () => {
  it('a long call profits when the underlying ends above the break-even', () => {
    const legs = [call(100, 1, 4)];
    const p = profitProbability(legs, ctx, 100, 0.2)!;
    // P(S_T > 104) with zero drift: N(d2) at strike 104.
    const sd = 0.2 * Math.sqrt(0.25);
    const expected = normCdf((Math.log(100 / 104) - 0.5 * 0.04 * 0.25) / sd);
    expect(p).toBeCloseTo(expected, 10);
  });

  it('a short strangle profits between its break-evens', () => {
    const legs = [put(90, -1, 2), call(110, -1, 3)];
    const p = profitProbability(legs, ctx, 100, 0.2)!;
    expect(p).toBeGreaterThan(0.5);
    expect(p).toBeLessThan(1);
  });

  it('is undefined without a model volatility or for mixed expiries', () => {
    expect(profitProbability([call(100, 1, 4)], ctx, 100, 0)).toBeUndefined();
    const far = { ...(call(100, 1, 4) as Leg & { kind: 'option' }), years: 1 };
    expect(profitProbability([call(100, -1, 2), far], ctx, 100, 0.2)).toBeUndefined();
  });
});

describe('time and range helpers', () => {
  it('shiftLegs takes time off every option, never below zero', () => {
    const legs: Leg[] = [call(100, 1, 2), { kind: 'underlying', quantity: 1, price: 90 }];
    const later = shiftLegs(legs, 0.1);
    expect((later[0] as Leg & { kind: 'option' }).years).toBeCloseTo(0.15);
    expect(later[1]).toBe(legs[1]);
    expect((shiftLegs(legs, 1)[0] as Leg & { kind: 'option' }).years).toBe(0);
  });

  it('the evaluation-date curve moves toward the expiry curve', () => {
    const legs = [call(100, 1, 3)];
    const now = payoffCurve(legs, ctx, 100, 100.0001, 1)[0];
    const later = payoffCurve(legs, ctx, 100, 100.0001, 1, 0.2)[0];
    const end = payoffCurve(legs, ctx, 100, 100.0001, 1, 5)[0];
    expect(later.today).toBeLessThan(now.today);
    expect(end.today).toBeCloseTo(end.expiry, 8); // capped at the expiry
  });

  it('curveRange covers the spread of outcomes and every strike', () => {
    const r = curveRange([call(200, 1, 1)], 100, 0.2);
    expect(r.low).toBeLessThan(80);
    expect(r.high).toBeGreaterThanOrEqual(220);
    expect(r.low).toBeGreaterThanOrEqual(0);
  });
});
