import { tradeStats, type RoundTrip } from '@core/index';
import { fmtMoney, fmtNum, fmtPct, signClass } from '../../format';

/** Closed-trade statistics: overall and per strategy. */
export default function StatsPanel(props: {
  trips: RoundTrip[];
  groups: { id: string; name: string }[];
  base: string;
}) {
  const { trips, groups, base } = props;
  const rows = [
    { id: 'all', name: '全部', stats: tradeStats(trips) },
    ...groups
      .map((g) => ({ ...g, stats: tradeStats(trips.filter((t) => t.strategyId === g.id)) }))
      .filter((r) => r.stats.count > 0),
  ];
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>範圍</th>
            <th className="num">筆數</th>
            <th className="num">勝率</th>
            <th className="num">平均獲利</th>
            <th className="num">平均虧損</th>
            <th className="num">Profit Factor</th>
            <th className="num">期望值</th>
            <th className="num">淨損益（{base}）</th>
            <th className="num">交易成本</th>
            <th className="num">平均持有天數</th>
            <th className="num">最大獲利</th>
            <th className="num">最大虧損</th>
            <th className="num">最大回撤</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ id, name, stats: s }) => (
            <tr key={id}>
              <td>{name}</td>
              <td className="num">{s.count}</td>
              <td className="num">{fmtPct(s.winRate, 0)}</td>
              <td className={`num ${signClass(s.averageWin)}`}>{fmtMoney(s.averageWin, base)}</td>
              <td className={`num ${signClass(s.averageLoss)}`}>{fmtMoney(s.averageLoss, base)}</td>
              <td
                className="num"
                title={
                  s.profitFactor === undefined && s.count ? '沒有虧損交易，無法計算' : undefined
                }
              >
                {fmtNum(s.profitFactor, 2)}
              </td>
              <td className={`num ${signClass(s.expectancy)}`}>{fmtMoney(s.expectancy, base)}</td>
              <td className={`num ${signClass(s.totalNetPnl)}`}>{fmtMoney(s.totalNetPnl, base)}</td>
              <td className="num">{fmtMoney(s.totalCosts, base)}</td>
              <td className="num">{fmtNum(s.averageHoldingDays, 1)}</td>
              <td className={`num ${signClass(s.largestWin)}`}>{fmtMoney(s.largestWin, base)}</td>
              <td className={`num ${signClass(s.largestLoss)}`}>{fmtMoney(s.largestLoss, base)}</td>
              <td className="num">{fmtMoney(s.maxDrawdown, base)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
