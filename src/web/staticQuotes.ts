import type { QuoteRequestItem, QuoteResult } from '@core/api';
import type { QuoteSource } from '@core/types';

// Quotes for a site with no backend. The published site carries a snapshot
// of public market prices (`quotes.json`, refreshed by a scheduled job);
// Binance allows browser calls, so its prices are fetched live.

interface Snapshot {
  generatedAt: string;
  quotes: QuoteResult[];
}

const key = (item: QuoteRequestItem) => `${item.source}:${item.symbol}`;

let snapshotAt: string | undefined;

/** When the snapshot last read was generated, so its age can be shown. */
export function snapshotGeneratedAt(): string | undefined {
  return snapshotAt;
}

/** A quote worth showing: a finite positive price with a time attached. */
function usable(q: QuoteResult): boolean {
  return (
    !q.error &&
    typeof q.price === 'number' &&
    Number.isFinite(q.price) &&
    q.price > 0 &&
    typeof q.asOf === 'string' &&
    !Number.isNaN(Date.parse(q.asOf))
  );
}

async function loadSnapshot(): Promise<Map<string, QuoteResult>> {
  try {
    const res = await fetch(`./quotes.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return new Map();
    const snapshot = (await res.json()) as Snapshot;
    snapshotAt = snapshot.generatedAt;
    return new Map(snapshot.quotes.filter(usable).map((q) => [key(q), q]));
  } catch {
    // No snapshot beside this page (e.g. during local development).
    return new Map();
  }
}

// Binance answers browsers directly, so its prices are always live.
const BINANCE_URL: Partial<Record<QuoteSource, string>> = {
  binance: 'https://data-api.binance.vision/api/v3/ticker/price?symbol=',
  binance_futures: 'https://fapi.binance.com/fapi/v1/ticker/price?symbol=',
};

async function binance(source: QuoteSource, symbol: string): Promise<QuoteResult> {
  const item = { source, symbol };
  try {
    const res = await fetch(`${BINANCE_URL[source]}${encodeURIComponent(symbol)}`);
    const price = Number((await res.json())?.price);
    if (!Number.isFinite(price) || !(price > 0)) throw new Error('沒有價格');
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
      if (BINANCE_URL[item.source]) {
        const live = await binance(item.source, item.symbol);
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
