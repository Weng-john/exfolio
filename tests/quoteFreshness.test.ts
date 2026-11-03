import { describe, expect, it } from 'vitest';
import type { QuoteResult } from '../src/core/api';
import { judgeQuote, reviewSnapshot } from '../src/core/quoteFreshness';

const NOW = new Date('2026-03-10T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const q = (over: Partial<QuoteResult>): QuoteResult => ({
  source: 'yahoo',
  symbol: 'VOO',
  price: 100,
  asOf: hoursAgo(1),
  status: 'delayed',
  ...over,
});

describe('judgeQuote', () => {
  it('lets an exchange price last over a long weekend', () => {
    expect(judgeQuote(q({ asOf: hoursAgo(90) }), NOW).kind).toBe('fresh');
    expect(judgeQuote(q({ asOf: hoursAgo(101) }), NOW)).toMatchObject({
      kind: 'stale',
      limitHours: 100,
    });
  });

  it('expects crypto prices within the hour', () => {
    const btc = { source: 'binance' as const, symbol: 'BTCUSDT' };
    expect(judgeQuote(q({ ...btc, asOf: hoursAgo(0.5) }), NOW).kind).toBe('fresh');
    expect(judgeQuote(q({ ...btc, asOf: hoursAgo(2) }), NOW).kind).toBe('stale');
  });

  it('fails a quote with no usable price or time', () => {
    expect(judgeQuote(q({ error: 'HTTP 404' }), NOW)).toEqual({
      kind: 'failed',
      reason: 'HTTP 404',
    });
    expect(judgeQuote(q({ price: 0 }), NOW).kind).toBe('failed');
    expect(judgeQuote(q({ price: Number.NaN }), NOW).kind).toBe('failed');
    expect(judgeQuote(q({ asOf: undefined }), NOW).kind).toBe('failed');
    expect(judgeQuote(q({ asOf: 'yesterday-ish' }), NOW).kind).toBe('failed');
  });

  it('tolerates small clock skew but not a quote from the future', () => {
    expect(judgeQuote(q({ asOf: hoursAgo(-0.1) }), NOW).kind).toBe('fresh');
    expect(judgeQuote(q({ asOf: hoursAgo(-1) }), NOW).kind).toBe('failed');
  });
});

describe('reviewSnapshot', () => {
  it('labels stale quotes and counts only failures against the threshold', () => {
    const quotes = [
      q({ symbol: 'A' }),
      q({ symbol: 'B' }),
      q({ symbol: 'C' }),
      q({ symbol: 'D', asOf: hoursAgo(500) }),
      q({ symbol: 'E', error: 'timeout' }),
    ];
    const r = reviewSnapshot(quotes, NOW);
    expect(r.fresh).toBe(3);
    expect(r.stale.map((s) => s.symbol)).toEqual(['D']);
    expect(r.failed.map((s) => s.symbol)).toEqual(['E']);
    expect(r.usableShare).toBeCloseTo(0.8);
    expect(r.publish).toBe(true);
    // The stale price is kept but labelled, so the site can show its age.
    expect(r.quotes.find((x) => x.symbol === 'D')).toMatchObject({ price: 100, status: 'stale' });
  });

  it('keeps publishing through a long holiday in one market', () => {
    const closed = [...'ABCDEF'].map((s) => q({ symbol: s, asOf: hoursAgo(200) }));
    const open = [...'GHIJ'].map((s) => q({ symbol: s }));
    const r = reviewSnapshot([...closed, ...open], NOW);
    expect(r.stale).toHaveLength(6);
    expect(r.publish).toBe(true);
  });

  it('refuses a snapshot where too many requests failed', () => {
    const quotes = [...'ABC'].map((s) => q({ symbol: s, error: 'HTTP 429' }));
    quotes.push(...[...'DEFGHIJ'].map((s) => q({ symbol: s })));
    expect(reviewSnapshot(quotes, NOW).publish).toBe(false);
  });

  it('gives an error to a failed quote that had none', () => {
    const r = reviewSnapshot([q({ price: -1 })], NOW);
    expect(r.quotes[0]!.error).toBe('沒有有效價格');
    expect(r.publish).toBe(false);
  });

  it('treats an empty list as nothing to block', () => {
    expect(reviewSnapshot([], NOW)).toMatchObject({ usableShare: 1, publish: true });
  });
});
