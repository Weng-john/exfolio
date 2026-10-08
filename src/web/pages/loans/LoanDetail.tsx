import { useState } from 'react';
import {
  prepaymentEffect,
  type AppData,
  type CollateralStatus,
  type Loan,
  type LoanStatus,
  type ScheduleRow,
} from '@core/index';
import { Badge, Card, Empty, Field, Stat } from '../../components/ui';
import { fmtMoney, fmtPct } from '../../format';
import CollateralPanel from './CollateralPanel';
import { DrawForm, RepayForm } from './TxForms';
import { KIND_LABEL, METHOD_LABEL, num } from './shared';

function ScheduleTable(props: { rows: ScheduleRow[]; currency: string; highlight?: string }) {
  const { rows, currency } = props;
  const sum = (f: (r: ScheduleRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th className="num">期</th>
            <th>到期日</th>
            <th className="num">應繳</th>
            <th className="num">本金</th>
            <th className="num">利息</th>
            <th className="num">剩餘本金</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.period}>
              <td className="num">{r.period}</td>
              <td>{r.dueDate}</td>
              <td className="num">{fmtMoney(r.payment, currency)}</td>
              <td className="num">{fmtMoney(r.principal, currency)}</td>
              <td className="num">{fmtMoney(r.interest, currency)}</td>
              <td className="num">{fmtMoney(r.balance, currency)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}>合計</td>
            <td className="num">{fmtMoney(sum((r) => r.payment), currency)}</td>
            <td className="num">{fmtMoney(sum((r) => r.principal), currency)}</td>
            <td className="num">{fmtMoney(sum((r) => r.interest), currency)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function PrepaymentCalc(props: { loan: Loan; status: LoanStatus }) {
  const { loan, status } = props;
  const [extra, setExtra] = useState('');
  const e = num(extra);
  if (!status.remainingPeriods || status.balance <= 0) return null;
  const effect =
    e > 0
      ? prepaymentEffect(loan, status.balance, e, status.remainingPeriods, { firstDueDate: status.nextDueDate })
      : undefined;
  const cur = loan.currency;
  const row = (label: string, o: NonNullable<typeof effect>['baseline']) => (
    <tr>
      <td>{label}</td>
      <td className="num">{o.periods}</td>
      <td className="num">{fmtMoney(o.firstPayment, cur)}</td>
      <td className="num">{fmtMoney(o.totalInterest, cur)}</td>
      <td className="num pos">{o.interestSaved > 0 ? fmtMoney(o.interestSaved, cur) : '—'}</td>
    </tr>
  );
  return (
    <Card title="提前還款試算">
      <div className="loans-stack">
        <div className="loans-inline">
          <Field label={`提前償還本金（${cur}）`}>
            <input type="number" value={extra} onChange={(e2) => setExtra(e2.target.value)} />
          </Field>
          <span className="muted">
            目前餘額 {fmtMoney(status.balance, cur)}，剩餘 {status.remainingPeriods} 期
          </span>
        </div>
        {effect ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>方案</th>
                  <th className="num">剩餘期數</th>
                  <th className="num">每期首期應繳</th>
                  <th className="num">剩餘總利息</th>
                  <th className="num">節省利息</th>
                </tr>
              </thead>
              <tbody>
                {row('不提前還款', effect.baseline)}
                {row('縮短期數（維持月付）', effect.keepPayment)}
                {row('降低月付（維持期數）', effect.keepTerm)}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="loans-explain">輸入金額後比較兩種提前還款方式。試算不會建立交易。</p>
        )}
      </div>
    </Card>
  );
}

function History(props: { data: AppData; loan: Loan }) {
  const { data, loan } = props;
  const cur = loan.currency;
  const txs = data.transactions
    .filter((t) => t.loanId === loan.id && (t.type === 'loan_repay' || t.type === 'loan_draw'))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return (
    <Card title="動用與還款紀錄">
      {!txs.length ? (
        <Empty>尚無紀錄。</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>日期</th>
                <th>類型</th>
                <th className="num">本金</th>
                <th className="num">利息</th>
                <th className="num">合計</th>
                <th>資金來源</th>
                <th>對 NAV 的影響</th>
              </tr>
            </thead>
            <tbody>
              {txs.map((t) => {
                if (t.type === 'loan_draw') {
                  return (
                    <tr key={t.id}>
                      <td>{t.date}</td>
                      <td>動用</td>
                      <td className="num">{fmtMoney(t.amount, cur)}</td>
                      <td className="num">—</td>
                      <td className="num">{fmtMoney(t.amount, cur)}</td>
                      <td>—</td>
                      <td className="muted">現金與負債同增，NAV 不變</td>
                    </tr>
                  );
                }
                const interest = t.interest ?? 0;
                const principal = t.principal ?? t.amount - interest;
                const external = t.source === 'external';
                return (
                  <tr key={t.id}>
                    <td>{t.date}</td>
                    <td>還款</td>
                    <td className="num">{fmtMoney(principal, cur)}</td>
                    <td className="num">{fmtMoney(interest, cur)}</td>
                    <td className="num">{fmtMoney(principal + interest, cur)}</td>
                    <td>{external ? <Badge tone="ok">外部資金</Badge> : <Badge tone="info">投資組合</Badge>}</td>
                    <td className="muted">
                      {external ? '債務減少，NAV 與投入本金上升' : '現金與負債同減，NAV 不變（利息為成本）'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default function LoanDetail(props: {
  data: AppData;
  loan: Loan;
  status: LoanStatus;
  collateral?: CollateralStatus;
  onEdit: () => void;
}) {
  const { data, loan, status, collateral } = props;
  const [modal, setModal] = useState<'draw' | 'repay'>();
  const cur = loan.currency;
  const scheduled = loan.method !== 'revolving' && !!loan.termMonths;

  return (
    <>
      {modal === 'draw' && <DrawForm data={data} loan={loan} onClose={() => setModal(undefined)} />}
      {modal === 'repay' && <RepayForm data={data} loan={loan} status={status} onClose={() => setModal(undefined)} />}
      <Card
        title={loan.name}
        actions={
          <>
            <button onClick={() => setModal('draw')}>動用借款</button>
            <button className="primary" onClick={() => setModal('repay')}>
              還款
            </button>
            <button onClick={props.onEdit}>編輯</button>
          </>
        }
      >
        <p className="muted">
          {KIND_LABEL[loan.kind]} · {loan.lender || '—'} · {METHOD_LABEL[loan.method]} · 年利率 {fmtPct(loan.annualRate, 2)} ·
          起貸 {loan.startDate}
          {loan.payDay ? ` · 每月 ${loan.payDay} 日` : ''}
          {!loan.active && ' · 已停用'}
        </p>
        <div className="stats">
          <Stat label="目前餘額" value={fmtMoney(status.balance, cur)} hint={`${cur} · 原始本金 ${fmtMoney(loan.principal, cur)}`} />
          <Stat label="累計動用" value={fmtMoney(status.drawn, cur)} />
          <Stat label="已還本金" value={fmtMoney(status.principalRepaid, cur)} />
          <Stat label="已付利息" value={fmtMoney(status.interestPaid, cur)} />
          <Stat
            label="外部資金還款"
            value={fmtMoney(status.repaidExternally, cur)}
            hint={`投資組合資金 ${fmtMoney(status.repaidFromPortfolio, cur)}`}
          />
          <Stat
            label="剩餘期數"
            value={status.remainingPeriods === undefined ? '—' : String(status.remainingPeriods)}
            hint={status.elapsedPeriods !== undefined ? `已過 ${status.elapsedPeriods} 期` : '無固定期限'}
          />
          <Stat
            label="下期應繳"
            value={status.nextPayment ? fmtMoney(status.nextPayment.total, cur) : '—'}
            hint={
              status.nextPayment
                ? `${status.nextDueDate} · 本金 ${fmtMoney(status.nextPayment.principal, cur)} / 利息 ${fmtMoney(status.nextPayment.interest, cur)}`
                : undefined
            }
          />
          <Stat label="預估月息" value={fmtMoney(status.projectedMonthlyInterest, cur)} hint="以目前餘額計" />
        </div>
      </Card>

      {(loan.kind === 'pledge' || loan.kind === 'margin' || loan.collateral?.length) && (
        <CollateralPanel data={data} loan={loan} status={collateral} />
      )}

      <Card title="剩餘攤還表">
        {scheduled && status.remainingSchedule.length ? (
          <ScheduleTable rows={status.remainingSchedule} currency={cur} />
        ) : (
          <Empty>
            {scheduled ? '已無待繳期數或餘額為 0。' : '循環額度沒有固定攤還表，只預估每月利息 ' + fmtMoney(status.projectedMonthlyInterest, cur) + ' ' + cur + '。'}
          </Empty>
        )}
      </Card>

      <PrepaymentCalc loan={loan} status={status} />
      <History data={data} loan={loan} />
    </>
  );
}
