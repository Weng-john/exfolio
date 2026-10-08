import { useEffect } from 'react';
import { makeSnapshot, today, upsertSnapshot } from '@core/index';
import { getState, setTable, useStore } from './store';
import { usePortfolio } from './usePortfolio';

/** Keep today's NAV snapshot current, so history builds up without any action. */
export function useDailySnapshot() {
  const { status, demo } = useStore();
  const portfolio = usePortfolio();
  useEffect(() => {
    if (demo || status === 'loading' || status === 'conflict') return;
    const { valuation } = portfolio;
    if (!valuation.positions.length && !valuation.cash.length && !valuation.loans.length) return;
    const current = getState().data.snapshots;
    const next = upsertSnapshot(current, makeSnapshot(portfolio, today()));
    if (next !== current) setTable('snapshots', next);
  }, [portfolio, status, demo]);
}
