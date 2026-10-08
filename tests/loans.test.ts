import { describe, expect, it } from 'vitest';
import {
  amortizationSchedule,
  addMonths,
  buildLedger,
  collateralStatus,
  computePortfolio,
  debtCashflowForecast,
  dueDateOf,
  loanStatus,
  prepaymentEffect,
  type AppData,
  type Loan,
} from '@core/index';
import { fresh, NOW, setFx, setPrice, tx } from './helpers';

const opts = { now: NOW };

const loan = (partial: Partial<Loan> = {}): Loan => ({
  id: 'L1',
  name: '測試信貸',
  kind: 'credit',
  lender: '測試銀行',
  currency: 'TWD',
  principal: 120_000,
  annualRate: 0.12,
  method: 'annuity',
  startDate: '2026-01-15',
  termMonths: 12,
  payDay: 15,
  active: true,
  ...partial,
});

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('amortizationSchedule', () => {
  it('annuity: level payment matches the hand-computed value', () => {
    // 120,000 at 1% a month over 12 months: 1,200 / (1 - 1.01^-12) = 10,661.85
    const rows = amortizationSchedule(loan());
    expect(rows).toHaveLength(12);
    expect(rows[0].payment).toBeCloseTo(10661.85, 2);
    expect(rows[0].interest).toBe(1200);
    expect(rows[0].principal).toBeCloseTo(9461.85, 2);
    expect(rows[5].payment).toBeCloseTo(10661.85, 2);
    expect(sum(rows.map((r) => r.principal))).toBeCloseTo(120_000, 6);
    expect(rows[11].balance).toBe(0);
  });

  it('annuity with a 0% rate splits the principal evenly', () => {
    const rows = amortizationSchedule(loan({ annualRate: 0, principal: 12_000 }));
    expect(rows.every((r) => r.interest === 0)).toBe(true);
    expect(rows.every((r) => r.payment === 1000)).toBe(true);
    expect(rows[11].balance).toBe(0);
  });

  it('absorbs rounding in the last period', () => {
    const rows = amortizationSchedule(loan({ principal: 100_000, annualRate: 0.0345, termMonths: 7 }), { digits: 0 });
    expect(sum(rows.map((r) => r.principal))).toBe(100_000);
    expect(rows[6].balance).toBe(0);
  });

  it('equal_principal: constant principal, declining interest', () => {
    const rows = amortizationSchedule(loan({ method: 'equal_principal' }));
    expect(rows[0].principal).toBe(10_000);
    expect(rows[0].interest).toBe(1200);
    expect(rows[1].interest).toBe(1100);
    expect(rows[11].interest).toBe(100);
    expect(rows[11].balance).toBe(0);
    expect(sum(rows.map((r) => r.principal))).toBe(120_000);
  });

  it('interest_only: interest each period, principal at maturity', () => {
    const rows = amortizationSchedule(loan({ method: 'interest_only' }));
    expect(rows.slice(0, 11).every((r) => r.principal === 0 && r.interest === 1200)).toBe(true);
    expect(rows[11].principal).toBe(120_000);
    expect(rows[11].payment).toBe(121_200);
    expect(rows[11].balance).toBe(0);
  });

  it('revolving has no schedule', () => {
    expect(amortizationSchedule(loan({ method: 'revolving', termMonths: undefined }))).toEqual([]);
  });

  it('clamps due dates to the month end', () => {
    const l = loan({ startDate: '2027-01-31', payDay: 31 });
    expect(dueDateOf(l, 1)).toBe('2027-02-28');
    expect(dueDateOf(l, 2)).toBe('2027-03-31');
    expect(dueDateOf(l, 3)).toBe('2027-04-30');
    expect(addMonths('2027-12-15', 1, 31)).toBe('2028-01-31');
    expect(addMonths('2027-01-31', 13, 31)).toBe('2028-02-29');
    const rows = amortizationSchedule(l);
    expect(rows[0].dueDate).toBe('2027-02-28');
    expect(rows[11].dueDate).toBe('2028-01-31');
  });

  it('restarts from the current balance and remaining periods', () => {
    const rows = amortizationSchedule(loan(), { balance: 50_000, periods: 5, firstDueDate: '2026-08-15' });
    expect(rows).toHaveLength(5);
    expect(rows[0].dueDate).toBe('2026-08-15');
    expect(rows[0].interest).toBe(500);
    expect(sum(rows.map((r) => r.principal))).toBeCloseTo(50_000, 6);
    expect(rows[4].balance).toBe(0);
  });
});

describe('loanStatus', () => {
  const build = (): AppData => {
    const data = fresh();
    data.loans.push(loan());
    data.transactions.push(
      tx({ type: 'deposit', date: '2026-01-01', amount: 50_000 }),
      tx({ type: 'loan_draw', date: '2026-01-15', amount: 120_000, loanId: 'L1' }),
      tx({ type: 'loan_repay', date: '2026-02-15', amount: 10661.85, principal: 9461.85, interest: 1200, loanId: 'L1', source: 'external' }),
      tx({ type: 'loan_repay', date: '2026-03-15', amount: 10661.85, principal: 9556.47, interest: 1105.38, loanId: 'L1', source: 'portfolio' }),
    );
    return data;
  };

  it('derives balance, split and next payment from transactions', () => {
    const data = build();
    const ledger = buildLedger(data);
    const st = loanStatus(data, ledger, data.loans[0], '2026-03-20');
    expect(st.balance).toBeCloseTo(120_000 - 9461.85 - 9556.47, 6);
    expect(st.drawn).toBe(120_000);
    expect(st.principalRepaid).toBeCloseTo(19018.32, 6);
    expect(st.interestPaid).toBeCloseTo(2305.38, 6);
    expect(st.repaidExternally).toBeCloseTo(10661.85, 6);
    expect(st.repaidFromPortfolio).toBeCloseTo(10661.85, 2);
    expect(st.elapsedPeriods).toBe(2);
    expect(st.remainingPeriods).toBe(10);
    expect(st.nextDueDate).toBe('2026-04-15');
    expect(st.nextPayment!.interest).toBeCloseTo(st.balance * 0.01, 2);
    expect(st.nextPayment!.principal + st.nextPayment!.interest).toBeCloseTo(st.nextPayment!.total, 6);
    expect(st.projectedMonthlyInterest).toBeCloseTo(st.balance * 0.01, 6);
    expect(st.remainingSchedule).toHaveLength(10);
    expect(st.remainingSchedule[9].balance).toBe(0);
  });

  it('a period due today counts as paid only once a repayment is recorded', () => {
    const data = build();
    const ledger = buildLedger(data);
    expect(loanStatus(data, ledger, data.loans[0], '2026-03-15').nextDueDate).toBe('2026-04-15');
    expect(loanStatus(data, ledger, data.loans[0], '2026-04-15').nextDueDate).toBe('2026-04-15');
  });

  it('revolving loans show projected interest only', () => {
    const data = build();
    data.loans = [loan({ method: 'revolving', termMonths: undefined })];
    const st = loanStatus(data, buildLedger(data), data.loans[0], '2026-03-20');
    expect(st.remainingSchedule).toEqual([]);
    expect(st.nextDueDate).toBe('2026-04-15');
    expect(st.nextPayment!.principal).toBe(0);
    expect(st.nextPayment!.interest).toBeCloseTo(st.balance * 0.01, 6);
  });
});

describe('prepaymentEffect', () => {
  it('keeping the term lowers the payment; keeping the payment shortens the term', () => {
    const e = prepaymentEffect(loan(), 120_000, 20_000, 12, { firstDueDate: '2026-02-15' });
    expect(e.newBalance).toBe(100_000);
    expect(e.baseline.firstPayment).toBeCloseTo(10661.85, 2);
    expect(e.keepTerm.periods).toBe(12);
    expect(e.keepTerm.firstPayment).toBeCloseTo(8884.88, 2);
    expect(e.keepPayment.periods).toBeLessThan(12);
    expect(e.keepPayment.firstPayment).toBeCloseTo(10661.85, 2);
    expect(e.keepPayment.schedule.at(-1)!.balance).toBe(0);
    expect(e.keepTerm.interestSaved).toBeGreaterThan(0);
    expect(e.keepPayment.interestSaved).toBeGreaterThan(e.keepTerm.interestSaved);
  });

  it('equal_principal keeps its principal step when keeping the payment', () => {
    const e = prepaymentEffect(loan({ method: 'equal_principal' }), 120_000, 30_000, 12);
    expect(e.keepPayment.periods).toBe(9);
    expect(e.keepPayment.schedule[0].principal).toBe(10_000);
    expect(e.keepTerm.schedule[0].principal).toBe(7500);
  });
});

describe('pledged collateral', () => {
  const pledge = (data: AppData, balance = 400_000, callRatio = 1.3): Loan => {
    const l = loan({
      id: 'P1', kind: 'pledge', method: 'revolving', termMonths: undefined, annualRate: 0.025, principal: balance,
      callRatio,
      collateral: [{ instrumentId: 'tw_0050', accountId: 'kgi_tw', quantity: 10_000, loanableRatio: 0.6 }],
    });
    data.loans.push(l);
    data.transactions.push(
      tx({ type: 'deposit', date: '2026-01-01', amount: 1_000_000 }),
      tx({ type: 'buy', date: '2026-01-02', instrumentId: 'tw_0050', quantity: 10_000, price: 100 }),
      tx({ type: 'loan_draw', date: '2026-01-03', amount: balance, loanId: 'P1' }),
    );
    setPrice(data, 'tw_0050', 100);
    return l;
  };
  const status = (data: AppData, l: Loan) => {
    const { ledger, valuation } = computePortfolio(data, opts);
    const bal = ledger.loans.find((s) => s.loanId === l.id)!.balance;
    return collateralStatus(data, valuation, l, bal);
  };

  it('maintenance ratio, lendable value, capacity and trigger drop', () => {
    const data = fresh();
    const c = status(data, pledge(data));
    expect(c.marketValue).toBe(1_000_000);
    expect(c.maintenanceRatio).toBeCloseTo(2.5);
    expect(c.lendableValue).toBe(600_000);
    expect(c.borrowingCapacity).toBe(200_000);
    expect(c.belowCall).toBe(false);
    expect(c.triggerValue).toBe(520_000);
    expect(c.triggerDropPct).toBeCloseTo(0.48);
    expect(c.releasableValue).toBe(480_000);
    expect(c.cureRepayment).toBeUndefined();
  });

  it('computes the repayment or collateral needed to cure a call', () => {
    const data = fresh();
    const c = status(data, pledge(data, 800_000));
    expect(c.maintenanceRatio).toBeCloseTo(1.25);
    expect(c.belowCall).toBe(true);
    expect(c.triggerDropPct).toBe(0);
    expect(c.cureRepayment).toBeCloseTo(800_000 - 1_000_000 / 1.3, 6);
    expect(c.cureCollateral).toBeCloseTo(40_000, 6);
    expect(c.releasableValue).toBe(0);
    expect(c.warnings.some((w) => w.includes('追繳'))).toBe(true);
  });

  it('maintenance ratio is undefined with no balance', () => {
    const data = fresh();
    const l = pledge(data);
    const { valuation } = computePortfolio(data, opts);
    const c = collateralStatus(data, valuation, l, 0);
    expect(c.maintenanceRatio).toBeUndefined();
    expect(c.belowCall).toBe(false);
    expect(c.releasableValue).toBe(1_000_000);
  });

  it('warns when more is pledged than held, and reports free quantity', () => {
    const data = fresh();
    const l = pledge(data);
    l.collateral![0].quantity = 12_000;
    const c = status(data, l);
    expect(c.items[0].overPledged).toBe(true);
    expect(c.items[0].heldQuantity).toBe(10_000);
    expect(c.items[0].freeQuantity).toBe(-2000);
    expect(c.warnings.some((w) => w.includes('超過'))).toBe(true);

    l.collateral![0].quantity = 4000;
    const ok = status(data, l);
    expect(ok.items[0].overPledged).toBe(false);
    expect(ok.items[0].freeQuantity).toBe(6000);
  });

  it('does not double count collateral in NAV', () => {
    const plain = fresh();
    pledge(plain);
    plain.loans[0].collateral = undefined;
    const pledged = fresh();
    pledge(pledged);
    const a = computePortfolio(plain, opts).valuation;
    const b = computePortfolio(pledged, opts).valuation;
    expect(b.nav).toBe(a.nav);
    expect(b.totalAssets).toBe(a.totalAssets);
    expect(b.liabilities).toBe(400_000);
    expect(b.nav).toBe(1_000_000); // 1.0M 0050 + 0.4M cash - 0.4M loan; collateral adds nothing
  });

  it('converts USD collateral into the TWD loan currency', () => {
    const data = fresh();
    setFx(data, 'USD', 'TWD', 32);
    data.transactions.push(
      tx({ type: 'deposit', date: '2026-01-01', accountId: 'sinopac_us', currency: 'USD', amount: 100_000 }),
      tx({ type: 'buy', date: '2026-01-02', accountId: 'sinopac_us', currency: 'USD', instrumentId: 'us_VOO', quantity: 100, price: 500 }),
      tx({ type: 'loan_draw', date: '2026-01-03', amount: 800_000, loanId: 'P2' }),
    );
    setPrice(data, 'us_VOO', 500, 'USD');
    const l = loan({
      id: 'P2', kind: 'pledge', method: 'revolving', termMonths: undefined, callRatio: 1.3,
      collateral: [{ instrumentId: 'us_VOO', accountId: 'sinopac_us', quantity: 100, loanableRatio: 0.5 }],
    });
    data.loans.push(l);
    const c = status(data, l);
    expect(c.marketValue).toBe(1_600_000); // 100 x 500 USD x 32
    expect(c.lendableValue).toBe(800_000);
    expect(c.maintenanceRatio).toBeCloseTo(2);
  });
});

describe('debtCashflowForecast', () => {
  it('lists scheduled principal and interest per month in base currency', () => {
    const data = fresh();
    data.loans.push(loan(), loan({ id: 'U1', currency: 'USD', method: 'revolving', termMonths: undefined, payDay: 20, annualRate: 0.06 }));
    setFx(data, 'USD', 'TWD', 30);
    data.transactions.push(
      tx({ type: 'loan_draw', date: '2026-01-15', amount: 120_000, loanId: 'L1' }),
      tx({ type: 'loan_draw', date: '2026-01-15', amount: 1000, currency: 'USD', loanId: 'U1' }),
    );
    const rows = debtCashflowForecast(data, buildLedger(data), 12, '2026-03-20');
    expect(rows).toHaveLength(12);
    expect(rows[0].month).toBe('2026-03');
    // March: L1 due 03-15 already passed, U1 interest due 03-20 is not after today.
    expect(rows[0].total).toBe(0);
    expect(rows[1].month).toBe('2026-04');
    const l1 = rows[1].byLoan.find((l) => l.loanId === 'L1')!;
    // No repayment recorded: the full balance is re-amortized over the 10 periods left.
    expect(l1.principal + l1.interest).toBeCloseTo(12669.85, 2);
    const u1 = rows[1].byLoan.find((l) => l.loanId === 'U1')!;
    expect(u1.principal).toBe(0);
    expect(u1.interest).toBeCloseTo(1000 * 0.005 * 30, 6);
    expect(rows[1].total).toBeCloseTo(rows[1].principal + rows[1].interest, 6);
    const l1Months = rows.filter((r) => r.byLoan.some((l) => l.loanId === 'L1')).length;
    expect(l1Months).toBe(10);
  });
});
