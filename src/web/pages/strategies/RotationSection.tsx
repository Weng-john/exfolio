import { useMemo, useState } from 'react';
import {
  makePriceLookup,
  newId,
  rotationCycleReport,
  summarizeRotationCycles,
  type RotationCycle,
  type Strategy,
} from '@core/index';
import { Badge, Card, Empty, Field, Stat } from '../../components/ui';
import { fmtMoney, fmtNum, fmtPct, signClass } from '../../format';
import { upsertRow, useData } from '../../store';
import { symbolOf, today } from './shared';

/** Rotation cycles of one strategy: create / close, and compare each with its "did not rotate" benchmark. */
export default function RotationSection(props: { strategy: Strategy; base: string }) {
  const { strategy, base } = props;
  const data = useData();
  const cycles = data.rotationCycles.filter((c) => c.strategyId === strategy.id);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [bench, setBench] = useState(strategy.benchmarkInstrumentId ?? '');
  const [reason, setReason] = useState('');
  const [openedAt, setOpenedAt] = useState(today());

  const lookup = useMemo(() => makePriceLookup(data), [data]);
  const reports = useMemo(
    () => cycles.map((c) => ({ cycle: c, report: rotationCycleReport(data, c, lookup) })),
    [data, cycles, lookup],
  );
  const series = useMemo(() => summarizeRotationCycles(reports.map((r) => r.report)), [reports]);
  const sym = (id?: string) => symbolOf(data, id);

  const create = () => {
    if (!name.trim() || !from || !to) return;
    const row: RotationCycle = {
      id: newId('rot'),
      strategyId: strategy.id,
      name: name.trim(),
      fromInstrumentId: from,
      toInstrumentId: to,
      benchmarkInstrumentId: bench || from,
      status: 'open',
      openedAt,
    };
    if (reason.trim()) row.reason = reason.trim();
    upsertRow('rotationCycles', row);
    setAdding(false);
    setName('');
    setReason('');
  };

  const close = (c: RotationCycle) => upsertRow('rotationCycles', { ...c, status: 'closed', closedAt: today() });
  const reopen = (c: RotationCycle) => {
    const { closedAt: _closedAt, ...rest } = c;
    upsertRow('rotationCycles', { ...rest, status: 'open' });
  };

  const instrumentSelect = (value: string, set: (v: string) => void, empty = '請選擇') => (
    <select value={value} onChange={(e) => set(e.target.value)}>
      <option value="">{empty}</option>
      {data.instruments.map((i) => (
        <option key={i.id} value={i.id}>
          {i.symbol} {i.name}
        </option>
      ))}
    </select>
  );

  const missingAll = reports.flatMap((r) => r.report.missing);

  return (
    <Card
      title="輪動週期（rotation cycle）"
      actions={
        <button onClick={() => setAdding((v) => !v)}>{adding ? '取消' : '新增週期'}</button>
      }
    >
      <p className="str-note">
        把切出、替代持有、切回的交易在 Trade Journal 掛上同一個週期。報告比較「實際輪動」與「沒有輪動、一直持有基準商品」，
        兩邊使用相同起始資金與相同的外部資金流（標記為此週期的入出金與策略資金撥入撥出）。
      </p>
      {adding && (
        <div className="str-inline" style={{ marginBottom: 12 }}>
          <Field label="週期名稱">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：2026-03 SSO→QLD" />
          </Field>
          <Field label="切出商品">{instrumentSelect(from, setFrom)}</Field>
          <Field label="替代持有商品">{instrumentSelect(to, setTo)}</Field>
          <Field label="基準商品（不輪動時持有）" hint="未選則用切出商品">
            {instrumentSelect(bench, setBench, '同切出商品')}
          </Field>
          <Field label="開始日">
            <input type="date" value={openedAt} onChange={(e) => setOpenedAt(e.target.value)} />
          </Field>
          <Field label="決策理由（選填）">
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <button className="primary" onClick={create} disabled={!name.trim() || !from || !to}>
            建立
          </button>
        </div>
      )}

      {series.cycles > 0 && (
        <div className="stats">
          <Stat label="週期數" value={series.cycles} hint={`${series.comparable} 個可比較基準`} />
          <Stat label={`累積損益（${base}）`} value={fmtMoney(series.cumulativePnl, base)} tone={series.cumulativePnl > 0 ? 'pos' : series.cumulativePnl < 0 ? 'neg' : undefined} />
          <Stat label="累積報酬（複利）" value={fmtPct(series.cumulativeReturn)} hint={`基準 ${fmtPct(series.cumulativeBenchmarkReturn)}`} />
          <Stat label="勝過基準比例" value={fmtPct(series.beatShare, 0)} />
          <Stat label="週期序列最大回撤" value={fmtPct(series.maxDrawdown)} />
        </div>
      )}

      {!cycles.length ? (
        <Empty>這個策略還沒有輪動週期</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>週期</th>
                <th>狀態</th>
                <th>期間</th>
                <th className="num">天數</th>
                <th>切出 → 替代</th>
                <th>基準</th>
                <th className="num">起始資金</th>
                <th className="num">交易成本</th>
                <th className="num">實際報酬</th>
                <th className="num">基準報酬</th>
                <th className="num">超額（百分點）</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {reports.map(({ cycle: c, report: r }) => (
                <tr key={c.id}>
                  <td title={c.reason}>{c.name}</td>
                  <td>
                    <Badge tone={c.status === 'open' ? 'ok' : 'info'}>{c.status === 'open' ? '進行中' : '已結束'}</Badge>
                  </td>
                  <td>{r.startDate ? `${r.startDate} ~ ${r.endDate}` : '尚無交易'}</td>
                  <td className="num">{r.holdingDays ?? '—'}</td>
                  <td>
                    {sym(c.fromInstrumentId)} → {sym(c.toInstrumentId)}
                  </td>
                  <td>{sym(c.benchmarkInstrumentId)}</td>
                  <td className="num">{fmtMoney(r.startCapital, base)}</td>
                  <td className="num">{fmtMoney(r.tradingCosts, base)}</td>
                  <td className={`num ${signClass(r.pnl)}`}>
                    {fmtPct(r.returnPct, 2)}
                    {r.pnl !== undefined && <div className="muted">{fmtMoney(r.pnl, base)}</div>}
                  </td>
                  <td className={`num ${signClass(r.benchmarkPnl)}`}>{fmtPct(r.benchmarkReturnPct, 2)}</td>
                  <td className={`num ${signClass(r.excessPp)}`}>
                    {r.excessPp === undefined ? '—' : `${r.excessPp > 0 ? '+' : ''}${fmtNum(r.excessPp, 2)}`}
                  </td>
                  <td>
                    {c.status === 'open' ? (
                      <button onClick={() => close(c)}>結束</button>
                    ) : (
                      <button className="ghost" onClick={() => reopen(c)}>重新開啟</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {missingAll.length > 0 && (
        <div className="notice warn" style={{ marginTop: 12 }}>
          缺少下列價格，相關欄位以「—」顯示（不做猜測）：
          <ul className="str-missing">
            {missingAll.map((m) => (
              <li key={`${m.instrumentId}|${m.date}|${m.purpose}`}>
                {sym(m.instrumentId)} · {m.date} · {m.purpose}
              </li>
            ))}
          </ul>
          價格歷史可以到 Performance 頁下載後再回來查看。
        </div>
      )}
    </Card>
  );
}
