import { useState } from 'react';
import { CORE_BUCKET, newId, type Strategy, type Transaction } from '@core/index';
import { Field, Modal } from '../../components/ui';
import { upsertRow, useData } from '../../store';
import { bucketName, toNumber, today } from './shared';

/**
 * Move capital between a strategy and core (or another strategy). A transfer
 * transaction with a destination bucket: internal, never P&L, NAV unchanged.
 */
export default function TransferModal(props: {
  strategy: Strategy;
  direction: 'in' | 'out';
  onClose: () => void;
}) {
  const { strategy, direction } = props;
  const data = useData();
  const incoming = direction === 'in';
  const accounts = data.accounts.filter((a) => a.active);
  const others = [
    CORE_BUCKET,
    ...data.strategies.filter((s) => s.id !== strategy.id).map((s) => s.id),
  ];

  const [other, setOther] = useState(CORE_BUCKET);
  const [fromAccount, setFromAccount] = useState(accounts[0]?.id ?? '');
  const [toAccount, setToAccount] = useState(accounts[0]?.id ?? '');
  const [date, setDate] = useState(today());
  const [currency, setCurrency] = useState(accounts[0]?.baseCurrency ?? 'TWD');
  const [amount, setAmount] = useState('');
  const [toCurrency, setToCurrency] = useState('');
  const [toAmount, setToAmount] = useState('');
  const [fxRate, setFxRate] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const sourceBucket = incoming ? other : strategy.id;
  const destBucket = incoming ? strategy.id : other;
  const cross =
    toCurrency.trim() !== '' && toCurrency.trim().toUpperCase() !== currency.trim().toUpperCase();
  const base = data.settings[0]?.baseCurrency ?? 'TWD';

  const save = () => {
    const amt = toNumber(amount);
    if (!amt || amt <= 0) return setError('金額須大於 0');
    if (!fromAccount || !toAccount) return setError('請選擇轉出與轉入帳戶');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError('請填寫日期');
    const cur = currency.trim().toUpperCase();
    const tx: Transaction = {
      id: newId('tx'),
      date,
      type: 'transfer',
      accountId: fromAccount,
      bucket: sourceBucket,
      currency: cur,
      amount: amt,
      toAccountId: toAccount,
      toBucket: destBucket,
    };
    if (cross) {
      const ta = toNumber(toAmount);
      if (!ta || ta <= 0) return setError('跨幣別請填寫轉入金額');
      tx.toCurrency = toCurrency.trim().toUpperCase();
      tx.toAmount = ta;
    }
    const rate = toNumber(fxRate);
    if (rate !== undefined && cur !== base) tx.fxRate = rate;
    if (note.trim()) tx.note = note.trim();
    upsertRow('transactions', tx);
    props.onClose();
  };

  return (
    <Modal
      title={incoming ? `撥入資金到「${strategy.name}」` : `從「${strategy.name}」撥出資金`}
      onClose={props.onClose}
      footer={
        <>
          <button className="ghost" onClick={props.onClose}>
            取消
          </button>
          <button className="primary" onClick={save}>
            建立轉帳
          </button>
        </>
      }
    >
      <div className="notice">
        這是組合內部的資金調度：整體 NAV 不變，也不算損益或外部投入。策略的「配置資金」會因此增減，
        之後的報酬以這筆配置資金為分母計算。
      </div>
      <div className="form-grid">
        <Field label={incoming ? '資金來源' : '轉入到'}>
          <select value={other} onChange={(e) => setOther(e.target.value)}>
            {others.map((b) => (
              <option key={b} value={b}>
                {bucketName(data, b)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="日期">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="轉出帳戶" hint="可與轉入帳戶相同（同一帳戶內調度）">
          <select value={fromAccount} onChange={(e) => setFromAccount(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}（{a.baseCurrency}）
              </option>
            ))}
          </select>
        </Field>
        <Field label="轉入帳戶">
          <select value={toAccount} onChange={(e) => setToAccount(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}（{a.baseCurrency}）
              </option>
            ))}
          </select>
        </Field>
        <Field label="轉出金額">
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="轉出幣別">
          <input value={currency} onChange={(e) => setCurrency(e.target.value)} />
        </Field>
        <Field label="轉入幣別（跨幣別才填）">
          <input
            value={toCurrency}
            onChange={(e) => setToCurrency(e.target.value)}
            placeholder={currency}
          />
        </Field>
        {cross && (
          <Field label="轉入金額">
            <input
              inputMode="decimal"
              value={toAmount}
              onChange={(e) => setToAmount(e.target.value)}
            />
          </Field>
        )}
        {currency.trim().toUpperCase() !== base && (
          <Field label={`匯率（${base} / ${currency.trim().toUpperCase() || '幣別'}，選填）`}>
            <input inputMode="decimal" value={fxRate} onChange={(e) => setFxRate(e.target.value)} />
          </Field>
        )}
        <Field label="備註（選填）">
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      {error && <p className="neg">{error}</p>}
    </Modal>
  );
}
