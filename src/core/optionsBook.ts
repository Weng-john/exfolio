import type { Greeks, Leg } from './options';
import type { ID } from './types';
import type { Valuation, ValuedPosition } from './valuation';

// Held options as a book: per-position Greeks scaled to the position, totals
// per underlying, and the legs that reproduce a holding in the strategy
// builder.

export interface HeldOptionRow {
  position: ValuedPosition;
  /** Position Greeks: per-unit Greeks x quantity x multiplier (instrument currency). */
  greeks?: Greeks;
  /** Delta exposure in base currency (same as the valuation's exposure). */
  exposure: number;
  /** Exposure as a share of NAV, when NAV is positive. */
  weight?: number;
  daysToExpiry?: number;
}

export interface OptionBook {
  rows: HeldOptionRow[];
  /** Sum of position Greeks in base currency, over rows that have them. */
  totals: Greeks & { exposure: number };
  /** Rows whose Greeks could not be computed. */
  incomplete: number;
}

const ZERO: Greeks = { delta: 0, gamma: 0, vega: 0, theta: 0, rho: 0 };
const KEYS = Object.keys(ZERO) as Array<keyof Greeks>;

/** Every open option position in the valuation, with its Greeks scaled to the position. */
export function optionBook(valuation: Valuation): OptionBook {
  const totals = { ...ZERO, exposure: 0 };
  let incomplete = 0;
  const rows: HeldOptionRow[] = [];
  for (const p of valuation.positions) {
    if (p.instrument.type !== 'option' || p.quantity === 0) continue;
    const scale = p.quantity * p.instrument.multiplier;
    let greeks: Greeks | undefined;
    if (p.option?.ok) {
      const g = p.option.greeks;
      greeks = { ...ZERO };
      for (const k of KEYS) {
        greeks[k] = g[k] * scale;
        totals[k] += greeks[k] * p.fxRate;
      }
    } else incomplete++;
    totals.exposure += p.exposure;
    rows.push({
      position: p,
      greeks,
      exposure: p.exposure,
      weight: valuation.nav > 0 ? p.exposure / valuation.nav : undefined,
      daysToExpiry: p.option?.ok ? Math.round(p.option.years * 365) : undefined,
    });
  }
  rows.sort(
    (a, b) =>
      (a.position.instrument.underlyingId ?? '').localeCompare(
        b.position.instrument.underlyingId ?? '',
      ) ||
      (a.position.instrument.expiry ?? '').localeCompare(b.position.instrument.expiry ?? '') ||
      (a.position.instrument.strike ?? 0) - (b.position.instrument.strike ?? 0),
  );
  return { rows, totals, incomplete };
}

export interface HeldStrategy {
  underlyingId: ID;
  spot: number;
  multiplier: number;
  /** Volatility of the first leg, as a starting point for the builder. */
  vol: number;
  legs: Leg[];
}

/**
 * The options held on one underlying, plus any shares of the underlying
 * itself, as strategy legs at their average cost. Quantities are expressed
 * in contracts of the first option's multiplier. Options without a model
 * (missing volatility or price) are left out.
 */
export function heldStrategy(valuation: Valuation, underlyingId: ID): HeldStrategy | undefined {
  const options = valuation.positions.filter(
    (p) =>
      p.instrument.type === 'option' &&
      p.instrument.underlyingId === underlyingId &&
      p.quantity !== 0 &&
      p.option?.ok,
  );
  const first = options[0];
  if (!first || !first.option?.ok) return undefined;
  const multiplier = first.instrument.multiplier;
  const spot = first.option.underlyingPrice;
  const legs: Leg[] = [];
  for (const p of options) {
    if (!p.option?.ok) continue;
    legs.push({
      kind: 'option',
      right: p.instrument.optionRight!,
      strike: p.instrument.strike!,
      quantity: (p.quantity * p.instrument.multiplier) / multiplier,
      premium: p.avgCost,
      vol: p.option.vol,
      years: p.option.years,
    });
  }
  const shares = valuation.positions
    .filter((p) => p.instrumentId === underlyingId && p.quantity !== 0)
    .reduce(
      (acc, p) => {
        acc.qty += p.quantity * p.instrument.multiplier;
        acc.cost += p.quantity * p.instrument.multiplier * p.avgCost;
        return acc;
      },
      { qty: 0, cost: 0 },
    );
  if (shares.qty !== 0)
    legs.unshift({
      kind: 'underlying',
      quantity: shares.qty / multiplier,
      price: shares.cost / shares.qty,
    });
  return { underlyingId, spot, multiplier, vol: first.option.vol, legs };
}
