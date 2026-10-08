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
import { performanceLevels, pnlBreakdown, positionPerformance, today } from '@core/index';
import { Badge, Card, Empty, Field, PageHeader } from '../components/ui';
import { fmtMoney, fmtPct, signClass } from '../format';
import { syncPriceHistory } from '../history';
import { useData } from '../store';
import { usePortfolio } from '../usePortfolio';
import { HistoryPanel } from './performance/HistoryPanel';
import './performance/performance.css';

type WindowChoice = 'ytd' | '1m' | '3m' | '6m' | '1y' | 'inception' | 'custom';
const TOOLTIP = {
  background: 'var(--panel)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
};

function shiftMonths(day: string, months: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - months);
  return date.toISOString().slice(0, 10);
}

function shortAnnualised(short: boolean) {
  return short ? <Badge tone="warn">短期年化，易失真</Badge> : null;
}

export default function PerformancePage() {
  const data = useData();
  const { ledger, valuation } = usePortfolio();
  const day = today();
  const inception = [...data.transactions.map((tx) => tx.date)].sort()[0] ?? day;
  const [windowChoice, setWindowChoice] = useState<WindowChoice>('ytd');
  const [customFrom, setCustomFrom] = useState(inception);
  const [customTo, setCustomTo] = useState(day);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string>();
  const { from, to } = useMemo(() => {
    if (windowChoice === 'custom') return { from: customFrom, to: customTo };
    if (windowChoice === 'inception') return { from: inception, to: day };
    if (windowChoice === 'ytd') return { from: `${day.slice(0, 4)}-01-01`, to: day };
    return { from: shiftMonths(day, Number(windowChoice.slice(0, -1))), to: day };
  }, [customFrom, customTo, day, inception, windowChoice]);
  const levels = useMemo(() => performanceLevels(data, from, to, day), [data, from, to, day]);
  const positions = useMemo(
    () =>
      ledger.positions
        .filter((position) => position.quantity !== 0)
        .map((position) => positionPerformance(data, position.key, day))
        .filter((position): position is NonNullable<typeof position> => position !== undefined),
    [data, day, ledger.positions],
  );
  const totalPnl = useMemo(() => pnlBreakdown(data, 'total', from, to, day), [data, from, to, day]);
  const missing = useMemo(() => {
    const rows = levels.flatMap((level) => [
      ...level.twr.missing,
      ...level.mwr.missing,
      ...(level.benchmark?.missing ?? []),
    ]);
    return rows.filter(
      (row, index) =>
        rows.findIndex(
          (item) => item.instrumentId === row.instrumentId && item.date === row.date,
        ) === index,
    );
  }, [levels]);
  const chartLevel = levels.find((level) => level.benchmark?.instrumentId);
  const chartData = useMemo(() => {
    if (!chartLevel?.benchmark) return [];
    const id = chartLevel.benchmark.instrumentId;
    const pointAt = (date: string) =>
      data.priceHistory
        .filter((point) => point.instrumentId === id && point.date <= date)
        .sort((a, b) => b.date.localeCompare(a.date))[0];
    const startPoint = pointAt(from);
    const start = startPoint?.adjClose ?? startPoint?.close;
    let cumulative = 1;
    return chartLevel.twr.periods.map((period) => {
      if (period.return !== undefined) cumulative *= 1 + period.return;
      const point = pointAt(period.to);
      const price = point?.adjClose ?? point?.close;
      return {
        date: period.to,
        twr: (cumulative - 1) * 100,
        benchmark: start && price ? (price / start - 1) * 100 : undefined,
      };
    });
  }, [chartLevel, data.priceHistory, from]);

  const downloadHistory = async () => {
    const held = ledger.positions
      .filter((position) => position.quantity !== 0)
      .map((position) => position.instrumentId);
    const benchmarks = data.strategies.flatMap((strategy) =>
      strategy.benchmarkInstrumentId
        ? [strategy.benchmarkInstrumentId]
        : data.instruments
            .filter(
              (instrument) =>
                instrument.indexId === strategy.benchmarkIndexId && instrument.leverage === 1,
            )
            .slice(0, 1)
            .map((instrument) => instrument.id),
    );
    setSyncing(true);
    const result = await syncPriceHistory([...new Set([...held, ...benchmarks])], from);
    setSyncing(false);
    setSyncMessage(
      `已新增 ${result.added} 筆歷史價格${result.errors.length ? `；${result.errors.join('；')}` : ''}`,
    );
  };

  return (
    <>
      <PageHeader
        title="Performance Analytics"
        subtitle="以 TWR 為主、XIRR 為輔；外部資金流與內部轉帳依範圍分開處理"
        actions={
          <button className="primary" disabled={syncing} onClick={() => void downloadHistory()}>
            {syncing ? '下載中…' : '下載歷史價格'}
          </button>
        }
      />
      <Card title="期間與資料">
        <div className="performance-toolbar">
          <Field label="分析期間">
            <select
              value={windowChoice}
              onChange={(event) => setWindowChoice(event.target.value as WindowChoice)}
            >
              <option value="ytd">YTD</option>
              <option value="1m">1M</option>
              <option value="3m">3M</option>
              <option value="6m">6M</option>
              <option value="1y">1Y</option>
              <option value="inception">自成立以來</option>
              <option value="custom">自訂</option>
            </select>
          </Field>
          {windowChoice === 'custom' && (
            <>
              <Field label="起日">
                <input
                  type="date"
                  value={customFrom}
                  max={customTo}
                  onChange={(event) => setCustomFrom(event.target.value)}
                />
              </Field>
              <Field label="迄日">
                <input
                  type="date"
                  value={customTo}
                  min={customFrom}
                  max={day}
                  onChange={(event) => setCustomTo(event.target.value)}
                />
              </Field>
            </>
          )}
          <span className="muted">
            {from} ～ {to} · 所有金額以 {valuation.baseCurrency} 計
          </span>
        </div>
        {syncMessage && <p className="performance-sync-message">{syncMessage}</p>}
        <p className="muted">
          下載會涵蓋目前持有商品與策略基準；手動報價商品需自行輸入或匯入歷史價格。
        </p>
      </Card>
      <HistoryPanel from={from} to={to} today={day} />
      {missing.length > 0 && (
        <Card title="歷史價格缺漏">
          <p className="notice">
            下列價格缺漏，依賴它們的結果不完整，系統沒有以成本或猜測價格替代。
          </p>
          <ul className="performance-missing">
            {missing.map((row) => (
              <li key={`${row.instrumentId}|${row.date}`}>
                {data.instruments.find((instrument) => instrument.id === row.instrumentId)
                  ?.symbol ?? row.instrumentId}{' '}
                · {row.date}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title="四層級比較">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>層級</th>
                <th className="num">累積 TWR</th>
                <th className="num">年化 TWR</th>
                <th className="num">XIRR</th>
                <th className="num">最大回撤</th>
                <th className="num">年化波動率</th>
                <th className="num">報酬 / 波動</th>
                <th className="num">Benchmark</th>
                <th className="num">超額報酬</th>
              </tr>
            </thead>
            <tbody>
              {levels.map((level) => (
                <tr key={level.id}>
                  <td>
                    {level.label}{' '}
                    {level.twr.undefinedPeriods && <Badge tone="warn">起始淨值非正</Badge>}
                  </td>
                  <td className={`num ${signClass(level.twr.cumulative)}`}>
                    {fmtPct(level.twr.cumulative)}
                  </td>
                  <td className="num">
                    {fmtPct(level.twr.annualized)} {shortAnnualised(level.twr.shortPeriod)}
                  </td>
                  <td className="num">
                    {fmtPct(level.mwr.xirr)} {shortAnnualised(level.twr.shortPeriod)}
                  </td>
                  <td className="num">{fmtPct(level.risk.maxDrawdown)}</td>
                  <td className="num">{fmtPct(level.risk.volatility)}</td>
                  <td className="num">
                    {level.risk.riskAdjusted === undefined
                      ? '—'
                      : level.risk.riskAdjusted.toFixed(2)}
                  </td>
                  <td className="num">{fmtPct(level.benchmark?.flowMatched.twr)}</td>
                  <td className={`num ${signClass(level.excessReturn)}`}>
                    {fmtPct(level.excessReturn)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted">
          波動率使用可得估值日期的日報酬、以 252 日年化；「報酬 / 波動」是簡易風險調整比率，不是
          Sharpe ratio。
        </p>
      </Card>
      <div className="grid">
        <Card title="P&L 拆解">
          <table>
            <tbody>
              {[
                ['已實現', totalPnl.realized],
                ['未實現', totalPnl.unrealized],
                ['股息', totalPnl.dividends],
                ['費用與稅', -totalPnl.feesAndTaxes],
                ['融資成本', -totalPnl.fundingCost],
                ['Gross（融資前）', totalPnl.gross],
                ['Net（融資後）', totalPnl.net],
              ].map(([label, value]) => (
                <tr key={label as string}>
                  <td>{label}</td>
                  <td className={`num ${signClass(value as number)}`}>
                    {fmtMoney(value as number, valuation.baseCurrency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">{totalPnl.notes[0]}</p>
        </Card>
        <Card title="累積 TWR 與 Benchmark">
          {chartData.length < 2 ? (
            <Empty>尚無具基準的策略或足夠歷史價格可繪圖。</Empty>
          ) : (
            <div className="performance-chart">
              <ResponsiveContainer>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" stroke="var(--muted)" fontSize={12} />
                  <YAxis
                    stroke="var(--muted)"
                    fontSize={12}
                    tickFormatter={(value) => `${value}%`}
                  />
                  <Tooltip
                    formatter={(value: number) => `${value.toFixed(1)}%`}
                    contentStyle={TOOLTIP}
                  />
                  <Legend />
                  <Line
                    dataKey="twr"
                    name={chartLevel?.label ?? 'TWR'}
                    stroke="var(--accent)"
                    dot={false}
                  />
                  <Line dataKey="benchmark" name="Benchmark" stroke="var(--muted)" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>
      <Card title="各部位績效">
        {!positions.length ? (
          <Empty>沒有持倉。</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>商品</th>
                  <th className="num">目前價值</th>
                  <th className="num">成本</th>
                  <th className="num">P&L</th>
                  <th className="num">累積報酬</th>
                  <th className="num">年化 TWR</th>
                  <th className="num">XIRR</th>
                  <th className="num">持有天數</th>
                  <th className="num">Benchmark</th>
                  <th className="num">超額</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((position) => (
                  <tr key={position.positionKey}>
                    <td>
                      {
                        data.instruments.find(
                          (instrument) => instrument.id === position.instrumentId,
                        )?.symbol
                      }
                      {position.derivativePnlPerAverageNotional !== undefined && (
                        <span className="performance-subline">
                          名目標準化 P&L {fmtPct(position.derivativePnlPerAverageNotional)}
                        </span>
                      )}
                    </td>
                    <td className="num">
                      {fmtMoney(position.currentValue, valuation.baseCurrency)}
                    </td>
                    <td className="num">{fmtMoney(position.cost, valuation.baseCurrency)}</td>
                    <td className={`num ${signClass(position.pnl)}`}>
                      {fmtMoney(position.pnl, valuation.baseCurrency)}
                    </td>
                    <td className="num">{fmtPct(position.cumulativeReturn)}</td>
                    <td className="num">
                      {fmtPct(position.twr.annualized)} {shortAnnualised(position.twr.shortPeriod)}
                    </td>
                    <td className="num">{fmtPct(position.mwr.xirr)}</td>
                    <td className="num">{position.holdingDays}</td>
                    <td className="num">{fmtPct(position.benchmark?.flowMatched.twr)}</td>
                    <td className="num">{fmtPct(position.excessReturn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted">
          期貨不把名目價值當投入本金；沒有明確策略權益帳本時，TWR 顯示為 —，另列名目曝險標準化 P&L。
        </p>
      </Card>
    </>
  );
}
