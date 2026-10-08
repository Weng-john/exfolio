import type { HistoryPointResult, HistoryResult, QuoteRequestItem, QuoteResult } from '../src/core/api';

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

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

async function yahooHistory(symbol: string, from: string): Promise<HistoryPointResult[]> {
  const start = Math.floor(new Date(`${from}T00:00:00Z`).getTime() / 1000);
  const end = Math.floor(Date.now() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${start}&period2=${end}`;
  const result = (await getJson(url))?.chart?.result?.[0];
  const stamps: number[] = result?.timestamp ?? [];
  const closes: Array<number | null> = result?.indicators?.quote?.[0]?.close ?? [];
  const adjusted: Array<number | null> = result?.indicators?.adjclose?.[0]?.adjclose ?? [];
  // Shift by the exchange offset so the date is the local trading day.
  const offset = (result?.meta?.gmtoffset ?? 0) * 1000;
  const points: HistoryPointResult[] = [];
  stamps.forEach((t, i) => {
    const close = closes[i];
    if (typeof close !== 'number') return;
    const adj = adjusted[i];
    points.push({ date: day(t * 1000 + offset), close, ...(typeof adj === 'number' ? { adjClose: adj } : {}) });
  });
  return points;
}

async function binanceHistory(symbol: string, from: string): Promise<HistoryPointResult[]> {
  const points: HistoryPointResult[] = [];
  let start = new Date(`${from}T00:00:00Z`).getTime();
  // 1000 daily candles per call; a handful of calls covers many years.
  for (let page = 0; page < 10; page++) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=1d&startTime=${start}&limit=1000`;
    const rows: unknown[][] = await getJson(url);
    if (!Array.isArray(rows) || !rows.length) break;
    for (const row of rows) points.push({ date: day(Number(row[0])), close: Number(row[4]) });
    if (rows.length < 1000) break;
    start = Number(rows[rows.length - 1][0]) + 86_400_000;
  }
  return points;
}

async function historyOne(item: QuoteRequestItem, from: string): Promise<HistoryResult> {
  try {
    if (item.source === 'yahoo') return { ...item, points: await yahooHistory(item.symbol, from) };
    if (item.source === 'binance') return { ...item, points: await binanceHistory(item.symbol, from) };
    return { ...item, points: [], error: 'Manual source has no remote history' };
  } catch (err) {
    return { ...item, points: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export function fetchHistory(items: QuoteRequestItem[], from: string): Promise<HistoryResult[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from ?? '')) throw new Error('`from` must be YYYY-MM-DD');
  return Promise.all((items ?? []).slice(0, 50).map((item) => historyOne(item, from)));
}
