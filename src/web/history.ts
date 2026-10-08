import type { PriceHistoryPoint, QuoteSource } from '@core/index';
import { getBackend, getState, setTable } from './store';

export interface HistorySyncResult {
  added: number;
  errors: string[];
}

/**
 * Download daily closes for the given instruments from `from` to today and
 * merge them into the `priceHistory` table. Instruments with a manual quote
 * source are skipped: their history has to be entered or imported.
 */
export async function syncPriceHistory(
  instrumentIds: string[],
  from: string,
): Promise<HistorySyncResult> {
  const backend = getBackend();
  if (!backend) return { added: 0, errors: ['尚未連線後端'] };
  const { data } = getState();
  const wanted = data.instruments.filter(
    (i) => instrumentIds.includes(i.id) && i.quoteSource !== 'manual' && i.quoteSymbol,
  );
  if (!wanted.length) return { added: 0, errors: [] };

  const key = (source: QuoteSource, symbol: string) => `${source}:${symbol}`;
  const items = [
    ...new Map(
      wanted.map((i) => [
        key(i.quoteSource, i.quoteSymbol!),
        { source: i.quoteSource, symbol: i.quoteSymbol! },
      ]),
    ).values(),
  ];
  const res = await backend.call({ action: 'history', items, from });
  if (!res.ok) return { added: 0, errors: [res.error] };

  const results = new Map((res.history ?? []).map((h) => [key(h.source, h.symbol), h]));
  const rows = new Map(getState().data.priceHistory.map((p) => [p.id, p]));
  const before = rows.size;
  const errors: string[] = [];
  for (const i of wanted) {
    const h = results.get(key(i.quoteSource, i.quoteSymbol!));
    if (!h || h.error) {
      errors.push(`${i.symbol}: ${h?.error ?? '沒有回應'}`);
      continue;
    }
    for (const pt of h.points) {
      const row: PriceHistoryPoint = {
        id: `${i.id}|${pt.date}`,
        instrumentId: i.id,
        date: pt.date,
        close: pt.close,
      };
      if (pt.adjClose !== undefined) row.adjClose = pt.adjClose;
      rows.set(row.id, row);
    }
  }
  setTable('priceHistory', [...rows.values()]);
  return { added: rows.size - before, errors };
}
