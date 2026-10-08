import { useMemo, useState } from 'react';
import { newId, tradeGroupSummary, replayTrades, type AppData, type TradeGroup } from '@core/index';
import { Badge, Card, Empty, Field } from '../../components/ui';
import { fmtMoney, signClass } from '../../format';
import { removeRow, upsertRow, useData } from '../../store';
import { bucketName } from '../strategies/shared';

/** Trade groups: the multi-leg unit (future option spreads, paired trades). */
export default function TradeGroups(props: { base: string }) {
  const { base } = props;
  const data: AppData = useData();
  const [editing, setEditing] = useState<TradeGroup | 'new'>();
  const [name, setName] = useState('');
  const [strategyId, setStrategyId] = useState('');
  const [status, setStatus] = useState<TradeGroup['status']>('open');
  const [note, setNote] = useState('');

  const rows = useMemo(() => {
    const replay = replayTrades(data);
    return data.tradeGroups.map((g) => tradeGroupSummary(data, g.id, replay));
  }, [data]);

  const begin = (g: TradeGroup | 'new') => {
    setEditing(g);
    const src = g === 'new' ? undefined : g;
    setName(src?.name ?? '');
    setStrategyId(src?.strategyId ?? data.strategies[0]?.id ?? '');
    setStatus(src?.status ?? 'open');
    setNote(src?.note ?? '');
  };

  const save = () => {
    if (!name.trim() || !strategyId) return;
    const row: TradeGroup = {
      id: editing && editing !== 'new' ? editing.id : newId('grp'),
      strategyId,
      name: name.trim(),
      status,
    };
    if (note.trim()) row.note = note.trim();
    upsertRow('tradeGroups', row);
    setEditing(undefined);
  };

  const remove = (g: TradeGroup) => {
    const legs = data.transactions.filter((t) => t.tradeGroupId === g.id).length;
    const msg = legs
      ? `「${g.name}」有 ${legs} 筆交易掛在這個群組。刪除後這些交易會變成沒有群組（交易本身不會被刪除）。確定？`
      : `確定刪除「${g.name}」？`;
    if (!window.confirm(msg)) return;
    if (legs) {
      for (const t of data.transactions.filter((x) => x.tradeGroupId === g.id)) {
        const { tradeGroupId: _g, ...rest } = t;
        upsertRow('transactions', rest);
      }
    }
    removeRow('tradeGroups', g.id);
  };

  return (
    <Card
      title="交易群組（多腿交易）"
      actions={
        <button
          onClick={() => (editing ? setEditing(undefined) : begin('new'))}
          disabled={!data.strategies.length}
        >
          {editing ? '取消' : '新增群組'}
        </button>
      }
    >
      <p className="jr-note">
        把同一個策略交易的多筆委託歸成一組（例如價差、對沖、分批進出），合併看損益與成本。
      </p>
      {editing && (
        <div className="jr-inline">
          <Field label="名稱">
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="策略">
            <select value={strategyId} onChange={(e) => setStrategyId(e.target.value)}>
              {data.strategies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="狀態">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as TradeGroup['status'])}
            >
              <option value="open">進行中</option>
              <option value="closed">已結束</option>
            </select>
          </Field>
          <Field label="備註">
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <button className="primary" onClick={save} disabled={!name.trim()}>
            儲存
          </button>
        </div>
      )}
      {!rows.length ? (
        <Empty>還沒有交易群組</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>群組</th>
                <th>策略</th>
                <th>狀態</th>
                <th className="num">腿數</th>
                <th>期間</th>
                <th className="num">已實現（{base}）</th>
                <th className="num">成本</th>
                <th className="num">淨損益</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.groupId}>
                  <td title={r.group?.note}>{r.group?.name ?? r.groupId}</td>
                  <td>{bucketName(data, r.group?.strategyId)}</td>
                  <td>
                    <Badge tone={r.status === 'open' ? 'ok' : 'info'}>
                      {r.status === 'open' ? '進行中' : '已結束'}
                    </Badge>
                    {r.status === 'closed' && !r.fullyClosed && r.legs.length > 0 && (
                      <span className="neg"> 仍有未平倉</span>
                    )}
                  </td>
                  <td className="num">{r.legs.length}</td>
                  <td>{r.firstDate ? `${r.firstDate} ~ ${r.lastDate}` : '—'}</td>
                  <td className={`num ${signClass(r.realizedPnlBase)}`}>
                    {fmtMoney(r.realizedPnlBase, base)}
                  </td>
                  <td className="num">{fmtMoney(r.costsBase, base)}</td>
                  <td className={`num ${signClass(r.netPnlBase)}`}>
                    {fmtMoney(r.netPnlBase, base)}
                  </td>
                  <td>
                    {r.group && (
                      <>
                        <button className="ghost" onClick={() => begin(r.group!)}>
                          編輯
                        </button>
                        <button className="ghost danger" onClick={() => remove(r.group!)}>
                          刪除
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
