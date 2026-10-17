import { useState } from 'react';
import {
  indexReferences,
  MARKET_LABELS,
  MARKETS,
  mergeIndices,
  newId,
  type Market,
  type UnderlyingIndex,
} from '@core/index';
import { removeRow, replaceAll, upsertRow, useData } from '../../store';
import { Card, Empty, Field, Modal } from '../../components/ui';
import { describeRefs, ErrorList } from './shared';
import { confirmDialog } from '../../dialog';

export default function IndicesTab() {
  const data = useData();
  const [editing, setEditing] = useState<{ row: UnderlyingIndex; isNew: boolean }>();
  const [errors, setErrors] = useState<string[]>([]);
  const [blocked, setBlocked] = useState<UnderlyingIndex>();
  const [merging, setMerging] = useState<{ from: UnderlyingIndex; intoId: string }>();
  const [notice, setNotice] = useState('');
  const mergePreview =
    merging?.intoId && data.indices.some((i) => i.id === merging.intoId)
      ? mergeIndices(data, merging.from.id, merging.intoId)
      : undefined;

  const confirmMerge = () => {
    if (!merging || !mergePreview) return;
    const into = data.indices.find((i) => i.id === merging.intoId)!;
    replaceAll(mergePreview.data);
    setNotice(`已把「${merging.from.name}」併入「${into.name}」。`);
    setMerging(undefined);
  };

  const set = (patch: Partial<UnderlyingIndex>) =>
    editing && setEditing({ ...editing, row: { ...editing.row, ...patch } });

  const save = () => {
    if (!editing) return;
    const r = {
      ...editing.row,
      id: editing.row.id.trim(),
      name: editing.row.name.trim(),
      currency: editing.row.currency.trim().toUpperCase(),
    };
    const errs: string[] = [];
    if (!r.id) errs.push('id 為必填');
    else if (editing.isNew && data.indices.some((x) => x.id === r.id))
      errs.push(`id「${r.id}」已存在`);
    if (!r.name) errs.push('名稱為必填');
    if (!r.currency) errs.push('幣別為必填');
    if (errs.length) return setErrors(errs);
    if (!r.note) delete r.note;
    upsertRow('indices', r);
    setEditing(undefined);
  };

  const tryDelete = async (x: UnderlyingIndex) => {
    if (indexReferences(data, x.id).length) return setBlocked(x);
    if (await confirmDialog(`確定刪除指數「${x.name}」？`, { tone: 'danger', confirmText: '刪除' }))
      removeRow('indices', x.id);
  };

  return (
    <Card
      title={`標的指數（${data.indices.length}）`}
      actions={
        <button
          className="primary"
          onClick={() => {
            setEditing({
              row: { id: newId('idx'), name: '', market: 'US', currency: 'USD' },
              isNew: true,
            });
            setErrors([]);
          }}
        >
          新增指數
        </button>
      }
    >
      <p className="muted">
        不同商品只要追蹤同一指數，曝險就會合併計算；請確認每檔商品掛在正確的指數上。
        想把兩個指數視為同一個（例如加權指數與台灣 50），用「併入其他指數」。
      </p>
      {notice && <div className="notice">{notice}</div>}
      {data.indices.length === 0 ? (
        <Empty>尚無指數</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>id</th>
                <th>名稱</th>
                <th>市場</th>
                <th>幣別</th>
                <th>商品數</th>
                <th>備註</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.indices.map((x) => (
                <tr key={x.id}>
                  <td>{x.id}</td>
                  <td>{x.name}</td>
                  <td>{x.market}</td>
                  <td>{x.currency}</td>
                  <td>{data.instruments.filter((i) => i.indexId === x.id).length}</td>
                  <td>{x.note ?? ''}</td>
                  <td>
                    <div className="settings-row-actions">
                      <button
                        onClick={() => {
                          setEditing({ row: { ...x }, isNew: false });
                          setErrors([]);
                        }}
                      >
                        編輯
                      </button>
                      <button
                        disabled={data.indices.length < 2}
                        onClick={() => setMerging({ from: x, intoId: '' })}
                      >
                        併入其他指數
                      </button>
                      <button className="danger" onClick={() => tryDelete(x)}>
                        刪除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {merging && (
        <Modal
          title={`把「${merging.from.name}」併入其他指數`}
          onClose={() => setMerging(undefined)}
          footer={
            <>
              <button className="ghost" onClick={() => setMerging(undefined)}>
                取消
              </button>
              <button className="primary" disabled={!mergePreview} onClick={confirmMerge}>
                確認合併
              </button>
            </>
          }
        >
          <Field label="併入" hint="合併後只保留這個指數；需要的話之後可以改它的名稱">
            <select
              value={merging.intoId}
              onChange={(e) => setMerging({ ...merging, intoId: e.target.value })}
            >
              <option value="">請選擇</option>
              {data.indices
                .filter((i) => i.id !== merging.from.id)
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
            </select>
          </Field>
          {mergePreview && (
            <>
              <p>合併後會變更：</p>
              <ul>
                <li>{mergePreview.summary.instruments} 個商品改掛到保留的指數</li>
                <li>
                  {mergePreview.summary.targets}{' '}
                  個配置目標（兩邊都有目標時，權重相加、容忍區間取較小者）
                </li>
                <li>{mergePreview.summary.strategies} 個策略基準</li>
                <li>{mergePreview.summary.snapshots} 筆歷史快照中的分指數曝險</li>
              </ul>
              {mergePreview.summary.scenariosToReview > 0 && (
                <p className="warn">
                  有 {mergePreview.summary.scenariosToReview} 個已存的 Risk Lab
                  情境仍引用被合併的指數，合併後請重新檢查。
                </p>
              )}
              <div className="notice warn">
                兩個指數的曝險之後會加在一起計算，「{merging.from.name}」這個指數會被移除。
                這個動作無法自動復原：要拆開只能重新建立指數並逐一改回商品。建議先到「後端與資料」匯出備份。
              </div>
            </>
          )}
        </Modal>
      )}

      {blocked && (
        <Modal
          title="無法刪除指數"
          onClose={() => setBlocked(undefined)}
          footer={<button onClick={() => setBlocked(undefined)}>知道了</button>}
        >
          <p>
            指數「{blocked.name}」仍被引用：{describeRefs(indexReferences(data, blocked.id))}
            。請先改掛其他指數或移除相關設定後再刪除。
          </p>
        </Modal>
      )}

      {editing && (
        <Modal
          title={editing.isNew ? '新增指數' : `編輯指數 ${editing.row.name}`}
          onClose={() => setEditing(undefined)}
          footer={
            <>
              <button onClick={() => setEditing(undefined)}>取消</button>
              <button className="primary" onClick={save}>
                儲存
              </button>
            </>
          }
        >
          <div className="form-grid">
            <Field label="id（唯一）">
              <input
                value={editing.row.id}
                disabled={!editing.isNew}
                onChange={(e) => set({ id: e.target.value })}
              />
            </Field>
            <Field label="名稱">
              <input value={editing.row.name} onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <Field label="市場">
              <select
                value={editing.row.market}
                onChange={(e) => set({ market: e.target.value as Market })}
              >
                {MARKETS.map((m) => (
                  <option key={m} value={m}>
                    {MARKET_LABELS[m]}（{m}）
                  </option>
                ))}
              </select>
            </Field>
            <Field label="幣別">
              <input
                value={editing.row.currency}
                onChange={(e) => set({ currency: e.target.value })}
              />
            </Field>
            <Field label="備註">
              <input
                value={editing.row.note ?? ''}
                onChange={(e) => set({ note: e.target.value })}
              />
            </Field>
          </div>
          <ErrorList errors={errors} />
        </Modal>
      )}
    </Card>
  );
}
