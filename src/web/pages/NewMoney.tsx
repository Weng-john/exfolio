import { Link } from 'react-router-dom';
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
import { Card, Field, PageHeader } from '../components/ui';
import { Accordion, Banner, EmptyState, Toggle } from '../components/Primitives';
import { PlanView } from './allocation/PlanView';
import { parseFiniteAmount, parseNonNegativeAmount } from './newMoneyValidation';
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

  const names = useMemo(
    () => Object.fromEntries(data.indices.map((i) => [i.id, i.name])),
    [data.indices],
  );
  const currencies = useMemo(
    () => [
      ...new Set([
        base,
        ...data.instruments.map((i) => i.currency),
        ...data.fxRates.map((r) => r.from),
      ]),
    ],
    [base, data.instruments, data.fxRates],
  );
  const targeted = data.targets.map((t) => t.indexId);
  const amountValue = parseNonNegativeAmount(amount);
  const amountError = amount.trim() !== '' && amountValue === undefined;
  const cmpAmountValue = parseFiniteAmount(cmpAmount);
  const cmpAmountError = cmpAmount.trim() !== '' && cmpAmountValue === undefined;

  const plan = useMemo(
    () =>
      planAllocation(data, valuation, {
        amount: amountValue ?? 0,
        currency,
        source,
        loanId: source === 'loan' ? loanId || undefined : undefined,
        accountId: accountId || (accounts[0]?.id ?? ''),
        allowSell: false,
        useExistingCash: useCash,
        overrides: Object.fromEntries(Object.entries(overrides).filter(([, v]) => v)),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, valuation, amount, amountValue, currency, source, loanId, accountId, useCash, overrides],
  );

  const effCmpIndex = cmpIndex || targeted[0] || data.indices[0]?.id || '';
  const rows = useMemo(
    () => (effCmpIndex ? compareInstruments(data, effCmpIndex, cmpAmountValue ?? 0) : []),
    [data, effCmpIndex, cmpAmountValue],
  );
  const gapRow = useMemo(
    () => compareAllocation(data, valuation).rows.find((r) => r.indexId === effCmpIndex),
    [data, valuation, effCmpIndex],
  );

  return (
    <>
      <PageHeader title="New Money Allocator" subtitle="輸入新資金來源與金額，產生交易建議清單" />
      <Banner title="先試算，再決定">
        此頁只產生建議清單，不會下單，也不會建立交易。計算會先納入資金來源對 NAV
        的影響，再評估目標缺口；只買進、不賣出。
      </Banner>
      {!accounts.length && (
        <EmptyState
          title="先選擇資金的落點"
          action={
            <Link className="button primary" to="/accounts">
              建立帳戶 ↗
            </Link>
          }
        >
          建立帳戶後，就能指定收款帳戶與可使用的現金。
        </EmptyState>
      )}
      <div className="section-kicker">
        <span>01</span> 設定投入條件
      </div>
      <Card title="資金">
        <div className="form-grid">
          <Field label="金額">
            <input
              type="number"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
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
                {data.loans
                  .filter((l) => l.active)
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
              </select>
            </Field>
          )}
          <Toggle
            label="一併使用現有現金"
            hint="動用收款帳戶內的閒置現金"
            checked={useCash}
            onChange={setUseCash}
          />
        </div>
        {amountError && (
          <div className="notice warn" role="alert">
            金額必須是大於或等於 0 的有效數字。
          </div>
        )}
      </Card>

      <div className="section-kicker">
        <span>02</span> 選擇配置工具
      </div>
      <Card title="各指數使用的商品">
        {targeted.length === 0 ? (
          <EmptyState
            title="給下一筆投入一個方向"
            action={
              <Link className="button" to="/allocation">
                設定配置目標 ↗
              </Link>
            }
          >
            設定各指數的目標權重後，這裡會列出可用商品。
          </EmptyState>
        ) : (
          <div className="form-grid">
            {targeted.map((idx) => {
              const pref = data.targets.find((t) => t.indexId === idx)?.preferredInstrumentId;
              return (
                <Field key={idx} label={names[idx] ?? idx}>
                  <select
                    value={overrides[idx] ?? ''}
                    onChange={(e) => setOverrides({ ...overrides, [idx]: e.target.value })}
                  >
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

      <div className="section-kicker">
        <span>03</span> 檢視配置建議
      </div>
      {!amountError && <PlanView plan={plan} names={names} />}
      <Accordion title="資金來源為什麼會影響結果？">
        <p>
          外部投入會增加 NAV；借款同時增加現金與負債，NAV
          不變。股息、賣出所得與內部移轉若已在帳內，不會再次計入外部投入。實際成交後，請到交易頁登錄。
        </p>
      </Accordion>

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
        {cmpAmountError && (
          <div className="notice warn" role="alert">
            目標曝險必須是有效數字。
          </div>
        )}
        <div className="table-wrap" role="region" aria-label="工具比較（可左右捲動）" tabIndex={0}>
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
                  <td className="num">
                    {r.price === undefined ? '—' : `${fmtMoney(r.price, r.currency)} ${r.currency}`}
                  </td>
                  <td className="num">{fmtNum(r.quantity, 8)}</td>
                  <td className="num">
                    {r.cash === undefined
                      ? '—'
                      : `${fmtMoney(r.cash, r.currency)} ${r.currency}${r.isMargin ? '（保證金）' : ''}`}
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
