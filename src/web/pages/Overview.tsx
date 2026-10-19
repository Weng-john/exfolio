import { Link } from 'react-router-dom';
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
  buildNotifications,
  CORE_BUCKET,
  demoData,
  leverageHistory,
  portfolioAlerts,
  today,
  UNCLASSIFIED_INDEX,
} from '@core/index';
import { Badge, Card, Empty, PageHeader, Stat } from '../components/ui';
import { fmtMoney, fmtPct, fmtX, signClass } from '../format';
import { loadDemo, replaceAll, useData, useStore } from '../store';
import { usePortfolio } from '../usePortfolio';
import { FundingNotice } from '../components/FundingEvidence';
import { Accordion, EmptyState } from '../components/Primitives';
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

      <div className="stats overview-stats">
        <Stat
          label="NAV 淨資產"
          value={fmtMoney(v.nav, base)}
          hint={`資產 ${fmtMoney(v.totalAssets, base)}`}
        />
        <Stat
          label="外部累積投入"
          value={fmtMoney(v.contributedCapital, base)}
          hint="含外部資金還款"
        />
        <Stat
          label="總損益"
          value={fmtMoney(v.totalPnl, base)}
          tone={v.totalPnl > 0 ? 'pos' : v.totalPnl < 0 ? 'neg' : undefined}
          hint={`未實現 ${fmtMoney(v.unrealizedPnl, base)}`}
        />
        <Stat
          label="Gross 曝險"
          value={fmtMoney(v.grossExposure, base)}
          hint={`槓桿 ${fmtX(v.grossLeverage)}`}
        />
        <Stat
          label="Net 曝險"
          value={fmtMoney(v.netExposure, base)}
          hint={`槓桿 ${fmtX(v.netLeverage)}`}
        />
        <Stat
          label="負債"
          value={fmtMoney(v.liabilities, base)}
          hint={`負債 / NAV ${fmtPct(v.debtToNav)}`}
        />
        <Stat label="現金" value={fmtMoney(v.cashValue, base)} hint="各帳戶正餘額合計" />
      </div>
      {(store.scratch || store.demo) && <Onboarding />}
      <FundingNotice transactions={data.transactions} />

      <Card title="風險警示">
        {alerts.length === 0 ? (
          <Empty>目前沒有警示。門檻可在 Settings 設定，僅供提醒，不限制任何操作。</Empty>
        ) : (
          <div className="table-wrap" role="region" aria-label="風險警示" tabIndex={0}>
            <table>
              <tbody>
                {alerts.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Badge tone={TONE[a.level]}>{a.title}</Badge>
                    </td>
                    <td style={{ whiteSpace: 'normal' }}>{a.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="所有通知">
        {notifications.length === 0 ? (
          <Empty>目前沒有通知。提醒門檻僅供資訊參考，不限制任何操作。</Empty>
        ) : (
          <div className="table-wrap" role="region" aria-label="所有通知" tabIndex={0}>
            <table>
              <tbody>
                {notifications.map((n) => (
                  <tr key={n.id}>
                    <td>
                      <Badge tone={TONE[n.level]}>{CATEGORY[n.category] ?? n.category}</Badge>
                    </td>
                    <td>
                      <strong>{n.title}</strong>
                    </td>
                    <td style={{ whiteSpace: 'normal' }}>{n.detail}</td>
                    <td>{n.dueDate ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

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
              <table>
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
              <table>
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
            <table>
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
