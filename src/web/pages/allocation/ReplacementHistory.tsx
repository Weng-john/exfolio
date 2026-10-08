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
import { historicalComparison, today, type AppData, type ID, type Instrument } from '@core/index';
import { Badge, Empty, Field } from '../../components/ui';
import { fmtNum, fmtPct } from '../../format';
import { syncPriceHistory } from '../../history';

const TOOLTIP = {
  background: 'var(--panel)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
};

function yearAgo(day: string) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

/** Realised history of a chosen pair. Describes the past only. */
export function ReplacementHistory(props: {
  data: AppData;
  instruments: Instrument[];
  defaultBase?: ID;
}) {
  const { data, instruments } = props;
  const [baseId, setBaseId] = useState(props.defaultBase ?? '');
  const [candId, setCandId] = useState('');
  const [from, setFrom] = useState(() => yearAgo(today()));
  const [to, setTo] = useState(() => today());
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const b = instruments.find((i) => i.id === baseId) ?? instruments[0];
  const c =
    instruments.find((i) => i.id === candId && i.id !== b?.id) ??
    instruments.find((i) => i.id !== b?.id);
  const cmp = useMemo(
    () => (b && c ? historicalComparison(data, b.id, c.id, from, to) : undefined),
    [data, b, c, from, to],
  );

  const download = async () => {
    if (!b || !c) return;
    setBusy(true);
    setMessage('');
    const res = await syncPriceHistory([b.id, c.id], from);
    setBusy(false);
    setMessage(
      res.errors.length
        ? `新增 ${res.added} 筆；${res.errors.join('；')}`
        : `已下載，新增 ${res.added} 筆`,
    );
  };

  if (instruments.length < 2) return <Empty>此指數少於 2 個商品，無法比較。</Empty>;
  const label = (i: Instrument) => `${i.symbol}${i.leverage !== 1 ? `（${i.leverage}×）` : ''}`;
  const chart = (cmp?.series ?? []).map((p) => ({
    date: p.date,
    base: p.base * 100,
    candidate: p.candidate * 100,
    naive: p.naive === undefined ? undefined : p.naive * 100,
  }));
  const pct = (v?: number) => fmtPct(v, 2);

  return (
    <>
      <div className="rp-controls">
        <Field label="基準商品">
          <select value={b?.id} onChange={(e) => setBaseId(e.target.value)}>
            {instruments.map((i) => (
              <option key={i.id} value={i.id}>
                {label(i)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="比較商品">
          <select value={c?.id} onChange={(e) => setCandId(e.target.value)}>
            {instruments
              .filter((i) => i.id !== b?.id)
              .map((i) => (
                <option key={i.id} value={i.id}>
                  {label(i)}
                </option>
              ))}
          </select>
        </Field>
        <Field label="起日">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="迄日">
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <button onClick={download} disabled={busy}>
          {busy ? '下載中…' : '下載歷史價格'}
        </button>
      </div>
      {message && <p className="muted">{message}</p>}

      {cmp && cmp.daysUsed >= 2 && cmp.base && cmp.candidate ? (
        <>
          <div className="table-wrap">
            <table className="rp-table">
              <thead>
                <tr>
                  <th />
                  <th className="num">區間報酬</th>
                  <th className="num">年化波動度</th>
                  <th className="num">最大回撤</th>
                </tr>
              </thead>
              <tbody>
                {[
                  [b, cmp.base],
                  [c, cmp.candidate],
                ].map(([i, s]) => (
                  <tr key={(i as Instrument).id}>
                    <td>{label(i as Instrument)}</td>
                    <td className="num">{pct((s as typeof cmp.base)!.totalReturn)}</td>
                    <td className="num">{pct((s as typeof cmp.base)!.volatility)}</td>
                    <td className="num">{pct((s as typeof cmp.base)!.maxDrawdown)}</td>
                  </tr>
                ))}
                {cmp.naive && (
                  <tr>
                    <td>
                      單純 {fmtNum(cmp.naive.ratio, 2)}× 基準報酬
                      <span className="rp-sub">基準區間報酬 × 倍數</span>
                    </td>
                    <td className="num">{pct(cmp.naive.naiveReturn)}</td>
                    <td className="num" colSpan={2}>
                      實際與單純倍數差距 {pct(cmp.naive.realisedGap)}（追蹤誤差、耗損與費用）
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="muted">
            使用共同日期 {cmp.daysUsed} 天（{cmp.firstDate} ～ {cmp.lastDate}）· 日報酬相關係數{' '}
            {fmtNum(cmp.correlation, 3)}
          </p>
          <div className="rp-chart">
            <ResponsiveContainer>
              <LineChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" stroke="var(--muted)" fontSize={12} />
                <YAxis
                  stroke="var(--muted)"
                  fontSize={12}
                  tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
                />
                <Tooltip formatter={(v: number) => `${v.toFixed(2)}%`} contentStyle={TOOLTIP} />
                <Legend />
                <Line
                  dataKey="base"
                  name={b ? label(b) : '基準'}
                  stroke="var(--muted)"
                  dot={false}
                />
                <Line
                  dataKey="candidate"
                  name={c ? label(c) : '比較'}
                  stroke="var(--accent)"
                  dot={false}
                />
                {cmp.naive && (
                  <Line
                    dataKey="naive"
                    name={`單純 ${fmtNum(cmp.naive.ratio, 2)}× 基準`}
                    stroke="var(--warn)"
                    strokeDasharray="5 4"
                    dot={false}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      ) : (
        <Empty>此區間共同價格不足（至少 2 天）。請先按「下載歷史價格」，或自行匯入。</Empty>
      )}
      {cmp && cmp.missing.length > 0 && (
        <details>
          <summary>
            <Badge tone="warn">缺資料 {cmp.missing.length}</Badge>{' '}
            不同日期的價格不會內插，僅使用共同日期
          </summary>
          <ul className="rp-notes">
            {cmp.missing.slice(0, 50).map((m, i) => (
              <li key={i}>
                {data.instruments.find((x) => x.id === m.instrumentId)?.symbol ?? m.instrumentId}
                {m.date ? ` ${m.date}` : ''}：{m.reason}
              </li>
            ))}
            {cmp.missing.length > 50 && <li>…另有 {cmp.missing.length - 50} 筆</li>}
          </ul>
        </details>
      )}
      {cmp?.warnings.map((w, i) => (
        <p key={i} className="muted">
          {w}
        </p>
      ))}
    </>
  );
}
