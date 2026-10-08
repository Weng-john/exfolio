import { compareAllocation } from './allocation';
import { portfolioAlerts, type AlertLevel } from './alerts';
import { daysBetween } from './dates';
import { collateralStatus, dueDateOf, loanStatus } from './loans';
import { futuresPositions, marginByAccount } from './futures';
import { getSettings, type AppData, type ISODate } from './types';
import { type Portfolio } from './valuation';

const DEFAULT_ROLL_NOTICE_DAYS = 7;
const DEFAULT_LOAN_NOTICE_DAYS = 7;
const MARGIN_BUFFER = 0.1;

export interface Notification {
  id: string;
  level: AlertLevel;
  category: string;
  title: string;
  detail: string;
  dueDate?: ISODate;
}

type Sink = Map<string, Notification>;

/** First notification with a given id wins, so one condition never repeats. */
function add(out: Sink, notification: Notification) {
  if (!out.has(notification.id)) out.set(notification.id, notification);
}

/**
 * Due date of the oldest scheduled payment that has no repayment recorded
 * against it, if any is already past. Repayments are matched to the schedule
 * by count, not by date, so an early payment covers the next instalment.
 */
function overdueLoanPayment(data: AppData, loanId: string, today: ISODate): ISODate | undefined {
  const loan = data.loans.find((l) => l.id === loanId);
  if (!loan) return undefined;
  const repayments = data.transactions.filter(
    (t) => t.loanId === loanId && t.type === 'loan_repay' && t.date <= today,
  ).length;
  const term = loan.termMonths ?? 0;
  // A revolving line has no payment schedule to fall behind on.
  if (loan.method === 'revolving' || term <= 0) return undefined;
  const pastDue: ISODate[] = [];
  for (let n = 1; n <= term; n++) {
    const date = dueDateOf(loan, n);
    // A payment due today is not overdue yet.
    if (date >= today) break;
    pastDue.push(date);
  }
  return pastDue[repayments];
}

function addFuturesExpiry(out: Sink, data: AppData, portfolio: Portfolio, today: ISODate) {
  const rollNoticeDays = getSettings(data).alerts.rollNoticeDays ?? DEFAULT_ROLL_NOTICE_DAYS;
  for (const p of futuresPositions(data, portfolio, today)) {
    if (p.expiry === undefined || p.daysToExpiry === undefined) continue;
    if (p.daysToExpiry < 0) {
      add(out, {
        id: `futures-expired-${p.key}`,
        level: 'bad',
        category: 'futures-expiry',
        title: `${p.symbol} 已經到期仍有未平倉部位`,
        detail: `部位 ${p.contracts} 口，請確認結算或補記轉倉。`,
        dueDate: p.expiry,
      });
    } else if (p.daysToExpiry <= rollNoticeDays) {
      add(out, {
        id: `futures-roll-${p.key}`,
        level: 'warn',
        category: 'futures-expiry',
        title: `${p.symbol} 接近到期，請評估轉倉`,
        detail: `距離到期 ${p.daysToExpiry} 天；提醒只供決策，不會送出訂單。`,
        dueDate: p.expiry,
      });
    }
  }
}

function addFuturesMargin(out: Sink, data: AppData, portfolio: Portfolio) {
  for (const row of marginByAccount(data, portfolio)) {
    const maintenance = row.maintenanceMarginRequired;
    if (row.shortfall !== undefined && row.shortfall > 0) {
      add(out, {
        id: `futures-margin-shortfall-${row.accountId}`,
        level: 'bad',
        category: 'futures-margin',
        title: `${row.accountName} 保證金權益不足`,
        detail: `權益 ${row.equity.toLocaleString()} ${row.baseCurrency}，低於維持保證金 ${maintenance!.toLocaleString()}，短缺 ${row.shortfall.toLocaleString()}。`,
      });
    } else if (
      maintenance !== undefined &&
      row.equity > 0 &&
      row.equity <= maintenance * (1 + MARGIN_BUFFER)
    ) {
      // Still above maintenance, but within the buffer of being called.
      add(out, {
        id: `futures-margin-buffer-${row.accountId}`,
        level: 'warn',
        category: 'futures-margin',
        title: `${row.accountName} 接近維持保證金`,
        detail: `權益 ${row.equity.toLocaleString()} ${row.baseCurrency}，維持保證金 ${maintenance.toLocaleString()}。`,
      });
    }
  }
}

function addLoanNotices(out: Sink, data: AppData, portfolio: Portfolio, today: ISODate) {
  const alerts = getSettings(data).alerts;
  const loanNoticeDays = alerts.loanDueNoticeDays ?? DEFAULT_LOAN_NOTICE_DAYS;
  for (const loan of data.loans.filter((l) => l.active)) {
    const status = loanStatus(data, portfolio.ledger, loan, today);
    if (status.balance <= 0) continue;

    // An overdue payment takes the place of the "due soon" reminder.
    const overdue = overdueLoanPayment(data, loan.id, today);
    if (overdue) {
      add(out, {
        id: `loan-overdue-${loan.id}`,
        level: 'bad',
        category: 'loan',
        title: `${loan.name} 貸款已逾期`,
        detail: `原應繳日期 ${overdue}，請確認本金與利息是否已記錄。`,
        dueDate: overdue,
      });
    } else if (status.nextDueDate && status.nextPayment) {
      const days = daysBetween(today, status.nextDueDate);
      if (days >= 0 && days <= loanNoticeDays) {
        add(out, {
          id: `loan-due-${loan.id}`,
          level: 'warn',
          category: 'loan',
          title: `${loan.name} 接近繳款日`,
          detail: `${status.nextDueDate} 應繳 ${status.nextPayment.total.toLocaleString()} ${loan.currency}。`,
          dueDate: status.nextDueDate,
        });
      }
    }

    if (loan.kind === 'pledge') {
      const collateral = collateralStatus(data, portfolio.valuation, loan, status.balance);
      const belowUserThreshold =
        alerts.maintenanceRatio !== undefined &&
        collateral.maintenanceRatio !== undefined &&
        collateral.maintenanceRatio < alerts.maintenanceRatio;
      if (collateral.belowCall || belowUserThreshold) {
        const threshold = collateral.belowCall
          ? `低於追繳門檻 ${loan.callRatio}`
          : `低於提醒門檻 ${alerts.maintenanceRatio}`;
        add(out, {
          id: `collateral-maintenance-${loan.id}`,
          level: collateral.belowCall ? 'bad' : 'warn',
          category: 'collateral',
          title: `${loan.name} 質押維持率偏低`,
          detail: `目前 ${collateral.maintenanceRatio?.toFixed(3) ?? '—'}，${threshold}。`,
        });
      }
    }
  }
}

function addAllocationDrift(out: Sink, data: AppData, portfolio: Portfolio) {
  const globalDrift = getSettings(data).alerts.allocationDrift;
  for (const row of compareAllocation(data, portfolio.valuation).rows) {
    const drift = Math.abs(row.gapWeight);
    // Notify when the target's own band is breached, or the global drift limit is.
    const withinGlobal = globalDrift === undefined || drift <= globalDrift;
    if (!row.hasTarget || (!row.outOfBand && withinGlobal)) continue;
    add(out, {
      id: `allocation-drift-${row.indexId}`,
      level: 'warn',
      category: 'allocation',
      title: `${row.name} 曝險偏離目標`,
      detail: `Core 實際 ${((row.coreWeight ?? 0) * 100).toFixed(1)}%，目標 ${(row.targetWeight * 100).toFixed(1)}%，偏離 ${(row.gapWeight * 100).toFixed(1)}%。`,
    });
  }
}

const LEVEL_PRIORITY: Record<AlertLevel, number> = { bad: 0, warn: 1, info: 2 };

/** Build informational reminders from derivatives, loans, allocation and legacy alerts. */
export function buildNotifications(
  data: AppData,
  portfolio: Portfolio,
  today: ISODate,
): Notification[] {
  const out: Sink = new Map();
  addFuturesExpiry(out, data, portfolio, today);
  addFuturesMargin(out, data, portfolio);
  addLoanNotices(out, data, portfolio, today);
  addAllocationDrift(out, data, portfolio);
  for (const alert of portfolioAlerts(data, portfolio.valuation)) {
    add(out, { ...alert, category: 'portfolio' });
  }

  // Soonest due date first (undated last), then most severe.
  return [...out.values()].sort(
    (a, b) =>
      (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31') ||
      LEVEL_PRIORITY[a.level] - LEVEL_PRIORITY[b.level] ||
      a.category.localeCompare(b.category) ||
      a.id.localeCompare(b.id),
  );
}

export { DEFAULT_LOAN_NOTICE_DAYS, DEFAULT_ROLL_NOTICE_DAYS };
