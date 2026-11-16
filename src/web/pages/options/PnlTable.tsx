import type { PnlGrid } from '@core/index';
import { fmtNum } from '../../format';

/**
 * Strategy P&L by underlying price (rows) and date (columns). Each cell is
 * tinted by the size of its gain or loss, softly: the number carries the
 * value, the tint only makes the shape readable at a glance.
 */
export function PnlTable(props: { grid: PnlGrid; spot: number }) {
  const { grid, spot } = props;
  if (!grid.rows.length) return null;
  const last = grid.days[grid.days.length - 1];
  const digits = spot < 10 ? 2 : spot < 1000 ? 1 : 0;
  // The row nearest the current price is marked, so "where am I now" is one look.
  const nearest = grid.rows.reduce((best, row) =>
    Math.abs(row.spot - spot) < Math.abs(best.spot - spot) ? row : best,
  ).spot;
  const tint = (v: number) => {
    if (!grid.maxAbs || Math.abs(v) < 0.5) return undefined;
    const alpha = 0.05 + (Math.abs(v) / grid.maxAbs) * 0.33;
    return `rgba(var(${v > 0 ? '--pos-rgb' : '--neg-rgb'}), ${alpha.toFixed(3)})`;
  };
  return (
    <div className="table-wrap" role="region" aria-label="損益表（可左右捲動）" tabIndex={0}>
      <table className="opt-grid">
        <caption className="sr-only">各標的價格與日期下的組合損益（模型估算）</caption>
        <thead>
          <tr>
            <th scope="col">標的價格</th>
            {grid.days.map((d) => (
              <th scope="col" key={d} className="num">
                {d === 0 ? '今天' : d === last ? `到期（${d} 天）` : `${d} 天後`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((row) => (
            <tr key={row.spot} className={row.spot === nearest ? 'at-spot' : undefined}>
              <th scope="row" className="num">
                {fmtNum(row.spot, digits)}
                {row.spot === nearest && <span className="opt-grid-now">現價附近</span>}
              </th>
              {row.pnl.map((v, i) => (
                <td key={grid.days[i]} className="num" style={{ background: tint(v) }}>
                  {v > 0 ? '+' : ''}
                  {fmtNum(v, 0)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
