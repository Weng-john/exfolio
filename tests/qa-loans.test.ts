import { describe, expect, it } from 'vitest';
import { buildLedger } from '@core/index';
import { buildTransaction } from '../src/web/pages/accounts/TxForm';
import { fresh, tx } from './helpers';

describe('QA: loan repayment bounds', () => {
  it('does not turn principal overpayment into a negative liability', () => {
    const data = fresh();
    data.loans.push({
      id: 'qa-loan',
      name: 'QA loan',
      kind: 'credit',
      lender: 'Example Bank',
      currency: 'TWD',
      principal: 100,
      annualRate: 0,
      method: 'revolving',
      startDate: '2026-01-01',
      active: true,
    });
    data.transactions.push(
      tx({ type: 'loan_draw', date: '2026-01-02', amount: 100, loanId: 'qa-loan' }),
      tx({
        type: 'loan_repay',
        date: '2026-01-03',
        amount: 150,
        principal: 150,
        interest: 0,
        loanId: 'qa-loan',
        source: 'external',
      }),
    );

    const ledger = buildLedger(data);

    expect(ledger.loans[0].balance).toBe(100);
    expect(ledger.loans[0].principalRepaid).toBe(0);
    expect(ledger.totals.contributedCapital).toBe(0);
    expect(ledger.warnings.join(' ')).toContain('本金還款超過剩餘本金');
  });

  it('shows a validation error before the transaction form saves excess principal', () => {
    const data = fresh();
    data.loans.push({
      id: 'qa-loan',
      name: 'QA loan',
      kind: 'credit',
      lender: 'Example Bank',
      currency: 'TWD',
      principal: 100,
      annualRate: 0,
      method: 'revolving',
      startDate: '2026-01-01',
      active: true,
    });
    data.transactions.push(
      tx({ type: 'loan_draw', date: '2026-01-02', amount: 100, loanId: 'qa-loan' }),
    );

    const result = buildTransaction(
      {
        date: '2026-01-03',
        type: 'loan_repay',
        accountId: 'kgi_tw',
        bucket: 'core',
        currency: 'TWD',
        amount: '150',
        instrumentId: '',
        quantity: '',
        price: '',
        fee: '',
        tax: '',
        fxRate: '',
        toAccountId: '',
        toCurrency: '',
        toAmount: '',
        toBucket: '',
        loanId: 'qa-loan',
        principal: '150',
        interest: '0',
        source: 'external',
        note: '',
      },
      data,
      'qa-repayment',
    );

    expect(result).toBe('本金還款超過貸款剩餘本金');
  });
});
