import { useState } from 'react';
import { indexReferences, newId, type Market, type UnderlyingIndex } from '@core/index';
import { removeRow, upsertRow, useData } from '../../store';
import { Card, Empty, Field, Modal } from '../../components/ui';
import { describeRefs, ErrorList } from './shared';

const MARKETS: Market[] = ['TW', 'US', 'GLOBAL', 'CRYPTO', 'OTHER'];

export default function IndicesTab() {
  const data = useData();
  const [editing, setEditing] = useState<{ row: UnderlyingIndex; isNew: boolean }>();
  const [errors, setErrors] = useState<string[]>([]);
  const [blocked, setBlocked] = useState<UnderlyingIndex>();

  const set = (patch: Partial<UnderlyingIndex>) => editing && setEditing({ ...editing, row: { ...editing.row, ...patch } });

  const save = () => {
    if (!editing) return;
    const r = { ...editing.row, id: editing.row.id.trim(), name: editing.row.name.trim(), currency: editing.row.currency.trim().toUpperCase() };
    const errs: string[] = [];
    if (!r.id) errs.push('id 為必填');
    else if (editing.isNew && data.indices.some((x) => x.id === r.id)) errs.push(`id「${r.id}」已存在`);
    if (!r.name) errs.push('名稱為必填');
    if (!r.currency) errs.push('幣別為必填');
    if (errs.length) return setErrors(errs);
    if (!r.note) delete r.note;
    upsertRow('indices', r);
    setEditing(undefined);
  };

  const tryDelete = (x: UnderlyingIndex) => {
    if (indexReferences(data, x.id).length) return setBlocked(x);
    if (window.confirm(`確定刪除指數「${x.name}」？`)) removeRow('indices', x.id);
  };

  return (
    <Card
      title={`標的指數（${data.indices.length}）`}
      actions={
        <button className="primary" onClick={() => { setEditing({ row: { id: newId('idx'), name: '', market: 'US', currency: 'USD' }, isNew: true }); setErrors([]); }}>
          新增指數
        </button>
      }
    >
      <p className="muted">不同商品只要追蹤同一指數，曝險就會合併計算；請確認每檔商品掛在正確的指數上。</p>
      {data.indices.length === 0 ? (
        <Empty>尚無指數</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>id</th><th>名稱</th><th>市場</th><th>幣別</th><th>商品數</th><th>備註</th><th /></tr></thead>
            <tbody>
              {data.indices.map((x) => (
                <tr key={x.id}>
                  <td>{x.id}</td><td>{x.name}</td><td>{x.market}</td><td>{x.currency}</td>
                  <td>{data.instruments.filter((i) => i.indexId === x.id).length}</td>
                  <td>{x.note ?? ''}</td>
                  <td>
                    <div className="settings-row-actions">
                      <button onClick={() => { setEditing({ row: { ...x }, isNew: false }); setErrors([]); }}>編輯</button>
                      <button className="danger" onClick={() => tryDelete(x)}>刪除</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {blocked && (
        <Modal title="無法刪除指數" onClose={() => setBlocked(undefined)} footer={<button onClick={() => setBlocked(undefined)}>知道了</button>}>
          <p>指數「{blocked.name}」仍被引用：{describeRefs(indexReferences(data, blocked.id))}。請先改掛其他指數或移除相關設定後再刪除。</p>
        </Modal>
      )}

      {editing && (
        <Modal
          title={editing.isNew ? '新增指數' : `編輯指數 ${editing.row.name}`}
          onClose={() => setEditing(undefined)}
          footer={<><button onClick={() => setEditing(undefined)}>取消</button><button className="primary" onClick={save}>儲存</button></>}
        >
          <div className="form-grid">
            <Field label="id（唯一）"><input value={editing.row.id} disabled={!editing.isNew} onChange={(e) => set({ id: e.target.value })} /></Field>
            <Field label="名稱"><input value={editing.row.name} onChange={(e) => set({ name: e.target.value })} /></Field>
            <Field label="市場">
              <select value={editing.row.market} onChange={(e) => set({ market: e.target.value as Market })}>
                {MARKETS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
            <Field label="幣別"><input value={editing.row.currency} onChange={(e) => set({ currency: e.target.value })} /></Field>
            <Field label="備註"><input value={editing.row.note ?? ''} onChange={(e) => set({ note: e.target.value })} /></Field>
          </div>
          <ErrorList errors={errors} />
        </Modal>
      )}
    </Card>
  );
}
