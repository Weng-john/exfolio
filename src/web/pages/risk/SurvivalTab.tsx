import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  monthsToDays,
  runSurvival,
  today,
  type ExtraFlow,
  type ShortfallPolicy,
  type SurvivalEvent,
  type SurvivalEventType,
  type SurvivalParams,
} from '@core/index';
import { Badge, Card, Empty, Field, Stat } from '../../components/ui';
import { fmtMoney, fmtPct, fmtX } from '../../format';
import { useData } from '../../store';
import { usePortfolio } from '../../usePortfolio';
import CashflowTable from './CashflowTable';
import { foreignCurrencies, NumInput, PctInput, ScenarioBar } from './shared';

type Horizon = '1' | '3' | '6' | '12' | 'custom';

interface ShockRow {
  key: string;
  day?: number;
  kind: 'index' | 'fx';
  target: string;
  move?: number;
}

interface FlowRow {
  key: string;
  date: string;
  amount?: number;
  currency: string;
  label: string;
}

interface State {
  horizon: Horizon;
  customDays: number;
  indexMoves: Record<string, number>;
  defaultIndexMove?: number;
  currencyMoves: Record<string, number>;
  shocks: ShockRow[];
  rateShift?: number;
  extraFlows: FlowRow[];
  useCashflowItems: boolean;
  loanPaymentsFromOutside: boolean;
  rollCostPerContract?: number;
  fundingRateAnnual?: number;
  shortfallPolicy: ShortfallPolicy;
}

const INITIAL: State = {
  horizon: '6',
  customDays: 90,
  indexMoves: {},
  currencyMoves: {},
  shocks: [],
  extraFlows: [],
  useCashflowItems: true,
  loanPaymentsFromOutside: false,
  shortfallPolicy: 'record',
};

let keySeq = 0;
const nextKey = () => `r${++keySeq}`;

const EVENT_LABEL: Record<SurvivalEventType, string> = {
  cash_shortfall: '現金不足',
  pledge_call: '質押追繳',
  margin_shortfall: '保證金不足',
  forced_reduction: '強制減碼',
  nav_nonpositive: 'NAV ≤ 0',
};
const EVENT_TONE: Record<SurvivalEventType, 'warn' | 'bad'> = {
  cash_shortfall: 'bad',
  pledge_call: 'warn',
  margin_shortfall: 'bad',
  forced_reduction: 'warn',
  nav_nonpositive: 'bad',
};

const TOOLTIP = { background: 'var(--panel)', border: '1px solid var(--border)', color: 'var(--text)' };

/** Merge saved params over the defaults, ignoring anything of the wrong shape. */
function readState(params: Record<string, unknown>): State {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const rec = (v: unknown): Record<string, number> =>
    v && typeof v === 'object'
      ? Object.fromEntries(Object.entries(v).filter(([, n]) => typeof n === 'number' && Number.isFinite(n)))
      : {};
  const list = (v: unknown): Array<Record<string, unknown>> =>
    Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : [];
  const horizon = ['1', '3', '6', '12', 'custom'].includes(params.horizon as string) ? (params.horizon as Horizon) : INITIAL.horizon;
  return {
    horizon,
    customDays: num(params.customDays) ?? INITIAL.customDays,
    indexMoves: rec(params.indexMoves),
    defaultIndexMove: num(params.defaultIndexMove),
    currencyMoves: rec(params.currencyMoves),
    shocks: list(params.shocks).map((s) => ({
      key: nextKey(),
      day: num(s.day),
      kind: s.kind === 'fx' ? 'fx' : 'index',
      target: typeof s.target === 'string' ? s.target : '*',
      move: num(s.move),
    })),
    rateShift: num(params.rateShift),
    extraFlows: list(params.extraFlows).map((f) => ({
      key: nextKey(),
      date: typeof f.date === 'string' ? f.date : today(),
      amount: num(f.amount),
      currency: typeof f.currency === 'string' ? f.currency : 'TWD',
      label: typeof f.label === 'string' ? f.label : '',
    })),
    useCashflowItems: params.useCashflowItems !== false,
    loanPaymentsFromOutside: params.loanPaymentsFromOutside === true,
    rollCostPerContract: num(params.rollCostPerContract),
    fundingRateAnnual: num(params.fundingRateAnnual),
    shortfallPolicy: params.shortfallPolicy === 'sell_core' ? 'sell_core' : 'record',
  };
}

function toParams(s: State, day: string): SurvivalParams {
  const horizonDays = s.horizon === 'custom' ? Math.max(1, Math.floor(s.customDays || 1)) : monthsToDays(Number(s.horizon), day);
  const shocks = s.shocks
    .filter((r) => r.day !== undefined && r.day >= 1 && r.move !== undefined && r.target)
    .map((r) => ({ day: Math.floor(r.day!), kind: r.kind, id: r.target, move: r.move! }));
  const extraFlows: ExtraFlow[] = s.extraFlows
    .filter((f) => f.amount && f.date)
    .map((f) => ({ date: f.date, amount: f.amount!, currency: f.currency, label: f.label || undefined }));
  return {
    today: day,
    horizonDays,
    indexMoves: s.indexMoves,
    defaultIndexMove: s.defaultIndexMove,
    currencyMoves: s.currencyMoves,
    shocks,
    rateShift: s.rateShift,
    extraFlows,
    useCashflowItems: s.useCashflowItems,
    loanPaymentsFromOutside: s.loanPaymentsFromOutside,
    rollCostPerContract: s.rollCostPerContract,
    fundingRateAnnual: s.fundingRateAnnual,
    shortfallPolicy: s.shortfallPolicy,
  };
}

export default function SurvivalTab() {
  const data = useData();
  const portfolio = usePortfolio();
  const base = portfolio.valuation.baseCurrency;
  const [state, setState] = useState<State>(INITIAL);
  const day = today();

  const params = useMemo(() => toParams(state, day), [state, day]);
  const result = useMemo(() => runSurvival(data, portfolio, params), [data, portfolio, params]);
  const patch = (p: Partial<State>) => setState((s) => ({ ...s, ...p }));

  const indices = data.indices;
  const currencies = foreignCurrencies(data, portfolio);
  const accountName = (id?: string) => (id ? data.accounts.find((a) => a.id === id)?.name ?? id : '');
  const loanName = (id?: string) => (id ? data.loans.find((l) => l.id === id)?.name ?? id : '');

  const setMove = (kind: 'indexMoves' | 'currencyMoves', id: string, v: number | undefined) =>
    setState((s) => {
      const next = { ...s[kind] };
      if (v === undefined) delete next[id];
      else next[id] = v;
      return { ...s, [kind]: next };
    });
  const editShock = (key: string, p: Partial<ShockRow>) =>
    patch({ shocks: state.shocks.map((r) => (r.key === key ? { ...r, ...p } : r)) });
  const editFlow = (key: string, p: Partial<FlowRow>) =>
    patch({ extraFlows: state.extraFlows.map((r) => (r.key === key ? { ...r, ...p } : r)) });

  const s = result.summary;
  const chart = result.series.map((d) => ({
    date: d.date,
    nav: Math.round(d.nav),
    cash: Math.round(d.cash),
    ratio: d.minMaintenanceRatio,
  }));
  const hasRatio = chart.some((d) => d.ratio !== undefined);
  const hasBook = portfolio.valuation.positions.length > 0 || portfolio.valuation.cash.length > 0;

  const verdict = (() => {
    if (!s.navPositiveThroughout) {
      return {
        tone: 'bad',
        text: `NAV 在 ${s.minNav.date} 降至 ${fmtMoney(s.minNav.value, base)} ${base}（≤ 0）。這已是帳面虧損，不只是現金問題。`,
      };
    }
    if (s.navPositiveButCashShort) {
      const f = s.firstShortfall;
      return {
        tone: 'bad',
        text: `帳面 NAV 全程為正（最低 ${fmtMoney(s.minNav.value, base)} ${base}），但現金不足以維持持倉：首次缺口發生在 ${s.firstShortfallDate}${
          f ? `（${f.label}，缺 ${fmtMoney(f.amount, f.currency)} ${f.currency}）` : ''
        }，期間最低現金 ${fmtMoney(s.minCash.value, base)} ${base}（${s.minCash.date}）。要避免所有缺口，約需外部資金 ${fmtMoney(s.externalNeeded.total, base)} ${base}。`,
      };
    }
    if (s.firstPledgeCallDate) {
      return {
        tone: 'warn',
        text: `現金足夠，沒有現金或保證金缺口；但質押借款在 ${s.firstPledgeCallDate} 觸發追繳，約需 ${fmtMoney(s.externalNeeded.pledge, base)} ${base} 還款或補擔保品。`,
      };
    }
    return { tone: 'ok', text: '在此情境下，現金足以維持持倉：期間內沒有現金缺口、保證金不足或追繳。' };
  })();

  return (
    <div className="risk-stack">
      <Card title="情境">
        <ScenarioBar
          data={data}
          kind="cashflow"
          current={() => {
            const { shocks, extraFlows, ...rest } = state;
            return {
              ...rest,
              shocks: shocks.map(({ key: _k, ...r }) => r),
              extraFlows: extraFlows.map(({ key: _k, ...r }) => r),
            };
          }}
          onLoad={(p) => setState(readState(p))}
        />
      </Card>

      <Card title="期間與市場路徑">
        <div className="risk-form-grid">
          <Field label="模擬期間">
            <select value={state.horizon} onChange={(e) => patch({ horizon: e.target.value as Horizon })}>
              <option value="1">1 個月</option>
              <option value="3">3 個月</option>
              <option value="6">6 個月</option>
              <option value="12">12 個月</option>
              <option value="custom">自訂天數</option>
            </select>
          </Field>
          {state.horizon === 'custom' && (
            <Field label="天數">
              <NumInput value={state.customDays} onChange={(v) => patch({ customDays: v ?? 1 })} />
            </Field>
          )}
          <Field label="共 / 到期日" hint="從今天起算">
            <input readOnly value={`${params.horizonDays} 天 · ${result.endDate}`} />
          </Field>
          <Field label="利率變動（百分點）" hint="浮動利率假設，從第 1 天起">
            <NumInput value={state.rateShift} onChange={(v) => patch({ rateShift: v })} placeholder="0" />
          </Field>
        </div>

        <div className="risk-subhead">各指數在期間內的總漲跌（逐日線性分攤；留空 = 使用「其餘指數」）</div>
        <div className="risk-form-grid">
          {indices.map((i) => (
            <Field key={i.id} label={i.name}>
              <PctInput value={state.indexMoves[i.id]} onChange={(v) => setMove('indexMoves', i.id, v)} placeholder={fmtPct(state.defaultIndexMove ?? 0, 0)} />
            </Field>
          ))}
          <Field label="其餘指數">
            <PctInput value={state.defaultIndexMove} onChange={(v) => patch({ defaultIndexMove: v })} placeholder="0" />
          </Field>
        </div>

        <div className="risk-subhead">匯率：期間內各幣別對 {base} 的總升貶</div>
        <div className="risk-form-grid">
          {currencies.map((c) => (
            <Field key={c} label={`${c} / ${base}`}>
              <PctInput value={state.currencyMoves[c]} onChange={(v) => setMove('currencyMoves', c, v)} placeholder="0" />
            </Field>
          ))}
          {!currencies.length && <span className="muted">沒有外幣部位或匯率。</span>}
        </div>

        <div className="risk-subhead">指定日期的單次衝擊（例：第 10 天 −20%、第 40 天 +5%）</div>
        <div className="risk-inline-rows">
          {state.shocks.map((r) => (
            <div className="risk-inline-row" key={r.key}>
              <Field label="第幾天">
                <NumInput value={r.day} onChange={(v) => editShock(r.key, { day: v })} />
              </Field>
              <Field label="類型">
                <select value={r.kind} onChange={(e) => editShock(r.key, { kind: e.target.value as ShockRow['kind'], target: e.target.value === 'fx' ? currencies[0] ?? '' : '*' })}>
                  <option value="index">指數</option>
                  <option value="fx">匯率</option>
                </select>
              </Field>
              <Field label="對象">
                <select value={r.target} onChange={(e) => editShock(r.key, { target: e.target.value })}>
                  {r.kind === 'index' ? (
                    <>
                      <option value="*">全部指數</option>
                      {indices.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name}
                        </option>
                      ))}
                    </>
                  ) : (
                    currencies.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))
                  )}
                </select>
              </Field>
              <Field label="漲跌">
                <PctInput value={r.move} onChange={(v) => editShock(r.key, { move: v })} />
              </Field>
              <button className="ghost danger" onClick={() => patch({ shocks: state.shocks.filter((x) => x.key !== r.key) })}>
                移除
              </button>
            </div>
          ))}
          <div>
            <button onClick={() => patch({ shocks: [...state.shocks, { key: nextKey(), day: 10, kind: 'index', target: '*', move: -0.2 }] })}>
              新增衝擊
            </button>
          </div>
        </div>
      </Card>

      <Card title="資金、合約成本與缺口處理">
        <div className="risk-form-grid">
          <Field label="期貨每次轉倉成本（每口）" hint="每月一次，商品幣別">
            <NumInput value={state.rollCostPerContract} onChange={(v) => patch({ rollCostPerContract: v })} placeholder="0" />
          </Field>
          <Field label="永續合約年化 Funding 費率" hint="正 = 多方付；套用於名目金額逐日">
            <PctInput value={state.fundingRateAnnual} onChange={(v) => patch({ fundingRateAnnual: v })} placeholder="0" />
          </Field>
          <Field label="現金不足時">
            <select value={state.shortfallPolicy} onChange={(e) => patch({ shortfallPolicy: e.target.value as ShortfallPolicy })}>
              <option value="record">只記錄缺口，現金續為負</option>
              <option value="sell_core">按比例賣出被動核心補足</option>
            </select>
          </Field>
          <Field label="借款還款來源">
            <select value={state.loanPaymentsFromOutside ? 'out' : 'in'} onChange={(e) => patch({ loanPaymentsFromOutside: e.target.value === 'out' })}>
              <option value="in">從投資組合現金支付</option>
              <option value="out">由組合外收入支付</option>
            </select>
          </Field>
          <Field label="外部收支項目">
            <select value={state.useCashflowItems ? 'yes' : 'no'} onChange={(e) => patch({ useCashflowItems: e.target.value === 'yes' })}>
              <option value="yes">納入下方清單</option>
              <option value="no">不納入</option>
            </select>
          </Field>
        </div>

        <div className="risk-subhead">額外投入（正）／提領（負）</div>
        <div className="risk-inline-rows">
          {state.extraFlows.map((f) => (
            <div className="risk-inline-row" key={f.key}>
              <Field label="日期">
                <input type="date" value={f.date} onChange={(e) => editFlow(f.key, { date: e.target.value })} />
              </Field>
              <Field label="金額（正 = 投入）">
                <NumInput value={f.amount} onChange={(v) => editFlow(f.key, { amount: v })} />
              </Field>
              <Field label="幣別">
                <input value={f.currency} onChange={(e) => editFlow(f.key, { currency: e.target.value.trim().toUpperCase() })} />
              </Field>
              <Field label="備註">
                <input value={f.label} onChange={(e) => editFlow(f.key, { label: e.target.value })} />
              </Field>
              <button className="ghost danger" onClick={() => patch({ extraFlows: state.extraFlows.filter((x) => x.key !== f.key) })}>
                移除
              </button>
            </div>
          ))}
          <div>
            <button onClick={() => patch({ extraFlows: [...state.extraFlows, { key: nextKey(), date: day, amount: undefined, currency: base, label: '' }] })}>
              新增一筆
            </button>
          </div>
        </div>
      </Card>

      <CashflowTable />

      {!hasBook ? (
        <Card>
          <Empty>尚無持倉或現金，沒有可模擬的內容。</Empty>
        </Card>
      ) : (
        <>
          <div className={`risk-verdict ${verdict.tone}`}>
            <strong>核心問題：即使帳面 NAV 仍為正，現金是否足以維持持倉？</strong>
            <div style={{ marginTop: 6 }}>{verdict.text}</div>
          </div>

          <div className="stats">
            <Stat
              label="首次缺口日"
              value={s.firstShortfallDate ?? '無'}
              tone={s.firstShortfallDate ? 'neg' : 'pos'}
              hint={s.shortfallCount ? `共 ${s.shortfallCount} 次` : undefined}
            />
            <Stat label={`最低現金（${base}）`} value={fmtMoney(s.minCash.value, base)} tone={s.minCash.value < 0 ? 'neg' : undefined} hint={s.minCash.date} />
            <Stat
              label="最低維持率"
              value={s.minMaintenanceRatio ? fmtPct(s.minMaintenanceRatio.value, 1) : '—'}
              hint={s.minMaintenanceRatio ? `${s.minMaintenanceRatio.date} · ${loanName(s.minMaintenanceRatio.ref)}` : '無質押借款'}
              tone={s.firstPledgeCallDate ? 'neg' : undefined}
            />
            <Stat
              label={`最低保證金餘裕（${base}）`}
              value={s.minMarginHeadroom ? fmtMoney(s.minMarginHeadroom.value, base) : '—'}
              hint={s.minMarginHeadroom ? `${s.minMarginHeadroom.date} · ${accountName(s.minMarginHeadroom.ref)}` : '無期貨／永續合約'}
              tone={s.minMarginHeadroom && s.minMarginHeadroom.value < 0 ? 'neg' : undefined}
            />
            <Stat
              label={`避免缺口所需外部資金（${base}）`}
              value={fmtMoney(s.externalNeeded.total, base)}
              hint={`現金 ${fmtMoney(s.externalNeeded.cash, base)} · 保證金 ${fmtMoney(s.externalNeeded.margin, base)} · 追繳 ${fmtMoney(s.externalNeeded.pledge, base)}`}
            />
            <Stat label={`期末 NAV（${base}）`} value={fmtMoney(s.endingNav, base)} />
            <Stat label="期末 Gross / Net 槓桿" value={`${fmtX(s.endingGrossLeverage)} / ${fmtX(s.endingNetLeverage)}`} />
          </div>

          <Card title="NAV、現金與最低維持率">
            <div className="risk-chart">
              <ResponsiveContainer>
                <LineChart data={chart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" stroke="var(--muted)" fontSize={12} minTickGap={32} />
                  <YAxis yAxisId="money" stroke="var(--muted)" fontSize={12} width={80} tickFormatter={(n) => fmtMoney(n, base, 0)} />
                  {hasRatio && <YAxis yAxisId="ratio" orientation="right" stroke="var(--muted)" fontSize={12} width={55} tickFormatter={(n) => `${Math.round(n * 100)}%`} />}
                  <Tooltip
                    contentStyle={TOOLTIP}
                    formatter={(v: number, name: string) => (name === '最低維持率' ? fmtPct(v, 1) : fmtMoney(v, base))}
                  />
                  <Legend />
                  <Line yAxisId="money" dataKey="nav" name="NAV" stroke="var(--accent)" dot={false} />
                  <Line yAxisId="money" dataKey="cash" name="總現金" stroke="var(--warn)" dot={false} />
                  {hasRatio && <Line yAxisId="ratio" dataKey="ratio" name="最低維持率" stroke="var(--pos)" dot={false} connectNulls />}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title={`事件（${result.events.length}）`}>
            {!result.events.length ? (
              <Empty>期間內沒有缺口、追繳或強制減碼事件。</Empty>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>日期</th>
                      <th className="num">第幾天</th>
                      <th>事件</th>
                      <th>說明</th>
                      <th className="num">金額</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.events.map((e: SurvivalEvent, i) => (
                      <tr key={i}>
                        <td>{e.date}</td>
                        <td className="num">{e.day}</td>
                        <td>
                          <Badge tone={EVENT_TONE[e.type]}>{EVENT_LABEL[e.type]}</Badge>
                        </td>
                        <td style={{ whiteSpace: 'normal' }}>
                          {e.label}
                          {e.sold && e.sold.length > 0 && (
                            <div className="muted" style={{ fontSize: 12 }}>
                              賣出：
                              {e.sold
                                .map((x) => `${data.instruments.find((n) => n.id === x.instrumentId)?.symbol ?? x.instrumentId} ${x.quantity.toFixed(2)}`)
                                .join('、')}
                            </div>
                          )}
                          {e.coveredBySale ? <div className="muted" style={{ fontSize: 12 }}>其中 {fmtMoney(e.coveredBySale, e.currency)} 由賣出補足</div> : null}
                        </td>
                        <td className="num">
                          {fmtMoney(e.amount, e.currency)} {e.currency}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {result.warnings.length > 0 && (
            <Card title="警示">
              <ul className="risk-list">
                {result.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}

      <div className="notice warn">
        <strong>限制說明</strong>
        <ul className="risk-list caveats">
          {result.caveats.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
