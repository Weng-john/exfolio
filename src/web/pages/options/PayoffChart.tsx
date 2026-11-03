import { useId } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CurvePoint } from '@core/index';
import { CHART_TOOLTIP, useChartMotion } from '../../components/chartTheme';
import { fmtNum } from '../../format';

/** Expiry P&L as a filled area (green above zero, red below) and the model P&L today as a line. */
export function PayoffChart(props: {
  curve: CurvePoint[];
  spot: number;
  breakevens: number[];
  showToday: boolean;
  todayLabel: string;
}) {
  const animate = useChartMotion();
  const gradient = useId().replace(/:/g, '');
  const values = props.curve.map((p) => p.expiry);
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  // Where zero sits in the area's vertical extent, for the two-colour fill.
  const zero = max === min ? 0.5 : max / (max - min);
  const digits = props.spot < 10 ? 2 : props.spot < 1000 ? 1 : 0;
  const xs = props.curve.map((p) => p.spot);
  const ticks = roundTicks(Math.min(...xs), Math.max(...xs));
  return (
    <div className="opt-chart">
      <ResponsiveContainer>
        <ComposedChart
          accessibilityLayer
          data={props.curve}
          margin={{ top: 16, right: 12, left: 4, bottom: 4 }}
        >
          <defs>
            <linearGradient id={`${gradient}-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset={0} stopColor="var(--success)" stopOpacity={0.32} />
              <stop offset={zero} stopColor="var(--success)" stopOpacity={0.06} />
              <stop offset={zero} stopColor="var(--danger)" stopOpacity={0.06} />
              <stop offset={1} stopColor="var(--danger)" stopOpacity={0.32} />
            </linearGradient>
            <linearGradient id={`${gradient}-line`} x1="0" y1="0" x2="0" y2="1">
              <stop offset={0} stopColor="var(--success-text)" />
              <stop offset={zero} stopColor="var(--success-text)" />
              <stop offset={zero} stopColor="var(--danger-text)" />
              <stop offset={1} stopColor="var(--danger-text)" />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="spot"
            type="number"
            domain={['dataMin', 'dataMax']}
            stroke="var(--muted)"
            fontSize={12}
            tickFormatter={(v: number) => fmtNum(v, digits)}
            ticks={ticks}
          />
          <YAxis
            stroke="var(--muted)"
            fontSize={12}
            width={72}
            tickFormatter={(v: number) => fmtNum(v, 0)}
          />
          <Tooltip
            contentStyle={CHART_TOOLTIP}
            labelFormatter={(v: number) => `標的價格 ${fmtNum(v, digits + 1)}`}
            formatter={(value: number, name: string) => [fmtNum(value, 0), name]}
          />
          <ReferenceLine y={0} stroke="var(--border-strong)" />
          <ReferenceLine
            x={props.spot}
            stroke="var(--accent)"
            strokeDasharray="4 4"
            label={{ value: '現價', position: 'top', fill: 'var(--accent-text)', fontSize: 12 }}
          />
          <Area
            isAnimationActive={animate}
            type="linear"
            dataKey="expiry"
            name="到期損益"
            stroke={`url(#${gradient}-line)`}
            strokeWidth={2.25}
            fill={`url(#${gradient}-fill)`}
            activeDot={{ r: 4 }}
          />
          {props.showToday && (
            <Line
              isAnimationActive={animate}
              type="monotone"
              dataKey="today"
              name={props.todayLabel}
              stroke="var(--chart-2)"
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={false}
            />
          )}
          {props.breakevens.map((x) => (
            <ReferenceDot
              key={x}
              x={x}
              y={0}
              r={5}
              fill="var(--surface)"
              stroke="var(--primary-text)"
              strokeWidth={2}
              ifOverflow="extendDomain"
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** About six round axis values inside [low, high], e.g. 80, 90, 100… */
function roundTicks(low: number, high: number): number[] {
  if (!(high > low)) return [];
  const raw = (high - low) / 6;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * pow >= raw)! * pow;
  const out: number[] = [];
  for (let v = Math.ceil(low / step) * step; v <= high + 1e-9; v += step)
    out.push(+v.toPrecision(12));
  return out;
}

/** Small payoff glyph for a template card: the expiry P&L shape only, no axes. */
export function PayoffGlyph(props: { values: number[] }) {
  const clip = `glyph${useId().replace(/:/g, '')}`;
  const w = 120;
  const h = 48;
  const max = Math.max(...props.values, 1e-9);
  const min = Math.min(...props.values, -1e-9);
  const y = (v: number) => h - 4 - ((v - min) / (max - min)) * (h - 8);
  const x = (i: number) => (i / (props.values.length - 1)) * w;
  const line = props.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const zero = y(0);
  return (
    <svg
      className="opt-glyph"
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      <line x1={0} x2={w} y1={zero} y2={zero} className="opt-glyph-zero" />
      <clipPath id={clip}>
        <rect x={0} y={0} width={w} height={zero} />
      </clipPath>
      <polyline points={line} className="opt-glyph-line" />
      <polyline points={line} className="opt-glyph-line up" clipPath={`url(#${clip})`} />
    </svg>
  );
}
