import { useState } from 'react';
import {
  fromCatalog,
  INSTITUTION_CATALOG,
  newId,
  type Broker,
  type FeeClass,
  type FeeRule,
  type InstitutionKind,
} from '@core/index';
import { Field, Modal } from '../../components/ui';

export const KIND_LABELS: Record<InstitutionKind, string> = {
  broker: '券商',
  bank: '銀行',
  exchange: '交易所',
};

const CLASS_LABELS: Record<FeeClass, string> = {
  stock: '股票',
  etf: 'ETF',
  future: '期貨',
  perpetual: '永續合約',
  crypto: '加密現貨',
  option: '選擇權',
};
const CLASSES = Object.keys(CLASS_LABELS) as FeeClass[];

// Rates are edited as percentages and the discount in 折 (28 = 28 折);
// both are stored as fractions.
const COLUMNS: Array<{ key: keyof FeeRule; label: string; scale: number; hint: string }> = [
  { key: 'rate', label: '手續費率 %', scale: 100, hint: '牌告費率，例如 0.1425' },
  { key: 'discount', label: '折讓（折）', scale: 100, hint: '實收比例，28 代表 28 折；留空為不打折' },
  { key: 'minFee', label: '最低手續費', scale: 1, hint: '每筆最低收費' },
  { key: 'perUnit', label: '每單位費用', scale: 1, hint: '每股或每口固定費用' },
  { key: 'taxRate', label: '交易稅 %（買賣）', scale: 100, hint: '買賣皆收，例如期交稅' },
  { key: 'sellTaxRate', label: '交易稅 %（賣出）', scale: 100, hint: '僅賣出時收，例如證交稅' },
];

type Draft = Record<FeeClass, Partial<Record<keyof FeeRule, string>>>;

function toDraft(fees: Broker['fees']): Draft {
  const draft = {} as Draft;
  for (const c of CLASSES) {
    draft[c] = {};
    for (const col of COLUMNS) {
      const v = fees?.[c]?.[col.key];
      // Trim float noise from the percentage conversion.
      draft[c][col.key] = v === undefined ? '' : String(Number((v * col.scale).toPrecision(10)));
    }
  }
  return draft;
}

function fromDraft(draft: Draft): { fees: Broker['fees']; error?: string } {
  const fees: NonNullable<Broker['fees']> = {};
  for (const c of CLASSES) {
    const rule: FeeRule = {};
    for (const col of COLUMNS) {
      const text = (draft[c][col.key] ?? '').trim();
      if (!text) continue;
      const n = Number(text);
      if (!Number.isFinite(n) || n < 0) {
        return { fees, error: `${CLASS_LABELS[c]}的「${col.label}」必須是不為負的數字` };
      }
      rule[col.key] = n / col.scale;
    }
    if (Object.keys(rule).length) fees[c] = rule;
  }
  return { fees: Object.keys(fees).length ? fees : undefined };
}

export default function InstitutionForm(props: {
  broker: Broker;
  existingIds: string[];
  onSave: (b: Broker) => void;
  onClose: () => void;
}) {
  const isNew = !props.broker.id;
  const [name, setName] = useState(props.broker.name);
  const [kind, setKind] = useState<InstitutionKind>(props.broker.kind ?? 'broker');
  const [note, setNote] = useState(props.broker.note ?? '');
  const [draft, setDraft] = useState<Draft>(() => toDraft(props.broker.fees));
  const [catalogId, setCatalogId] = useState('');
  const [error, setError] = useState('');

  const pick = (id: string) => {
    setCatalogId(id);
    const entry = fromCatalog(id);
    if (!entry) return;
    setName(entry.name);
    setKind(entry.kind ?? 'broker');
    setDraft(toDraft(entry.fees));
  };

  const save = () => {
    if (!name.trim()) return setError('請輸入名稱');
    const { fees, error: feeError } = fromDraft(draft);
    if (feeError) return setError(feeError);
    // Reuse the catalog id when it is free, so the row stays recognisable.
    const id =
      props.broker.id ||
      (catalogId && !props.existingIds.includes(catalogId) ? catalogId : newId('inst'));
    const b: Broker = { id, name: name.trim(), kind };
    if (fees) b.fees = fees;
    if (note.trim()) b.note = note.trim();
    props.onSave(b);
  };

  return (
    <Modal
      title={isNew ? '新增機構' : '編輯機構'}
      onClose={props.onClose}
      wide
      footer={
        <>
          <button className="ghost" onClick={props.onClose}>取消</button>
          <button className="primary" onClick={save}>儲存</button>
        </>
      }
    >
      {error && <div className="notice warn">{error}</div>}
      <div className="form-grid">
        {isNew && (
          <Field label="從常用清單帶入" hint="可選；清單外的機構直接填寫名稱即可">
            <select value={catalogId} onChange={(e) => pick(e.target.value)}>
              <option value="">自行輸入</option>
              {(Object.keys(KIND_LABELS) as InstitutionKind[]).map((k) => (
                <optgroup key={k} label={KIND_LABELS[k]}>
                  {INSTITUTION_CATALOG.filter((b) => b.kind === k).map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>
        )}
        <Field label="名稱"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="類別">
          <select value={kind} onChange={(e) => setKind(e.target.value as InstitutionKind)}>
            {(Object.keys(KIND_LABELS) as InstitutionKind[]).map((k) => (
              <option key={k} value={k}>{KIND_LABELS[k]}</option>
            ))}
          </select>
        </Field>
        <Field label="備註"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>

      {kind !== 'bank' && (
        <>
          <h2 style={{ margin: '16px 0 4px' }}>手續費與交易稅</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            用來估算交易成本；實際金額以你在每筆交易填寫的為準。清單帶入的是牌告或常見預設值，
            請改成你自己的費率與折讓。沒填的商品類別不會估算。
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>商品類別</th>
                  {COLUMNS.map((col) => (
                    <th key={col.key} title={col.hint}>{col.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CLASSES.map((c) => (
                  <tr key={c}>
                    <td>{CLASS_LABELS[c]}</td>
                    {COLUMNS.map((col) => (
                      <td key={col.key}>
                        <input
                          inputMode="decimal"
                          style={{ minWidth: 80 }}
                          title={col.hint}
                          value={draft[c][col.key] ?? ''}
                          onChange={(e) =>
                            setDraft((d) => ({ ...d, [c]: { ...d[c], [col.key]: e.target.value } }))
                          }
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}
