import type { CashValue, ValuedPosition } from './valuation';
import type { AppData, ID, ISODate, Transaction, TxType } from './types';

// Pure helpers behind the Accounts & Positions page.

export interface TxFilter {
  accountId?: ID;
  type?: TxType;
  instrumentId?: ID;
  /** Inclusive bounds. */
  from?: ISODate;
  to?: ISODate;
}

/** Transactions matching the filter, newest first (later entries first within a day). */
export function filterTransactions(txs: Transaction[], f: TxFilter): Transaction[] {
  return txs
    .map((tx, i) => ({ tx, i }))
    .filter(({ tx }) => {
      if (f.accountId && tx.accountId !== f.accountId && tx.toAccountId !== f.accountId)
        return false;
      if (f.type && tx.type !== f.type) return false;
      if (f.instrumentId && tx.instrumentId !== f.instrumentId) return false;
      if (f.from && tx.date < f.from) return false;
      if (f.to && tx.date > f.to) return false;
      return true;
    })
    .sort((a, b) => (a.tx.date === b.tx.date ? b.i - a.i : a.tx.date < b.tx.date ? 1 : -1))
    .map(({ tx }) => tx);
}

export interface PositionTotals {
  marketValue: number;
  exposure: number;
  unrealizedPnl: number;
  /** In base currency. */
  realizedPnl: number;
  /** Exposure / NAV; undefined when NAV is not positive. */
  exposureToNav?: number;
}

export function positionTotals(positions: ValuedPosition[], nav: number): PositionTotals {
  let marketValue = 0;
  let exposure = 0;
  let unrealizedPnl = 0;
  let realizedPnl = 0;
  for (const p of positions) {
    marketValue += p.marketValue;
    exposure += p.exposure;
    unrealizedPnl += p.unrealizedPnl;
    realizedPnl += p.realizedPnl * p.fxRate;
  }
  return {
    marketValue,
    exposure,
    unrealizedPnl,
    realizedPnl,
    exposureToNav: nav > 0 ? exposure / nav : undefined,
  };
}

/** Base-currency cash total and the amount that is overdrawn (a liability). */
export function cashTotals(cash: CashValue[]): { total: number; overdrawn: number } {
  let total = 0;
  let overdrawn = 0;
  for (const c of cash) {
    total += c.value;
    if (c.value < 0) overdrawn += -c.value;
  }
  return { total, overdrawn };
}

/** What still references an account; deleting it is refused while any count is non-zero. */
export function accountReferences(
  data: AppData,
  accountId: ID,
): { transactions: number; collateral: number } {
  return {
    transactions: data.transactions.filter(
      (t) => t.accountId === accountId || t.toAccountId === accountId,
    ).length,
    collateral: data.loans.reduce(
      (n, l) => n + (l.collateral ?? []).filter((c) => c.accountId === accountId).length,
      0,
    ),
  };
}

/** What still references a broker. */
export function brokerReferences(
  data: AppData,
  brokerId: ID,
): { accounts: number; instruments: number } {
  return {
    accounts: data.accounts.filter((a) => a.brokerId === brokerId).length,
    instruments: data.instruments.filter((i) => i.brokerIds?.includes(brokerId)).length,
  };
}
