import { describe, expect, it } from 'vitest';
import { fmtMoney, fmtNum, fmtPct } from '../src/web/format';

describe('number formatting', () => {
  it('never shows a negative zero', () => {
    expect(fmtMoney(-0)).toBe('0');
    expect(fmtMoney(-0.3)).toBe('0');
    expect(fmtMoney(-0.004, 'USD')).toBe('0.00');
    expect(fmtNum(-0.001, 2)).toBe('0');
    expect(fmtPct(-0.00001)).toBe('0.0%');
  });

  it('keeps the sign of values that do not round to zero', () => {
    expect(fmtMoney(-0.6)).toBe('-1');
    expect(fmtMoney(-1234.5, 'USD')).toBe('-1,234.50');
    expect(fmtPct(-0.0006)).toBe('-0.1%');
  });
});
