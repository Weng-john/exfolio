import { useState } from 'react';
import type { AppData, JournalEntry, Transaction } from '@core/index';
import { Empty, Field } from '../../components/ui';
import { fmtMoney, fmtNum, signClass } from '../../format';
import { upsertRow } from '../../store';
import { bucketName, symbolOf } from '../strategies/shared';

interface Draft {
  reason: string;
  tags: string;
  note: string;
  tradeGroupId: string;
  rotationCycleId: string;
}

const parseTags = (s: string) => [
  ...new Set(
    s
      .split(/[,，\s]+/)
      .map((t) => t.trim())
      .filter(Boolean),
  ),
];

/** Journal metadata only: the transaction itself (price, quantity...) is not edited here. */
function applyDraft(tx: Transaction, d: Draft): Transaction {
  const { reason: _r, tags: _t, note: _n, tradeGroupId: _g, rotationCycleId: _c, ...rest } = tx;
  const next: Transaction = { ...rest };
  if (d.reason.trim()) next.reason = d.reason.trim();
  const tags = parseTags(d.tags);
  if (tags.length) next.tags = tags;
  if (d.note.trim()) next.note = d.note.trim();
  if (d.tradeGroupId) next.tradeGroupId = d.tradeGroupId;
  if (d.rotationCycleId) next.rotationCycleId = d.rotationCycleId;
  return next;
}

export default function JournalTable(props: {
  data: AppData;
  entries: JournalEntry[];
  base: string;
}) {
  const { data, entries, base } = props;
  const [editingId, setEditingId] = useState<string>();
  const [draft, setDraft] = useState<Draft>();

  const begin = (e: JournalEntry) => {
    setEditingId(e.txId);
    setDraft({
      reason: e.reason ?? '',
      tags: e.tags.join(', '),
      note: e.note ?? '',
      tradeGroupId: e.tradeGroupId ?? '',
      rotationCycleId: e.rotationCycleId ?? '',
    });
  };

  const save = (e: JournalEntry) => {
    const tx = data.transactions.find((t) => t.id === e.txId);
    if (tx && draft) upsertRow('transactions', applyDraft(tx, draft));
    setEditingId(undefined);
  };

  if (!entries.length) return <Empty>沒有符合條件的交易。策略內的買賣交易會出現在這裡。</Empty>;

  const groupName = (id?: string) =>
    id ? (data.tradeGroups.find((g) => g.id === id)?.name ?? id) : '';
  const cycleName = (id?: string) =>
    id ? (data.rotationCycles.find((c) => c.id === id)?.name ?? id) : '';
  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>日期</th>
            <th>策略</th>
            <th>商品</th>
            <th>方向</th>
            <th className="num">價格</th>
            <th className="num">數量</th>
            <th>幣別</th>
            <th className="num">費用 + 稅</th>
            <th className="num">已實現損益</th>
            <th>理由</th>
            <th>標籤</th>
            <th>群組</th>
            <th>輪動週期</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {entries.map((e) =>
            editingId === e.txId && draft ? (
              <tr key={e.txId} className="jr-edit">
                <td colSpan={14}>
                  <div className="muted" style={{ marginBottom: 8 }}>
                    {e.date} · {bucketName(data, e.strategyId)} · {symbolOf(data, e.instrumentId)}{' '}
                    {e.side === 'buy' ? '買進' : '賣出'} {fmtNum(e.quantity, 4)} @{' '}
                    {fmtNum(e.price, 4)}
                  </div>
                  <div className="jr-edit-grid">
                    <Field label="交易理由">
                      <input
                        value={draft.reason}
                        onChange={(ev) => set({ reason: ev.target.value })}
                      />
                    </Field>
                    <Field label="標籤（逗號分隔）">
                      <input value={draft.tags} onChange={(ev) => set({ tags: ev.target.value })} />
                    </Field>
                    <Field label="備註">
                      <input value={draft.note} onChange={(ev) => set({ note: ev.target.value })} />
                    </Field>
                    <Field label="交易群組">
                      <select
                        value={draft.tradeGroupId}
                        onChange={(ev) => set({ tradeGroupId: ev.target.value })}
                      >
                        <option value="">無</option>
                        {data.tradeGroups
                          .filter((g) => g.strategyId === e.strategyId)
                          .map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field label="輪動週期">
                      <select
                        value={draft.rotationCycleId}
                        onChange={(ev) => set({ rotationCycleId: ev.target.value })}
                      >
                        <option value="">無</option>
                        {data.rotationCycles
                          .filter((c) => c.strategyId === e.strategyId)
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                      </select>
                    </Field>
                  </div>
                  <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                    <button className="primary" onClick={() => save(e)}>
                      儲存
                    </button>
                    <button className="ghost" onClick={() => setEditingId(undefined)}>
                      取消
                    </button>
                  </div>
                </td>
              </tr>
            ) : (
              <tr key={e.txId}>
                <td>{e.date}</td>
                <td>{bucketName(data, e.strategyId)}</td>
                <td>{symbolOf(data, e.instrumentId)}</td>
                <td>{e.side === 'buy' ? '買進' : '賣出'}</td>
                <td className="num">{fmtNum(e.price, 4)}</td>
                <td className="num">{fmtNum(e.quantity, 4)}</td>
                <td>{e.currency}</td>
                <td className="num">{fmtMoney(e.costs, e.currency)}</td>
                <td
                  className={`num ${signClass(e.realizedPnl)}`}
                  title={`約當 ${fmtMoney(e.realizedPnlBase, base)} ${base}`}
                >
                  {e.side === 'sell' || e.realizedPnl !== 0
                    ? fmtMoney(e.realizedPnl, e.currency)
                    : '—'}
                </td>
                <td className="jr-text" title={e.reason}>
                  {e.reason}
                </td>
                <td>
                  {e.tags.map((t) => (
                    <span key={t} className="jr-tag">
                      {t}
                    </span>
                  ))}
                </td>
                <td>{groupName(e.tradeGroupId)}</td>
                <td>{cycleName(e.rotationCycleId)}</td>
                <td>
                  <button className="ghost" onClick={() => begin(e)}>
                    編輯
                  </button>
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}
