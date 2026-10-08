import { useState } from 'react';
import { newId, type Strategy, type StrategyStatus } from '@core/index';
import { Field, Modal } from '../../components/ui';
import { upsertRow, useData } from '../../store';
import { STATUS_LABEL, today } from './shared';

/** Add / edit a strategy. Every field is optional except the name: no trigger rules are required. */
export default function StrategyForm(props: {
  strategy?: Strategy;
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const { strategy } = props;
  const data = useData();
  const [name, setName] = useState(strategy?.name ?? '');
  const [description, setDescription] = useState(strategy?.description ?? '');
  const [category, setCategory] = useState(strategy?.category ?? '');
  const [status, setStatus] = useState<StrategyStatus>(strategy?.status ?? 'active');
  const [indexId, setIndexId] = useState(strategy?.benchmarkIndexId ?? '');
  const [instrumentId, setInstrumentId] = useState(strategy?.benchmarkInstrumentId ?? '');
  const [allowed, setAllowed] = useState<string[]>(strategy?.allowedInstrumentIds ?? []);
  const [filter, setFilter] = useState('');
  const [rules, setRules] = useState(strategy?.rules ?? '');
  const [riskNotes, setRiskNotes] = useState(strategy?.riskNotes ?? '');

  const q = filter.trim().toLowerCase();
  const visible = data.instruments.filter(
    (i) => allowed.includes(i.id) || !q || `${i.symbol} ${i.name}`.toLowerCase().includes(q),
  );
  const toggle = (id: string) => setAllowed((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));

  const save = () => {
    if (!name.trim()) return;
    const row: Strategy = {
      id: strategy?.id ?? newId('str'),
      name: name.trim(),
      status,
      createdAt: strategy?.createdAt ?? today(),
    };
    if (description.trim()) row.description = description.trim();
    if (category.trim()) row.category = category.trim();
    if (indexId) row.benchmarkIndexId = indexId;
    if (instrumentId) row.benchmarkInstrumentId = instrumentId;
    if (allowed.length) row.allowedInstrumentIds = allowed;
    if (rules.trim()) row.rules = rules.trim();
    if (riskNotes.trim()) row.riskNotes = riskNotes.trim();
    upsertRow('strategies', row);
    props.onSaved?.(row.id);
    props.onClose();
  };

  return (
    <Modal
      title={strategy ? '編輯策略' : '新增策略'}
      onClose={props.onClose}
      wide
      footer={
        <>
          <button className="ghost" onClick={props.onClose}>
            取消
          </button>
          <button className="primary" onClick={save} disabled={!name.trim()}>
            儲存
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="名稱">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：S&P 500 主觀輪動" />
        </Field>
        <Field label="分類（選填）">
          <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="例如：輪動、波段、期貨" />
        </Field>
        <Field label="狀態">
          <select value={status} onChange={(e) => setStatus(e.target.value as StrategyStatus)}>
            {(Object.keys(STATUS_LABEL) as StrategyStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="基準指數（選填）">
          <select value={indexId} onChange={(e) => setIndexId(e.target.value)}>
            <option value="">不指定</option>
            {data.indices.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="基準商品（選填）" hint="其買進持有報酬作為基準，例如 SSO">
          <select value={instrumentId} onChange={(e) => setInstrumentId(e.target.value)}>
            <option value="">不指定</option>
            {data.instruments.map((i) => (
              <option key={i.id} value={i.id}>
                {i.symbol} {i.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="form-grid" style={{ marginTop: 12 }}>
        <div className="str-wide">
          <Field label="描述（選填）">
            <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
        <div className="str-wide">
          <Field
            label={`允許商品（已選 ${allowed.length}）`}
            hint="不選 = 不限制。只在交易歸屬時提醒，不會阻擋交易。"
          >
            <input placeholder="搜尋代號或名稱" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </Field>
          <div className="str-checklist" style={{ marginTop: 6 }}>
            {visible.map((i) => (
              <label key={i.id}>
                <input type="checkbox" checked={allowed.includes(i.id)} onChange={() => toggle(i.id)} />
                {i.symbol} {i.name}
              </label>
            ))}
            {!visible.length && <span className="muted">沒有符合的商品</span>}
          </div>
        </div>
        <div className="str-wide">
          <Field label="交易規則說明（選填）" hint="自由文字。主觀判斷式策略不需要設定觸發條件。">
            <textarea rows={3} value={rules} onChange={(e) => setRules(e.target.value)} />
          </Field>
        </div>
        <div className="str-wide">
          <Field label="風險備註（選填）">
            <textarea rows={2} value={riskNotes} onChange={(e) => setRiskNotes(e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
