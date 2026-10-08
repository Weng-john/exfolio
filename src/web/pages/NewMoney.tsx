import { useMemo, useState } from 'react';
import {
  compareAllocation,
  compareInstruments,
  planAllocation,
  type FundingKind,
  type ID,
} from '@core/index';
import { useData } from '../store';
import { usePortfolio } from '../usePortfolio';
import { fmtMoney, fmtNum, fmtPct } from '../format';
import { Card, Empty, Field, PageHeader } from '../components/ui';
import { PlanView } from './allocation/PlanView';
import './allocation/allocation.css';

const SOURCES: Array<[FundingKind, string]> = [
  ['external', '外部投入（入金，NAV 增加）'],
  ['loan', '借款取得資金（現金與負債同增，NAV 不變）'],
  ['dividend', '股息／賣出所得（已在組合現金內）'],
  ['internal', '內部資金移轉（已在 NAV 內）'],
];

export default function NewMoneyPage() {
  const data = useData();
  const { valuation } = usePortfolio();
  const base = valuation.baseCurrency;

  const accounts = data.accounts.filter((a) => a.active);
  const [amount, setAmount] = useState('100000');
  const [currency, setCurrency] = useState(base);
  const [source, setSource] = useState<FundingKind>('external');
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [loanId, setLoanId] = useState('');
  const [useCash, setUseCash] = useState(false);
  const [overrides, setOverrides] = useState<Record<ID, ID>>({});
  const [cmpIndex, setCmpIndex] = useState('');
  const [cmpAmount, setCmpAmount] = useState('1000000');

  const names = useMemo(() => Object.fromEntries(data.indices.map((i) => [i.id, i.name])), [data.indices]);
  const currencies = useMemo(
    () => [...new Set([base, ...data.instruments.map((i) => i.currency), ...data.fxRates.map((r) => r.from)])],
    [base, data.instruments, data.fxRates],
  );
  const targeted = data.targets.map((t) => t.indexId);

  const plan = useMemo(
    () =>
      planAllocation(data, valuation, {
        amount: parseFloat(amount) || 0,
        currency,
        source,
        loanId: source === 'loan' ? loanId || undefined : undefined,
        accountId: accountId || (accounts[0]?.id ?? ''),
        allowSell: false,
        useExistingCash: useCash,
        overrides: Object.fromEntries(Object.entries(overrides).filter(([, v]) => v)),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, valuation, amount, currency, source, loanId, accountId, useCash, overrides],
  );

  const effCmpIndex = cmpIndex || targeted[0] || data.indices[0]?.id || '';
  const rows = useMemo(
    () => (effCmpIndex ? compareInstruments(data, effCmpIndex, parseFloat(cmpAmount) || 0) : []),
    [data, effCmpIndex, cmpAmount],
  );
  const gapRow = useMemo(
    () => compareAllocation(data, valuation).rows.find((r) => r.indexId === effCmpIndex),
    [data, valuation, effCmpIndex],
  );

  return (
    <>
      <PageHeader title="New Money Allocator" subtitle="輸入新資金來源與金額，產生交易建議清單" />
      <div className="notice">
        此頁只產生<strong>建議清單</strong>：網站不會下單，也不會建立任何交易紀錄。實際成交後請至交易紀錄自行登錄。
        流程依序為：先算資金到位後的 NAV，再以該 NAV 評估各指數目標缺口；僅買進（不賣出）。
      </div>

      <Card title="資金">
        <div className="form-grid">
          <Field label="金額">
            <input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="幣別">
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {currencies.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="資金來源">
            <select value={source} onChange={(e) => setSource(e.target.value as FundingKind)}>
              {SOURCES.map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="收款帳戶">
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          {source === 'loan' && (
            <Field label="借款">
              <select value={loanId} onChange={(e) => setLoanId(e.target.value)}>
                <option value="">選擇借款…</option>
                {data.loans.filter((l) => l.active).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="現有現金" hint="同時動用收款帳戶內的閒置現金">
            <label>
              <input type="checkbox" checked={useCash} onChange={(e) => setUseCash(e.target.checked)} /> 一併使用
            </label>
          </Field>
        </div>
      </Card>

      <Card title="各指數使用的商品">
        {targeted.length === 0 ? (
          <Empty>尚未設定目標，請先到 Core Allocation 設定</Empty>
        ) : (
          <div className="form-grid">
            {targeted.map((idx) => {
              const pref = data.targets.find((t) => t.indexId === idx)?.preferredInstrumentId;
              return (
                <Field key={idx} label={names[idx] ?? idx}>
                  <select value={overrides[idx] ?? ''} onChange={(e) => setOverrides({ ...overrides, [idx]: e.target.value })}>
                    <option value="">{pref ? '目標設定的偏好商品' : '自動（無槓桿商品）'}</option>
                    {data.instruments
                      .filter((i) => i.indexId === idx && i.active)
                      .map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.symbol}
                          {i.leverage !== 1 ? `（${i.leverage}×）` : ''}
                        </option>
                      ))}
                  </select>
                </Field>
              );
            })}
          </div>
        )}
      </Card>

      <PlanView plan={plan} names={names} />

      <Card title="工具比較">
        <div className="form-grid">
          <Field label="指數">
            <select value={effCmpIndex} onChange={(e) => setCmpIndex(e.target.value)}>
              {data.indices.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={`目標曝險（${base}）`}
            hint={gapRow?.hasTarget ? `目前缺口 ${fmtMoney(gapRow.gap, base)}` : undefined}
          >
            <input type="number" value={cmpAmount} onChange={(e) => setCmpAmount(e.target.value)} />
          </Field>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>商品</th>
                <th className="num">槓桿</th>
                <th className="num">價格</th>
                <th className="num">數量</th>
                <th className="num">資金／保證金</th>
                <th className="num">資金（{base}）</th>
                <th className="num">資金占曝險</th>
                <th className="num">實際曝險</th>
                <th>備註</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.instrumentId}>
                  <td>{r.symbol}</td>
                  <td className="num">{r.leverage}×</td>
                  <td className="num">{r.price === undefined ? '—' : `${fmtMoney(r.price, r.currency)} ${r.currency}`}</td>
                  <td className="num">{fmtNum(r.quantity, 8)}</td>
                  <td className="num">
                    {r.cash === undefined ? '—' : `${fmtMoney(r.cash, r.currency)} ${r.currency}${r.isMargin ? '（保證金）' : ''}`}
                  </td>
                  <td className="num">{fmtMoney(r.cashBase, base)}</td>
                  <td className="num">{fmtPct(r.cashRatio, 0)}</td>
                  <td className="num">{fmtMoney(r.exposure, base)}</td>
                  <td>
                    <ul className="notes-list">
                      {r.notes.map((n, i) => (
                        <li key={i}>{n}</li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
