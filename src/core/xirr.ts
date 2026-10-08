import type { ISODate } from './types';

export interface CashFlow {
  date: ISODate;
  /** Investor cash flow: money paid in is negative; money received is positive. */
  amount: number;
}

const MIN_RATE = -0.999999;
const MAX_RATE = 1e100;
const TOLERANCE = 1e-10;

function dayNumber(date: ISODate): number | undefined {
  const parts = date.split('-').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) return undefined;
  const [year, month, day] = parts;
  const value = Date.UTC(year, month - 1, day);
  return Number.isNaN(value) ? undefined : value / 86_400_000;
}

/**
 * Money-weighted annualised return using Actual/365. The bracketed solver is
 * deliberately used instead of Newton's method: cash-flow series commonly
 * have flat slopes or a root close to -100%.
 */
export function xirr(flows: CashFlow[]): number | undefined {
  if (flows.length < 2 || !flows.some((f) => f.amount > 0) || !flows.some((f) => f.amount < 0)) return undefined;
  const dated = flows
    .map((flow) => ({ ...flow, day: dayNumber(flow.date) }))
    .filter((flow): flow is CashFlow & { day: number } => flow.day !== undefined && Number.isFinite(flow.amount));
  if (dated.length < 2) return undefined;
  const first = Math.min(...dated.map((flow) => flow.day));
  const npv = (rate: number) => {
    const base = 1 + rate;
    if (!(base > 0)) return Number.NaN;
    return dated.reduce((sum, flow) => sum + flow.amount / base ** ((flow.day - first) / 365), 0);
  };

  // A geometric scan finds a sign-changing bracket without assuming where a
  // realistic annual return lies. Multiple roots remain inherently ambiguous;
  // returning the first bracket is the conventional XIRR behaviour.
  const candidates = [
    MIN_RATE, -0.9, -0.5, -0.1, 0, 0.1, 0.5, 1, 2, 5, 10, 100, 1_000, 10_000,
    1e6, 1e8, 1e10, 1e12, 1e14, 1e16, 1e20, 1e40, 1e70, MAX_RATE,
  ];
  let left = candidates[0];
  let leftValue = npv(left);
  for (let i = 1; i < candidates.length; i += 1) {
    const right = candidates[i];
    const rightValue = npv(right);
    if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) {
      left = right;
      leftValue = rightValue;
      continue;
    }
    if (Math.abs(leftValue) < TOLERANCE) return left;
    if (Math.abs(rightValue) < TOLERANCE) return right;
    if (Math.sign(leftValue) !== Math.sign(rightValue)) {
      let lo = left;
      let hi = right;
      let loValue = leftValue;
      for (let iteration = 0; iteration < 200; iteration += 1) {
        const mid = (lo + hi) / 2;
        const midValue = npv(mid);
        if (!Number.isFinite(midValue)) return undefined;
        if (Math.abs(midValue) < TOLERANCE || Math.abs(hi - lo) < TOLERANCE * (1 + Math.abs(mid))) return mid;
        if (Math.sign(loValue) === Math.sign(midValue)) {
          lo = mid;
          loValue = midValue;
        } else {
          hi = mid;
        }
      }
      return undefined;
    }
    left = right;
    leftValue = rightValue;
  }
  return undefined;
}
