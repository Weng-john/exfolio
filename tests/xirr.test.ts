import { describe, expect, it } from 'vitest';
import { xirr } from '@core/index';

describe('xirr', () => {
  it('returns 100% for a one-year doubling', () => {
    expect(
      xirr([
        { date: '2025-01-01', amount: -100 },
        { date: '2026-01-01', amount: 200 },
      ]),
    ).toBeCloseTo(1, 8);
  });

  it('solves a hand-checkable multi-flow series with Actual/365', () => {
    const rate = xirr([
      { date: '2025-01-01', amount: -100 },
      { date: '2025-07-02', amount: -50 },
      { date: '2026-01-01', amount: 180 },
    ]);
    expect(rate).toBeCloseTo(0.2425, 3);
  });

  it('supports losses and rejects series without a sign change', () => {
    expect(
      xirr([
        { date: '2025-01-01', amount: -100 },
        { date: '2026-01-01', amount: 80 },
      ]),
    ).toBeCloseTo(-0.2, 8);
    expect(
      xirr([
        { date: '2025-01-01', amount: -100 },
        { date: '2026-01-01', amount: -80 },
      ]),
    ).toBeUndefined();
    expect(xirr([{ date: '2025-01-01', amount: -100 }])).toBeUndefined();
  });
});
