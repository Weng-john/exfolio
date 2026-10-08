import { useState } from 'react';
import {
  estimateFees,
  CORE_BUCKET,
  getSettings,
  newId,
  today,
  type AppData,
  type FundingSource,
  type Transaction,
  type TxType,
} from '@core/index';
import { Field, Modal } from '../../components/ui';
import { TX_HINTS, TX_LABELS } from './labels';

const ALL_TYPES = Object.keys(TX_LABELS) as TxType[];

/** Form state: every control is a string so partial input never gets coerced. */
interface FormState {
  date: string;
  type: TxType;
  accountId: string;
  bucket: string;
  currency: string;
  amount: string;
  instrumentId: string;
  quantity: string;
  price: string;
  fee: string;
  tax: string;
  fxRate: string;
  toAccountId: string;
  toCurrency: string;
  toAmount: string;
  toBucket: string;
  loanId: string;
  principal: string;
  interest: string;
  source: '' | FundingSource;
  note: string;
}

const str = (n: number | undefined) => (n === undefined ? '' : String(n));

function initial(data: AppData, tx?: Transaction): FormState {
  const account =
    data.accounts.find((a) => a.id === tx?.accountId) ??
    data.accounts.find((a) => a.active) ??
    data.accounts[0];
  return {
    date: tx?.date ?? today(),
    type: tx?.type ?? 'buy',
    accountId: tx?.accountId ?? account?.id ?? '',
    bucket: tx?.bucket ?? CORE_BUCKET,
    currency: tx?.currency ?? account?.baseCurrency ?? getSettings(data).baseCurrency,
    amount: tx && tx.type !== 'buy' && tx.type !== 'sell' ? str(tx.amount) : '',
    instrumentId: tx?.instrumentId ?? '',
    quantity: str(tx?.quantity),
    price: str(tx?.price),
    fee: str(tx?.fee),
    tax: str(tx?.tax),
    fxRate: str(tx?.fxRate),
    toAccountId: tx?.toAccountId ?? '',
    toCurrency: tx?.toCurrency ?? '',
    toAmount: str(tx?.toAmount),
    toBucket: tx?.toBucket ?? '',
    loanId: tx?.loanId ?? '',
    principal: str(tx?.principal),
    interest: str(tx?.interest),
    source: tx?.source ?? '',
    note: tx?.note ?? '',
  };
}

/** Which controls each type uses. */
function layout(type: TxType) {
  const trade = type === 'buy' || type === 'sell';
  const loan = type === 'loan_draw' || type === 'loan_repay';
  return {
    trade,
    loan,
    repay: type === 'loan_repay',
    transfer: type === 'transfer',
    amount: !trade && type !== 'loan_repay',
    instrument: trade || type === 'dividend',
    costs: trade || type === 'dividend' || type === 'transfer' || loan,
    tax: trade || type === 'dividend',
    signedAmount: type === 'adjust' || type === 'funding_fee',
  };
}

/** Validate the form and build the transaction. Returns an error message instead of throwing. */
export function buildTransaction(
  f: FormState,
  data: AppData,
  id: string,
  orig?: Transaction,
): Transaction | string {
  const L = layout(f.type);
  const base = getSettings(data).baseCurrency;
  const num = (label: string, raw: string): number | undefined | string => {
    if (raw.trim() === '') return undefined;
    const n = Number(raw.replace(/,/g, ''));
    return Number.isFinite(n) ? n : `${label} 不是有效數字`;
  };
  const vals: Record<string, number | undefined> = {};
  const fields: [string, string, string][] = [
    ['amount', '金額', f.amount],
    ['quantity', '數量', f.quantity],
    ['price', '價格', f.price],
    ['fee', '手續費', f.fee],
    ['tax', '稅', f.tax],
    ['fxRate', '匯率', f.fxRate],
    ['toAmount', '轉入金額', f.toAmount],
    ['principal', '本金', f.principal],
    ['interest', '利息', f.interest],
  ];
  for (const [key, label, raw] of fields) {
    const r = num(label, raw);
    if (typeof r === 'string') return r;
    if (r !== undefined && r < 0 && !(key === 'amount' && L.signedAmount))
      return `${label} 不可為負數`;
    vals[key] = r;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return '請填寫日期';
  if (!f.accountId) return '請選擇帳戶';
  const inst = data.instruments.find((i) => i.id === f.instrumentId);
  if (L.trade && !inst) return '請選擇商品';
  if (L.trade && !vals.quantity) return '數量須大於 0';
  if (L.trade && vals.price === undefined) return '請填寫價格';
  if (L.amount && vals.amount === undefined) return '請填寫金額';
  if (L.amount && !L.signedAmount && !vals.amount) return '金額須大於 0';
  if (L.transfer && !f.toAccountId) return '請選擇轉入帳戶';
  if (L.loan && !f.loanId) return '請選擇貸款';
  if (L.repay) {
    if (!f.source) return '請選擇還款資金來源（外部 / 投資組合）';
    if (!vals.principal && !vals.interest) return '請填寫本金或利息';
  }
  if (vals.fxRate !== undefined && vals.fxRate <= 0) return '匯率須大於 0';

  const currency = (L.trade && inst ? inst.currency : f.currency.trim().toUpperCase()) || base;
  const tx: Transaction = {
    id,
    date: f.date,
    type: f.type,
    accountId: f.accountId,
    bucket: f.bucket || CORE_BUCKET,
    currency,
    amount: L.trade
      ? 0
      : L.repay
        ? (vals.principal ?? 0) + (vals.interest ?? 0)
        : (vals.amount ?? 0),
  };
  if (L.instrument && f.instrumentId) tx.instrumentId = f.instrumentId;
  if (L.trade) {
    tx.quantity = vals.quantity; // positive magnitude; the type decides the direction
    tx.price = vals.price;
  }
  if (L.costs && vals.fee !== undefined) tx.fee = vals.fee;
  if (L.tax && vals.tax !== undefined) tx.tax = vals.tax;
  if (vals.fxRate !== undefined && currency !== base) tx.fxRate = vals.fxRate;
  if (L.transfer) {
    tx.toAccountId = f.toAccountId;
    if (f.toCurrency.trim()) tx.toCurrency = f.toCurrency.trim().toUpperCase();
    if (vals.toAmount !== undefined) tx.toAmount = vals.toAmount;
    if (f.toBucket) tx.toBucket = f.toBucket;
  }
  if (L.loan) tx.loanId = f.loanId;
  if (L.repay) {
    tx.principal = vals.principal ?? 0;
    tx.interest = vals.interest ?? 0;
    tx.source = f.source as FundingSource;
  }
  if (f.note.trim()) tx.note = f.note.trim();
  // Journal metadata is edited elsewhere: keep it when the trade is re-saved.
  if (orig?.tags?.length) tx.tags = orig.tags;
  if (orig?.reason) tx.reason = orig.reason;
  if (orig?.tradeGroupId) tx.tradeGroupId = orig.tradeGroupId;
  if (orig?.rotationCycleId) tx.rotationCycleId = orig.rotationCycleId;
  return tx;
}

export default function TxForm(props: {
  data: AppData;
  tx?: Transaction;
  onSave: (tx: Transaction) => void;
  onClose: () => void;
}) {
  const { data, tx } = props;
  const [f, setF] = useState<FormState>(() => initial(data, tx));
  const [error, setError] = useState('');
  const L = layout(f.type);
  const set = (patch: Partial<FormState>) => setF((s) => ({ ...s, ...patch }));
  const input = (key: keyof FormState, extra: { type?: string; placeholder?: string } = {}) => (
    <input
      type={extra.type ?? 'text'}
      inputMode={extra.type ? undefined : 'decimal'}
      placeholder={extra.placeholder}
      value={f[key]}
      onChange={(e) => set({ [key]: e.target.value } as Partial<FormState>)}
    />
  );
  const inst = data.instruments.find((i) => i.id === f.instrumentId);
  const base = getSettings(data).baseCurrency;
  const currency = L.trade && inst ? inst.currency : f.currency.trim().toUpperCase();
  const loans = data.loans;

  // Estimate from the institution's fee rule; the user can still overwrite it.
  const account = data.accounts.find((a) => a.id === f.accountId);
  const broker = data.brokers.find((b) => b.id === account?.brokerId);
  const estimate =
    L.trade && inst
      ? estimateFees(
          broker,
          inst,
          f.type === 'sell' ? 'sell' : 'buy',
          Number(f.quantity),
          Number(f.price),
        )
      : undefined;
  const round = (n: number) => String(Math.round(n * 100) / 100);
  const feeHint = !estimate ? undefined : estimate.known ? (
    <button
      type="button"
      className="ghost"
      onClick={() => set({ fee: round(estimate.fee), tax: round(estimate.tax) })}
    >
      依 {broker?.name} 費率估算：手續費 {round(estimate.fee)}、稅 {round(estimate.tax)}（點此帶入）
    </button>
  ) : (
    '此機構未設定這類商品的費率，可到「帳戶與機構」設定'
  );

  const onAccount = (accountId: string) => {
    const acc = data.accounts.find((a) => a.id === accountId);
    set(tx || L.trade ? { accountId } : { accountId, currency: acc?.baseCurrency ?? f.currency });
  };

  const save = () => {
    const res = buildTransaction(f, data, tx?.id ?? newId('tx'), tx);
    if (typeof res === 'string') setError(res);
    else props.onSave(res);
  };

  return (
    <Modal
      title={tx ? '編輯交易' : '新增交易'}
      onClose={props.onClose}
      wide
      footer={
        <>
          <button className="ghost" onClick={props.onClose}>
            取消
          </button>
          <button className="primary" onClick={save}>
            儲存
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="類型">
          <select value={f.type} onChange={(e) => set({ type: e.target.value as TxType })}>
            {ALL_TYPES.map((t) => (
              <option key={t} value={t}>
                {TX_LABELS[t]}（{t}）
              </option>
            ))}
          </select>
        </Field>
        <Field label="日期">{input('date', { type: 'date' })}</Field>
        <Field label={L.transfer ? '轉出帳戶' : '帳戶'}>
          <select value={f.accountId} onChange={(e) => onAccount(e.target.value)}>
            {data.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}（{a.baseCurrency}）
              </option>
            ))}
          </select>
        </Field>
        <Field label="策略 / 桶" hint="預設為核心（core）">
          <select value={f.bucket} onChange={(e) => set({ bucket: e.target.value })}>
            <option value={CORE_BUCKET}>core（核心）</option>
            {data.strategies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="notice" style={{ marginTop: 12 }}>
        {TX_HINTS[f.type]}
      </div>

      <div className="form-grid">
        {L.instrument && (
          <Field label={L.trade ? '商品' : '商品（選填）'}>
            <select value={f.instrumentId} onChange={(e) => set({ instrumentId: e.target.value })}>
              <option value="">{L.trade ? '請選擇' : '無'}</option>
              {data.instruments.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.symbol} {i.name}（{i.currency}）
                </option>
              ))}
            </select>
          </Field>
        )}
        {L.trade ? (
          <>
            <Field label="數量" hint="填正數，方向由買 / 賣決定">
              {input('quantity')}
            </Field>
            <Field label="價格" hint={inst ? `${inst.currency} / 單位` : undefined}>
              {input('price')}
            </Field>
            <Field label="幣別" hint="買賣固定使用商品幣別">
              <input value={inst?.currency ?? ''} disabled />
            </Field>
          </>
        ) : (
          <>
            {L.amount && (
              <Field label="金額" hint={L.signedAmount ? '可為負數' : '填正數'}>
                {input('amount')}
              </Field>
            )}
            <Field label={L.transfer ? '轉出幣別' : '幣別'}>
              <input
                value={f.currency}
                onChange={(e) => set({ currency: e.target.value })}
                list="acct-currencies"
              />
            </Field>
          </>
        )}
        {L.repay && (
          <>
            <Field label="本金">{input('principal')}</Field>
            <Field label="利息">{input('interest')}</Field>
            <Field
              label="資金來源"
              hint="外部：不動用投資組合現金，NAV 上升；投資組合：從帳戶現金扣款"
            >
              <select
                value={f.source}
                onChange={(e) => set({ source: e.target.value as FormState['source'] })}
              >
                <option value="">請選擇</option>
                <option value="external">外部資金</option>
                <option value="portfolio">投資組合現金</option>
              </select>
            </Field>
          </>
        )}
        {L.loan && (
          <Field label="貸款">
            <select value={f.loanId} onChange={(e) => set({ loanId: e.target.value })}>
              <option value="">{loans.length ? '請選擇' : '尚無貸款（請先到貸款頁建立）'}</option>
              {loans.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}（{l.currency}）
                </option>
              ))}
            </select>
          </Field>
        )}
        {L.costs && (
          <Field label="手續費" hint={L.trade ? feeHint : undefined}>
            {input('fee')}
          </Field>
        )}
        {L.tax && <Field label="稅">{input('tax')}</Field>}
        {currency && currency !== base && (
          <Field label={`匯率（${currency}→${base}）`} hint="選填；留空則使用目前匯率表">
            {input('fxRate')}
          </Field>
        )}
      </div>

      {L.transfer && (
        <div className="form-grid" style={{ marginTop: 12 }}>
          <Field label="轉入帳戶">
            <select value={f.toAccountId} onChange={(e) => set({ toAccountId: e.target.value })}>
              <option value="">請選擇</option>
              {data.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}（{a.baseCurrency}）
                </option>
              ))}
            </select>
          </Field>
          <Field label="轉入幣別" hint="跨幣別時填寫；留空 = 同幣別">
            <input
              value={f.toCurrency}
              onChange={(e) => set({ toCurrency: e.target.value })}
              list="acct-currencies"
            />
          </Field>
          <Field label="轉入金額" hint="跨幣別時填實際入帳金額；留空 = 同轉出金額">
            {input('toAmount')}
          </Field>
          <Field label="轉入策略 / 桶" hint="資金在核心與策略間移動時選擇">
            <select value={f.toBucket} onChange={(e) => set({ toBucket: e.target.value })}>
              <option value="">與轉出相同</option>
              <option value={CORE_BUCKET}>core（核心）</option>
              {data.strategies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <Field label="備註">
          <input value={f.note} onChange={(e) => set({ note: e.target.value })} />
        </Field>
      </div>
      <datalist id="acct-currencies">
        {[
          ...new Set([base, 'USD', 'USDT', 'BTC', ...data.accounts.map((a) => a.baseCurrency)]),
        ].map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      {error && (
        <div className="notice warn" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}
    </Modal>
  );
}
