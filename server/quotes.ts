import type {
  HistoryPointResult,
  HistoryResult,
  QuoteRequestItem,
  QuoteResult,
} from '../src/core/api';

// Free public sources, fetched server-side because none of them allows
// cross-origin browser calls reliably. Both are unofficial for this use:
// prices may be delayed and the endpoints may change or rate-limit.

const TTL_MS = 20_000;
const cache = new Map<string, { at: number; result: QuoteResult }>();

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (exfolio local quote proxy)',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function yahoo(symbol: string): Promise<Partial<QuoteResult>> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  const meta = (await getJson(url))?.chart?.result?.[0]?.meta;
  if (!meta || !Number.isFinite(meta.regularMarketPrice) || !(meta.regularMarketPrice > 0)) {
    throw new Error('No price in response');
  }
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
  if (!Number.isFinite(price) || !(price > 0)) throw new Error('No price in response');
  return { price, asOf: new Date().toISOString(), status: 'realtime' };
}

/** Binance USDⓈ-M perpetuals, including TradFi contracts such as SPYUSDT. */
async function binanceFutures(symbol: string): Promise<Partial<QuoteResult>> {
  const url = `https://fapi.binance.com/fapi/v1/ticker/price?symbol=${encodeURIComponent(symbol)}`;
  const body = await getJson(url);
  const price = Number(body?.price);
  if (!Number.isFinite(price) || !(price > 0)) throw new Error('No price in response');
  return {
    price,
    asOf: new Date(Number(body?.time) || Date.now()).toISOString(),
    status: 'realtime',
  };
}

// One call returns every contract month of a product, so the list is cached
// per product and session, and calls are made one at a time: the site
// answers bursts with errors.
const TAIFEX_TTL_MS = 90_000;
const taifexLists = new Map<string, { at: number; list: TaifexRow[] }>();
let taifexQueue: Promise<unknown> = Promise.resolve();

function taifexList(cid: string, marketType: string): Promise<TaifexRow[]> {
  const run = async () => {
    const key = `${cid}:${marketType}`;
    const hit = taifexLists.get(key);
    if (hit && Date.now() - hit.at < TAIFEX_TTL_MS) return hit.list;
    try {
      const res = await fetch('https://mis.taifex.com.tw/futures/api/getQuoteList', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (exfolio local quote proxy)',
        },
        body: JSON.stringify({
          MarketType: marketType,
          SymbolType: 'F',
          KindID: '1',
          CID: cid,
          ExpireMonth: '',
          RowSize: '全部',
          PageNo: '',
          SortColumn: '',
          AscDesc: 'A',
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list: TaifexRow[] = (await res.json())?.RtData?.QuoteList ?? [];
      taifexLists.set(key, { at: Date.now(), list });
      return list;
    } catch (err) {
      // Keep serving the last good list: its own timestamp shows how old it is.
      if (hit) return hit.list;
      throw err;
    }
  };
  const next = taifexQueue.then(run, run);
  taifexQueue = next.catch(() => undefined);
  return next;
}

export interface TaifexRow {
  SymbolID?: string;
  CLastPrice?: string;
  CDate?: string;
  CTime?: string;
}

/**
 * Pick the latest trade for a TAIFEX symbol from the regular ('0') and
 * after-hours ('1') quote lists. `symbol` is a product code such as TXF
 * (the nearest monthly contract is used) or a contract id such as TXFK6-F.
 */
export function pickTaifexQuote(
  symbol: string,
  lists: Record<'0' | '1', TaifexRow[]>,
): { price: number; at: number } | undefined {
  const exact = symbol.includes('-');
  const cid = exact ? symbol.slice(0, 3) : symbol;
  // Contract ids end in -F in the regular session and -M after hours.
  const monthly = new RegExp(`^${cid}[A-L]\\d-[FM]$`);
  const contract = exact ? symbol.replace(/-[FM]$/, '') : '';
  let best: { price: number; at: number } | undefined;
  for (const session of ['0', '1'] as const) {
    const row = lists[session].find((q) =>
      exact
        ? String(q.SymbolID).replace(/-[FM]$/, '') === contract
        : monthly.test(q.SymbolID ?? ''),
    );
    const price = Number(row?.CLastPrice);
    const d = row?.CDate ?? '';
    if (!row || !Number.isFinite(price) || !(price > 0) || !/^\d{8}$/.test(d)) continue;
    const t = String(row.CTime ?? '').padStart(6, '0');
    let at = new Date(
      `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}+08:00`,
    ).getTime();
    // After-hours trades past midnight still carry the previous calendar date.
    if (session === '1' && Number(t.slice(0, 2)) < 15) at += 86_400_000;
    if (!best || at > best.at) best = { price, at };
  }
  return best;
}

async function taifex(symbol: string): Promise<Partial<QuoteResult>> {
  const cid = symbol.slice(0, 3);
  const best = pickTaifexQuote(symbol, {
    '0': await taifexList(cid, '0'),
    '1': await taifexList(cid, '1'),
  });
  if (!best) throw new Error('No price in response');
  return {
    price: best.price,
    currency: 'TWD',
    asOf: new Date(best.at).toISOString(),
    status: 'delayed',
  };
}

async function fetchOne(item: QuoteRequestItem): Promise<QuoteResult> {
  const key = `${item.source}:${item.symbol}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.result;
  let result: QuoteResult;
  try {
    if (item.source === 'yahoo') result = { ...item, ...(await yahoo(item.symbol)) };
    else if (item.source === 'binance') result = { ...item, ...(await binance(item.symbol)) };
    else if (item.source === 'binance_futures') {
      result = { ...item, ...(await binanceFutures(item.symbol)) };
    } else if (item.source === 'taifex') result = { ...item, ...(await taifex(item.symbol)) };
    else result = { ...item, error: 'Manual source has no remote quote' };
  } catch (err) {
    result = { ...item, error: err instanceof Error ? err.message : String(err) };
  }
  if (!result.error) cache.set(key, { at: Date.now(), result });
  return result;
}

const MAX_PARALLEL = 6;

/**
 * Quotes for up to 300 items, a few requests at a time: firing a long
 * catalogue at a source all at once gets the whole batch rate-limited.
 */
export async function fetchQuotes(items: QuoteRequestItem[]): Promise<QuoteResult[]> {
  const list = (items ?? []).slice(0, 300);
  const results: QuoteResult[] = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++;
      results[i] = await fetchOne(list[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL, list.length) }, worker));
  return results;
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
    points.push({
      date: day(t * 1000 + offset),
      close,
      ...(typeof adj === 'number' ? { adjClose: adj } : {}),
    });
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
    if (item.source === 'binance')
      return { ...item, points: await binanceHistory(item.symbol, from) };
    return { ...item, points: [], error: 'Manual source has no remote history' };
  } catch (err) {
    return { ...item, points: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export function fetchHistory(items: QuoteRequestItem[], from: string): Promise<HistoryResult[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from ?? '')) throw new Error('`from` must be YYYY-MM-DD');
  return Promise.all((items ?? []).slice(0, 50).map((item) => historyOne(item, from)));
}
