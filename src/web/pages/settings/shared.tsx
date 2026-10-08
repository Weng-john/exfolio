import type { ReactNode } from 'react';
import type { Reference } from '@core/index';

/** Parse a numeric form string; empty means "not set". */
export function parseNum(s: string): number | undefined {
  return s.trim() === '' ? undefined : Number(s);
}

export const numStr = (n: number | undefined) => (n === undefined ? '' : String(n));

export function ErrorList(props: { errors: string[] }) {
  if (!props.errors.length) return null;
  return (
    <ul className="settings-form-errors">
      {props.errors.map((e) => (
        <li key={e}>{e}</li>
      ))}
    </ul>
  );
}

export function describeRefs(refs: Reference[]): string {
  return refs.map((r) => `${r.table} ${r.count} 筆`).join('、');
}

export function Check(props: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="settings-check">
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      {props.label}
    </label>
  );
}
