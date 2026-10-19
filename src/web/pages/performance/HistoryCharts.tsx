import { CHART_TOOLTIP, useChartMotion } from '../../components/chartTheme';
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
import type { HistoryRow, IndexedHistoryPoint } from '@core/index';
import { fmtMoney, fmtPct, fmtX } from '../../format';

const COLOURS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--neg)',
  'var(--muted)',
];

function percent(value: number) {
  return fmtPct(value / 100);
}

export function NavChart(props: { rows: HistoryRow[]; currency: string }) {
  const animate = useChartMotion();
  return (
    <div className="history-chart">
      <ResponsiveContainer>
        <LineChart accessibilityLayer data={props.rows}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="date" stroke="var(--muted)" fontSize={12} />
          <YAxis
            stroke="var(--muted)"
            fontSize={12}
            tickFormatter={(value) => fmtMoney(value, props.currency)}
          />
          <Tooltip
            formatter={(value: number) => fmtMoney(value, props.currency)}
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
            stroke="var(--muted)"
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function LeverageChart(props: { rows: HistoryRow[] }) {
  const animate = useChartMotion();
  const data = props.rows.map((row) => ({
    ...row,
    gross: row.grossLeverage === undefined ? undefined : row.grossLeverage * 100,
    net: row.netLeverage === undefined ? undefined : row.netLeverage * 100,
    debt: row.debtToNav === undefined ? undefined : row.debtToNav * 100,
  }));
  return (
    <div className="history-chart">
      <ResponsiveContainer>
        <LineChart accessibilityLayer data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="date" stroke="var(--muted)" fontSize={12} />
          <YAxis stroke="var(--muted)" fontSize={12} tickFormatter={percent} />
          <Tooltip formatter={(value: number) => fmtX(value / 100)} contentStyle={CHART_TOOLTIP} />
          <Legend />
          <Line
            isAnimationActive={animate}
            dataKey="gross"
            name="Gross 槓桿"
            stroke="var(--chart-1)"
            dot={false}
          />
          <Line
            isAnimationActive={animate}
            dataKey="net"
            name="Net 槓桿"
            stroke="var(--chart-2)"
            strokeDasharray="5 4"
            dot={false}
          />
          <Line
            isAnimationActive={animate}
            dataKey="debt"
            name="Debt / NAV"
            stroke="var(--warn)"
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ExposureChart(props: { rows: HistoryRow[]; indexNames: Record<string, string> }) {
  const animate = useChartMotion();
  const ids = [...new Set(props.rows.flatMap((row) => Object.keys(row.netExposureByIndex)))];
  const data = props.rows.map((row) => ({ ...row.netExposureByIndex, date: row.date }));
  if (!ids.length) return <p className="muted">此期間沒有可分類的指數曝險。</p>;
  return (
    <div className="history-chart">
      <ResponsiveContainer>
        <AreaChart accessibilityLayer data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="date" stroke="var(--muted)" fontSize={12} />
          <YAxis stroke="var(--muted)" fontSize={12} />
          <Tooltip contentStyle={CHART_TOOLTIP} />
          <Legend />
          {ids.map((id, index) => (
            <Area
              isAnimationActive={animate}
              key={id}
              dataKey={id}
              name={props.indexNames[id] ?? id}
              stackId="exposure"
              stroke={COLOURS[index % COLOURS.length]}
              fill={COLOURS[index % COLOURS.length]}
              fillOpacity={0.65}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function UnderwaterChart(props: { index: IndexedHistoryPoint[] }) {
  const animate = useChartMotion();
  let high = 1;
  const data = props.index.map((point) => {
    high = Math.max(high, point.index);
    return { date: point.date, underwater: (point.index / high - 1) * 100 };
  });
  return (
    <div className="history-chart">
      <ResponsiveContainer>
        <AreaChart accessibilityLayer data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="date" stroke="var(--muted)" fontSize={12} />
          <YAxis stroke="var(--muted)" fontSize={12} tickFormatter={percent} />
          <Tooltip
            formatter={(value: number) => fmtPct(value / 100)}
            contentStyle={CHART_TOOLTIP}
          />
          <Area
            isAnimationActive={animate}
            dataKey="underwater"
            name="回撤"
            stroke="var(--neg)"
            fill="var(--neg)"
            fillOpacity={0.55}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
