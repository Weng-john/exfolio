import { compareAllocation } from './allocation';
import { portfolioAlerts, type AlertLevel } from './alerts';
import { collateralStatus, dueDateOf, loanStatus, addMonths } from './loans';
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

function parse(date: ISODate): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  return [y, m, d];
}

function daysBetween(from: ISODate, to: ISODate): number {
  const [fy, fm, fd] = parse(from);
  const [ty, tm, td] = parse(to);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

function add(out: Map<string, Notification>, notification: Notification) {
  if (!out.has(notification.id)) out.set(notification.id, notification);
}

function overdueLoanPayment(data: AppData, loanId: string, today: ISODate): ISODate | undefined {
  const loan = data.loans.find((l) => l.id === loanId);
  if (!loan) return undefined;
  const repayments = data.transactions.filter((t) => t.loanId === loanId && t.type === 'loan_repay' && t.date <= today).length;
  const term = loan.termMonths ?? 0;
  const scheduled = loan.method !== 'revolving' && term > 0;
  const due: ISODate[] = [];
  if (scheduled) {
    for (let n = 1; n <= term; n++) {
      const date = dueDateOf(loan, n);
      if (date >= today) break;
      due.push(date);
    }
  } else {
    const payDay = loan.payDay ?? Number(loan.startDate.slice(-2));
    for (let n = 1; n <= 1200; n++) {
      const date = addMonths(loan.startDate, n, payDay);
      if (date >= today) break;
      due.push(date);
    }
  }
  return due[repayments];
}

/** Build informational reminders from derivatives, loans, allocation and legacy alerts. */
export function buildNotifications(data: AppData, portfolio: Portfolio, today: ISODate): Notification[] {
  const settings = getSettings(data);
  const alerts = settings.alerts;
  const out = new Map<string, Notification>();
  const futures = futuresPositions(data, portfolio, today);
  const rollDays = alerts.rollNoticeDays ?? DEFAULT_ROLL_NOTICE_DAYS;
  for (const p of futures) {
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
    } else if (p.daysToExpiry <= rollDays) {
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

  for (const row of marginByAccount(data, portfolio)) {
    if (row.shortfall !== undefined && row.shortfall > 0) {
      add(out, {
        id: `futures-margin-shortfall-${row.accountId}`,
        level: 'bad',
        category: 'futures-margin',
        title: `${row.accountName} 保證金權益不足`,
        detail: `權益 ${row.equity.toLocaleString()} ${row.baseCurrency}，低於維持保證金 ${row.maintenanceMarginRequired!.toLocaleString()}，短缺 ${row.shortfall.toLocaleString()}。`,
      });
    } else if (
      row.maintenanceMarginRequired !== undefined &&
      row.equity > 0 &&
      row.equity <= row.maintenanceMarginRequired * (1 + MARGIN_BUFFER)
    ) {
      add(out, {
        id: `futures-margin-buffer-${row.accountId}`,
        level: 'warn',
        category: 'futures-margin',
        title: `${row.accountName} 接近維持保證金`,
        detail: `權益 ${row.equity.toLocaleString()} ${row.baseCurrency}，維持保證金 ${row.maintenanceMarginRequired.toLocaleString()}。`,
      });
    }
  }

  const ledger = portfolio.ledger;
  const loanNoticeDays = alerts.loanDueNoticeDays ?? DEFAULT_LOAN_NOTICE_DAYS;
  for (const loan of data.loans.filter((l) => l.active)) {
    const status = loanStatus(data, ledger, loan, today);
    if (status.balance <= 0) continue;
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

    if (loan.kind === 'pledge' && status.balance > 0) {
      const collateral = collateralStatus(data, portfolio.valuation, loan, status.balance);
      const belowUserThreshold =
        alerts.maintenanceRatio !== undefined &&
        collateral.maintenanceRatio !== undefined &&
        collateral.maintenanceRatio < alerts.maintenanceRatio;
      if (collateral.belowCall || belowUserThreshold) {
        add(out, {
          id: `collateral-maintenance-${loan.id}`,
          level: collateral.belowCall ? 'bad' : 'warn',
          category: 'collateral',
          title: `${loan.name} 質押維持率偏低`,
          detail: `目前 ${collateral.maintenanceRatio?.toFixed(3) ?? '—'}，${collateral.belowCall ? `低於追繳門檻 ${loan.callRatio}` : `低於提醒門檻 ${alerts.maintenanceRatio}`}。`,
        });
      }
    }
  }

  const allocation = compareAllocation(data, portfolio.valuation);
  for (const row of allocation.rows) {
    const drift = Math.abs(row.gapWeight);
    const globalDrift = alerts.allocationDrift;
    if (!row.hasTarget || (!row.outOfBand && (globalDrift === undefined || drift <= globalDrift))) continue;
    add(out, {
      id: `allocation-drift-${row.indexId}`,
      level: 'warn',
      category: 'allocation',
      title: `${row.name} 曝險偏離目標`,
      detail: `Core 實際 ${((row.coreWeight ?? 0) * 100).toFixed(1)}%，目標 ${(row.targetWeight * 100).toFixed(1)}%，偏離 ${(row.gapWeight * 100).toFixed(1)}%。`,
    });
  }

  for (const alert of portfolioAlerts(data, portfolio.valuation)) {
    add(out, { ...alert, category: 'portfolio' });
  }

  const priority: Record<AlertLevel, number> = { bad: 0, warn: 1, info: 2 };
  return [...out.values()].sort(
    (a, b) =>
      (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31') ||
      priority[a.level] - priority[b.level] ||
      a.category.localeCompare(b.category) ||
      a.id.localeCompare(b.id),
  );
}

export { DEFAULT_LOAN_NOTICE_DAYS, DEFAULT_ROLL_NOTICE_DAYS };
