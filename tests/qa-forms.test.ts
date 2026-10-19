import { describe, expect, it } from 'vitest';
import { buildTransaction } from '../src/web/pages/accounts/TxForm';
import { fresh } from './helpers';

type Draft = Parameters<typeof buildTransaction>[0];

function draft(patch: Partial<Draft> = {}): Draft {
  return {
    date: '2026-01-01',
    type: 'transfer',
    accountId: 'kgi_tw',
    bucket: 'core',
    currency: 'TWD',
    amount: '100',
    instrumentId: '',
    quantity: '',
    price: '',
    fee: '',
    tax: '',
    fxRate: '',
    toAccountId: 'sinopac_tw',
    toCurrency: '',
    toAmount: '',
    toBucket: '',
    loanId: '',
    principal: '',
    interest: '',
    source: '',
    note: '',
    ...patch,
  };
}

describe('QA: deleted account references', () => {
  it('rejects a transaction whose source account was deleted', () => {
    const result = buildTransaction(draft({ accountId: 'deleted-account' }), fresh(), 'qa-tx');
    expect(result).toBe('找不到指定的帳戶');
  });

  it('rejects a transaction whose source account was disabled', () => {
    const data = fresh();
    data.accounts.find((account) => account.id === 'kgi_tw')!.active = false;

    const result = buildTransaction(draft(), data, 'qa-tx');

    expect(result).toBe('找不到指定的帳戶');
  });

  it('rejects a transfer whose destination account was deleted', () => {
    const result = buildTransaction(draft({ toAccountId: 'deleted-account' }), fresh(), 'qa-tx');
    expect(result).toBe('找不到有效的轉入帳戶');
  });

  it('rejects a transfer whose destination account was disabled', () => {
    const data = fresh();
    data.accounts.find((account) => account.id === 'sinopac_tw')!.active = false;

    const result = buildTransaction(draft(), data, 'qa-tx');

    expect(result).toBe('找不到有效的轉入帳戶');
  });

  it('rejects a repayment that refers to a disabled loan', () => {
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
      active: false,
    });
    const result = buildTransaction(
      draft({ type: 'loan_repay', loanId: 'qa-loan', principal: '1', source: 'external' }),
      data,
      'qa-tx',
    );

    expect(result).toBe('找不到指定的貸款');
  });
});
