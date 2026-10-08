import { useMemo } from 'react';
import { computePortfolio, type Portfolio } from '@core/index';
import { useData } from './store';

/** Ledger and valuation of the current dataset, recomputed when it changes. */
export function usePortfolio(): Portfolio {
  const data = useData();
  return useMemo(() => computePortfolio(data), [data]);
}
