import type {
  CalendarReturnYear,
  DrawdownResult,
  IndexOverlap,
  LeverageAttribution,
  PnlContributionItem,
} from '@core/index';
import { fmtMoney, fmtPct, fmtX, signClass } from '../../format';

export function DrawdownTable(props: { report: DrawdownResult }) {
  const rows = props.report.drawdowns;
  if (!rows.length) return <p className="muted">沒有足夠的完整估值日計算回撤。</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>高點</th>
            <th>低點</th>
            <th className="num">深度</th>
            <th className="num">至低點天數</th>
            <th>復原日</th>
            <th className="num">復原天數</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr key={`${item.peakDate}|${item.troughDate}`}>
              <td>{item.peakDate}</td>
              <td>{item.troughDate}</td>
              <td className="num neg">{fmtPct(item.depth)}</td>
              <td className="num">{item.daysToTrough}</td>
              <td>{item.recoveryDate ?? '—'}</td>
              <td className="num">{item.daysToRecover ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CalendarTable(props: { rows: CalendarReturnYear[] }) {
  const months = Array.from({ length: 12 }, (_, index) => (index + 1).toString().padStart(2, '0'));
  if (!props.rows.length) return <p className="muted">沒有足夠的完整估值日計算月報酬。</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>年</th>
            {months.map((month) => (
              <th className="num" key={month}>
                {month}
              </th>
            ))}
            <th className="num">全年</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <tr key={row.year}>
              <td>{row.year}</td>
              {months.map((month) => (
                <td className={`num ${signClass(row.months[month])}`} key={month}>
                  {fmtPct(row.months[month])}
                </td>
              ))}
              <td className={`num ${signClass(row.total)}`}>{fmtPct(row.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AttributionTable(props: { value: LeverageAttribution }) {
  const values: Array<[string, number]> = [
    ['市場價格', props.value.marketMoves],
    ['外部資金', props.value.externalFlows],
    ['債務變動', props.value.debtChanges],
    ['交易', props.value.trading],
    ['殘差', props.value.residual],
  ];
  let running = props.value.start ?? 0;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>因素</th>
            <th className="num">槓桿變動</th>
            <th className="num">累計</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>起點</td>
            <td className="num">—</td>
            <td className="num">{fmtX(props.value.start)}</td>
          </tr>
          {values.map(([label, value]) => {
            running += value;
            return (
              <tr key={label}>
                <td>{label}</td>
                <td className={`num ${signClass(value)}`}>{fmtX(value)}</td>
                <td className="num">{fmtX(running)}</td>
              </tr>
            );
          })}
          <tr>
            <td>終點</td>
            <td className="num">{fmtX(props.value.totalChange)}</td>
            <td className="num">{fmtX(props.value.end)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function ContributionTable(props: {
  title: string;
  rows: PnlContributionItem[];
  currency: string;
}) {
  return (
    <div>
      <h3>{props.title}</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>項目</th>
              <th className="num">價格</th>
              <th className="num">已實現</th>
              <th className="num">股息</th>
              <th className="num">合計</th>
            </tr>
          </thead>
          <tbody>
            {props.rows.map((item) => (
              <tr key={item.id}>
                <td>{item.id}</td>
                <td className={`num ${signClass(item.priceEffect)}`}>
                  {fmtMoney(item.priceEffect, props.currency)}
                </td>
                <td className={`num ${signClass(item.realizedPnl)}`}>
                  {fmtMoney(item.realizedPnl, props.currency)}
                </td>
                <td className={`num ${signClass(item.dividends)}`}>
                  {fmtMoney(item.dividends, props.currency)}
                </td>
                <td className={`num ${signClass(item.total)}`}>
                  {fmtMoney(item.total, props.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ContributionTables(props: {
  byIndex: PnlContributionItem[];
  byPosition: PnlContributionItem[];
  currency: string;
  unexplained?: number;
}) {
  return (
    <div className="history-contributions">
      <ContributionTable title="依指數" rows={props.byIndex} currency={props.currency} />
      <ContributionTable title="依部位" rows={props.byPosition} currency={props.currency} />
      <p className="muted">
        未解釋差額（費用、融資、FX 或缺價）：{fmtMoney(props.unexplained, props.currency)}
      </p>
    </div>
  );
}

export function CorrelationTable(props: { report: IndexOverlap; names: Record<string, string> }) {
  if (!props.report.rows.length)
    return <p className="muted">尚無已持有指數的代表性未槓桿商品與足夠價格資料。</p>;
  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>指數</th>
              <th className="num">觀測數</th>
              {props.report.rows.map((row) => (
                <th className="num" key={row.indexId}>
                  {props.names[row.indexId] ?? row.indexId}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.report.rows.map((row) => (
              <tr key={row.indexId}>
                <td>{props.names[row.indexId] ?? row.indexId}</td>
                <td className="num">{row.observations}</td>
                {props.report.rows.map((other) => (
                  <td className="num" key={other.indexId}>
                    {row.correlations[other.indexId] === undefined
                      ? '—'
                      : row.correlations[other.indexId]!.toFixed(2)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">
        有效獨立押注：
        {props.report.effectiveIndependentBets === undefined
          ? '—'
          : props.report.effectiveIndependentBets.toFixed(2)}
        。{props.report.formula}
      </p>
    </>
  );
}
