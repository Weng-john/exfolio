import type { BucketSummary } from '@core/index';
import { fmtMoney, fmtPct, fmtX, signClass } from '../../format';

/** The four levels of spec 7.4: core, each strategy, all strategies, total. */
export default function SummaryTable(props: { rows: BucketSummary[]; base: string }) {
  const { rows, base } = props;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>層級</th>
            <th className="num">配置資金</th>
            <th className="num">權益</th>
            <th className="num">負債</th>
            <th className="num">損益</th>
            <th className="num">Gross</th>
            <th className="num">Net</th>
            <th className="num">Gross / 權益</th>
            <th className="num">Gross / NAV</th>
            <th className="num">佔 NAV</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={`${r.level}:${r.bucket}`}
              className={r.level === 'strategies' || r.level === 'total' ? 'str-level' : ''}
            >
              <td>{r.name}</td>
              <td className="num">{fmtMoney(r.capital, base)}</td>
              <td className="num">{fmtMoney(r.equity, base)}</td>
              <td className="num">{fmtMoney(r.loanLiability, base)}</td>
              <td className={`num ${signClass(r.totalPnl)}`}>{fmtMoney(r.totalPnl, base)}</td>
              <td className="num">{fmtMoney(r.grossExposure, base)}</td>
              <td className="num">{fmtMoney(r.netExposure, base)}</td>
              <td className="num">{fmtX(r.grossToEquity)}</td>
              <td className="num">{fmtX(r.grossToNav)}</td>
              <td className="num">{fmtPct(r.shareOfNav)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
