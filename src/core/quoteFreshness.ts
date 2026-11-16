import type { QuoteRequestItem, QuoteResult } from './api';
import type { QuoteSource } from './types';

// Per-quote freshness for the published quote snapshot.
//
// The snapshot job used to judge itself only by how many requests failed. A
// source can still answer with an old price (a delisted ticker, a renamed
// symbol, a market closed for longer than a weekend), and that price was
// published as if current. Each quote is now judged by its own age and an old
// one is labelled `stale`, so the site shows it as such whatever the
// visitor's own staleness setting.

const HOUR = 3_600_000;

/**
 * Oldest a quote may be, in hours, before the snapshot treats it as stale.
 * Exchange-traded prices are allowed a long weekend plus a holiday
 * (Friday close → Tuesday open is ~88 hours); crypto trades around the clock.
 */
export const MAX_QUOTE_AGE_HOURS: Record<Exclude<QuoteSource, 'manual'>, number> = {
  yahoo: 100,
  taifex: 100,
  binance: 1,
  binance_futures: 1,
};

/** Clock skew tolerated for a quote stamped slightly in the future. */
const FUTURE_SKEW_MS = 10 * 60_000;

export type QuoteVerdict =
  | { kind: 'fresh'; ageHours: number }
  | { kind: 'stale'; ageHours: number; limitHours: number }
  | { kind: 'failed'; reason: string };

/** Judges one quote against its source's age limit at time `now`. */
export function judgeQuote(quote: QuoteResult, now: Date): QuoteVerdict {
  if (quote.error) return { kind: 'failed', reason: quote.error };
  if (typeof quote.price !== 'number' || !Number.isFinite(quote.price) || !(quote.price > 0))
    return { kind: 'failed', reason: '沒有有效價格' };
  const at = quote.asOf === undefined ? NaN : Date.parse(quote.asOf);
  if (Number.isNaN(at)) return { kind: 'failed', reason: '沒有報價時間' };
  const ageMs = now.getTime() - at;
  if (ageMs < -FUTURE_SKEW_MS) return { kind: 'failed', reason: '報價時間在未來' };
  const ageHours = Math.max(0, ageMs) / HOUR;
  if (quote.source === 'manual') return { kind: 'fresh', ageHours };
  const limitHours = MAX_QUOTE_AGE_HOURS[quote.source];
  return ageHours > limitHours
    ? { kind: 'stale', ageHours, limitHours }
    : { kind: 'fresh', ageHours };
}

export interface SnapshotReview {
  /** Quotes to publish: stale ones keep their price but are marked `stale`. */
  quotes: QuoteResult[];
  fresh: number;
  stale: Array<QuoteRequestItem & { ageHours: number; limitHours: number }>;
  failed: Array<QuoteRequestItem & { reason: string }>;
  /** Share of quotes with a usable price, fresh or stale, 0–1 (1 for an empty list). */
  usableShare: number;
  /** Whether enough quotes have a price to replace the published snapshot. */
  publish: boolean;
}

/**
 * Reviews a snapshot before it is published. A stale quote is kept (an old
 * price beats none for a visitor who can see its age) but marked `stale`.
 * Only failures count against the publish threshold: a market closed for a
 * week-long holiday makes its quotes stale, and that must not stop every
 * other market's prices from updating.
 */
export function reviewSnapshot(
  quotes: QuoteResult[],
  now: Date,
  minUsableShare = 0.8,
): SnapshotReview {
  const out: QuoteResult[] = [];
  const stale: SnapshotReview['stale'] = [];
  const failed: SnapshotReview['failed'] = [];
  let fresh = 0;
  for (const q of quotes) {
    const v = judgeQuote(q, now);
    const item = { source: q.source, symbol: q.symbol };
    if (v.kind === 'fresh') {
      fresh++;
      out.push(q);
    } else if (v.kind === 'stale') {
      stale.push({ ...item, ageHours: v.ageHours, limitHours: v.limitHours });
      out.push({ ...q, status: 'stale' });
    } else {
      failed.push({ ...item, reason: v.reason });
      out.push(q.error ? q : { ...q, error: v.reason });
    }
  }
  const usableShare = quotes.length ? (fresh + stale.length) / quotes.length : 1;
  return {
    quotes: out,
    fresh,
    stale,
    failed,
    usableShare,
    publish: usableShare >= minUsableShare,
  };
}
