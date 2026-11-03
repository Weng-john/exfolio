import { daysBetween } from './dates';
import type { ISODate } from './types';

// Options: Black-Scholes pricing and Greeks, implied volatility, and
// multi-leg payoff analysis.
//
// Model limits, stated once: European exercise, constant volatility and
// rates, continuous dividend yield. American options (most single-stock and
// ETF options) can be worth more than this price when early exercise pays,
// mainly deep in-the-money puts and calls ahead of a dividend. Every number
// here is a model estimate for information, never a quote.

export type OptionRight = 'call' | 'put';

export interface OptionInputs {
  right: OptionRight;
  /** Underlying price. */
  spot: number;
  strike: number;
  /** Time to expiry in years. */
  years: number;
  /** Annual volatility as a fraction (0.2 = 20%). */
  vol: number;
  /** Continuously compounded risk-free rate. */
  rate?: number;
  /** Continuous dividend (or carry) yield. */
  dividendYield?: number;
}

/**
 * Sensitivities of one option (one unit of the underlying, before any
 * contract multiplier or position size).
 * - delta: price change per 1 change in the underlying.
 * - gamma: delta change per 1 change in the underlying.
 * - vega: price change per 1 volatility point (0.01).
 * - theta: price change per calendar day, all else unchanged.
 * - rho: price change per 1 rate point (0.01).
 */
export interface Greeks {
  delta: number;
  gamma: number;
  vega: number;
  theta: number;
  rho: number;
}

const SQRT_2PI = Math.sqrt(2 * Math.PI);

export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

/** Standard normal CDF, via the complementary error function below. */
export function normCdf(x: number): number {
  return 0.5 * erfc(-x / Math.SQRT2);
}

function erfc(x: number): number {
  // Numerical Recipes' Chebyshev fit, fractional error below 1.2e-7 everywhere:
  // far finer than any market input to an option price.
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t *
                          (0.27886807 +
                            t *
                              (-1.13520398 +
                                t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? r : 2 - r;
}

/** Value at expiry of one unit. */
export function intrinsic(right: OptionRight, spot: number, strike: number): number {
  return right === 'call' ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
}

function valid(p: OptionInputs): boolean {
  return (
    Number.isFinite(p.spot) &&
    p.spot > 0 &&
    Number.isFinite(p.strike) &&
    p.strike > 0 &&
    Number.isFinite(p.years) &&
    p.years >= 0 &&
    Number.isFinite(p.vol) &&
    p.vol >= 0 &&
    Number.isFinite(p.rate ?? 0) &&
    Number.isFinite(p.dividendYield ?? 0)
  );
}

/** Black-Scholes-Merton price, or undefined for inputs that cannot be priced. */
export function bsPrice(p: OptionInputs): number | undefined {
  if (!valid(p)) return undefined;
  const r = p.rate ?? 0;
  const q = p.dividendYield ?? 0;
  const { spot: S, strike: K, years: T, vol } = p;
  const dfR = Math.exp(-r * T);
  const dfQ = Math.exp(-q * T);
  const sd = vol * Math.sqrt(T);
  if (sd < 1e-12) {
    // No uncertainty left: the discounted forward intrinsic value.
    const fwd = S * dfQ - K * dfR;
    return p.right === 'call' ? Math.max(fwd, 0) : Math.max(-fwd, 0);
  }
  const d1 = (Math.log(S / K) + (r - q + 0.5 * vol * vol) * T) / sd;
  const d2 = d1 - sd;
  return p.right === 'call'
    ? S * dfQ * normCdf(d1) - K * dfR * normCdf(d2)
    : K * dfR * normCdf(-d2) - S * dfQ * normCdf(-d1);
}

/** Greeks for one unit of the underlying, or undefined for inputs that cannot be priced. */
export function bsGreeks(p: OptionInputs): Greeks | undefined {
  if (!valid(p)) return undefined;
  const r = p.rate ?? 0;
  const q = p.dividendYield ?? 0;
  const { spot: S, strike: K, years: T, vol } = p;
  const call = p.right === 'call';
  const dfR = Math.exp(-r * T);
  const dfQ = Math.exp(-q * T);
  const sd = vol * Math.sqrt(T);
  if (sd < 1e-12) {
    // At expiry (or zero vol) only the exercise decision is left.
    const itm = call ? S * dfQ > K * dfR : S * dfQ < K * dfR;
    return { delta: itm ? (call ? dfQ : -dfQ) : 0, gamma: 0, vega: 0, theta: 0, rho: 0 };
  }
  const d1 = (Math.log(S / K) + (r - q + 0.5 * vol * vol) * T) / sd;
  const d2 = d1 - sd;
  const pdf = normPdf(d1);
  const delta = call ? dfQ * normCdf(d1) : -dfQ * normCdf(-d1);
  const gamma = (dfQ * pdf) / (S * sd);
  const vega = (S * dfQ * pdf * Math.sqrt(T)) / 100;
  const decay = -(S * dfQ * pdf * vol) / (2 * Math.sqrt(T));
  const thetaYear = call
    ? decay - r * K * dfR * normCdf(d2) + q * S * dfQ * normCdf(d1)
    : decay + r * K * dfR * normCdf(-d2) - q * S * dfQ * normCdf(-d1);
  const rho = (call ? K * T * dfR * normCdf(d2) : -K * T * dfR * normCdf(-d2)) / 100;
  return { delta, gamma, vega, theta: thetaYear / 365, rho };
}

/**
 * Volatility at which the model price equals `price`, or undefined when no
 * volatility can (a price below intrinsic or above the no-arbitrage bound,
 * or an expired option). Bisection: slow but cannot diverge.
 */
export function impliedVol(
  price: number,
  p: Omit<OptionInputs, 'vol'>,
  bounds: { low?: number; high?: number } = {},
): number | undefined {
  if (!Number.isFinite(price) || price <= 0 || !(p.years > 0)) return undefined;
  let low = bounds.low ?? 1e-4;
  let high = bounds.high ?? 5;
  const at = (vol: number) => bsPrice({ ...p, vol });
  const lo = at(low);
  const hi = at(high);
  if (lo === undefined || hi === undefined || price < lo - 1e-9 || price > hi + 1e-9)
    return undefined;
  for (let i = 0; i < 100; i++) {
    const mid = 0.5 * (low + high);
    if (at(mid)! < price) low = mid;
    else high = mid;
    if (high - low < 1e-7) break;
  }
  return 0.5 * (low + high);
}

/**
 * Years from `today` to `expiry` on a 365-day calendar. An option expiring
 * today still has its final session ahead: half a day is counted so the
 * model does not collapse to intrinsic value before the market closes.
 * Negative (expired) dates give 0.
 */
export function yearsToExpiry(today: ISODate, expiry: ISODate): number {
  const days = daysBetween(today, expiry);
  if (days < 0) return 0;
  return (days === 0 ? 0.5 : days) / 365;
}

// ------------------------------------------------------------ multi-leg

/** One leg of a strategy. `quantity` is signed: + bought, − sold. */
export type Leg =
  | {
      kind: 'option';
      right: OptionRight;
      strike: number;
      quantity: number;
      /** Price paid (+) or received for one unit when the leg was opened. */
      premium: number;
      /** Volatility used to value the leg before expiry. */
      vol: number;
      /** Years to this leg's expiry; legs may expire on different dates. */
      years: number;
    }
  | {
      kind: 'underlying';
      quantity: number;
      /** Entry price of the underlying. */
      price: number;
    };

export interface StrategyContext {
  /** Contract multiplier applied to every leg. */
  multiplier: number;
  rate?: number;
  dividendYield?: number;
}

/** P&L of a leg if the underlying is at `spot` when the first leg expires. */
function legValue(leg: Leg, spot: number, elapsedYears: number, ctx: StrategyContext): number {
  if (leg.kind === 'underlying') return leg.quantity * (spot - leg.price);
  const years = Math.max(0, leg.years - elapsedYears);
  const value =
    years === 0
      ? intrinsic(leg.right, spot, leg.strike)
      : (bsPrice({
          right: leg.right,
          spot,
          strike: leg.strike,
          years,
          vol: leg.vol,
          rate: ctx.rate,
          dividendYield: ctx.dividendYield,
        }) ?? intrinsic(leg.right, spot, leg.strike));
  return leg.quantity * (value - leg.premium);
}

/** Strategy P&L (times the multiplier) at underlying price `spot`, `elapsedYears` from now. */
export function strategyPnl(
  legs: Leg[],
  spot: number,
  ctx: StrategyContext,
  elapsedYears = 0,
): number {
  return legs.reduce((s, leg) => s + legValue(leg, spot, elapsedYears, ctx), 0) * ctx.multiplier;
}

/** Years until the first option leg expires; 0 when there is none. */
export function firstExpiry(legs: Leg[]): number {
  const years = legs.flatMap((l) => (l.kind === 'option' ? [l.years] : []));
  return years.length ? Math.min(...years) : 0;
}

/** P&L when the first option leg expires, later legs still valued by the model. */
export function pnlAtExpiry(legs: Leg[], spot: number, ctx: StrategyContext): number {
  return strategyPnl(legs, spot, ctx, firstExpiry(legs));
}

/** Net premium: + paid, − received (times the multiplier). */
export function netPremium(legs: Leg[], ctx: StrategyContext): number {
  return (
    legs.reduce((s, l) => s + (l.kind === 'option' ? l.quantity * l.premium : 0), 0) *
    ctx.multiplier
  );
}

/** Sum of each leg's Greeks times its quantity and the multiplier, at `spot` now. */
export function strategyGreeks(legs: Leg[], spot: number, ctx: StrategyContext): Greeks {
  const total: Greeks = { delta: 0, gamma: 0, vega: 0, theta: 0, rho: 0 };
  for (const leg of legs) {
    if (leg.kind === 'underlying') {
      total.delta += leg.quantity;
      continue;
    }
    const g = bsGreeks({
      right: leg.right,
      spot,
      strike: leg.strike,
      years: leg.years,
      vol: leg.vol,
      rate: ctx.rate,
      dividendYield: ctx.dividendYield,
    });
    if (!g) continue;
    for (const k of Object.keys(total) as Array<keyof Greeks>) total[k] += g[k] * leg.quantity;
  }
  for (const k of Object.keys(total) as Array<keyof Greeks>) total[k] *= ctx.multiplier;
  return total;
}

/** Whether every option leg expires together, so the expiry P&L is piecewise linear. */
export function singleExpiry(legs: Leg[]): boolean {
  const years = new Set(legs.flatMap((l) => (l.kind === 'option' ? [l.years] : [])));
  return years.size <= 1;
}

/**
 * Slope of the expiry P&L for a very high underlying price, per unit of the
 * underlying: calls and underlying count, puts are worthless up there.
 */
function upsideSlope(legs: Leg[]): number {
  return legs.reduce(
    (s, l) => s + (l.kind === 'underlying' ? l.quantity : l.right === 'call' ? l.quantity : 0),
    0,
  );
}

export interface ExpiryProfile {
  /** Underlying prices at which expiry P&L crosses zero, ascending. */
  breakevens: number[];
  /** Highest expiry P&L; undefined when unbounded (rises without limit). */
  maxProfit?: number;
  /** Lowest expiry P&L (negative is a loss); undefined when unbounded. */
  maxLoss?: number;
  /** Underlying price where the maximum profit is reached (lowest such price). */
  maxProfitAt?: number;
  maxLossAt?: number;
}

/**
 * Break-evens and bounds of a single-expiry strategy, exactly: its expiry P&L
 * is linear between strikes, so its extremes lie at a strike, at zero or
 * towards infinity. Returns undefined for legs that expire on different
 * dates, whose P&L curve is not piecewise linear.
 */
export function expiryProfile(legs: Leg[], ctx: StrategyContext): ExpiryProfile | undefined {
  if (!legs.length || !singleExpiry(legs)) return undefined;
  const at = (s: number) => pnlAtExpiry(legs, s, ctx);
  const strikes = [...new Set(legs.flatMap((l) => (l.kind === 'option' ? [l.strike] : [])))].sort(
    (a, b) => a - b,
  );
  const knots = [0, ...strikes.filter((k) => k > 0)];
  const values = knots.map(at);
  const slope = upsideSlope(legs) * ctx.multiplier;
  const last = knots[knots.length - 1];

  const breakevens: number[] = [];
  const near = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));
  for (let i = 0; i < knots.length - 1; i++) {
    const [x0, x1, y0, y1] = [knots[i], knots[i + 1], values[i], values[i + 1]];
    if (y0 === 0 && i > 0) breakevens.push(x0);
    else if (y0 * y1 < 0) breakevens.push(x0 + ((x1 - x0) * -y0) / (y1 - y0));
  }
  const yLast = values[values.length - 1];
  if (yLast === 0 && knots.length > 1) breakevens.push(last);
  else if (slope !== 0 && yLast * slope < 0) breakevens.push(last - yLast / slope);

  let maxProfit: number | undefined = Math.max(...values);
  let maxLoss: number | undefined = Math.min(...values);
  let maxProfitAt: number | undefined = knots[values.indexOf(maxProfit)];
  let maxLossAt: number | undefined = knots[values.indexOf(maxLoss)];
  if (slope > 0) maxProfit = maxProfitAt = undefined;
  if (slope < 0) maxLoss = maxLossAt = undefined;
  return {
    breakevens: breakevens.filter((b, i, a) => i === 0 || !near(b, a[i - 1])),
    maxProfit,
    maxLoss,
    maxProfitAt,
    maxLossAt,
  };
}

export interface CurvePoint {
  spot: number;
  /** P&L when the first leg expires. */
  expiry: number;
  /** P&L at the evaluation date (now, or `elapsedYears` later), every leg valued by the model. */
  today: number;
}

/** The same legs `elapsedYears` later: every option has that much less time left. */
export function shiftLegs(legs: Leg[], elapsedYears: number): Leg[] {
  if (!(elapsedYears > 0)) return legs;
  return legs.map((l) =>
    l.kind === 'option' ? { ...l, years: Math.max(0, l.years - elapsedYears) } : l,
  );
}

/**
 * Underlying price range worth drawing: `sds` standard deviations of the
 * move to the first expiry around the spot, widened to show every strike.
 */
export function curveRange(
  legs: Leg[],
  spot: number,
  vol: number,
  sds = 3.5,
): { low: number; high: number } {
  const sd = vol * Math.sqrt(Math.max(firstExpiry(legs), 1 / 365));
  const strikes = legs.flatMap((l) => (l.kind === 'option' ? [l.strike] : []));
  return {
    low: Math.max(0, Math.min(spot * (1 - sds * sd), ...strikes.map((k) => k * 0.9))),
    high: Math.max(spot * (1 + sds * sd), ...strikes.map((k) => k * 1.1)),
  };
}

/**
 * P&L curve over [low, high] in `steps` intervals, plus every strike so kinks
 * are exact. The `today` series is valued `elapsedYears` from now.
 */
export function payoffCurve(
  legs: Leg[],
  ctx: StrategyContext,
  low: number,
  high: number,
  steps = 120,
  elapsedYears = 0,
): CurvePoint[] {
  if (!(high > low) || !(low >= 0) || steps < 1) return [];
  const xs = new Set<number>();
  for (let i = 0; i <= steps; i++) xs.add(low + ((high - low) * i) / steps);
  for (const l of legs)
    if (l.kind === 'option' && l.strike > low && l.strike < high) xs.add(l.strike);
  return [...xs]
    .sort((a, b) => a - b)
    .map((spot) => ({
      spot,
      expiry: pnlAtExpiry(legs, spot, ctx),
      today: strategyPnl(legs, spot, ctx, Math.min(elapsedYears, firstExpiry(legs))),
    }));
}

// ------------------------------------------------------------ templates

export type TemplateId =
  | 'long_call'
  | 'long_put'
  | 'covered_call'
  | 'protective_put'
  | 'bull_call_spread'
  | 'bear_put_spread'
  | 'long_straddle'
  | 'short_strangle'
  | 'iron_condor'
  | 'long_butterfly'
  | 'collar';

export interface Template {
  id: TemplateId;
  name: string;
  /** What the position is for, in one line. */
  view: string;
  /** Market direction it profits from. */
  outlook: 'bullish' | 'bearish' | 'neutral' | 'volatile' | 'hedge';
}

export const TEMPLATES: Template[] = [
  { id: 'long_call', name: '買進買權', view: '看漲，損失以權利金為限', outlook: 'bullish' },
  { id: 'long_put', name: '買進賣權', view: '看跌或避險，損失以權利金為限', outlook: 'bearish' },
  {
    id: 'covered_call',
    name: 'Covered Call',
    view: '持有現貨，賣出買權收取權利金',
    outlook: 'neutral',
  },
  {
    id: 'protective_put',
    name: 'Protective Put',
    view: '持有現貨，買進賣權鎖住下檔',
    outlook: 'hedge',
  },
  { id: 'collar', name: 'Collar', view: '持有現貨，以賣出買權支付賣權保護', outlook: 'hedge' },
  {
    id: 'bull_call_spread',
    name: '多頭價差',
    view: '溫和看漲，成本與獲利都有上限',
    outlook: 'bullish',
  },
  {
    id: 'bear_put_spread',
    name: '空頭價差',
    view: '溫和看跌，成本與獲利都有上限',
    outlook: 'bearish',
  },
  { id: 'long_straddle', name: '買進跨式', view: '預期大幅波動，方向不拘', outlook: 'volatile' },
  {
    id: 'short_strangle',
    name: '賣出勒式',
    view: '預期盤整，賺取時間價值；兩端風險無上限',
    outlook: 'neutral',
  },
  { id: 'iron_condor', name: '鐵兀鷹', view: '預期盤整，收益與風險都有上限', outlook: 'neutral' },
  { id: 'long_butterfly', name: '買進蝶式', view: '預期收在中間履約價附近', outlook: 'neutral' },
];

/**
 * Legs of a template around `spot`, strikes on a `step` grid, each option
 * priced by the model at `vol` so the starting premiums are consistent.
 */
export function templateLegs(
  id: TemplateId,
  spot: number,
  step: number,
  vol: number,
  years: number,
  ctx: Pick<StrategyContext, 'rate' | 'dividendYield'> = {},
): Leg[] {
  const atm = Math.max(step, Math.round(spot / step) * step);
  const k = (n: number) => Math.max(step, atm + n * step);
  const opt = (right: OptionRight, strike: number, quantity: number): Leg => ({
    kind: 'option',
    right,
    strike,
    quantity,
    vol,
    years,
    premium: bsPrice({ right, spot, strike, years, vol, ...ctx }) ?? intrinsic(right, spot, strike),
  });
  const stock: Leg = { kind: 'underlying', quantity: 1, price: spot };
  switch (id) {
    case 'long_call':
      return [opt('call', k(0), 1)];
    case 'long_put':
      return [opt('put', k(0), 1)];
    case 'covered_call':
      return [stock, opt('call', k(2), -1)];
    case 'protective_put':
      return [stock, opt('put', k(-2), 1)];
    case 'collar':
      return [stock, opt('put', k(-2), 1), opt('call', k(2), -1)];
    case 'bull_call_spread':
      return [opt('call', k(0), 1), opt('call', k(2), -1)];
    case 'bear_put_spread':
      return [opt('put', k(0), 1), opt('put', k(-2), -1)];
    case 'long_straddle':
      return [opt('call', k(0), 1), opt('put', k(0), 1)];
    case 'short_strangle':
      return [opt('put', k(-2), -1), opt('call', k(2), -1)];
    case 'iron_condor':
      return [
        opt('put', k(-3), 1),
        opt('put', k(-1), -1),
        opt('call', k(1), -1),
        opt('call', k(3), 1),
      ];
    case 'long_butterfly':
      return [opt('call', k(-1), 1), opt('call', k(0), -2), opt('call', k(1), 1)];
  }
}

/** A strike grid step that gives roughly 40–80 strikes across the spot price. */
export function niceStep(spot: number): number {
  if (!(spot > 0)) return 1;
  const raw = spot / 50;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const unit = [1, 2, 2.5, 5, 10].find((m) => m * pow >= raw)!;
  return unit * pow;
}

// ------------------------------------------------------------ held options

export interface HeldOptionInputs {
  right?: OptionRight;
  strike?: number;
  expiry?: ISODate;
  /** Option price per unit used for valuation. */
  premium: number;
  /** Whether `premium` is a market quote (so a volatility can be implied from it). */
  quoted: boolean;
  /** Underlying price per unit, when known. */
  underlyingPrice?: number;
  /** Fallback volatility from the instrument record. */
  impliedVol?: number;
  today: ISODate;
}

export type HeldOptionAnalytics =
  | {
      ok: true;
      underlyingPrice: number;
      years: number;
      vol: number;
      /** Where the volatility came from. */
      volSource: 'implied' | 'instrument' | 'expired';
      greeks: Greeks;
      expired: boolean;
    }
  | { ok: false; reason: string };

/**
 * Greeks of a held option from its record and current prices. Volatility is
 * implied from the option's own quote when there is one, else taken from the
 * instrument record; nothing is assumed beyond that. Rates and dividends are
 * taken as zero, which moves delta far less than the volatility estimate does.
 */
export function heldOptionAnalytics(p: HeldOptionInputs): HeldOptionAnalytics {
  if (!p.right || !(p.strike! > 0) || !p.expiry)
    return { ok: false, reason: '缺少買賣權別、履約價或到期日' };
  if (!(p.underlyingPrice! > 0)) return { ok: false, reason: '標的沒有價格' };
  const spot = p.underlyingPrice!;
  const years = yearsToExpiry(p.today, p.expiry);
  const base = { right: p.right, spot, strike: p.strike!, years };
  if (years === 0) {
    return {
      ok: true,
      underlyingPrice: spot,
      years,
      vol: 0,
      volSource: 'expired',
      greeks: bsGreeks({ ...base, vol: 0 })!,
      expired: true,
    };
  }
  const implied = p.quoted ? impliedVol(p.premium, base) : undefined;
  const vol = implied ?? (p.impliedVol! > 0 ? p.impliedVol! : undefined);
  if (vol === undefined)
    return {
      ok: false,
      reason: p.quoted ? '報價無法反推波動率，且商品未設定波動率' : '沒有報價，且商品未設定波動率',
    };
  return {
    ok: true,
    underlyingPrice: spot,
    years,
    vol,
    volSource: implied !== undefined ? 'implied' : 'instrument',
    greeks: bsGreeks({ ...base, vol })!,
    expired: false,
  };
}

/**
 * Probability that a single-expiry strategy ends in profit, under the
 * lognormal model with volatility `vol` (risk-neutral drift `rate`). A model
 * figure, not a forecast: real returns have fatter tails than the model.
 * Undefined when the expiry P&L is not piecewise linear or inputs are invalid.
 */
export function profitProbability(
  legs: Leg[],
  ctx: StrategyContext,
  spot: number,
  vol: number,
): number | undefined {
  const years = firstExpiry(legs);
  const profile = expiryProfile(legs, ctx);
  if (!profile || !(spot > 0) || !(vol > 0) || !(years > 0)) return undefined;
  const r = ctx.rate ?? 0;
  const q = ctx.dividendYield ?? 0;
  const sd = vol * Math.sqrt(years);
  /** P(S_T <= x). */
  const below = (x: number) =>
    x <= 0 ? 0 : normCdf((Math.log(x / spot) - (r - q - 0.5 * vol * vol) * years) / sd);
  const cuts = [0, ...profile.breakevens, Infinity];
  let p = 0;
  for (let i = 0; i < cuts.length - 1; i++) {
    const [a, b] = [cuts[i], cuts[i + 1]];
    const probe = b === Infinity ? Math.max(a * 2, a + 1) : (a + b) / 2;
    if (pnlAtExpiry(legs, probe, ctx) > 0) p += (b === Infinity ? 1 : below(b)) - below(a);
  }
  return Math.min(1, Math.max(0, p));
}
