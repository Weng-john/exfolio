import type { AllocationComparison } from './allocation';
import type { ID } from './types';
import type { Valuation } from './valuation';

// The overview's conclusions: for each headline figure, one sentence saying
// how it stands, and the allocation gaps worth looking at first. Everything
// here informs; nothing blocks an action or caps leverage.

export type ReadingTone = 'ok' | 'info' | 'warn';

export interface Reading {
  tone: ReadingTone;
  text: string;
}

/** Share of the alert threshold from which leverage is called "close to" it. */
const NEAR_THRESHOLD = 0.9;

const times = (x: number) => `${x.toFixed(2)}×`;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** Gross leverage against the alert threshold, when one is set. */
export function leverageReading(grossLeverage: number | undefined, threshold?: number): Reading {
  if (grossLeverage === undefined) return { tone: 'warn', text: 'NAV 不為正，無法計算槓桿' };
  if (!(threshold !== undefined && threshold > 0))
    return { tone: 'info', text: '尚未設定槓桿提醒門檻' };
  if (grossLeverage > threshold) return { tone: 'warn', text: `高於提醒門檻 ${times(threshold)}` };
  if (grossLeverage >= threshold * NEAR_THRESHOLD)
    return { tone: 'info', text: `接近提醒門檻 ${times(threshold)}` };
  return { tone: 'ok', text: `低於提醒門檻 ${times(threshold)}` };
}

/** Total profit as a return on the money put in from outside. */
export function returnReading(totalPnl: number, contributedCapital: number): Reading {
  if (!(contributedCapital > 0)) return { tone: 'info', text: '尚無外部投入，無法計算報酬率' };
  const r = totalPnl / contributedCapital;
  const sign = r > 0 ? '+' : '';
  return { tone: 'info', text: `相對外部投入 ${sign}${pct(r)}` };
}

/** Liabilities as a share of NAV. */
export function debtReading(liabilities: number, debtToNav: number | undefined): Reading {
  if (!(liabilities > 0)) return { tone: 'ok', text: '沒有負債' };
  if (debtToNav === undefined) return { tone: 'warn', text: 'NAV 不為正，無法計算比率' };
  return { tone: 'info', text: `負債 / NAV ${pct(debtToNav)}` };
}

/** Cash as a share of NAV. */
export function cashReading(cashValue: number, nav: number): Reading {
  if (!(nav > 0)) return { tone: 'info', text: '各帳戶正餘額合計' };
  return { tone: 'info', text: `占 NAV ${pct(cashValue / nav)}` };
}

export interface Deviation {
  indexId: ID;
  name: string;
  targetWeight: number;
  /** Core weight actually held. */
  actualWeight: number;
  /** target − actual: positive means under-weight. */
  gapWeight: number;
  outOfBand: boolean;
  /** "低於目標 22.1 個百分點" and the like. */
  text: string;
}

/**
 * Indices with a target, widest gap first. `limit` keeps the list short for
 * a summary; the allocation page shows them all.
 */
export function topDeviations(comparison: AllocationComparison, limit = 4): Deviation[] {
  if (!comparison.navValid) return [];
  return comparison.rows
    .filter((r) => r.hasTarget)
    .sort((a, b) => Math.abs(b.gapWeight) - Math.abs(a.gapWeight))
    .slice(0, limit)
    .map((r) => {
      const points = Math.abs(r.gapWeight * 100).toFixed(1);
      const text = !r.outOfBand
        ? '在容忍區間內'
        : r.gapWeight > 0
          ? `低於目標 ${points} 個百分點`
          : `高於目標 ${points} 個百分點`;
      return {
        indexId: r.indexId,
        name: r.name,
        targetWeight: r.targetWeight,
        actualWeight: r.coreWeight,
        gapWeight: r.gapWeight,
        outOfBand: r.outOfBand,
        text,
      };
    });
}

export interface OverviewSummary {
  leverage: Reading;
  pnl: Reading;
  debt: Reading;
  cash: Reading;
  deviations: Deviation[];
  /** Targets outside their band, over all indices (not only those listed). */
  outOfBand: number;
  /** Indices that have a target at all. */
  targets: number;
}

export function overviewSummary(
  valuation: Valuation,
  comparison: AllocationComparison,
  grossLeverageThreshold?: number,
): OverviewSummary {
  const withTarget = comparison.rows.filter((r) => r.hasTarget);
  return {
    leverage: leverageReading(valuation.grossLeverage, grossLeverageThreshold),
    pnl: returnReading(valuation.totalPnl, valuation.contributedCapital),
    debt: debtReading(valuation.liabilities, valuation.debtToNav),
    cash: cashReading(valuation.cashValue, valuation.nav),
    deviations: topDeviations(comparison),
    outOfBand: comparison.navValid ? withTarget.filter((r) => r.outOfBand).length : 0,
    targets: withTarget.length,
  };
}
