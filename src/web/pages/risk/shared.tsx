import { useEffect, useState } from 'react';
import { newId, type AppData, type Currency, type Portfolio, type Scenario } from '@core/index';
import { Field } from '../../components/ui';
import { removeRow, upsertRow } from '../../store';

/** Fraction <-> percent text for the inputs: 0.125 shows as "12.5". */
const toText = (v: number | undefined) =>
  v === undefined ? '' : String(Math.round(v * 1e6) / 1e4);
const parse = (t: string): number | undefined => {
  if (t.trim() === '' || t === '-' || t === '.') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n / 100 : undefined;
};

/** Percent input over a fraction. Empty = undefined. */
export function PctInput(props: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  placeholder?: string;
  label?: string;
}) {
  const [text, setText] = useState(toText(props.value));
  useEffect(() => {
    // Follow outside changes (preset, loaded scenario) but not our own typing.
    if (parse(text) !== props.value) setText(toText(props.value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.value]);
  return (
    <div className="risk-pct">
      <input
        inputMode="decimal"
        aria-label={props.label}
        placeholder={props.placeholder}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          props.onChange(parse(e.target.value));
        }}
      />
      <span>%</span>
    </div>
  );
}

/** Plain number input that keeps what the user types. */
export function NumInput(props: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  placeholder?: string;
  label?: string;
}) {
  const [text, setText] = useState(props.value === undefined ? '' : String(props.value));
  useEffect(() => {
    const n = text.trim() === '' ? undefined : Number(text);
    if (n !== props.value) setText(props.value === undefined ? '' : String(props.value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.value]);
  return (
    <input
      inputMode="decimal"
      aria-label={props.label}
      placeholder={props.placeholder}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const t = e.target.value.trim();
        const n = Number(t);
        props.onChange(t === '' || t === '-' || !Number.isFinite(n) ? undefined : n);
      }}
    />
  );
}

/** Currencies other than the base that the book holds or owes. */
export function foreignCurrencies(data: AppData, portfolio: Portfolio): Currency[] {
  const base = portfolio.valuation.baseCurrency;
  const set = new Set<Currency>();
  for (const c of portfolio.ledger.cash) set.add(c.currency);
  for (const p of portfolio.valuation.positions) set.add(p.instrument.currency);
  for (const l of data.loans) set.add(l.currency);
  for (const r of data.fxRates) {
    set.add(r.from);
    set.add(r.to);
  }
  set.delete(base);
  return [...set].sort();
}

/** Save, load and delete named scenarios of one kind in `data.scenarios`. */
export function ScenarioBar(props: {
  data: AppData;
  kind: Scenario['kind'];
  /** Current parameters to save. */
  current: () => Record<string, unknown>;
  onLoad: (params: Record<string, unknown>) => void;
}) {
  const { data, kind } = props;
  const list = data.scenarios.filter((s) => s.kind === kind);
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('');
  const chosen = list.find((s) => s.id === selected);

  const save = () => {
    const n = name.trim();
    if (!n) return;
    const existing = list.find((s) => s.name === n);
    if (existing && !window.confirm(`已有同名情境「${n}」，要覆蓋嗎？`)) return;
    const id = existing?.id ?? newId('scn');
    upsertRow('scenarios', { id, kind, name: n, params: props.current() });
    setSelected(id);
  };

  return (
    <div className="risk-scenarios">
      <Field label="已存情境">
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">{list.length ? '選擇情境…' : '尚無已存情境'}</option>
          {list.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
      <button
        disabled={!chosen}
        onClick={() => {
          if (!chosen) return;
          props.onLoad(chosen.params);
          setName(chosen.name);
        }}
      >
        載入
      </button>
      <button
        className="danger"
        disabled={!chosen}
        onClick={() => {
          if (chosen && window.confirm(`確定刪除情境「${chosen.name}」？`)) {
            removeRow('scenarios', chosen.id);
            setSelected('');
          }
        }}
      >
        刪除
      </button>
      <Field label="另存為">
        <input value={name} placeholder="情境名稱" onChange={(e) => setName(e.target.value)} />
      </Field>
      <button className="primary" disabled={!name.trim()} onClick={save}>
        儲存
      </button>
    </div>
  );
}
