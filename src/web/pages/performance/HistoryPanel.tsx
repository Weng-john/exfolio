import { useMemo } from 'react';
import {
  calendarReturns,
  drawdownTable,
  historyFlows,
  indexOverlap,
  leverageAttribution,
  pnlContribution,
  reconstructHistory,
} from '@core/index';
import { Card, Empty } from '../../components/ui';
import { useData } from '../../store';
import {
  AttributionTable,
  CalendarTable,
  ContributionTables,
  CorrelationTable,
  DrawdownTable,
} from './HistoryTables';
import { ExposureChart, LeverageChart, NavChart, UnderwaterChart } from './HistoryCharts';
import './historyAnalytics.css';

export function HistoryPanel(props: { from: string; to: string; today: string }) {
  const data = useData();
  const result = useMemo(
    () => reconstructHistory(data, props.from, props.to, props.today),
    [data, props.from, props.to, props.today],
  );
  const flows = useMemo(
    () => historyFlows(data, props.from, props.to),
    [data, props.from, props.to],
  );
  const drawdowns = useMemo(() => drawdownTable(result.rows, flows, 5), [result.rows, flows]);
  const calendar = useMemo(() => calendarReturns(result.rows, flows), [result.rows, flows]);
  const attribution = useMemo(() => leverageAttribution(result.rows, flows), [result.rows, flows]);
  const contributions = useMemo(
    () => pnlContribution(data, result.rows, flows),
    [data, result.rows, flows],
  );
  const overlap = useMemo(() => indexOverlap(data, result.rows), [data, result.rows]);
  const names = useMemo(
    () => Object.fromEntries(data.indices.map((index) => [index.id, index.name])),
    [data.indices],
  );
  const incomplete = result.rows.filter((row) => row.incomplete);
  if (!result.rows.length)
    return (
      <Card title="歷史分析">
        <Empty>此期間沒有交易日或歷史收盤價。</Empty>
      </Card>
    );
  return (
    <section className="history-panel">
      <Card title="歷史分析">
        <p className="muted">每日收盤重建 NAV、曝險與槓桿；統計只使用完整估值日。</p>
        <div className="history-grid">
          <div>
            <h3>NAV 與累積投入</h3>
            <NavChart rows={result.rows} currency={data.settings[0]?.baseCurrency ?? 'TWD'} />
          </div>
          <div>
            <h3>槓桿與負債</h3>
            <LeverageChart rows={result.rows} />
          </div>
        </div>
        <h3>各指數淨曝險</h3>
        <ExposureChart rows={result.rows} indexNames={names} />
      </Card>
      <Card title="回撤">
        <UnderwaterChart index={drawdowns.index} />
        <DrawdownTable report={drawdowns} />
        {drawdowns.current && (
          <p className="muted">
            目前回撤尚未復原：{drawdowns.current.peakDate} 高點至 {drawdowns.current.troughDate}{' '}
            低點。
          </p>
        )}
      </Card>
      <Card title="月曆報酬">
        <CalendarTable rows={calendar} />
      </Card>
      <Card title="槓桿歸因">
        <AttributionTable value={attribution} />
        <p className="muted">
          內部借還款同時改變現金與債務，直接槓桿效果為 0；外部還款歸入外部資金。
        </p>
      </Card>
      <Card title="P&L 貢獻">
        <ContributionTables {...contributions} currency={data.settings[0]?.baseCurrency ?? 'TWD'} />
      </Card>
      <Card title="指數重疊">
        <CorrelationTable report={overlap} names={names} />
        <p className="muted">高度相關指數的曝險相加，不代表同樣多的獨立風險來源。</p>
      </Card>
      {(incomplete.length > 0 || result.notes.length > 0) && (
        <Card title="資料完整性">
          <p className="notice">缺價日期不以成本價替代，且已自統計排除。</p>
          {incomplete.length > 0 && (
            <ul className="history-missing">
              {incomplete.map((item) => (
                <li key={item.date}>
                  {item.date}：
                  {item.missing
                    .map(
                      (id) =>
                        data.instruments.find((instrument) => instrument.id === id)?.symbol ?? id,
                    )
                    .join('、')}
                </li>
              ))}
            </ul>
          )}
          <ul className="history-notes">
            {result.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}
