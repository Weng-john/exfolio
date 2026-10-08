import { useEffect, useState } from 'react';
import {
  SEED_FX_PAIRS,
  type FxRate,
  type PriceQuote,
  type QuoteRequestItem,
  type QuoteSource,
} from '@core/index';
import { getBackend, getState, setTable } from './store';

// Market quotes are refreshed separately from account data: on page open,
// every 30 seconds while the tab is visible, and on demand.

export const REFRESH_MS = 30_000;

export interface QuoteSyncState {
  refreshing: boolean;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  errors: string[];
}

let sync: QuoteSyncState = { refreshing: false, errors: [] };
const listeners = new Set<() => void>();

function setSync(patch: Partial<QuoteSyncState>) {
  sync = { ...sync, ...patch };
  listeners.forEach((l) => l());
}

export function useQuoteSync(): QuoteSyncState {
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return sync;
}

const key = (source: QuoteSource, symbol: string) => `${source}:${symbol}`;

/** Fetch every non-manual instrument quote and the tracked FX pairs. */
export async function refreshQuotes(): Promise<void> {
  const backend = getBackend();
  if (!backend || sync.refreshing || getState().status === 'loading') return;
  const { data } = getState();

  const instruments = data.instruments.filter(
    (i) => i.active && i.quoteSource !== 'manual' && i.quoteSymbol,
  );
  const items = new Map<string, QuoteRequestItem>();
  for (const i of instruments) {
    items.set(key(i.quoteSource, i.quoteSymbol!), {
      source: i.quoteSource,
      symbol: i.quoteSymbol!,
    });
  }
  for (const [, , source, symbol] of SEED_FX_PAIRS)
    items.set(key(source, symbol), { source, symbol });
  if (!items.size) return;

  setSync({ refreshing: true, lastAttemptAt: new Date().toISOString() });
  try {
    const res = await backend.call({ action: 'quotes', items: [...items.values()] });
    if (!res.ok) throw new Error(res.error);
    const results = new Map((res.quotes ?? []).map((q) => [key(q.source, q.symbol), q]));
    const errors: string[] = [];
    const latest = getState().data;

    const prices = new Map(latest.prices.map((p) => [p.id, p]));
    for (const i of instruments) {
      const q = results.get(key(i.quoteSource, i.quoteSymbol!));
      if (!q || q.error || !q.price) {
        errors.push(`${i.symbol}: ${q?.error ?? '沒有回應'}`);
        continue;
      }
      const quote: PriceQuote = {
        id: i.id,
        price: q.price,
        currency: i.currency,
        asOf: q.asOf ?? new Date().toISOString(),
        source: i.quoteSource,
        status: q.status ?? 'delayed',
      };
      prices.set(i.id, quote);
    }

    const fxRates = new Map(latest.fxRates.map((r) => [r.id, r]));
    for (const [from, to, source, symbol] of SEED_FX_PAIRS) {
      const q = results.get(key(source, symbol));
      if (!q || q.error || !q.price) {
        errors.push(`${from}/${to}: ${q?.error ?? '沒有回應'}`);
        continue;
      }
      const rate: FxRate = {
        id: `${from}/${to}`,
        from,
        to,
        rate: q.price,
        asOf: q.asOf ?? new Date().toISOString(),
        source,
      };
      fxRates.set(rate.id, rate);
    }

    setTable('prices', [...prices.values()]);
    setTable('fxRates', [...fxRates.values()]);
    setSync({
      refreshing: false,
      errors,
      lastSuccessAt: errors.length < items.size ? new Date().toISOString() : sync.lastSuccessAt,
    });
  } catch (err) {
    setSync({ refreshing: false, errors: [err instanceof Error ? err.message : String(err)] });
  }
}

/** Refresh on mount and every 30 s while the tab is visible. */
export function useAutoRefresh(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    void refreshQuotes();
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void refreshQuotes();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [enabled]);
}
