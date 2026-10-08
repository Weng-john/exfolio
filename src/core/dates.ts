import type { ISODate } from './types';

// Calendar arithmetic on YYYY-MM-DD strings. Everything is done in UTC so the
// result never depends on the machine's time zone or on the local clock.

const DAY_MS = 86_400_000;

/** UTC midnight of a YYYY-MM-DD date, in milliseconds since the epoch. */
function utcMillis(date: ISODate): number {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
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
  return `${year}-${month}-${day}`;
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
