import type { QuoteRequestItem, QuoteResult } from '../src/core/api';

// Free public sources, fetched server-side because none of them allows
// cross-origin browser calls reliably. Both are unofficial for this use:
// prices may be delayed and the endpoints may change or rate-limit.

const TTL_MS = 20_000;
const cache = new Map<string, { at: number; result: QuoteResult }>();

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (exfolio local quote proxy)', Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function yahoo(symbol: string): Promise<Partial<QuoteResult>> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  const meta = (await getJson(url))?.chart?.result?.[0]?.meta;
  if (!meta || typeof meta.regularMarketPrice !== 'number') throw new Error('No price in response');
  return {
    price: meta.regularMarketPrice,
    currency: meta.currency,
    asOf: new Date((meta.regularMarketTime ?? Date.now() / 1000) * 1000).toISOString(),
    status: 'delayed',
  };
}

async function binance(symbol: string): Promise<Partial<QuoteResult>> {
  const url = `https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`;
  const body = await getJson(url);
  const price = Number(body?.price);
  if (!(price > 0)) throw new Error('No price in response');
  return { price, asOf: new Date().toISOString(), status: 'realtime' };
}

async function fetchOne(item: QuoteRequestItem): Promise<QuoteResult> {
  const key = `${item.source}:${item.symbol}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.result;
  let result: QuoteResult;
  try {
    if (item.source === 'yahoo') result = { ...item, ...(await yahoo(item.symbol)) };
    else if (item.source === 'binance') result = { ...item, ...(await binance(item.symbol)) };
    else result = { ...item, error: 'Manual source has no remote quote' };
  } catch (err) {
    result = { ...item, error: err instanceof Error ? err.message : String(err) };
  }
  if (!result.error) cache.set(key, { at: Date.now(), result });
  return result;
}

export function fetchQuotes(items: QuoteRequestItem[]): Promise<QuoteResult[]> {
  return Promise.all((items ?? []).slice(0, 200).map(fetchOne));
}
