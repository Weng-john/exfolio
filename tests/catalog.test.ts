import { describe, expect, it } from 'vitest';
import { CATALOG_FX_PAIRS, CATALOG_INDICES, CATALOG_INSTRUMENTS, QUOTE_SOURCES } from '@core/index';

describe('public market catalogue', () => {
  it('has stable unique ids and valid index/quote references', () => {
    const ids = CATALOG_INSTRUMENTS.map((instrument) => instrument.id);
    expect(new Set(ids).size).toBe(ids.length);
    const indexIds = new Set(CATALOG_INDICES.map((index) => index.id));
    for (const instrument of CATALOG_INSTRUMENTS) {
      expect(instrument.symbol).not.toBe('');
      expect(instrument.currency).not.toBe('');
      expect(instrument.multiplier).toBeGreaterThan(0);
      expect(instrument.lotSize).toBeGreaterThan(0);
      expect(instrument.leverage).not.toBe(0);
      expect(QUOTE_SOURCES).toContain(instrument.quoteSource);
      expect(instrument.indexId && indexIds.has(instrument.indexId)).toBe(true);
      if (instrument.quoteSource !== 'manual') expect(instrument.quoteSymbol).toBeTruthy();
    }
  });

  it('keeps declared weighting semantics and broad-market implementation choices', () => {
    const byId = new Map(CATALOG_INDICES.map((index) => [index.id, index]));
    expect(byId.get('nikkei225')?.weighting).toBe('price');
    expect(byId.get('btc')?.weighting).toBe('other');
    for (const id of [
      'tw50',
      'sp500',
      'ndx',
      'kospi200',
      'hsi',
      'csi300',
      'nifty50',
      'emerging',
      'global_all',
    ]) {
      expect(
        CATALOG_INSTRUMENTS.some(
          (instrument) => instrument.indexId === id && instrument.leverage === 1,
        ),
      ).toBe(true);
    }
    for (const index of CATALOG_INDICES) expect(index.weighting).toBeTruthy();
  });

  it('uses valid quote sources for every maintained FX pair', () => {
    for (const [from, to, source, symbol] of CATALOG_FX_PAIRS) {
      expect(from).not.toBe(to);
      expect(QUOTE_SOURCES).toContain(source);
      expect(symbol).not.toBe('');
    }
  });
});
