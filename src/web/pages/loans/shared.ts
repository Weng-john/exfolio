import { FxTable, getSettings, type AppData, type Loan, type LoanKind, type RepaymentMethod } from '@core/index';

export const KIND_LABEL: Record<LoanKind, string> = {
  credit: '信用貸款',
  pledge: '股票／ETF 質押',
  margin: '融資',
  other: '其他',
};

export const METHOD_LABEL: Record<RepaymentMethod, string> = {
  annuity: '本息平均攤還',
  equal_principal: '本金平均攤還',
  interest_only: '到期還本（按期繳息）',
  revolving: '循環額度（無固定期限）',
};

export function num(s: string): number {
  return s.trim() === '' ? NaN : Number(s);
}

/** Base currency per 1 unit of `currency`; 0 when no FX path exists. */
export function baseRate(data: AppData, currency: string): number {
  return new FxTable(data.fxRates).rate(currency, getSettings(data).baseCurrency) ?? 0;
}

export function hasTransactions(data: AppData, loan: Loan): boolean {
  return data.transactions.some((t) => t.loanId === loan.id);
}
