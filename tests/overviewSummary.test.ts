import { describe, expect, it } from 'vitest';
import {
  cashReading,
  compareAllocation,
  computePortfolio,
  debtReading,
  demoData,
  getSettings,
  leverageReading,
  overviewSummary,
  returnReading,
  topDeviations,
} from '@core/index';

describe('readings', () => {
  it('places leverage against the alert threshold', () => {
    expect(leverageReading(1.8, 2.5)).toEqual({ tone: 'ok', text: '低於提醒門檻 2.50×' });
    expect(leverageReading(2.3, 2.5).tone).toBe('info');
    expect(leverageReading(2.5, 2.5).text).toContain('接近');
    expect(leverageReading(2.6, 2.5)).toEqual({ tone: 'warn', text: '高於提醒門檻 2.50×' });
    expect(leverageReading(1.2, undefined).text).toContain('尚未設定');
    expect(leverageReading(undefined, 2.5).tone).toBe('warn');
  });

  it('states return on contributed capital with its sign', () => {
    expect(returnReading(150, 1000).text).toBe('相對外部投入 +15.0%');
    expect(returnReading(-50, 1000).text).toBe('相對外部投入 -5.0%');
    expect(returnReading(10, 0).text).toContain('無法計算');
  });

  it('reads debt and cash as shares of NAV', () => {
    expect(debtReading(0, 0)).toEqual({ tone: 'ok', text: '沒有負債' });
    expect(debtReading(500, 0.5).text).toBe('負債 / NAV 50.0%');
    expect(debtReading(500, undefined).tone).toBe('warn');
    expect(cashReading(250, 1000).text).toBe('占 NAV 25.0%');
    expect(cashReading(250, 0).text).toBe('各帳戶正餘額合計');
  });
});

describe('overview of the demo portfolio', () => {
  const now = new Date('2026-10-09T08:00:00Z');
  const data = demoData(now);
  const { valuation } = computePortfolio(data, { now });
  const comparison = compareAllocation(data, valuation);

  it('lists the widest allocation gaps first, in words', () => {
    const d = topDeviations(comparison, 3);
    expect(d).toHaveLength(3);
    expect(Math.abs(d[0].gapWeight)).toBeGreaterThanOrEqual(Math.abs(d[1].gapWeight));
    expect(d[0].name).toBe('S&P 500');
    expect(d[0].text).toMatch(/^低於目標 \d+\.\d 個百分點$/);
    for (const row of d) expect(row.gapWeight).toBeCloseTo(row.targetWeight - row.actualWeight, 10);
  });

  it('counts every target outside its band, not only those listed', () => {
    const s = overviewSummary(valuation, comparison, getSettings(data).alerts.grossLeverage);
    expect(s.targets).toBe(data.targets.length);
    expect(s.outOfBand).toBe(comparison.rows.filter((r) => r.hasTarget && r.outOfBand).length);
    expect(s.leverage.tone).toBe('ok');
    expect(s.debt.text).toMatch(/^負債 \/ NAV/);
  });

  it('gives no deviations when NAV is not positive', () => {
    expect(topDeviations({ ...comparison, navValid: false })).toEqual([]);
  });
});
