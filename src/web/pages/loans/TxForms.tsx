import { useState } from 'react';
import {
  CORE_BUCKET,
  FxTable,
  getSettings,
  newId,
  today,
  type AppData,
  type FundingSource,
  type Loan,
  type LoanStatus,
  type Transaction,
} from '@core/index';
import { Field, Modal } from '../../components/ui';
import { fmtMoney } from '../../format';
import { upsertRow } from '../../store';
import { num } from './shared';

function accountOptions(data: AppData) {
  return data.accounts.filter((a) => a.active);
}

function fxRateFor(data: AppData, currency: string): number | undefined {
  const base = getSettings(data).baseCurrency;
  return new FxTable(data.fxRates).rate(currency, base);
}

/** 動用借款: money arrives in an account as cash and the loan balance rises. */
export function DrawForm(props: { data: AppData; loan: Loan; onClose: () => void }) {
  const { data, loan } = props;
  const accounts = accountOptions(data);
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState('');
  const [fee, setFee] = useState('');
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [note, setNote] = useState('');
  const ok = num(amount) > 0 && !!accountId && !!date;

  const save = () => {
    if (!ok) return;
    const tx: Transaction = {
      id: newId('tx'),
      date,
      type: 'loan_draw',
      accountId,
      bucket: CORE_BUCKET,
      currency: loan.currency,
      amount: num(amount),
      fee: fee.trim() && num(fee) > 0 ? num(fee) : undefined,
      fxRate: fxRateFor(data, loan.currency),
      loanId: loan.id,
      note: note.trim() || undefined,
    };
    upsertRow('transactions', tx);
    props.onClose();
  };

  return (
    <Modal
      title={`動用借款 · ${loan.name}`}
      onClose={props.onClose}
      footer={
        <>
          <button onClick={props.onClose}>取消</button>
          <button className="primary" disabled={!ok} onClick={save}>
            建立交易
          </button>
        </>
      }
    >
      <div className="loans-stack">
        <p className="loans-explain">
          借入的款項進入所選帳戶成為現金，借款餘額與負債同額增加，NAV 不變。
        </p>
        <div className="form-grid">
          <Field label="日期">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={`金額（${loan.currency}）`}>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="撥款帳戶">
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="手續費（選填）">
            <input type="number" value={fee} onChange={(e) => setFee(e.target.value)} />
          </Field>
        </div>
        <Field label="備註">
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

/** 還款: principal / interest split plus where the money came from. */
export function RepayForm(props: {
  data: AppData;
  loan: Loan;
  status: LoanStatus;
  onClose: () => void;
}) {
  const { data, loan, status } = props;
  const accounts = accountOptions(data);
  const next = status.nextPayment;
  const [date, setDate] = useState(today());
  const [principal, setPrincipal] = useState(next ? String(next.principal) : '');
  const [interest, setInterest] = useState(next ? String(next.interest) : '');
  const [source, setSource] = useState<FundingSource>('portfolio');
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [note, setNote] = useState('');
  const p = num(principal) || 0;
  const i = num(interest) || 0;
  const ok = p + i > 0 && p >= 0 && i >= 0 && !!accountId && !!date;

  const save = () => {
    if (!ok) return;
    const tx: Transaction = {
      id: newId('tx'),
      date,
      type: 'loan_repay',
      accountId,
      bucket: CORE_BUCKET,
      currency: loan.currency,
      amount: p + i,
      principal: p,
      interest: i,
      source,
      fxRate: fxRateFor(data, loan.currency),
      loanId: loan.id,
      note: note.trim() || undefined,
    };
    upsertRow('transactions', tx);
    props.onClose();
  };

  return (
    <Modal
      title={`還款 · ${loan.name}`}
      onClose={props.onClose}
      footer={
        <>
          <button onClick={props.onClose}>取消</button>
          <button className="primary" disabled={!ok} onClick={save}>
            建立交易
          </button>
        </>
      }
    >
      <div className="loans-stack">
        {next && (
          <p className="loans-explain">
            已依下一期（{status.nextDueDate}）預填：本金 {fmtMoney(next.principal, loan.currency)} +
            利息 {fmtMoney(next.interest, loan.currency)}。可自行修改（例如提前還款）。
          </p>
        )}
        <div className="form-grid">
          <Field label="日期">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={`本金（${loan.currency}）`}>
            <input type="number" value={principal} onChange={(e) => setPrincipal(e.target.value)} />
          </Field>
          <Field label={`利息（${loan.currency}）`}>
            <input type="number" value={interest} onChange={(e) => setInterest(e.target.value)} />
          </Field>
          <Field label="資金來源">
            <select value={source} onChange={(e) => setSource(e.target.value as FundingSource)}>
              <option value="portfolio">投資組合內部資金</option>
              <option value="external">外部資金</option>
            </select>
          </Field>
          <Field label={source === 'portfolio' ? '扣款帳戶' : '記錄帳戶'}>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="notice">
          {source === 'external' ? (
            <>
              <b>外部資金：</b>由投資組合以外的錢直接付給貸款機構。不動用帳戶現金，債務減少、
              <b>累計投入本金與 NAV 同額上升</b>。
            </>
          ) : (
            <>
              <b>投資組合內部資金：</b>從帳戶現金扣款還款，現金與負債同額減少，<b>NAV 不變</b>
              （槓桿下降但不是獲利）。
            </>
          )}
        </div>
        <Field label="備註">
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <p className="loans-explain">
          合計支付 {fmtMoney(p + i, loan.currency)} {loan.currency}
        </p>
      </div>
    </Modal>
  );
}
