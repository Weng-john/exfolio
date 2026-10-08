import { describe, expect, it } from 'vitest';
import { buildNotifications, computePortfolio, type Notification } from '@core/index';
import { fresh, setPrice, setTarget, tx } from './helpers';

function has(list: Notification[], id: string): boolean {
  return list.some((n) => n.id === id);
}

describe('notifications', () => {
  it('uses the default seven-day expiry window and includes the boundary', () => {
    const data = fresh();
    const instrument = data.instruments.find((i) => i.id === 'fut_MTX')!;
    instrument.expiry = '2026-10-16';
    data.transactions.push(tx({ type: 'buy', date: '2026-01-01', accountId: 'kgi_fut', instrumentId: instrument.id, quantity: 1, price: 20_000 }));
    setPrice(data, instrument.id, 20_000);
    expect(has(buildNotifications(data, computePortfolio(data), '2026-10-09'), 'futures-roll-kgi_fut|fut_MTX|core')).toBe(true);
    expect(buildNotifications(data, computePortfolio(data), '2026-10-08').some((n) => n.category === 'futures-expiry')).toBe(false);
  });

  it('flags an expired open contract and a margin shortfall', () => {
    const data = fresh();
    const instrument = data.instruments.find((i) => i.id === 'fut_MTX')!;
    instrument.expiry = '2026-10-08';
    instrument.initialMargin = 8_000;
    instrument.maintenanceMargin = 6_000;
    data.transactions.push(
      tx({ type: 'deposit', date: '2026-01-01', accountId: 'kgi_fut', amount: 1_000 }),
      tx({ type: 'buy', date: '2026-01-02', accountId: 'kgi_fut', instrumentId: instrument.id, quantity: 1, price: 20_000 }),
    );
    setPrice(data, instrument.id, 19_000);
    const list = buildNotifications(data, computePortfolio(data), '2026-10-09');
    expect(list.some((n) => n.category === 'futures-expiry' && n.level === 'bad')).toBe(true);
    expect(list.some((n) => n.category === 'futures-margin' && n.level === 'bad')).toBe(true);
  });

  it('notifies pledge maintenance below call and below the user threshold', () => {
    const data = fresh();
    data.loans.push({
      id: 'pledge1', name: '示範質押', kind: 'pledge', lender: '示範券商甲', currency: 'TWD', principal: 8_000,
      annualRate: 0.03, method: 'revolving', startDate: '2026-01-01', callRatio: 1.5, active: true,
      collateral: [{ instrumentId: 'tw_0050', accountId: 'kgi_tw', quantity: 100, loanableRatio: 0.6 }],
    });
    data.transactions.push(
      tx({ type: 'deposit', date: '2026-01-01', accountId: 'kgi_tw', amount: 10_000 }),
      tx({ type: 'buy', date: '2026-01-02', accountId: 'kgi_tw', instrumentId: 'tw_0050', quantity: 100, price: 100 }),
      tx({ type: 'loan_draw', date: '2026-01-03', accountId: 'kgi_tw', amount: 8_000, loanId: 'pledge1' }),
    );
    setPrice(data, 'tw_0050', 100);
    data.settings[0].alerts.maintenanceRatio = 1.4;
    const list = buildNotifications(data, computePortfolio(data), '2026-10-09');
    expect(list.find((n) => n.id === 'collateral-maintenance-pledge1')?.level).toBe('bad');

    data.loans[0].callRatio = 1.1;
    const thresholdList = buildNotifications(data, computePortfolio(data), '2026-10-09');
    expect(thresholdList.find((n) => n.id === 'collateral-maintenance-pledge1')?.level).toBe('warn');
  });

  it('uses the default seven-day loan reminder and detects overdue payments', () => {
    const data = fresh();
    data.loans.push({ id: 'loan1', name: '示範信貸', kind: 'credit', lender: '示範銀行', currency: 'TWD', principal: 10_000, annualRate: 0.03, method: 'annuity', startDate: '2026-01-01', termMonths: 12, payDay: 1, active: true });
    data.transactions.push(tx({ type: 'loan_draw', date: '2026-01-01', accountId: 'kgi_tw', amount: 10_000, loanId: 'loan1' }));
    expect(buildNotifications(data, computePortfolio(data), '2026-01-25').some((n) => n.id === 'loan-due-loan1')).toBe(true);
    expect(buildNotifications(data, computePortfolio(data), '2026-02-02').some((n) => n.id === 'loan-overdue-loan1')).toBe(true);
  });

  it('fires allocation drift only beyond the target tolerance and merges portfolio alerts', () => {
    const data = fresh();
    data.transactions.push(tx({ type: 'deposit', date: '2026-01-01', amount: 1_000 }), tx({ type: 'buy', date: '2026-01-02', instrumentId: 'tw_0050', quantity: 5, price: 100 }));
    setPrice(data, 'tw_0050', 100);
    setTarget(data, 'tw50', 0.6, { tolerance: 0.1 });
    let list = buildNotifications(data, computePortfolio(data), '2026-10-09');
    expect(list.some((n) => n.category === 'allocation')).toBe(false);
    data.targets[0].targetWeight = 0.61;
    data.settings[0].alerts.grossLeverage = 0.4;
    list = buildNotifications(data, computePortfolio(data), '2026-10-09');
    expect(list.some((n) => n.id === 'allocation-drift-tw50')).toBe(true);
    expect(list.some((n) => n.id === 'gross-leverage' && n.category === 'portfolio')).toBe(true);
    expect(new Set(list.map((n) => n.id)).size).toBe(list.length);
  });
});
