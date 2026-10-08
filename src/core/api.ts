import type { AppData, Currency, QuoteSource, QuoteStatus } from './types';

// Wire protocol shared by the local Node backend and the Google Apps Script
// backend. Every call is a POST of one JSON object with an `action`.

export interface QuoteRequestItem {
  source: QuoteSource;
  symbol: string;
}

export interface QuoteResult extends QuoteRequestItem {
  price?: number;
  currency?: Currency;
  /** ISO time of the quote as reported by the source. */
  asOf?: string;
  status?: QuoteStatus;
  error?: string;
}

export interface HistoryPointResult {
  /** YYYY-MM-DD in the exchange's local calendar. */
  date: string;
  close: number;
  adjClose?: number;
}

export interface HistoryResult extends QuoteRequestItem {
  points: HistoryPointResult[];
  error?: string;
}

export type ApiRequest = { token?: string } & (
  | { action: 'ping' }
  | { action: 'load' }
  | { action: 'save'; tables: Partial<AppData>; baseRevision?: number }
  | { action: 'quotes'; items: QuoteRequestItem[] }
  /** Daily closes from `from` (YYYY-MM-DD) to today. */
  | { action: 'history'; items: QuoteRequestItem[]; from: string }
);

export type ApiResponse =
  | { ok: true; backend?: string; revision?: number; tables?: Partial<AppData>; quotes?: QuoteResult[]; history?: HistoryResult[] }
  | { ok: false; error: string; revision?: number };
