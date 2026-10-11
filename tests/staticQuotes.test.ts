import { afterEach, describe, expect, it, vi } from 'vitest';
import { staticQuotes } from '../src/web/staticQuotes';

// The static site's quote source, with the network replaced.

const snapshot = {
  generatedAt: '2026-01-05T00:00:00.000Z',
  quotes: [
    {
      source: 'yahoo',
      symbol: '0050.TW',
      price: 100,
      currency: 'TWD',
      asOf: '2026-01-05T00:00:00.000Z',
      status: 'delayed',
    },
    { source: 'yahoo', symbol: 'BAD', error: 'HTTP 404' },
    {
      source: 'binance',
      symbol: 'BTCUSDT',
      price: 70_000,
      asOf: '2026-01-05T00:00:00.000Z',
      status: 'realtime',
    },
  ],
};

function mockFetch(options: { snapshot?: unknown; binance?: unknown }) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(url);
    if (url.includes('quotes.json')) {
      if (options.snapshot === undefined) return { ok: false, json: async () => ({}) };
      return { ok: true, json: async () => options.snapshot };
    }
    if (options.binance === undefined) throw new Error('offline');
    return { ok: true, json: async () => options.binance };
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('staticQuotes', () => {
  it('reads snapshot prices and skips entries that failed when the snapshot was made', async () => {
    mockFetch({ snapshot });
    const [ok, bad, unknown] = await staticQuotes([
      { source: 'yahoo', symbol: '0050.TW' },
      { source: 'yahoo', symbol: 'BAD' },
      { source: 'yahoo', symbol: 'NOPE' },
    ]);
    expect(ok).toMatchObject({ price: 100, status: 'delayed' });
    expect(bad.error).toBeTruthy();
    expect(bad.price).toBeUndefined();
    expect(unknown.error).toBeTruthy();
  });

  it('asks Binance directly and falls back to the snapshot when that fails', async () => {
    mockFetch({ snapshot, binance: { price: '81234.5' } });
    expect((await staticQuotes([{ source: 'binance', symbol: 'BTCUSDT' }]))[0]).toMatchObject({
      price: 81234.5,
      status: 'realtime',
    });
    mockFetch({ snapshot });
    expect((await staticQuotes([{ source: 'binance', symbol: 'BTCUSDT' }]))[0].price).toBe(70_000);
  });

  it('reports every item as unavailable when there is no snapshot', async () => {
    const calls = mockFetch({});
    const quotes = await staticQuotes([{ source: 'yahoo', symbol: '0050.TW' }]);
    expect(quotes[0].error).toContain('手動輸入');
    expect(calls.every((url) => url.startsWith('./quotes.json'))).toBe(true);
  });
});
