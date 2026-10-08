import type { Portfolio } from './valuation';
import type { ISODate, NavSnapshot } from './types';

/** Freeze today's valuation into a snapshot row. */
export function makeSnapshot(portfolio: Portfolio, date: ISODate): NavSnapshot {
  const v = portfolio.valuation;
  return {
    id: date,
    date,
    nav: v.nav,
    assets: v.totalAssets,
    liabilities: v.liabilities,
    cash: v.cashValue,
    grossExposure: v.grossExposure,
    netExposure: v.netExposure,
    contributedCapital: v.contributedCapital,
    byIndex: Object.fromEntries(v.byIndex.map((ix) => [ix.indexId, ix.net])),
  };
}

/**
 * Insert or replace the snapshot for its date, keeping the list sorted.
 * Returns the same array when nothing changed, so callers can skip a save.
 */
export function upsertSnapshot(snapshots: NavSnapshot[], next: NavSnapshot): NavSnapshot[] {
  const existing = snapshots.find((s) => s.date === next.date);
  if (existing && sameSnapshot(existing, next)) return snapshots;
  return [...snapshots.filter((s) => s.date !== next.date), next].sort((a, b) =>
    a.date < b.date ? -1 : 1,
  );
}

function sameSnapshot(a: NavSnapshot, b: NavSnapshot): boolean {
  const near = (x: number, y: number) => Math.abs(x - y) < 0.005;
  const keys = new Set([...Object.keys(a.byIndex), ...Object.keys(b.byIndex)]);
  return (
    near(a.nav, b.nav) &&
    near(a.assets, b.assets) &&
    near(a.liabilities, b.liabilities) &&
    near(a.cash, b.cash) &&
    near(a.grossExposure, b.grossExposure) &&
    near(a.netExposure, b.netExposure) &&
    near(a.contributedCapital, b.contributedCapital) &&
    [...keys].every((k) => near(a.byIndex[k] ?? 0, b.byIndex[k] ?? 0))
  );
}

export interface HistoryPoint {
  date: ISODate;
  nav: number;
  contributedCapital: number;
  pnl: number;
  grossLeverage?: number;
  netLeverage?: number;
  debtToNav?: number;
}

/** Snapshot series with the ratios the history charts plot. */
export function leverageHistory(snapshots: NavSnapshot[]): HistoryPoint[] {
  return [...snapshots]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((s) => {
      const ratio = (x: number) => (s.nav > 0 ? x / s.nav : undefined);
      return {
        date: s.date,
        nav: s.nav,
        contributedCapital: s.contributedCapital,
        pnl: s.nav - s.contributedCapital,
        grossLeverage: ratio(s.grossExposure),
        netLeverage: ratio(s.netExposure),
        debtToNav: ratio(s.liabilities),
      };
    });
}
