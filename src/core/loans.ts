import { FxTable } from './fx';
import type { Ledger } from './ledger';
import type { Valuation } from './valuation';
import { getSettings, type AppData, type ID, type ISODate, type Loan } from './types';

// Loans, amortization, prepayment, pledged collateral and the debt cash-flow
// forecast. Pure functions: balances always come from the ledger (replayed
// transactions); `loan.principal` is only the original amount.
//
// Accounting rules honoured here:
// - Pledged collateral and the stock position are ONE asset. Nothing in this
//   module adds collateral value to assets or NAV; the pledge loan balance is
//   the only liability.
// - Thresholds (callRatio, loanableRatio) are informational. They never block
//   or cap anything.

const EPS = 1e-9;
const MAX_PERIODS = 1200;

// ---------------------------------------------------------------- dates

interface YMD {
  y: number;
  m: number; // 1-12
  d: number;
}

function parseDate(date: ISODate): YMD {
  const [y, m, d] = date.split('-').map(Number);
  return { y, m, d };
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function fmtDate(y: number, m: number, d: number): ISODate {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** `date` moved by `months`, landing on `day` clamped to the month end. */
export function addMonths(date: ISODate, months: number, day?: number): ISODate {
  const p = parseDate(date);
  const idx = p.y * 12 + (p.m - 1) + months;
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  return fmtDate(y, m, Math.min(day ?? p.d, daysInMonth(y, m)));
}

/** Due date of scheduled period `n` (1-based): startDate + n months on payDay. */
export function dueDateOf(loan: Loan, n: number): ISODate {
  return addMonths(loan.startDate, n, loan.payDay ?? parseDate(loan.startDate).d);
}

const round = (x: number, digits: number): number => {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
};

// ------------------------------------------------------------- schedule

export interface ScheduleRow {
  /** 1-based period number within this schedule. */
  period: number;
  dueDate: ISODate;
  /** principal + interest. */
  payment: number;
  principal: number;
  interest: number;
  /** Balance after this payment. Exactly 0 on the last row. */
  balance: number;
}

export interface ScheduleOptions {
  /** Starting balance. Defaults to the original principal. */
  balance?: number;
  /** Number of periods left. Defaults to `loan.termMonths`. */
  periods?: number;
  /** Due date of the first row. Defaults to startDate + 1 month on payDay. */
  firstDueDate?: ISODate;
  /** Decimal places payments are rounded to. Default 2. */
  digits?: number;
}

/** Interest for one month on `balance`: annualRate / 12. */
export function monthlyInterest(balance: number, annualRate: number): number {
  return Math.max(0, balance) * (annualRate / 12);
}

/** Level annuity payment for `balance` over `periods` months. Handles 0%. */
export function annuityPayment(balance: number, annualRate: number, periods: number): number {
  if (periods <= 0) return balance;
  const r = annualRate / 12;
  if (Math.abs(r) < EPS) return balance / periods;
  return (balance * r) / (1 - (1 + r) ** -periods);
}

/**
 * Repayment schedule of `loan`. `revolving` loans (and loans without a term)
 * have no schedule: the result is empty.
 */
export function amortizationSchedule(loan: Loan, options: ScheduleOptions = {}): ScheduleRow[] {
  const digits = options.digits ?? 2;
  const start = options.balance ?? loan.principal;
  const n = Math.floor(options.periods ?? loan.termMonths ?? 0);
  if (loan.method === 'revolving' || n <= 0 || !(start > EPS)) return [];

  const first = options.firstDueDate ?? dueDateOf(loan, 1);
  const day = loan.payDay ?? parseDate(first).d;
  const rate = loan.annualRate / 12;
  const level = round(annuityPayment(start, loan.annualRate, n), digits);
  const stepPrincipal = round(start / n, digits);

  const rows: ScheduleRow[] = [];
  let balance = start;
  for (let i = 1; i <= n; i++) {
    const interest = round(balance * rate, digits);
    const last = i === n;
    let principal: number;
    switch (loan.method) {
      case 'annuity':
        principal = last ? balance : round(level - interest, digits);
        break;
      case 'equal_principal':
        principal = last ? balance : stepPrincipal;
        break;
      default: // interest_only
        principal = last ? balance : 0;
    }
    principal = Math.min(principal, balance);
    balance = last ? 0 : round(balance - principal, digits);
    rows.push({
      period: i,
      dueDate: addMonths(first, i - 1, day),
      payment: round(principal + interest, digits),
      principal,
      interest,
      balance,
    });
  }
  return rows;
}

// --------------------------------------------------------------- status

export interface LoanStatus {
  loanId: ID;
  currency: string;
  /** Outstanding principal, derived from transactions. */
  balance: number;
  drawn: number;
  principalRepaid: number;
  interestPaid: number;
  /** Principal + interest paid with outside money. */
  repaidExternally: number;
  /** Principal + interest paid out of portfolio cash. */
  repaidFromPortfolio: number;
  /** Scheduled periods whose due date has passed. Undefined without a schedule. */
  elapsedPeriods?: number;
  remainingPeriods?: number;
  nextDueDate?: ISODate;
  nextPayment?: { principal: number; interest: number; total: number };
  /** One month of interest on the current balance. */
  projectedMonthlyInterest: number;
  /** Schedule of the periods still to pay, re-derived from the current balance. */
  remainingSchedule: ScheduleRow[];
}

/**
 * Status of one loan as of `today`. A period counts as elapsed when its due
 * date is before today, or is today and a repayment was already recorded today.
 */
export function loanStatus(data: AppData, ledger: Ledger, loan: Loan, today: ISODate): LoanStatus {
  const state = ledger.loans.find((l) => l.loanId === loan.id);
  const balance = state?.balance ?? 0;
  const drawn = state?.drawn ?? 0;
  const principalRepaid = state?.principalRepaid ?? 0;
  const interestPaid = state?.interestPaid ?? 0;
  const repaidExternally = state?.repaidExternally ?? 0;
  const projected = monthlyInterest(balance, loan.annualRate);
  const out: LoanStatus = {
    loanId: loan.id,
    currency: loan.currency,
    balance,
    drawn,
    principalRepaid,
    interestPaid,
    repaidExternally,
    repaidFromPortfolio: principalRepaid + interestPaid - repaidExternally,
    projectedMonthlyInterest: projected,
    remainingSchedule: [],
  };

  const term = loan.termMonths ?? 0;
  const scheduled = loan.method !== 'revolving' && term > 0;
  if (!scheduled) {
    // No fixed schedule: interest is due each month on the payDay.
    if (balance > EPS) {
      const day = loan.payDay ?? parseDate(loan.startDate).d;
      out.nextDueDate = nextMonthlyDate(today, day);
      out.nextPayment = { principal: 0, interest: projected, total: projected };
    }
    return out;
  }

  const paidToday = data.transactions.some(
    (t) => t.type === 'loan_repay' && t.loanId === loan.id && t.date === today,
  );
  let elapsed = 0;
  while (elapsed < term) {
    const due = dueDateOf(loan, elapsed + 1);
    if (due < today || (due === today && paidToday)) elapsed++;
    else break;
  }
  const remaining = term - elapsed;
  out.elapsedPeriods = elapsed;
  out.remainingPeriods = remaining;
  if (remaining > 0 && balance > EPS) {
    out.remainingSchedule = amortizationSchedule(loan, {
      balance,
      periods: remaining,
      firstDueDate: dueDateOf(loan, elapsed + 1),
    });
    const next = out.remainingSchedule[0];
    out.nextDueDate = next.dueDate;
    out.nextPayment = { principal: next.principal, interest: next.interest, total: next.payment };
  }
  return out;
}

/** First date on `day` (clamped) that is strictly after `today`. */
function nextMonthlyDate(today: ISODate, day: number): ISODate {
  const thisMonth = addMonths(today, 0, day);
  return thisMonth > today ? thisMonth : addMonths(today, 1, day);
}

// ----------------------------------------------------------- prepayment

export interface PrepaymentOption {
  schedule: ScheduleRow[];
  periods: number;
  /** First scheduled payment after the prepayment. */
  firstPayment: number;
  totalInterest: number;
  /** Baseline interest minus this option's interest. */
  interestSaved: number;
}

export interface PrepaymentEffect {
  extraPrincipal: number;
  newBalance: number;
  baseline: PrepaymentOption;
  /** Same remaining term, lower payment. */
  keepTerm: PrepaymentOption;
  /** Same payment (principal step for equal_principal), shorter term. */
  keepPayment: PrepaymentOption;
}

const sumInterest = (rows: ScheduleRow[]) => rows.reduce((s, r) => s + r.interest, 0);

/**
 * Effect of paying `extraPrincipal` now, with `remainingPeriods` left on
 * `balance`. Interest-only loans repay in full at maturity either way, so
 * keepPayment equals keepTerm for them.
 */
export function prepaymentEffect(
  loan: Loan,
  balance: number,
  extraPrincipal: number,
  remainingPeriods: number,
  options: Pick<ScheduleOptions, 'firstDueDate' | 'digits'> = {},
): PrepaymentEffect {
  const digits = options.digits ?? 2;
  const extra = Math.min(Math.max(extraPrincipal, 0), Math.max(balance, 0));
  const newBalance = round(balance - extra, digits);
  const common = { firstDueDate: options.firstDueDate, digits };
  const baselineRows = amortizationSchedule(loan, {
    ...common,
    balance,
    periods: remainingPeriods,
  });
  const baselineInterest = sumInterest(baselineRows);

  const option = (rows: ScheduleRow[]): PrepaymentOption => ({
    schedule: rows,
    periods: rows.length,
    firstPayment: rows[0]?.payment ?? 0,
    totalInterest: sumInterest(rows),
    interestSaved: baselineInterest - sumInterest(rows),
  });

  const keepTermRows = amortizationSchedule(loan, {
    ...common,
    balance: newBalance,
    periods: remainingPeriods,
  });
  let keepPaymentRows = keepTermRows;

  if (baselineRows.length && newBalance > EPS && loan.method !== 'interest_only') {
    const first = options.firstDueDate ?? baselineRows[0].dueDate;
    const day = loan.payDay ?? parseDate(first).d;
    const rate = loan.annualRate / 12;
    const level = baselineRows[0].payment;
    const step = baselineRows[0].principal;
    keepPaymentRows = [];
    let b = newBalance;
    for (let i = 1; i <= MAX_PERIODS && b > EPS; i++) {
      const interest = round(b * rate, digits);
      let principal = loan.method === 'annuity' ? round(level - interest, digits) : step;
      if (principal <= 0) break; // payment no longer covers interest
      if (principal >= b - EPS || (loan.method === 'annuity' && level >= b + interest))
        principal = b;
      b = round(b - principal, digits);
      keepPaymentRows.push({
        period: i,
        dueDate: addMonths(first, i - 1, day),
        payment: round(principal + interest, digits),
        principal,
        interest,
        balance: b,
      });
    }
  }

  return {
    extraPrincipal: extra,
    newBalance,
    baseline: option(baselineRows),
    keepTerm: option(keepTermRows),
    keepPayment: option(keepPaymentRows),
  };
}

// ----------------------------------------------------------- collateral

export interface CollateralItemStatus {
  instrumentId: ID;
  accountId: ID;
  symbol: string;
  pledgedQuantity: number;
  /** Quantity of the instrument held in that account (all buckets). */
  heldQuantity: number;
  /** held - pledged. Negative when over-pledged. */
  freeQuantity: number;
  overPledged: boolean;
  /** Unit price in the instrument currency; undefined when none is known. */
  price?: number;
  /** Pledged market value in the loan currency. */
  marketValue: number;
  loanableRatio: number;
  /** marketValue x loanableRatio. */
  lendableValue: number;
}

export interface CollateralStatus {
  loanId: ID;
  currency: string;
  balance: number;
  items: CollateralItemStatus[];
  /** Σ pledged market value in the loan currency. Memo only, never added to NAV. */
  marketValue: number;
  lendableValue: number;
  /** lendableValue - balance. Negative when over-borrowed against the lender's limit. */
  borrowingCapacity: number;
  /** 整戶維持率 = marketValue / balance. Undefined when the balance is 0. */
  maintenanceRatio?: number;
  callRatio?: number;
  belowCall: boolean;
  /** Collateral value at which the call triggers: callRatio x balance. */
  triggerValue?: number;
  /** Uniform price fall from now that reaches the trigger (0 when already below). */
  triggerDropPct?: number;
  /** Cash repayment that restores the ratio to callRatio. Only when below. */
  cureRepayment?: number;
  /** Extra collateral value that restores the ratio to callRatio. Only when below. */
  cureCollateral?: number;
  /** Collateral value that can be withdrawn while staying at or above callRatio. */
  releasableValue?: number;
  warnings: string[];
}

/**
 * Pledge status of `loan` against `balance`. Collateral is valued at current
 * prices and converted into the loan currency with the FX table.
 */
export function collateralStatus(
  data: AppData,
  valuation: Valuation,
  loan: Loan,
  balance: number,
): CollateralStatus {
  const fx = new FxTable(data.fxRates);
  const instruments = new Map(data.instruments.map((i) => [i.id, i]));
  const quotes = new Map(data.prices.map((p) => [p.id, p.price]));
  const warnings: string[] = [];

  const items: CollateralItemStatus[] = (loan.collateral ?? []).map((c) => {
    const inst = instruments.get(c.instrumentId);
    const held = valuation.positions
      .filter((p) => p.accountId === c.accountId && p.instrumentId === c.instrumentId)
      .reduce((s, p) => s + p.quantity, 0);
    const symbol = inst?.symbol ?? c.instrumentId;
    const quote = quotes.get(c.instrumentId);
    const price =
      quote && quote > 0
        ? quote
        : valuation.positions.find(
            (p) => p.instrumentId === c.instrumentId && p.priceStatus !== 'missing',
          )?.price;
    let marketValue = 0;
    if (!inst) {
      warnings.push(`擔保品引用了不存在的商品 ${c.instrumentId}`);
    } else if (price === undefined) {
      warnings.push(`${symbol} 沒有報價，擔保品市值以 0 計`);
    } else {
      const rate = fx.rate(inst.currency, loan.currency);
      if (rate === undefined) {
        warnings.push(`缺少 ${inst.currency}/${loan.currency} 匯率，${symbol} 擔保品市值以 0 計`);
      } else {
        marketValue = c.quantity * price * inst.multiplier * rate;
      }
    }
    const overPledged = c.quantity > held + EPS;
    if (overPledged) {
      warnings.push(`${symbol} 質押 ${c.quantity} 超過帳戶實際持有 ${held}`);
    }
    return {
      instrumentId: c.instrumentId,
      accountId: c.accountId,
      symbol,
      pledgedQuantity: c.quantity,
      heldQuantity: held,
      freeQuantity: held - c.quantity,
      overPledged,
      price,
      marketValue,
      loanableRatio: c.loanableRatio,
      lendableValue: marketValue * c.loanableRatio,
    };
  });

  const marketValue = items.reduce((s, i) => s + i.marketValue, 0);
  const lendableValue = items.reduce((s, i) => s + i.lendableValue, 0);
  const hasBalance = balance > EPS;
  const maintenanceRatio = hasBalance ? marketValue / balance : undefined;
  const callRatio = loan.callRatio;

  const out: CollateralStatus = {
    loanId: loan.id,
    currency: loan.currency,
    balance,
    items,
    marketValue,
    lendableValue,
    borrowingCapacity: lendableValue - balance,
    maintenanceRatio,
    callRatio,
    belowCall: false,
    warnings,
  };

  if (callRatio !== undefined && callRatio > 0) {
    const trigger = callRatio * Math.max(balance, 0);
    out.triggerValue = trigger;
    out.belowCall = hasBalance && marketValue < trigger - EPS;
    out.releasableValue = Math.max(0, marketValue - trigger);
    if (hasBalance && marketValue > EPS) {
      out.triggerDropPct = out.belowCall ? 0 : 1 - trigger / marketValue;
    }
    if (out.belowCall) {
      out.cureRepayment = balance - marketValue / callRatio;
      out.cureCollateral = trigger - marketValue;
      warnings.push('維持率低於追繳門檻');
    }
  }
  return out;
}

// ------------------------------------------------------------- forecast

/** Scheduled debt service of one loan in one month, in base currency. */
export interface DebtCashflowLoan {
  loanId: ID;
  principal: number;
  interest: number;
}

/**
 * One forecast month. Amounts are in the base currency; `total` is
 * principal + interest across all active loans. `byLoan` lists only loans
 * with a payment that month.
 */
export interface DebtCashflowRow {
  /** YYYY-MM */
  month: string;
  principal: number;
  interest: number;
  total: number;
  byLoan: DebtCashflowLoan[];
}

/**
 * Scheduled principal and interest per month for the `months` months starting
 * with the month of `today` (only payments due after today). Loans without a
 * fixed schedule (revolving, or no term) contribute their projected monthly
 * interest on the current balance on each payDay, with no principal.
 */
export function debtCashflowForecast(
  data: AppData,
  ledger: Ledger,
  months: number,
  today: ISODate,
): DebtCashflowRow[] {
  const base = getSettings(data).baseCurrency;
  const fx = new FxTable(data.fxRates);
  const monthKey = (d: ISODate) => d.slice(0, 7);
  const rows: DebtCashflowRow[] = [];
  for (let i = 0; i < months; i++) {
    rows.push({
      month: monthKey(addMonths(today, i, 1)),
      principal: 0,
      interest: 0,
      total: 0,
      byLoan: [],
    });
  }
  const byMonth = new Map(rows.map((r) => [r.month, r]));

  const add = (month: string, loan: Loan, principal: number, interest: number) => {
    const row = byMonth.get(month);
    const rate = fx.rate(loan.currency, base);
    if (!row || rate === undefined) return;
    const p = principal * rate;
    const it = interest * rate;
    let entry = row.byLoan.find((l) => l.loanId === loan.id);
    if (!entry) row.byLoan.push((entry = { loanId: loan.id, principal: 0, interest: 0 }));
    entry.principal += p;
    entry.interest += it;
    row.principal += p;
    row.interest += it;
    row.total += p + it;
  };

  for (const loan of data.loans) {
    if (!loan.active) continue;
    const st = loanStatus(data, ledger, loan, today);
    if (st.balance <= EPS) continue;
    if (st.remainingSchedule.length) {
      for (const r of st.remainingSchedule) add(monthKey(r.dueDate), loan, r.principal, r.interest);
    } else if (loan.method === 'revolving' || !(loan.termMonths && loan.termMonths > 0)) {
      const day = loan.payDay ?? parseDate(loan.startDate).d;
      for (let i = 0; i < months; i++) {
        const due = addMonths(today, i, day);
        if (due > today) add(monthKey(due), loan, 0, st.projectedMonthlyInterest);
      }
    }
  }
  return rows;
}
