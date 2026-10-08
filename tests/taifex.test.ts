import { describe, expect, it } from 'vitest';
import { pickTaifexQuote } from '../server/quotes';

const regular = [
  { SymbolID: 'TMF-S', CLastPrice: '20000.00', CDate: '20260105', CTime: '133000' },
  { SymbolID: 'TM2A6-F', CLastPrice: '19990.00', CDate: '20260105', CTime: '134400' },
  { SymbolID: 'TMFA6-F', CLastPrice: '20010.00', CDate: '20260105', CTime: '134500' },
  { SymbolID: 'TMFB6-F', CLastPrice: '20100.00', CDate: '20260105', CTime: '134400' },
];
const at = (iso: string) => new Date(iso).getTime();

describe('pickTaifexQuote', () => {
  it('uses the nearest monthly contract, skipping spot and weekly rows', () => {
    expect(pickTaifexQuote('TMF', { '0': regular, '1': [] })).toEqual({
      price: 20010,
      at: at('2026-01-05T13:45:00+08:00'),
    });
  });

  it('prefers a later after-hours trade', () => {
    const night = [{ SymbolID: 'TMFA6-M', CLastPrice: '19950.00', CDate: '20260105', CTime: '213000' }];
    expect(pickTaifexQuote('TMF', { '0': regular, '1': night })?.price).toBe(19950);
  });

  it('dates after-hours trades past midnight on the next calendar day', () => {
    const night = [{ SymbolID: 'TMFA6-M', CLastPrice: '19900.00', CDate: '20260105', CTime: '040823' }];
    expect(pickTaifexQuote('TMF', { '0': regular, '1': night })).toEqual({
      price: 19900,
      at: at('2026-01-06T04:08:23+08:00'),
    });
  });

  it('keeps the regular session when after hours has not traded', () => {
    const night = [{ SymbolID: 'TMFA6-M', CLastPrice: '', CDate: '20260105', CTime: '' }];
    expect(pickTaifexQuote('TMF', { '0': regular, '1': night })?.price).toBe(20010);
  });

  it('matches an exact contract in either session', () => {
    const night = [{ SymbolID: 'TMFB6-M', CLastPrice: '20050.00', CDate: '20260105', CTime: '220000' }];
    expect(pickTaifexQuote('TMFB6-F', { '0': regular, '1': night })?.price).toBe(20050);
    expect(pickTaifexQuote('TMFC6-F', { '0': regular, '1': night })).toBeUndefined();
  });
});
