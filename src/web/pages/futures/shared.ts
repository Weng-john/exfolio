import { daysInMonth, type Instrument } from '@core/index';

/** Contract months of one futures series, nearest expiry first. */
export interface FuturesSeries {
  seriesId: string;
  instruments: Instrument[];
}

/** Parse a form input: blank or non-numeric text means "not set". */
export function optionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function instrumentLabel(instrument: Instrument): string {
  return `${instrument.symbol}${instrument.expiry ? ` · ${instrument.expiry}` : ''}`;
}

/** Sort key that puts contracts without an expiry (perpetuals) last. */
export function expirySortKey(instrument: Instrument): string {
  return instrument.expiry ?? '9999-12-31';
}

/** Group futures and perpetuals by `seriesId`; instruments without one are left out. */
export function groupBySeries(instruments: Instrument[]): FuturesSeries[] {
  const bySeries = new Map<string, Instrument[]>();
  for (const instrument of instruments) {
    const isFutures = instrument.type === 'future' || instrument.type === 'perpetual';
    if (!isFutures || !instrument.seriesId) continue;
    const list = bySeries.get(instrument.seriesId) ?? [];
    list.push(instrument);
    bySeries.set(instrument.seriesId, list);
  }
  return [...bySeries.entries()].map(([seriesId, list]) => ({
    seriesId,
    instruments: list.sort((a, b) => expirySortKey(a).localeCompare(expirySortKey(b))),
  }));
}

/** Same day-of-month one month later, clamped to the end of a shorter month. */
export function addOneMonth(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextDay = Math.min(day, daysInMonth(nextYear, nextMonth));
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(nextDay).padStart(2, '0')}`;
}
