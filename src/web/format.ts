const DASH = '—';

/** Amount with thousands separators. Currencies quoted in cents get 2 decimals. */
export function fmtMoney(value: number | undefined, currency = 'TWD', digits?: number): string {
  if (value === undefined || !Number.isFinite(value)) return DASH;
  const d = digits ?? (currency === 'TWD' ? 0 : 2);
  return unsignedZero(value, d).toLocaleString('en-US', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

export function fmtNum(value: number | undefined, digits = 2): string {
  if (value === undefined || !Number.isFinite(value)) return DASH;
  return unsignedZero(value, digits).toLocaleString('en-US', { maximumFractionDigits: digits });
}

/** A value that rounds to zero is shown as 0, never "-0" (e.g. a cost of −0.2). */
function unsignedZero(value: number, digits: number): number {
  return Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value;
}

/** Fraction as a percentage: 0.125 → "12.5%". */
export function fmtPct(value: number | undefined, digits = 1): string {
  if (value === undefined || !Number.isFinite(value)) return DASH;
  return `${unsignedZero(value * 100, digits).toFixed(digits)}%`;
}

/** Leverage multiple: 1.667 → "1.67×". */
export function fmtX(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return DASH;
  return `${value.toFixed(2)}×`;
}

export function fmtTime(iso: string | undefined): string {
  if (!iso) return DASH;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return DASH;
  return d.toLocaleString('zh-TW', { hour12: false });
}

/** CSS class for a signed amount. */
export function signClass(value: number | undefined): string {
  if (!value) return '';
  return value > 0 ? 'pos' : 'neg';
}
