import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Area,
  AreaChart,
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
  buildNotifications,
  compareAllocation,
  CORE_BUCKET,
  demoData,
  getSettings,
  leverageHistory,
  overviewSummary,
  portfolioAlerts,
  today,
  UNCLASSIFIED_INDEX,
  type Reading,
} from '@core/index';
import { Badge, Card, Empty, Figure, PageHeader } from '../components/ui';
import { fmtMoney, fmtPct, fmtX, signClass } from '../format';
import { loadDemo, replaceAll, useData, useStore } from '../store';
import { usePortfolio } from '../usePortfolio';
import { FundingNotice } from '../components/FundingEvidence';
import { Accordion, EmptyState, Tooltip as Term } from '../components/Primitives';
import { WeightBar } from './allocation/WeightBar';
import './allocation/allocation.css';
import { Onboarding } from '../components/Onboarding';
import { CHART_TOOLTIP, useChartMotion } from '../components/chartTheme';

const CATEGORY: Record<string, string> = {
  'futures-expiry': '期貨到期',
  'futures-margin': '期貨保證金',
  loan: '貸款',
  collateral: '質押',
  allocation: '配置',
  portfolio: '組合',
};
const TONE = { info: 'info', warn: 'warn', bad: 'bad' } as const;
const SEVERITY = { bad: 0, warn: 1, info: 2 } as const;
/** Notices shown before "show all". */
const NOTICE_PREVIEW = 3;
const READING_MARK = { ok: '✓', info: '·', warn: '!' } as const;

/**
 * Actual weight as a bar with the target as a tick. Long-only weights read
 * best from a zero at the left; a short or negative target needs the
 * zero-centred bar the allocation page uses.
 */
function GapBar(props: { target: number; actual: number; scale: number }) {
  const { target, actual, scale } = props;
  if (target < 0 || actual < 0) return <WeightBar {...props} />;
  const at = (x: number) => `${Math.min(100, (x / (scale * 1.05)) * 100)}%`;
  return (
    <div
      className="ov-bar"
      role="img"
      aria-label={`實際 ${(actual * 100).toFixed(1)}%，目標 ${(target * 100).toFixed(1)}%`}
    >
      <span className="ov-bar-fill" style={{ width: at(actual) }} />
      <span className="ov-bar-target" style={{ left: at(target) }} />
    </div>
  );
}

/** A headline figure with one sentence saying how it stands. */
function Kpi(props: { label: string; value: string; tone?: 'pos' | 'neg'; reading: Reading }) {
  return (
    <div className="stat ov-kpi">
      <div className="stat-label">{props.label}</div>
      <div key={props.value} className={`stat-value value-enter ${props.tone ?? ''}`}>
        <Figure text={props.value} />
      </div>
      <div className={`ov-reading ${props.reading.tone}`}>
        <span aria-hidden="true">{READING_MARK[props.reading.tone]}</span>
        {props.reading.text}
      </div>
    </div>
  );
}

export default function OverviewPage() {
  const animate = useChartMotion();
  const data = useData();
  const store = useStore();
  const { valuation: v, ledger } = usePortfolio();
  const base = v.baseCurrency;
  const alerts = portfolioAlerts(data, v);
  const notifications = buildNotifications(data, { ledger, valuation: v }, today());
  const history = leverageHistory(data.snapshots);
  const indexName = (id: string) =>
    id === UNCLASSIFIED_INDEX ? '未分類' : (data.indices.find((i) => i.id === id)?.name ?? id);
  const bucketName = (id: string) =>
    id === CORE_BUCKET ? 'Core 被動核心' : (data.strategies.find((s) => s.id === id)?.name ?? id);
  const maxGross = Math.max(1, ...v.byIndex.map((ix) => ix.gross));
  const summary = overviewSummary(
    v,
    compareAllocation(data, v),
    getSettings(data).alerts.grossLeverage,
  );
  const devScale = Math.max(
    0.1,
    ...summary.deviations.flatMap((d) => [Math.abs(d.targetWeight), Math.abs(d.actualWeight)]),
  );
  // Alerts first, then notifications; within each, the most severe first.
  const notices = [
    ...alerts.map((a) => ({ ...a, tag: '警示', dueDate: undefined as string | undefined })),
    ...notifications.map((n) => ({ ...n, tag: CATEGORY[n.category] ?? n.category })),
  ].sort((x, y) => SEVERITY[x.level] - SEVERITY[y.level]);
  const [showAll, setShowAll] = useState(false);
  const empty = !v.positions.length && !v.cash.length && !v.loans.length;

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={`所有金額以 ${base} 計；曝險與槓桿以目前 NAV 為分母`}
      />

      {empty && (
        <EmptyState
          title="從第一筆倉位，看見組合全貌"
          action={
            <>
              <Link className="button primary" to="/accounts">
                新增帳戶與倉位 <span aria-hidden="true">↗</span>
              </Link>
              <button onClick={() => (store.scratch ? loadDemo() : replaceAll(demoData()))}>
                探索虛構示範
              </button>
            </>
          }
        >
          先記錄帳戶與持倉，再設定配置目標。已有資料可到設定還原備份。
          {store.scratch && ' 試算內容只在這個分頁，關閉或重新整理就會消失。'}
          {!store.backendRemote &&
            !store.demo &&
            !store.scratch &&
            ' 資料存在這個瀏覽器，輸入前請先到設定了解資料保護。'}
        </EmptyState>
      )}

      <div className="ov-top">
        <section className="ov-nav" aria-label="NAV 淨資產">
          <div className="stat-label">
            <Term label="NAV 淨資產">
              資產與現金，加計期貨未實現損益，再扣除負債。外部投入與投資損益分開計算。
            </Term>
          </div>
          <div key={v.nav} className="ov-nav-value value-enter">
            <Figure text={fmtMoney(v.nav, base)} />
            <span className="ov-nav-unit">{base}</span>
          </div>
          <p className="ov-nav-line">
            資產 {fmtMoney(v.totalAssets, base)} · 外部投入 {fmtMoney(v.contributedCapital, base)}
          </p>
          {history.length >= 2 ? (
            <div
              className="ov-spark"
              role="img"
              aria-label={`NAV 走勢：${history[0].date} 至 ${history[history.length - 1].date}`}
            >
              <ResponsiveContainer>
                <AreaChart data={history} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                  <Area
                    isAnimationActive={animate}
                    dataKey="nav"
                    stroke="var(--chart-1)"
                    strokeWidth={2}
                    fill="var(--chart-1)"
                    fillOpacity={0.08}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="ov-nav-hint">累積兩天的快照後，這裡會顯示 NAV 走勢。</p>
          )}
        </section>
        <div className="ov-kpis">
          <Kpi
            label="總損益"
            value={fmtMoney(v.totalPnl, base)}
            tone={v.totalPnl > 0 ? 'pos' : v.totalPnl < 0 ? 'neg' : undefined}
            reading={summary.pnl}
          />
          <Kpi label="Gross 槓桿" value={fmtX(v.grossLeverage)} reading={summary.leverage} />
          <Kpi label="負債" value={fmtMoney(v.liabilities, base)} reading={summary.debt} />
          <Kpi label="現金" value={fmtMoney(v.cashValue, base)} reading={summary.cash} />
        </div>
      </div>
      {(store.scratch || store.demo) && <Onboarding />}
      <FundingNotice transactions={data.transactions} />

      <div className="grid">
        <Card
          title="目標與實際"
          actions={
            <Link className="button ghost" to="/allocation">
              查看配置 →
            </Link>
          }
        >
          {summary.deviations.length === 0 ? (
            <Empty>設定各指數的目標權重後，這裡會列出偏離最大的項目。</Empty>
          ) : (
            <>
              <p className="ov-verdict">
                {summary.outOfBand === 0
                  ? `${summary.targets} 個目標都在容忍區間內。`
                  : `${summary.targets} 個目標中有 ${summary.outOfBand} 個超出容忍區間。`}
              </p>
              <ul className="ov-devs">
                {summary.deviations.map((d) => (
                  <li key={d.indexId}>
                    <div className="ov-dev-head">
                      <strong>{d.name}</strong>
                      <span className="num">
                        {fmtPct(d.actualWeight)}{' '}
                        <span className="muted">/ 目標 {fmtPct(d.targetWeight)}</span>
                      </span>
                    </div>
                    <GapBar target={d.targetWeight} actual={d.actualWeight} scale={devScale} />
                    <span className={d.outOfBand ? 'ov-dev-text out' : 'ov-dev-text'}>
                      {d.text}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>

        <Card title={`提醒${notices.length ? `（${notices.length}）` : ''}`}>
          {notices.length === 0 ? (
            <Empty clear>目前沒有警示或通知。門檻可在設定調整，僅供提醒，不限制任何操作。</Empty>
          ) : (
            <>
              <ul className="ov-notices">
                {(showAll ? notices : notices.slice(0, NOTICE_PREVIEW)).map((n) => (
                  <li key={n.id}>
                    <Badge tone={TONE[n.level]}>{n.tag}</Badge>
                    <div>
                      <strong>{n.title}</strong>
                      <span>{n.detail}</span>
                    </div>
                    {n.dueDate && <span className="num muted">{n.dueDate}</span>}
                  </li>
                ))}
              </ul>
              {notices.length > NOTICE_PREVIEW && (
                <button
                  type="button"
                  className="ghost"
                  aria-expanded={showAll}
                  onClick={() => setShowAll(!showAll)}
                >
                  {showAll ? '只顯示最重要的' : `顯示全部 ${notices.length} 則`}
                </button>
              )}
            </>
          )}
        </Card>
      </div>

      <div className="section-kicker">
        <span aria-hidden="true">↓</span> 明細
      </div>
      <div className="grid">
        <Card title="各指數曝險">
          {v.byIndex.length === 0 ? (
            <Empty>沒有持倉</Empty>
          ) : (
            <div
              className="table-wrap"
              role="region"
              aria-label="各指數曝險（可左右捲動）"
              tabIndex={0}
            >
              <table className="stack-table">
                <thead>
                  <tr>
                    <th>指數</th>
                    <th className="num">多方</th>
                    <th className="num">空方</th>
                    <th className="num">Net</th>
                    <th className="num">Net / NAV</th>
                    <th style={{ width: '26%' }}>Gross</th>
                  </tr>
                </thead>
                <tbody>
                  {v.byIndex.map((ix) => (
                    <tr key={ix.indexId}>
                      <td>{indexName(ix.indexId)}</td>
                      <td className="num">{fmtMoney(ix.long, base)}</td>
                      <td className="num">{fmtMoney(ix.short, base)}</td>
                      <td className={`num ${signClass(ix.net)}`}>{fmtMoney(ix.net, base)}</td>
                      <td className="num">{fmtPct(ix.weight)}</td>
                      <td>
                        <div
                          role="img"
                          aria-label={`Gross 曝險 ${fmtMoney(ix.gross, base)}，長度以最大指數曝險為基準`}
                          title={fmtMoney(ix.gross, base)}
                          style={{
                            height: 8,
                            borderRadius: 4,
                            background: 'var(--chart-1)',
                            width: `${(ix.gross / maxGross) * 100}%`,
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>合計</td>
                    <td />
                    <td />
                    <td className="num">{fmtMoney(v.netExposure, base)}</td>
                    <td className="num">{fmtPct(v.netLeverage)}</td>
                    <td>{fmtMoney(v.grossExposure, base)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <Accordion title="如何解讀曝險與槓桿？">
            <p>
              不同指數可能高度重疊（例如 S&P 500 與 Nasdaq 100），曝險加總不等於獨立風險來源。槓桿
              ETF 以每日目標倍數估算曝險，長期報酬不能直接用倍數推算。
            </p>
            <p>
              Gross 將每筆曝險取絕對值後加總；Net 保留多空方向。兩者除以目前 NAV
              得到槓桿；保證金不等於曝險或負債。
            </p>
          </Accordion>
        </Card>

        <Card title="被動核心與主動策略">
          {v.byBucket.length === 0 ? (
            <Empty>沒有持倉</Empty>
          ) : (
            <div
              className="table-wrap"
              role="region"
              aria-label="被動核心與主動策略（可左右捲動）"
              tabIndex={0}
            >
              <table className="stack-table">
                <thead>
                  <tr>
                    <th>組合</th>
                    <th className="num">市值</th>
                    <th className="num">Net 曝險</th>
                    <th className="num">Gross 曝險</th>
                    <th className="num">未實現損益</th>
                  </tr>
                </thead>
                <tbody>
                  {v.byBucket.map((b) => (
                    <tr key={b.bucket}>
                      <td>{bucketName(b.bucket)}</td>
                      <td className="num">{fmtMoney(b.marketValue, base)}</td>
                      <td className="num">{fmtMoney(b.net, base)}</td>
                      <td className="num">{fmtMoney(b.gross, base)}</td>
                      <td className={`num ${signClass(b.unrealizedPnl)}`}>
                        {fmtMoney(b.unrealizedPnl, base)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div
            className="table-wrap"
            role="region"
            aria-label="組合損益摘要（可左右捲動）"
            tabIndex={0}
          >
            <table className="stack-table">
              <tbody>
                <tr>
                  <td>已實現損益</td>
                  <td className={`num ${signClass(ledger.totals.realizedPnl)}`}>
                    {fmtMoney(ledger.totals.realizedPnl, base)}
                  </td>
                </tr>
                <tr>
                  <td>股息</td>
                  <td className="num">{fmtMoney(ledger.totals.dividends, base)}</td>
                </tr>
                <tr>
                  <td>交易費用與稅</td>
                  <td className="num">{fmtMoney(-ledger.totals.fees, base)}</td>
                </tr>
                <tr>
                  <td>融資成本</td>
                  <td className="num">{fmtMoney(-ledger.totals.fundingCost, base)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card title="歷史快照">
        {history.length < 2 ? (
          <Empty>每天開啟網站時會自動記錄一筆快照；累積兩天以上後顯示走勢。</Empty>
        ) : (
          <div className="grid">
            <div style={{ height: 260 }}>
              <ResponsiveContainer>
                <LineChart accessibilityLayer data={history}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" stroke="var(--muted)" fontSize={12} />
                  <YAxis
                    stroke="var(--muted)"
                    fontSize={12}
                    width={80}
                    tickFormatter={(n) => fmtMoney(n, base, 0)}
                  />
                  <Tooltip
                    formatter={(n: number) => fmtMoney(n, base)}
                    contentStyle={CHART_TOOLTIP}
                  />
                  <Legend />
                  <Line
                    isAnimationActive={animate}
                    dataKey="nav"
                    name="NAV"
                    stroke="var(--chart-1)"
                    dot={false}
                  />
                  <Line
                    isAnimationActive={animate}
                    dataKey="contributedCapital"
                    name="累積投入"
                    stroke="var(--chart-2)"
                    strokeDasharray="5 4"
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div style={{ height: 260 }}>
              <ResponsiveContainer>
                <LineChart accessibilityLayer data={history}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" stroke="var(--muted)" fontSize={12} />
                  <YAxis
                    stroke="var(--muted)"
                    fontSize={12}
                    width={50}
                    tickFormatter={(n) => `${n}×`}
                  />
                  <Tooltip formatter={(n: number) => fmtX(n)} contentStyle={CHART_TOOLTIP} />
                  <Legend />
                  <Line
                    isAnimationActive={animate}
                    dataKey="grossLeverage"
                    name="Gross 槓桿"
                    stroke="var(--neg)"
                    dot={false}
                  />
                  <Line
                    isAnimationActive={animate}
                    dataKey="netLeverage"
                    name="Net 槓桿"
                    stroke="var(--pos)"
                    dot={false}
                  />
                  <Line
                    isAnimationActive={animate}
                    dataKey="debtToNav"
                    name="負債 / NAV"
                    stroke="var(--warn)"
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </Card>

      {v.warnings.length > 0 && (
        <Card title="估值提示">
          <ul className="planned">
            {v.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
