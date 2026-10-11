import type { QuoteRequestItem, QuoteResult } from '@core/api';

// Quotes for a site with no backend. The published site carries a snapshot
// of public market prices (`quotes.json`, refreshed by a scheduled job);
// Binance allows browser calls, so its prices are fetched live.

interface Snapshot {
  generatedAt: string;
  quotes: QuoteResult[];
}

const key = (item: QuoteRequestItem) => `${item.source}:${item.symbol}`;

async function loadSnapshot(): Promise<Map<string, QuoteResult>> {
  try {
    const res = await fetch(`./quotes.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return new Map();
    const snapshot = (await res.json()) as Snapshot;
    return new Map(snapshot.quotes.filter((q) => !q.error && q.price).map((q) => [key(q), q]));
  } catch {
    // No snapshot beside this page (e.g. during local development).
    return new Map();
  }
}

async function binance(symbol: string): Promise<QuoteResult> {
  const item = { source: 'binance' as const, symbol };
  try {
    const res = await fetch(
      `https://data-api.binance.vision/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`,
    );
    const price = Number((await res.json())?.price);
    if (!(price > 0)) throw new Error('沒有價格');
    return { ...item, price, asOf: new Date().toISOString(), status: 'realtime' };
  } catch (err) {
    return { ...item, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Best available quote per item: live where the browser may ask, else the snapshot. */
export async function staticQuotes(items: QuoteRequestItem[]): Promise<QuoteResult[]> {
  const snapshot = await loadSnapshot();
  return Promise.all(
    items.map(async (item) => {
      if (item.source === 'binance') {
        const live = await binance(item.symbol);
        if (!live.error) return live;
      }
      return (
        snapshot.get(key(item)) ?? {
          ...item,
          error: '沒有後端可取得這個報價，請在 Settings 手動輸入價格',
        }
      );
    }),
  );
}
