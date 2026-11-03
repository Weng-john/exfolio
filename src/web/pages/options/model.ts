import {
  bsPrice,
  curveRange,
  expiryProfile,
  firstExpiry,
  intrinsic,
  netPremium,
  niceStep,
  payoffCurve,
  profitProbability,
  shiftLegs,
  strategyGreeks,
  templateLegs,
  type CurvePoint,
  type ExpiryProfile,
  type Greeks,
  type Leg,
  type OptionRight,
  type StrategyContext,
  type TemplateId,
} from '@core/index';

// Builder state as the form holds it, and its translation into engine legs.
// Kept in memory for the visit only: it is a calculator, not stored data.

export interface Market {
  /** Free text name of the underlying, for the visitor's reference. */
  label: string;
  spot: string;
  /** Percent, e.g. "22". */
  vol: string;
  days: string;
  /** Percent, e.g. "1.5". */
  rate: string;
  multiplier: string;
}

export interface UiLeg {
  id: string;
  kind: 'call' | 'put' | 'underlying';
  /** Signed: + bought, − sold. */
  quantity: number;
  strike: number;
  /** Option premium paid or received, or the underlying's entry price. */
  price: number;
  /** Overrides; empty follows the market inputs. */
  days?: number;
  vol?: number;
}

export interface Builder {
  market: Market;
  legs: UiLeg[];
  /** Days from now at which the "today" curve is drawn. */
  elapsed: number;
  template?: TemplateId;
}

export const DEFAULT_MARKET: Market = {
  label: '示範標的',
  spot: '100',
  vol: '22',
  days: '30',
  rate: '1.5',
  multiplier: '100',
};

let seq = 0;
export const legId = () => `leg${++seq}`;

export interface ParsedMarket {
  spot: number;
  vol: number;
  days: number;
  rate: number;
  multiplier: number;
}

/** Parsed market inputs, or the list of what is wrong with them. */
export function parseMarket(
  m: Market,
): { ok: true; value: ParsedMarket } | { ok: false; errors: string[] } {
  const n = (s: string) => (s.trim() === '' ? NaN : Number(s));
  const spot = n(m.spot);
  const vol = n(m.vol) / 100;
  const days = n(m.days);
  const rate = m.rate.trim() === '' ? 0 : n(m.rate) / 100;
  const multiplier = n(m.multiplier);
  const errors: string[] = [];
  if (!(spot > 0)) errors.push('標的價格必須大於 0');
  if (!(vol > 0) || vol > 5) errors.push('波動率需介於 0 到 500%');
  if (!(days >= 1) || !Number.isInteger(days)) errors.push('到期天數需為 1 以上的整數');
  if (!Number.isFinite(rate) || Math.abs(rate) > 0.5) errors.push('利率需介於 −50% 到 50%');
  if (!(multiplier > 0)) errors.push('合約乘數必須大於 0');
  return errors.length
    ? { ok: false, errors }
    : { ok: true, value: { spot, vol, days, rate, multiplier } };
}

export function toLegs(legs: UiLeg[], m: ParsedMarket): Leg[] {
  return legs.map((l) =>
    l.kind === 'underlying'
      ? { kind: 'underlying', quantity: l.quantity, price: l.price }
      : {
          kind: 'option',
          right: l.kind,
          strike: l.strike,
          quantity: l.quantity,
          premium: l.price,
          vol: l.vol ?? m.vol,
          years: (l.days ?? m.days) / 365,
        },
  );
}

/** Model premium for an option leg at the current market inputs. */
export function modelPremium(
  right: OptionRight,
  strike: number,
  m: ParsedMarket,
  days = m.days,
  vol = m.vol,
): number {
  return (
    bsPrice({ right, spot: m.spot, strike, years: days / 365, vol, rate: m.rate }) ??
    intrinsic(right, m.spot, strike)
  );
}

export function fromTemplate(id: TemplateId, m: ParsedMarket): UiLeg[] {
  return templateLegs(id, m.spot, niceStep(m.spot), m.vol, m.days / 365, { rate: m.rate }).map(
    (l) =>
      l.kind === 'underlying'
        ? { id: legId(), kind: 'underlying', quantity: l.quantity, strike: 0, price: l.price }
        : {
            id: legId(),
            kind: l.right,
            quantity: l.quantity,
            strike: l.strike,
            price: l.premium,
          },
  );
}

export interface Analysis {
  ctx: StrategyContext;
  legs: Leg[];
  premium: number;
  profile?: ExpiryProfile;
  greeks: Greeks;
  probability?: number;
  curve: CurvePoint[];
  /** Days until the first option leg expires. */
  horizon: number;
}

export function analyse(b: Builder, m: ParsedMarket): Analysis {
  const ctx: StrategyContext = { multiplier: m.multiplier, rate: m.rate };
  const legs = toLegs(b.legs, m);
  const horizon = Math.round(firstExpiry(legs) * 365);
  const elapsedYears = Math.min(b.elapsed, horizon) / 365;
  const { low, high } = curveRange(legs, m.spot, m.vol);
  return {
    ctx,
    legs,
    premium: netPremium(legs, ctx),
    profile: expiryProfile(legs, ctx),
    greeks: strategyGreeks(shiftLegs(legs, elapsedYears), m.spot, ctx),
    probability: profitProbability(legs, ctx, m.spot, m.vol),
    curve: payoffCurve(legs, ctx, low, high, 160, elapsedYears),
    horizon,
  };
}
