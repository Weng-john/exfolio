import { useMemo, useState } from 'react';
import {
  collateralStatus,
  debtCashflowForecast,
  loanStatus,
  today,
  type CollateralStatus,
  type Loan,
  type LoanStatus,
} from '@core/index';
import { Badge, Card, Empty, PageHeader, Stat } from '../components/ui';
import { fmtMoney, fmtPct, fmtX } from '../format';
import { removeRow, upsertRow, useData } from '../store';
import { usePortfolio } from '../usePortfolio';
import LoanDetail from './loans/LoanDetail';
import LoanForm from './loans/LoanForm';
import { baseRate, hasTransactions, KIND_LABEL, METHOD_LABEL } from './loans/shared';
import './loans/loans.css';
import { confirmDialog } from '../dialog';

export default function LoansPage() {
  const data = useData();
  const { ledger, valuation } = usePortfolio();
  const base = valuation.baseCurrency;
  const [selectedId, setSelectedId] = useState<string>();
  const [form, setForm] = useState<{ loan?: Loan }>();

  const day = today();
  const rows = useMemo(
    () =>
      data.loans.map((loan) => {
        const status: LoanStatus = loanStatus(data, ledger, loan, day);
        const collateral: CollateralStatus | undefined = loan.collateral?.length
          ? collateralStatus(data, valuation, loan, status.balance)
          : undefined;
        return { loan, status, collateral, rate: baseRate(data, loan.currency) };
      }),
    [data, ledger, valuation, day],
  );
  const forecast = useMemo(() => debtCashflowForecast(data, ledger, 12, day), [data, ledger, day]);

  const active = rows.filter((r) => r.loan.active);
  const totalDebt = valuation.loans.reduce((s, l) => s + l.value, 0);
  const monthlyInterest = active.reduce(
    (s, r) => s + r.status.projectedMonthlyInterest * r.rate,
    0,
  );
  const nextDue = active
    .filter((r) => r.status.nextDueDate && r.status.nextPayment)
    .sort((a, b) => (a.status.nextDueDate! < b.status.nextDueDate! ? -1 : 1))[0];
  const ratios = active.filter((r) => r.collateral?.maintenanceRatio !== undefined);
  const lowest = ratios.sort(
    (a, b) => a.collateral!.maintenanceRatio! - b.collateral!.maintenanceRatio!,
  )[0];

  const selected = rows.find((r) => r.loan.id === selectedId) ?? rows[0];

  const remove = async (loan: Loan) => {
    if (hasTransactions(data, loan)) {
      if (
        await confirmDialog(`「${loan.name}」已有交易紀錄，無法刪除。要改為停用嗎？`, {
          title: '無法刪除',
          confirmText: '改為停用',
        })
      ) {
        upsertRow('loans', { ...loan, active: false });
      }
      return;
    }
    if (await confirmDialog(`確定刪除「${loan.name}」？`, { tone: 'danger', confirmText: '刪除' }))
      removeRow('loans', loan.id);
  };

  const forecastLoans = data.loans.filter((l) =>
    forecast.some((f) => f.byLoan.some((b) => b.loanId === l.id)),
  );
  const forecastTotal = forecast.reduce((s, f) => s + f.total, 0);

  return (
    <>
      <PageHeader
        title="Loans & Collateral"
        subtitle="信貸、質押、利息、還款與維持率"
        actions={
          <button className="primary" onClick={() => setForm({})}>
            新增借款
          </button>
        }
      />
      {form && (
        <LoanForm
          loan={form.loan}
          onClose={() => setForm(undefined)}
          onSaved={(id) => setSelectedId(id)}
        />
      )}

      <div className="stats">
        <Stat label={`總負債（${base}）`} value={fmtMoney(totalDebt, base)} hint="僅借款餘額" />
        <Stat
          label="負債 / NAV"
          value={fmtX(valuation.debtToNav)}
          hint={`${fmtPct(valuation.debtToNav, 1)} · 含透支現金`}
        />
        <Stat
          label={`預估月息（${base}）`}
          value={fmtMoney(monthlyInterest, base)}
          hint="使用中借款，以目前餘額計"
        />
        <Stat
          label="下一筆應繳"
          value={nextDue ? fmtMoney(nextDue.status.nextPayment!.total, nextDue.loan.currency) : '—'}
          hint={nextDue ? `${nextDue.status.nextDueDate} · ${nextDue.loan.name}` : undefined}
        />
        <Stat
          label="最低維持率"
          value={lowest ? fmtPct(lowest.collateral!.maintenanceRatio, 1) : '—'}
          tone={lowest?.collateral?.belowCall ? 'neg' : undefined}
          hint={lowest ? lowest.loan.name : '無質押借款'}
        />
      </div>

      <Card title="借款列表">
        {!rows.length ? (
          <Empty>尚未建立借款。按「新增借款」開始。</Empty>
        ) : (
          <div className="table-wrap">
            <table className="loans-list">
              <thead>
                <tr>
                  <th>名稱</th>
                  <th>類型</th>
                  <th>還款方式</th>
                  <th className="num">年利率</th>
                  <th className="num">目前餘額</th>
                  <th>下期到期</th>
                  <th className="num">維持率</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ loan, status, collateral }) => (
                  <tr
                    key={loan.id}
                    className={`clickable ${selected?.loan.id === loan.id ? 'selected' : ''}`}
                    onClick={() => setSelectedId(loan.id)}
                  >
                    <td>
                      {loan.name} {!loan.active && <Badge tone="warn">停用</Badge>}
                    </td>
                    <td>{KIND_LABEL[loan.kind]}</td>
                    <td>{METHOD_LABEL[loan.method]}</td>
                    <td className="num">{fmtPct(loan.annualRate, 2)}</td>
                    <td className="num">
                      {fmtMoney(status.balance, loan.currency)} {loan.currency}
                    </td>
                    <td>{status.nextDueDate ?? '—'}</td>
                    <td className="num">
                      {collateral ? (
                        <span className={collateral.belowCall ? 'neg' : ''}>
                          {fmtPct(collateral.maintenanceRatio, 1)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="num" onClick={(e) => e.stopPropagation()}>
                      <button className="ghost" onClick={() => setForm({ loan })}>
                        編輯
                      </button>
                      <button className="ghost danger" onClick={() => remove(loan)}>
                        刪除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selected && (
        <LoanDetail
          key={selected.loan.id}
          data={data}
          loan={selected.loan}
          status={selected.status}
          collateral={selected.collateral}
          onEdit={() => setForm({ loan: selected.loan })}
        />
      )}

      <Card title={`未來 12 個月債務現金流（${base}）`}>
        {!forecastLoans.length ? (
          <Empty>沒有待繳的借款。</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>月份</th>
                  {forecastLoans.map((l) => (
                    <th className="num" key={l.id}>
                      {l.name}
                    </th>
                  ))}
                  <th className="num">本金</th>
                  <th className="num">利息</th>
                  <th className="num">合計</th>
                </tr>
              </thead>
              <tbody>
                {forecast.map((f) => (
                  <tr key={f.month}>
                    <td>{f.month}</td>
                    {forecastLoans.map((l) => {
                      const b = f.byLoan.find((x) => x.loanId === l.id);
                      return (
                        <td className="num" key={l.id}>
                          {b ? fmtMoney(b.principal + b.interest, base) : '—'}
                        </td>
                      );
                    })}
                    <td className="num">{fmtMoney(f.principal, base)}</td>
                    <td className="num">{fmtMoney(f.interest, base)}</td>
                    <td className="num">{fmtMoney(f.total, base)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={forecastLoans.length + 1}>12 個月合計</td>
                  <td className="num">
                    {fmtMoney(
                      forecast.reduce((s, f) => s + f.principal, 0),
                      base,
                    )}
                  </td>
                  <td className="num">
                    {fmtMoney(
                      forecast.reduce((s, f) => s + f.interest, 0),
                      base,
                    )}
                  </td>
                  <td className="num">{fmtMoney(forecastTotal, base)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
