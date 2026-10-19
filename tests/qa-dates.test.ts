import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  daysBetween,
  isISODate,
  parseTransactionsCsv,
  quickPosition,
  rollingReturns,
  xirr,
} from '@core/index';
import { fresh } from './helpers';
import { parseFiniteAmount, parseNonNegativeAmount } from '../src/web/pages/newMoneyValidation';

describe('QA: calendar date validation', () => {
  it('accepts real Gregorian dates and rejects normalized-but-invalid dates', () => {
    expect(isISODate('2024-02-29')).toBe(true);
    expect(isISODate('2026-02-29')).toBe(false);
    expect(isISODate('2026-04-31')).toBe(false);
    expect(isISODate('2026-1-01')).toBe(false);
  });

  it('keeps four-digit years below 0100 correct across calendar helpers and XIRR', () => {
    expect(daysBetween('0099-12-31', '0100-01-01')).toBe(1);
    expect(addDays('0099-12-31', 1)).toBe('0100-01-01');
    expect(addMonths('0099-12-31', 1)).toBe('0100-01-31');
    expect(
      xirr([
        { date: '0099-01-01', amount: -100 },
        { date: '0100-01-01', amount: 110 },
      ]),
    ).toBeCloseTo(0.1, 5);
  });

  it('uses a clamped prior month for rolling returns at month end', () => {
    const history = [
      { date: '2026-02-28', nav: 100 },
      { date: '2026-03-02', nav: 120 },
      { date: '2026-03-31', nav: 130 },
    ].map(({ date, nav }) => ({
      date,
      totalAssets: nav,
      liabilities: 0,
      nav,
      cash: nav,
      grossExposure: nav,
      netExposure: nav,
      contributedCapital: nav,
      netExposureByIndex: {},
      incomplete: false,
      missing: [],
    }));

    expect(rollingReturns(history, [])['1M'][2].return).toBeCloseTo(0.3);
  });

  it('does not create a quick position for an invalid calendar date', () => {
    const result = quickPosition(fresh(), {
      accountId: 'kgi_tw',
      instrumentId: 'tw_0050',
      quantity: 1,
      side: 'long',
      averageCost: 100,
      date: '2026-02-29',
      fundFromOutside: true,
    });
    expect(result.transactions).toEqual([]);
    expect(result.errors).toContain('日期必須是有效的 YYYY-MM-DD 日期');
  });

  it('rejects impossible calendar dates in transaction CSV imports', () => {
    const data = fresh();
    const csv = 'date,type,account,currency,amount\n' + '2026-02-29,deposit,kgi_tw,TWD,1000\n';
    const result = parseTransactionsCsv(csv, data);
    expect(result.transactions).toEqual([]);
    expect(result.errors[0]?.message).toContain('date 格式');
  });

  it('does not silently truncate or clamp invalid allocator amounts', () => {
    expect(parseNonNegativeAmount('12.5')).toBe(12.5);
    expect(parseNonNegativeAmount('-1')).toBeUndefined();
    expect(parseNonNegativeAmount('12abc')).toBeUndefined();
    expect(parseFiniteAmount('-1')).toBe(-1);
    expect(parseFiniteAmount('12abc')).toBeUndefined();
  });
});
