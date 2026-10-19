import type { ISODate } from './types';

// Calendar arithmetic on YYYY-MM-DD strings. Everything is done in UTC so the
// result never depends on the machine's time zone or on the local clock.

const DAY_MS = 86_400_000;

/** UTC midnight of a YYYY-MM-DD date, in milliseconds since the epoch. */
function utcMillis(date: ISODate): number {
  const [year, month, day] = date.split('-').map(Number);
  // Date.UTC treats years 0–99 as 1900–1999. Setting the full year after
  // constructing an epoch date preserves the four-digit calendar year.
  const value = new Date(0);
  value.setUTCHours(0, 0, 0, 0);
  value.setUTCFullYear(year, month - 1, day);
  return value.getTime();
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((utcMillis(to) - utcMillis(from)) / DAY_MS);
}

/** `date` shifted by `days` calendar days (negative goes back). */
export function addDays(date: ISODate, days: number): ISODate {
  const shifted = new Date(utcMillis(date) + days * DAY_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${String(year).padStart(4, '0')}-${month}-${day}`;
}

/** Gregorian leap year: every 4th year, except centuries not divisible by 400. */
export function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/** Number of days in a calendar month (`month` is 1-12). */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** True only for a real Gregorian calendar date in YYYY-MM-DD form. */
export function isISODate(value: string): value is ISODate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}
