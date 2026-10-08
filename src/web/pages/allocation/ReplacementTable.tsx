import type { CostKey, ReplacementAnalysis, ReplacementRow } from '@core/index';
import { fmtMoney, fmtNum, fmtPct, fmtX } from '../../format';
import { Badge, Empty } from '../../components/ui';

const COST_COLUMNS: Array<[CostKey, string]> = [
  ['expense', '內扣費用'],
  ['embeddedFinancing', '內含融資'],
  ['volatilityDrag', '波動耗損（近似）'],
  ['impliedFinancing', '隱含融資'],
  ['rollCost', '換月成本'],
  ['cashOffset', '現金收益抵減'],
];

function costCell(row: ReplacementRow, key: CostKey, base: string) {
  const c = row.holding.components.find((x) => x.key === key);
  if (!c) return <span className="muted">—</span>;
  if (!c.known) return <Badge tone="warn">未知</Badge>;
  return (
    <span title={c.assumption} className={c.annual < 0 ? 'rp-offset' : undefined}>
      {fmtMoney(c.annual, base)}
    </span>
  );
}

/** One row per instrument of the index; sorted by annual cost, never ranked "best". */
export function ReplacementTable(props: { analysis: ReplacementAnalysis }) {
  const { analysis: a } = props;
  const base = a.baseCurrency;
  if (!a.rows.length) return <Empty>此指數沒有可比較的商品，或曝險金額為 0。</Empty>;
  const hasFrom = a.rows.some((r) => r.isCurrent);
  return (
    <div className="table-wrap">
      <table className="rp-table">
        <thead>
          <tr>
            <th>商品</th>
            <th className="num">實際曝險／誤差</th>
            <th className="num">資金占用</th>
            {COST_COLUMNS.map(([k, label]) => (
              <th key={k} className="num">
                {label}
              </th>
            ))}
            <th className="num">年成本合計</th>
            <th className="num">轉換成本</th>
            <th className="num">回本期</th>
            <th>備註與限制</th>
          </tr>
        </thead>
        <tbody>
          {a.rows.map((r) => {
            const e = r.efficiency;
            return (
              <tr key={r.instrumentId} className={r.isCurrent ? 'rp-current' : undefined}>
                <td>
                  {r.symbol}
                  {r.leverage !== 1 && <span className="muted"> {fmtX(r.leverage)}</span>}
                  {r.isCurrent && <Badge tone="info">目前持有</Badge>}
                  <span className="rp-sub">{r.name}</span>
                </td>
                <td className="num">
                  {fmtMoney(e.exposure, base)}
                  <span className="rp-sub">
                    {e.exposureError !== undefined
                      ? `誤差 ${fmtMoney(e.exposureError, base)}（${fmtPct(e.errorPct, 2)}）`
                      : '—'}
                    {e.quantity !== undefined && ` · 數量 ${fmtNum(e.quantity, 4)}`}
                  </span>
                </td>
                <td className="num">
                  {e.capital === undefined ? (
                    <Badge tone="warn">未知</Badge>
                  ) : (
                    fmtMoney(e.capital, base)
                  )}
                  <span className="rp-sub">
                    {e.isMargin ? '原始保證金' : '買入成本'}
                    {e.freeCashVsUnleveraged !== undefined &&
                      ` · 釋出 ${fmtMoney(e.freeCashVsUnleveraged, base)}`}
                  </span>
                </td>
                {COST_COLUMNS.map(([k]) => (
                  <td key={k} className="num">
                    {costCell(r, k, base)}
                  </td>
                ))}
                <td className="num">
                  <strong>{fmtMoney(r.holding.totalAnnual, base)}</strong>
                  <span className="rp-sub">
                    {fmtPct(r.holding.totalAnnual / a.exposure, 2)} / 年
                  </span>
                </td>
                <td className="num">{r.switching ? fmtMoney(r.switching.total, base) : '—'}</td>
                <td className="num">
                  {r.breakEvenYears !== undefined
                    ? `${fmtNum(r.breakEvenYears, 2)} 年`
                    : r.switching
                      ? '無節省'
                      : '—'}
                </td>
                <td>
                  <ul className="rp-notes">
                    {r.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!hasFrom && <p className="muted">選擇「要替換的現有商品」後，才會計算轉換成本與回本期。</p>}
    </div>
  );
}
