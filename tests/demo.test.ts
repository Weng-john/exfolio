import { describe, expect, it } from 'vitest';
import { collateralStatus, computePortfolio, demoData, strategySummaries } from '@core/index';

describe('demo data', () => {
  const now = new Date('2026-10-09T08:00:00Z');
  const data = demoData(now);
  const portfolio = computePortfolio(data, { now });

  it('is a coherent portfolio: priced, positive NAV, no warnings', () => {
    const v = portfolio.valuation;
    expect(v.warnings).toEqual([]);
    expect(v.nav).toBeGreaterThan(0);
    expect(v.grossLeverage).toBeGreaterThan(1);
    expect(v.positions.every((p) => p.priceStatus === 'manual')).toBe(true);
    expect(v.cash.every((c) => c.value >= 0)).toBe(true);
  });

  it('exercises loans, pledging and a strategy', () => {
    const pledge = data.loans.find((l) => l.kind === 'pledge')!;
    const balance = portfolio.ledger.loans.find((l) => l.loanId === pledge.id)!.balance;
    expect(collateralStatus(data, portfolio.valuation, pledge, balance).maintenanceRatio).toBeGreaterThan(pledge.callRatio!);
    expect(strategySummaries(data, portfolio).levels.length).toBeGreaterThanOrEqual(4);
  });

  it('uses only fictional institutions', () => {
    expect(data.brokers.every((b) => b.name.startsWith('示範'))).toBe(true);
    expect(data.loans.every((l) => l.lender.startsWith('示範'))).toBe(true);
  });
});
