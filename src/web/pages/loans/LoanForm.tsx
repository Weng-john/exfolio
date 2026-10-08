import { useState } from 'react';
import {
  INSTITUTION_CATALOG,
  newId,
  type Loan,
  type LoanKind,
  type RepaymentMethod,
} from '@core/index';
import { Field, Modal } from '../../components/ui';
import { upsertRow, useData } from '../../store';
import { KIND_LABEL, METHOD_LABEL, num } from './shared';

const pct = (x: number | undefined) =>
  x === undefined ? '' : String(Number((x * 100).toFixed(6)));
const frac = (s: string) => Number((num(s) / 100).toFixed(8));

/** Add / edit a loan. Fields adapt to the loan kind and repayment method. */
export default function LoanForm(props: {
  loan?: Loan;
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const { loan } = props;
  const data = useData();
  // The user's own institutions first, then the catalog's banks and brokers.
  const lenderOptions = [
    ...new Set(
      [...data.brokers, ...INSTITUTION_CATALOG.filter((b) => b.kind !== 'exchange')].map(
        (b) => b.name,
      ),
    ),
  ];
  const [name, setName] = useState(loan?.name ?? '');
  const [kind, setKind] = useState<LoanKind>(loan?.kind ?? 'credit');
  const [lender, setLender] = useState(loan?.lender ?? '');
  const [currency, setCurrency] = useState(loan?.currency ?? 'TWD');
  const [principal, setPrincipal] = useState(String(loan?.principal ?? ''));
  const [rate, setRate] = useState(pct(loan?.annualRate));
  const [method, setMethod] = useState<RepaymentMethod>(loan?.method ?? 'annuity');
  const [startDate, setStartDate] = useState(
    loan?.startDate ?? new Date().toISOString().slice(0, 10),
  );
  const [term, setTerm] = useState(String(loan?.termMonths ?? ''));
  const [payDay, setPayDay] = useState(String(loan?.payDay ?? ''));
  const [callRatio, setCallRatio] = useState(pct(loan?.callRatio));
  const [active, setActive] = useState(loan?.active ?? true);
  const [note, setNote] = useState(loan?.note ?? '');

  const revolving = method === 'revolving';
  const secured = kind === 'pledge' || kind === 'margin';

  const changeKind = (k: LoanKind) => {
    setKind(k);
    if ((k === 'pledge' || k === 'margin') && method !== 'revolving') setMethod('revolving');
  };

  const errors: string[] = [];
  if (!name.trim()) errors.push('請輸入名稱');
  if (!currency.trim()) errors.push('請輸入幣別');
  if (!(num(principal) >= 0)) errors.push('原始本金需為數字');
  if (!(num(rate) >= 0)) errors.push('年利率需為數字');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) errors.push('請輸入起貸日');
  if (!revolving && !(num(term) >= 1)) errors.push('非循環貸款需填寫期數（月）');
  if (payDay.trim() && !(num(payDay) >= 1 && num(payDay) <= 31)) errors.push('繳款日需為 1–31');
  if (callRatio.trim() && !(num(callRatio) > 0)) errors.push('追繳門檻需大於 0');

  const save = () => {
    if (errors.length) return;
    const row: Loan = {
      id: loan?.id ?? newId('loan'),
      name: name.trim(),
      kind,
      lender: lender.trim(),
      currency: currency.trim().toUpperCase(),
      principal: num(principal),
      annualRate: frac(rate),
      method,
      startDate,
      termMonths: revolving || !term.trim() ? undefined : Math.floor(num(term)),
      payDay: payDay.trim() ? Math.floor(num(payDay)) : undefined,
      collateral: loan?.collateral,
      callRatio: secured && callRatio.trim() ? frac(callRatio) : undefined,
      active,
      note: note.trim() || undefined,
    };
    upsertRow('loans', row);
    props.onSaved?.(row.id);
    props.onClose();
  };

  return (
    <Modal
      title={loan ? '編輯借款' : '新增借款'}
      onClose={props.onClose}
      wide
      footer={
        <>
          <button onClick={props.onClose}>取消</button>
          <button className="primary" disabled={errors.length > 0} onClick={save}>
            儲存
          </button>
        </>
      }
    >
      <div className="loans-stack">
        <div className="form-grid">
          <Field label="名稱">
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="類型">
            <select value={kind} onChange={(e) => changeKind(e.target.value as LoanKind)}>
              {Object.entries(KIND_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="貸款機構">
            <input
              list="lender-options"
              value={lender}
              onChange={(e) => setLender(e.target.value)}
            />
            <datalist id="lender-options">
              {lenderOptions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </Field>
          <Field label="幣別">
            <input value={currency} onChange={(e) => setCurrency(e.target.value)} />
          </Field>
          <Field label="原始本金" hint="目前餘額由交易紀錄推算，不取此欄">
            <input type="number" value={principal} onChange={(e) => setPrincipal(e.target.value)} />
          </Field>
          <Field label="年利率（%）">
            <input
              type="number"
              step="any"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
          </Field>
          <Field label="還款方式">
            <select value={method} onChange={(e) => setMethod(e.target.value as RepaymentMethod)}>
              {Object.entries(METHOD_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="起貸日">
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          {!revolving && (
            <Field label="期數（月）">
              <input type="number" value={term} onChange={(e) => setTerm(e.target.value)} />
            </Field>
          )}
          <Field label="繳款日（每月幾號）" hint="超過當月天數時以月底計">
            <input
              type="number"
              min={1}
              max={31}
              value={payDay}
              onChange={(e) => setPayDay(e.target.value)}
            />
          </Field>
          {secured && (
            <Field label="追繳維持率門檻（%）" hint="僅提示，不會限制任何操作">
              <input
                type="number"
                step="any"
                value={callRatio}
                onChange={(e) => setCallRatio(e.target.value)}
              />
            </Field>
          )}
        </div>
        <Field label="備註">
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <label>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />{' '}
          使用中
        </label>
        {secured && <p className="loans-explain">擔保品請於借款明細的「擔保品」區塊設定。</p>}
        {errors.length > 0 && <div className="notice warn">{errors.join('；')}</div>}
      </div>
    </Modal>
  );
}
