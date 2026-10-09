import { estimateFees } from './fees';
import { newId } from './ids';
import { buildLedger } from './ledger';
import { parseCsvRecords } from './csv';
import {
  isDerivative,
  type Account,
  type AppData,
  type ImportProfile,
  type Instrument,
  type InstrumentType,
  type Transaction,
  type TxType,
} from './types';

// Broker / exchange statement importer. Statements are arbitrary tables, so the
// flow is: decode bytes -> detect the table -> map columns to fields -> parse each
// row -> resolve instruments -> build transactions -> preview the ledger impact.
// Everything here is pure (no I/O); the file never leaves the browser.
// Fictional example institutions only: nothing in this module is tied to a real broker.

// ---------------------------------------------------------------- decoding

export type StatementEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'big5';

export const ENCODING_LABELS: Record<StatementEncoding, string> = {
  'utf-8': 'UTF-8',
  'utf-16le': 'UTF-16 LE',
  'utf-16be': 'UTF-16 BE',
  big5: 'Big5 / CP950',
};

/** Minimal TextDecoder shape, so tests can inject a decoder when ICU lacks Big5. */
export interface TextDecoderLike {
  decode(bytes: Uint8Array): string;
}

export type DecoderFactory = (label: string, fatal: boolean) => TextDecoderLike;

const defaultDecoderFactory: DecoderFactory = (label, fatal) =>
  new TextDecoder(label, { fatal, ignoreBOM: false });

export interface DecodedStatement {
  text: string;
  encoding: StatementEncoding;
  /** True when the encoding was chosen by detection rather than forced by the caller. */
  detected: boolean;
}

/**
 * Decode statement bytes. A BOM decides first; otherwise strict UTF-8 is tried
 * and Big5 (the usual Taiwanese broker export) is the fallback. `encoding`
 * forces a choice, e.g. after the user overrides it in the UI.
 */
export function decodeStatement(
  bytes: Uint8Array,
  options: { encoding?: StatementEncoding; decoderFactory?: DecoderFactory } = {},
): DecodedStatement {
  const make = options.decoderFactory ?? defaultDecoderFactory;
  const strip = (s: string) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);
  const run = (enc: StatementEncoding, data: Uint8Array, fatal: boolean) =>
    strip(make(enc, fatal).decode(data));

  if (options.encoding) {
    return {
      text: run(options.encoding, bytes, false),
      encoding: options.encoding,
      detected: false,
    };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return { text: run('utf-16le', bytes, false), encoding: 'utf-16le', detected: true };
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return { text: run('utf-16be', bytes, false), encoding: 'utf-16be', detected: true };
  try {
    return { text: run('utf-8', bytes, true), encoding: 'utf-8', detected: true };
  } catch {
    return { text: run('big5', bytes, false), encoding: 'big5', detected: true };
  }
}

// ----------------------------------------------------------- column fields

export type StatementField =
  | 'date'
  | 'symbol'
  | 'name'
  | 'side'
  | 'quantity'
  | 'price'
  | 'fee'
  | 'tax'
  | 'amount'
  | 'currency'
  | 'orderId'
  | 'note';

export const STATEMENT_FIELDS: Array<{ key: StatementField; label: string; hint?: string }> = [
  { key: 'date', label: '成交日期' },
  { key: 'symbol', label: '商品代號' },
  { key: 'name', label: '商品名稱' },
  { key: 'side', label: '買賣別', hint: '沒有此欄時，由數量或金額的正負號推導' },
  { key: 'quantity', label: '數量' },
  { key: 'price', label: '成交價' },
  { key: 'fee', label: '手續費' },
  { key: 'tax', label: '交易稅' },
  { key: 'amount', label: '金額', hint: '成交金額或淨收付；價格缺漏時用來反推價格' },
  { key: 'currency', label: '幣別' },
  { key: 'orderId', label: '成交／委託編號', hint: '用於避免重複匯入' },
  { key: 'note', label: '備註' },
];

/** Statement column header per field. Headers (not indexes) so profiles survive column moves. */
export type StatementMapping = Partial<Record<StatementField, string>>;

/** Lower-case, NFKC, no spaces / underscores / hyphens. */
export function normalizeHeader(h: string): string {
  return h
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s_\-.・]+/g, '');
}

// [strong synonyms, weak synonyms]. Weak ones are plausible but often mean something else.
const SYNONYMS: Record<StatementField, [string[], string[]]> = {
  date: [
    [
      '成交日期',
      '交易日期',
      '日期',
      '成交日',
      '交易日',
      '成交時間',
      '交易時間',
      '成交时间',
      '交易时间',
      '日期時間',
      '日期时间',
      'date',
      'trade date',
      'tradedate',
      'transaction date',
      'date(utc)',
      'datetime',
      'timestamp',
      'trade time',
      'execution time',
    ],
    ['時間', '时间', 'time'],
  ],
  symbol: [
    [
      '股票代號',
      '股票代碼',
      '股票代号',
      '股票代码',
      '代號',
      '代碼',
      '代号',
      '代码',
      '商品代碼',
      '商品代號',
      '商品代码',
      '商品代号',
      '證券代號',
      '證券代碼',
      '证券代码',
      '证券代号',
      '標的代號',
      '合約代碼',
      '合約代號',
      '合约代码',
      'symbol',
      'ticker',
      'pair',
      'market',
      'instrument',
      'security',
      'contract',
      'asset',
    ],
    ['股票', '標的', '商品', '合約', '合约'],
  ],
  name: [
    [
      '股票名稱',
      '商品名稱',
      '名稱',
      '證券名稱',
      '標的名稱',
      '股票名称',
      '商品名称',
      '名称',
      '证券名称',
      'name',
      'security name',
      'instrument name',
    ],
    ['description', '商品說明'],
  ],
  side: [
    [
      '買賣別',
      '買賣',
      '交易類別',
      '交易别',
      '交易類型',
      '買賣方向',
      '買賣超',
      '买卖别',
      '买卖',
      '交易类别',
      '方向',
      '交易別',
      'side',
      'action',
      'buy/sell',
      'direction',
      'transaction type',
      'trade type',
      'b/s',
    ],
    ['type', '類別', '类别'],
  ],
  quantity: [
    [
      '成交股數',
      '股數',
      '數量',
      '成交數量',
      '成交量',
      '口數',
      '成交口數',
      '成交股数',
      '股数',
      '数量',
      '成交数量',
      '口数',
      'quantity',
      'qty',
      'executed',
      'shares',
      'filled',
      'units',
      'contracts',
      'filled qty',
    ],
    ['size', 'volume', '張數'],
  ],
  price: [
    [
      '成交價',
      '成交價格',
      '單價',
      '均價',
      '成交均價',
      '成交价',
      '成交价格',
      '单价',
      '均价',
      '成交均价',
      '價格',
      '价格',
      'price',
      'avg price',
      'average price',
      'trade price',
      'executed price',
      'fill price',
    ],
    [],
  ],
  fee: [
    ['手續費', '手续费', '交易手續費', '佣金', 'fee', 'fees', 'commission', 'commissions'],
    ['費用', '费用', 'fees & comm', 'fees and commissions'],
  ],
  tax: [
    [
      '交易稅',
      '證交稅',
      '期交稅',
      '證券交易稅',
      '期貨交易稅',
      '交易税',
      '证交税',
      '期交税',
      '稅金',
      '税金',
      'tax',
      'taxes',
    ],
    ['稅', '税'],
  ],
  amount: [
    [
      '成交金額',
      '價金',
      '成交價金',
      '應收付金額',
      '淨收付',
      '淨收付金額',
      '收付金額',
      '淨額',
      '成交金额',
      '价金',
      '应收付金额',
      '净收付',
      '净额',
      'total',
      'net amount',
      'netamount',
      'proceeds',
      'notional',
      'total amount',
      'gross amount',
      'quote amount',
    ],
    ['金額', '金额', 'value', 'net'],
  ],
  currency: [
    ['幣別', '币别', '幣種', '币种', '交易幣別', '計價幣別', 'currency', 'ccy', 'quote currency'],
    ['quote asset'],
  ],
  orderId: [
    [
      '成交序號',
      '委託書號',
      '委託書編號',
      '成交編號',
      '委託單號',
      '成交序号',
      '委托书号',
      'order id',
      'orderid',
      'order no',
      'order number',
      'trade id',
      'tradeid',
      'execution id',
      'exec id',
      'confirmation',
    ],
    ['序號', 'reference', 'id'],
  ],
  note: [
    ['備註', '备注', '說明', '说明', 'note', 'notes', 'memo', 'remark', 'remarks', 'comment'],
    [],
  ],
};

const norm = (list: string[]) => list.map(normalizeHeader);
const SYN = Object.fromEntries(
  (Object.keys(SYNONYMS) as StatementField[]).map((f) => [
    f,
    { strong: norm(SYNONYMS[f][0]), weak: norm(SYNONYMS[f][1]) },
  ]),
) as Record<StatementField, { strong: string[]; weak: string[] }>;

const FIELD_ORDER = Object.keys(SYN) as StatementField[];

/** Header without a trailing unit in brackets: 成交價(元) -> 成交價. */
const stripBrackets = (h: string) => h.replace(/[([（][^)\]）]*[)\]）]$/, '');

/** How well one header names one field, 0..1. */
function headerScore(header: string, field: StatementField): number {
  const h = normalizeHeader(header);
  if (!h) return 0;
  const { strong, weak } = SYN[field];
  if (strong.includes(h)) return 1;
  const hb = stripBrackets(h);
  if (hb && hb !== h && strong.includes(hb)) return 0.9;
  if (weak.includes(h)) return 0.7;
  if (hb && hb !== h && weak.includes(hb)) return 0.65;
  // Substring match, only for synonyms long enough to be meaningful.
  const long = (s: string) => (/[^\x00-\x7f]/.test(s) ? s.length >= 2 : s.length >= 4);
  if (strong.some((s) => long(s) && h.includes(s))) return 0.55;
  return 0;
}

export interface MappingSuggestion {
  mapping: StatementMapping;
  /** 0..1 per mapped field; below 0.8 the UI should ask the user to check. */
  confidence: Partial<Record<StatementField, number>>;
}

/**
 * Mend a header cell that text recognition got one character wrong, e.g.
 * 股粟代號 for 股票代號. Only a cell that names no field as written, and is
 * exactly one character away from a single known Chinese header of the
 * same length (three characters or more), is changed.
 */
export function repairHeaderTypo(cell: string): string {
  const h = normalizeHeader(cell);
  if (h.length < 3 || !/[^\x00-\x7f]/.test(h)) return cell;
  if (FIELD_ORDER.some((field) => headerScore(cell, field) > 0)) return cell;
  const matches = new Set<string>();
  for (const field of FIELD_ORDER) {
    for (const synonym of SYN[field].strong) {
      if (synonym.length !== h.length) continue;
      let differing = 0;
      for (let i = 0; i < h.length; i++) if (synonym[i] !== h[i]) differing += 1;
      if (differing === 1) matches.add(synonym);
    }
  }
  return matches.size === 1 ? [...matches][0] : cell;
}

/** Confidence below which a suggested field is highlighted for review. */
export const LOW_CONFIDENCE = 0.8;

/**
 * Suggest which statement column holds which field. Uncertain matches are left
 * out rather than guessed; each column is used for at most one field.
 */
export function suggestMapping(headers: string[]): MappingSuggestion {
  type Cand = { field: StatementField; col: number; score: number };
  const cands: Cand[] = [];
  for (let col = 0; col < headers.length; col++) {
    for (const field of FIELD_ORDER) {
      const score = headerScore(headers[col], field);
      if (score >= 0.5) cands.push({ field, col, score });
    }
  }
  // "Amount" is a quantity when a separate Total column holds the money; otherwise money.
  const hasQuantity = cands.some((c) => c.field === 'quantity');
  const totalCol = cands.find((c) => c.field === 'amount' && c.score >= 0.8);
  headers.forEach((h, col) => {
    if (normalizeHeader(h) !== 'amount') return;
    if (!hasQuantity && totalCol) cands.push({ field: 'quantity', col, score: 0.6 });
    else cands.push({ field: 'amount', col, score: 0.75 });
  });

  cands.sort((a, b) => b.score - a.score || a.col - b.col);
  const mapping: StatementMapping = {};
  const confidence: Partial<Record<StatementField, number>> = {};
  const usedCols = new Set<number>();
  for (const c of cands) {
    if (mapping[c.field] !== undefined || usedCols.has(c.col)) continue;
    mapping[c.field] = headers[c.col];
    confidence[c.field] = c.score;
    usedCols.add(c.col);
  }
  return { mapping, confidence };
}

/** Problems that make a mapping unusable. Empty = good to go. */
export function validateMapping(mapping: StatementMapping): string[] {
  const problems: string[] = [];
  if (!mapping.date) problems.push('必須指定日期欄');
  if (!mapping.symbol) problems.push('必須指定商品代號欄');
  if (!mapping.quantity && !mapping.amount) problems.push('至少要指定數量欄或金額欄');
  return problems;
}

// ------------------------------------------------------ table detection

export type Delimiter = ',' | '\t' | ';';

export interface StatementTable {
  delimiter: Delimiter;
  /** All records of the file, before any preamble is skipped. */
  records: string[][];
  /** Index into `records` of the header row. */
  headerRow: number;
  headers: string[];
  /** Data rows only: no preamble, blank rows or summary rows. */
  rows: string[][];
  /** Preamble records above the header. */
  preamble: string[][];
  /** Summary rows (合計 / Total ...) removed from the table. */
  summaryRows: number;
}

/** Split text into records using any single-character delimiter; comma goes through the shared CSV parser. */
export function parseDelimited(text: string, delimiter: Delimiter): string[][] {
  if (delimiter === ',') return parseCsvRecords(text);
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  let pending = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === '') {
      quoted = true;
      pending = true;
    } else if (ch === delimiter) {
      record.push(field);
      field = '';
      pending = true;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      if (pending || field !== '') {
        record.push(field);
        records.push(record);
      }
      record = [];
      field = '';
      pending = false;
    } else {
      field += ch;
      pending = true;
    }
  }
  if (pending || field !== '') {
    record.push(field);
    records.push(record);
  }
  return records;
}

/** Pick the delimiter that splits most of the first lines into the same number (>1) of fields. */
export function detectDelimiter(text: string): Delimiter {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r\n|\n|\r/)
    .filter((l) => l.trim() !== '')
    .slice(0, 80);
  let best: Delimiter = ',';
  let bestScore = 0;
  for (const d of [',', '\t', ';'] as Delimiter[]) {
    const counts = lines.map((l) => parseDelimited(l, d)[0]?.length ?? 1);
    const freq = new Map<number, number>();
    for (const c of counts) if (c > 1) freq.set(c, (freq.get(c) ?? 0) + 1);
    let modal = 0;
    let modalFreq = 0;
    for (const [c, f] of freq)
      if (f > modalFreq || (f === modalFreq && c > modal)) [modal, modalFreq] = [c, f];
    const score = modalFreq * 1000 + modal;
    if (score > bestScore) [best, bestScore] = [d, score];
  }
  return best;
}

const SUMMARY_RE =
  /^(合計|總計|总计|小計|小计|合并|累計|累计|總筆數|共\s*\d|total|subtotal|sub-total|grand total|summary)/i;

/** Distinct fields a record's cells look like headers for. */
function headerHits(record: string[]): number {
  const fields = new Set<StatementField>();
  for (const cell of record) {
    for (const f of FIELD_ORDER) if (headerScore(cell, f) >= 0.7) fields.add(f);
  }
  return fields.size;
}

/** Index of the header row: the first with at least 3 header keywords, else the best row with 2. */
export function detectHeaderRow(records: string[][]): number {
  const limit = Math.min(records.length, 60);
  let best = -1;
  let bestHits = 0;
  for (let i = 0; i < limit; i++) {
    const hits = headerHits(records[i]);
    if (hits >= 3) return i;
    if (hits >= 2 && hits > bestHits) [best, bestHits] = [i, hits];
  }
  return best >= 0 ? best : 0;
}

/**
 * Find the real table in a statement: skip title lines, pick the delimiter and
 * header row (overridable), drop blank and summary rows below the header.
 */
export function detectStatementTable(
  text: string,
  overrides: { delimiter?: Delimiter; headerRow?: number } = {},
): StatementTable {
  const delimiter = overrides.delimiter ?? detectDelimiter(text);
  const records = parseDelimited(text, delimiter);
  const headerRow = Math.min(
    Math.max(overrides.headerRow ?? detectHeaderRow(records), 0),
    Math.max(records.length - 1, 0),
  );
  const headers = (records[headerRow] ?? []).map((h) => h.trim());
  const rows: string[][] = [];
  let summaryRows = 0;
  for (const rec of records.slice(headerRow + 1)) {
    if (rec.every((c) => c.trim() === '')) continue;
    const first = rec.find((c) => c.trim() !== '')?.trim() ?? '';
    if (SUMMARY_RE.test(first)) {
      summaryRows++;
      continue;
    }
    rows.push(rec);
  }
  return {
    delimiter,
    records,
    headerRow,
    headers,
    rows,
    preamble: records.slice(0, headerRow),
    summaryRows,
  };
}

// ---------------------------------------------------------- value parsing

export interface ParsedNumber {
  value?: number;
  /** Cell was blank or a dash. */
  empty?: boolean;
  error?: string;
  /** Currency code or unit written next to the number, e.g. USDT in "12.5 USDT". */
  unit?: string;
  percent?: boolean;
}

/**
 * Parse a number as statements write it: thousands separators, full-width
 * digits, (1,200) or 1200- for negatives, currency symbols, %, trailing unit.
 * "1,234" is thousands; "12,34" / "1.234,56" are read as decimal-comma.
 */
export function parseNumber(raw: string | undefined): ParsedNumber {
  if (raw === undefined) return { empty: true };
  let s = raw.normalize('NFKC').replace(/[\s ]/g, '').replace(/[−–—]/g, '-');
  if (s === '' || /^-+$/.test(s)) return { empty: true };
  let negative = false;
  let percent = false;
  let unit: string | undefined;
  const takeSign = () => {
    if (s.startsWith('(') && s.endsWith(')')) {
      negative = !negative;
      s = s.slice(1, -1);
    }
    if (s.startsWith('-')) {
      negative = !negative;
      s = s.slice(1);
    } else if (s.startsWith('+')) s = s.slice(1);
    if (s.endsWith('-')) {
      negative = !negative;
      s = s.slice(0, -1);
    }
  };
  takeSign();
  if (s.endsWith('%')) {
    percent = true;
    s = s.slice(0, -1);
  }
  s = s.replace(/^(NT\$|US\$|HK\$|[$¥€£₩])/i, '');
  takeSign();
  const sci = /^\d+(\.\d+)?e[+-]?\d+$/i.test(s);
  if (!sci) {
    const lead = /^([A-Za-z]{2,10})(?=[\d.])/.exec(s);
    if (lead) {
      unit = lead[1].toUpperCase();
      s = s.slice(lead[1].length);
    }
    const trail = /([A-Za-z]{2,10}|元|圓|股|張|口)$/.exec(s);
    if (trail) {
      unit = trail[1].toUpperCase();
      s = s.slice(0, -trail[1].length);
    }
  }
  let body = s;
  if (/^\d{1,3}(\.\d{3})+,\d+$/.test(body)) body = body.replace(/\./g, '').replace(',', '.');
  else if (/^\d+,\d{1,2}$/.test(body)) body = body.replace(',', '.');
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(body)) body = body.replace(/,/g, '');
  if (!/^(\d+\.?\d*|\.\d+|\d+(\.\d+)?e[+-]?\d+)$/i.test(body))
    return { error: `無法解析數字「${raw.trim()}」` };
  let value = Number(body);
  if (!Number.isFinite(value)) return { error: `無法解析數字「${raw.trim()}」` };
  if (percent) value /= 100;
  if (negative) value = -value;
  return { value, unit, percent: percent || undefined };
}

export type DateOrder = 'ymd' | 'mdy' | 'dmy';
export type RocMode = 'auto' | 'yes' | 'no';

export interface DateOptions {
  /** Reading of `a/b/YYYY` dates. Year-first dates are always read Y-M-D. */
  dateOrder: DateOrder;
  /** ROC (民國) years: auto = year under 200 is ROC. */
  roc: RocMode;
}

export interface ParsedDate {
  date?: string;
  error?: string;
  /** The year was a ROC year and was converted. */
  rocUsed?: boolean;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Parse a statement date into YYYY-MM-DD. Time parts are dropped (the date as
 * written is kept; no time-zone shifting). Never guesses between MM/DD and DD/MM.
 */
export function parseDate(raw: string | undefined, opts: Partial<DateOptions> = {}): ParsedDate {
  const order = opts.dateOrder ?? 'ymd';
  const rocMode = opts.roc ?? 'auto';
  const text = (raw ?? '').normalize('NFKC').trim();
  if (!text) return { error: '日期空白' };

  const make = (y: number, m: number, d: number, rocUsed = false): ParsedDate => {
    if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= daysIn(y, m)))
      return { error: `日期不存在「${text}」` };
    return {
      date: `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`,
      rocUsed: rocUsed || undefined,
    };
  };
  const year = (y: number): { y: number; roc: boolean } | { error: string } => {
    if (y >= 1911) return { y, roc: false };
    const isRoc = rocMode === 'yes' || (rocMode === 'auto' && y >= 1 && y < 200);
    if (isRoc) return { y: y + 1911, roc: true };
    return { error: `年份不合理「${text}」${rocMode === 'no' ? '（已關閉民國年）' : ''}` };
  };

  // Unix epoch seconds / milliseconds (exchange exports).
  if (/^\d{13}$/.test(text) || /^\d{10}$/.test(text)) {
    const ms = text.length === 13 ? Number(text) : Number(text) * 1000;
    const dt = new Date(ms);
    return make(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }

  // Drop the time part.
  const datePart = text.split(/[\sT]/)[0];

  let m = /^(\d{1,4})年(\d{1,2})月(\d{1,2})日?$/.exec(datePart);
  if (m) {
    const yy = year(Number(m[1]));
    return 'error' in yy ? yy : make(yy.y, Number(m[2]), Number(m[3]), yy.roc);
  }

  // 8 digits: YYYYMMDD. 7 digits: ROC YYYMMDD.
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(datePart);
  if (m && /^\d{8}$/.test(datePart)) {
    const yy = year(Number(m[1]));
    return 'error' in yy ? yy : make(yy.y, Number(m[2]), Number(m[3]), yy.roc);
  }
  m = /^(\d{3})(\d{2})(\d{2})$/.exec(datePart);
  if (m) {
    const yy = year(Number(m[1]));
    return 'error' in yy ? yy : make(yy.y, Number(m[2]), Number(m[3]), yy.roc);
  }

  m = /^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})$/.exec(datePart);
  if (!m) return { error: `無法辨識日期格式「${text}」` };
  const [a, b, c] = [m[1], m[2], m[3]];
  // Year first: 2026-01-05, 2026/1/5, 115/01/05.
  if (a.length >= 3 || (a.length <= 2 && c.length <= 2 && order === 'ymd' && Number(a) > 31)) {
    const yy = year(Number(a));
    return 'error' in yy ? yy : make(yy.y, Number(b), Number(c), yy.roc);
  }
  // Year last: MM/DD/YYYY or DD/MM/YYYY (two-digit years are 20xx).
  if (c.length === 4 || c.length === 2) {
    if (order === 'ymd')
      return { error: `日期「${text}」是 月/日/年 或 日/月/年，請在選項中指定順序` };
    const yr = c.length === 2 ? 2000 + Number(c) : Number(c);
    const [mo, d] = order === 'mdy' ? [Number(a), Number(b)] : [Number(b), Number(a)];
    return make(yr, mo, d);
  }
  return { error: `無法辨識日期格式「${text}」` };
}

/** Hints from sample date cells: unambiguous slash order and whether years look ROC. */
export function suggestDateOptions(samples: string[]): {
  dateOrder?: DateOrder;
  /** True when a/b/YYYY dates exist but both readings fit every sample. */
  ambiguous: boolean;
  roc: boolean;
} {
  let mdy = true;
  let dmy = true;
  let slashYearLast = false;
  let roc = false;
  for (const s of samples) {
    const t = s.normalize('NFKC').trim().split(/[\sT]/)[0];
    const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(t);
    if (m) {
      slashYearLast = true;
      if (Number(m[1]) > 12) mdy = false;
      if (Number(m[2]) > 12) dmy = false;
      continue;
    }
    const y = /^(\d{1,4})(?:[-/.]\d{1,2}[-/.]\d{1,2}|\d{4}|年.*)$/.exec(t);
    if (y && Number(y[1]) < 200) roc = true;
  }
  if (!slashYearLast) return { ambiguous: false, roc };
  if (mdy && !dmy) return { dateOrder: 'mdy', ambiguous: false, roc };
  if (dmy && !mdy) return { dateOrder: 'dmy', ambiguous: false, roc };
  return { ambiguous: mdy && dmy, roc };
}

export type SideClass =
  { kind: 'buy' | 'sell' } | { kind: 'other'; type: TxType } | { kind: 'unknown' };

/** Classify a 買賣別 / Side cell, including non-trade rows (dividend, deposit ...). */
export function classifySide(raw: string | undefined): SideClass {
  const s = (raw ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  if (!s) return { kind: 'unknown' };
  if (/funding|資金費|资金费/.test(s)) return { kind: 'other', type: 'funding_fee' };
  if (/股息|配息|股利|現金股利|现金股利|dividend|^div/.test(s))
    return { kind: 'other', type: 'dividend' };
  if (/入金|存入|匯入|汇入|儲值|存款|deposit/.test(s)) return { kind: 'other', type: 'deposit' };
  if (/出金|提領|提款|匯出|汇出|withdraw/.test(s)) return { kind: 'other', type: 'withdraw' };
  if (/利息|interest/.test(s)) return { kind: 'other', type: 'interest' };
  if (/手續費|手续费|^fee|commission/.test(s)) return { kind: 'other', type: 'fee' };
  const hasBuy = /買|买/.test(s);
  const hasSell = /賣|卖/.test(s);
  if (hasBuy && !hasSell) return { kind: 'buy' };
  if (hasSell && !hasBuy) return { kind: 'sell' };
  if (/^(b$|buy|bought|long|purchase)/.test(s)) return { kind: 'buy' };
  if (/^(s$|sell|sold|short)/.test(s)) return { kind: 'sell' };
  return { kind: 'unknown' };
}

const CURRENCY_ALIASES: Record<string, string> = {
  新台幣: 'TWD',
  台幣: 'TWD',
  新臺幣: 'TWD',
  臺幣: 'TWD',
  NTD: 'TWD',
  NT: 'TWD',
  美元: 'USD',
  美金: 'USD',
  日圓: 'JPY',
  日元: 'JPY',
  港幣: 'HKD',
  港元: 'HKD',
  人民幣: 'CNY',
  RMB: 'CNY',
  歐元: 'EUR',
};

export function normalizeCurrency(raw: string | undefined): string | undefined {
  const s = (raw ?? '').normalize('NFKC').trim();
  if (!s) return undefined;
  const up = s.toUpperCase();
  return CURRENCY_ALIASES[s] ?? CURRENCY_ALIASES[up] ?? up;
}

// -------------------------------------------------------- statement rows

export type QuantityUnit = 'share' | 'lot';

export interface StatementOptions extends DateOptions {
  accountId: string;
  /** 'core' or a strategy id. */
  bucket: string;
  /** Currency for cash rows without a currency column; defaults to the account's. */
  defaultCurrency?: string;
  /** 'lot' multiplies stock / ETF quantities by `lotSize` (張 = 1000 shares). Futures and crypto are never scaled. */
  quantityUnit: QuantityUnit;
  lotSize?: number;
  /** Fill fee / tax left out of the file from the institution's fee rules. Off by default. */
  estimateMissingFees: boolean;
  /** Symbol key -> instrument id chosen by the user (confirms or overrides a match). */
  instrumentChoices?: Record<string, string>;
  /** Symbol key -> new instrument the user confirmed (possibly edited from the proposal). */
  confirmedInstruments?: Record<string, Instrument>;
}

export const DEFAULT_STATEMENT_OPTIONS: Omit<StatementOptions, 'accountId' | 'bucket'> = {
  dateOrder: 'ymd',
  roc: 'auto',
  quantityUnit: 'share',
  lotSize: 1000,
  estimateMissingFees: false,
};

export interface ParsedRow {
  /** 1-based position among the table's data rows. */
  rowNumber: number;
  cells: string[];
  date?: string;
  type?: TxType;
  /** How the buy / sell direction was found. */
  sideSource?: 'column' | 'quantity-sign' | 'amount-sign';
  symbol?: string;
  name?: string;
  /** Always positive for trades. */
  quantity?: number;
  price?: number;
  /** Signed as written in the file. */
  amount?: number;
  fee?: number;
  tax?: number;
  /** Currency written next to the fee, e.g. BTC in "0.001BTC". */
  feeUnit?: string;
  currency?: string;
  orderId?: string;
  note?: string;
  /** Observations worth showing (derived values, unit hints). */
  notes: string[];
  /** Why this row cannot be imported. Empty = parsed fine. */
  errors: string[];
}

const colIndex = (headers: string[], name: string | undefined): number | undefined => {
  if (name === undefined || name === '') return undefined;
  const i = headers.indexOf(name);
  return i >= 0 ? i : undefined;
};

/** Parse every data row of a table with a mapping. Never throws; problems go in `errors`. */
export function parseStatementRows(
  table: Pick<StatementTable, 'headers' | 'rows'>,
  mapping: StatementMapping,
  options: Partial<DateOptions> = {},
): ParsedRow[] {
  const idx = Object.fromEntries(
    FIELD_ORDER.map((f) => [f, colIndex(table.headers, mapping[f])]),
  ) as Record<StatementField, number | undefined>;
  const cellOf = (cells: string[], f: StatementField): string | undefined => {
    const i = idx[f];
    return i === undefined ? undefined : (cells[i] ?? '').trim();
  };

  // File-level hint: quantities carry a sign when any is negative.
  const quantitySigned = table.rows.some(
    (cells) => (parseNumber(cellOf(cells, 'quantity')).value ?? 0) < 0,
  );

  // Rows whose date cell is blank or not date-shaped at all: footer candidates.
  const notDateShaped = new Set<number>();
  const out: ParsedRow[] = table.rows.map((cells, i) => {
    const row: ParsedRow = { rowNumber: i + 1, cells, notes: [], errors: [] };
    const err = (m: string) => row.errors.push(m);

    const d = parseDate(cellOf(cells, 'date'), options);
    if (d.date) {
      row.date = d.date;
      if (d.rocUsed) row.notes.push('民國年已轉換為西元年');
    } else {
      err(d.error ?? '日期無法解析');
      if (/空白|無法辨識/.test(d.error ?? '')) notDateShaped.add(i);
    }

    const num = (f: StatementField): ParsedNumber => {
      const p = parseNumber(cellOf(cells, f));
      if (p.error) err(`${STATEMENT_FIELDS.find((x) => x.key === f)?.label}：${p.error}`);
      return p;
    };
    const qty = num('quantity');
    const price = num('price');
    const amount = num('amount');
    const fee = num('fee');
    const tax = num('tax');
    row.amount = amount.value;
    row.fee = fee.value === undefined ? undefined : Math.abs(fee.value);
    row.feeUnit = fee.unit;
    row.tax = tax.value === undefined ? undefined : Math.abs(tax.value);
    row.price = price.value;
    if (price.value !== undefined && price.value < 0) err('價格為負數');

    row.symbol = cellOf(cells, 'symbol')?.normalize('NFKC').trim() || undefined;
    row.name = cellOf(cells, 'name') || undefined;
    row.orderId = cellOf(cells, 'orderId') || undefined;
    row.note = cellOf(cells, 'note') || undefined;
    row.currency = normalizeCurrency(cellOf(cells, 'currency'));

    // Direction and type.
    const sideRaw = cellOf(cells, 'side');
    const sideCls = classifySide(sideRaw);
    if (sideCls.kind === 'buy' || sideCls.kind === 'sell') {
      row.type = sideCls.kind;
      row.sideSource = 'column';
    } else if (sideCls.kind === 'other') {
      row.type = sideCls.type;
      row.sideSource = 'column';
    } else if (sideRaw) {
      err(`無法判斷買賣別／交易類型「${sideRaw}」`);
    } else if (qty.value !== undefined && qty.value < 0) {
      row.type = 'sell';
      row.sideSource = 'quantity-sign';
      row.notes.push('買賣方向由數量負號推導');
    } else if (qty.value !== undefined && quantitySigned) {
      row.type = 'buy';
      row.sideSource = 'quantity-sign';
      row.notes.push('買賣方向由數量正負號推導（檔案中有負數量）');
    } else if (amount.value !== undefined && amount.value !== 0) {
      // Cash view: money out = buy, money in = sell.
      row.type = amount.value < 0 ? 'buy' : 'sell';
      row.sideSource = 'amount-sign';
      row.notes.push('買賣方向由金額正負號推導（負＝付出＝買進）');
    } else if (!idx.side) {
      err('沒有買賣別欄，且數量與金額都沒有正負號可推導方向');
    } else {
      err('買賣別空白');
    }

    if (qty.value !== undefined) row.quantity = Math.abs(qty.value);
    return row;
  });

  // Trailing rows with no date-like cell are footers (notes, totals) and are dropped.
  // A date that is merely invalid or ambiguous stays as an error, and so does a
  // file where no row has a date at all (wrong mapping), so nothing vanishes silently.
  if (!out.some((r) => r.date)) return out;
  let last = out.length;
  while (last > 0 && notDateShaped.has(last - 1)) last--;
  return out.slice(0, last);
}

/** Guess shares vs lots from the column header and from amount ≈ quantity x price. */
export function suggestQuantityUnit(
  table: Pick<StatementTable, 'headers' | 'rows'>,
  mapping: StatementMapping,
): { unit?: QuantityUnit; reason?: string } {
  const h = mapping.quantity ?? '';
  if (/張/.test(h) && !/股/.test(h)) return { unit: 'lot', reason: `欄名「${h}」含「張」` };
  if (/口/.test(h)) return { unit: 'share', reason: `欄名「${h}」是口數，不換算` };
  const parsed = parseStatementRows(table, mapping);
  let lot = 0;
  let share = 0;
  for (const r of parsed) {
    if (!r.quantity || !r.price || r.amount === undefined) continue;
    const gross = Math.abs(r.amount);
    const ratio = gross / (r.quantity * r.price);
    if (Math.abs(ratio - 1000) / 1000 < 0.03) lot++;
    else if (Math.abs(ratio - 1) < 0.03) share++;
  }
  if (lot > share && lot > 0) return { unit: 'lot', reason: '金額約為 數量 × 價格 × 1000' };
  if (share > 0) return { unit: 'share', reason: '金額約為 數量 × 價格' };
  if (/股/.test(h)) return { unit: 'share', reason: `欄名「${h}」含「股」` };
  return {};
}

// ------------------------------------------------------ instrument matching

export type MatchHow = 'id' | 'symbol' | 'stripped' | 'pair' | 'quoteSymbol' | 'name';

export interface InstrumentMatch {
  instrument: Instrument;
  how: MatchHow;
  /** True for name matches: the user must confirm before rows are imported. */
  needsReview: boolean;
}

const PREFIX_RE =
  /^(TW|TWSE|TPE|TWO|TPEX|US|NASDAQ|NYSE|AMEX|ARCA|HK|SSE|SZSE|CME|TAIFEX|BINANCE|CRYPTO)[:.]/i;
const SUFFIX_RE = /(\.(TW|TWO|US|O|N|HK|TPE)|:(TW|US)|\s+(TT|US|UN|UW))$/i;
const QUOTES = ['USDT', 'USDC', 'BUSD', 'FDUSD', 'USD', 'TWD', 'EUR', 'BTC', 'ETH'];

/** Uppercase, trimmed symbol used as the key for per-symbol choices. */
export function symbolKey(symbol: string | undefined, name?: string): string {
  return (symbol ?? name ?? '').normalize('NFKC').trim().toUpperCase();
}

/** Split an exchange pair like BTCUSDT / BTC/USDT / BTC-USDT. */
export function parsePair(symbol: string): { base: string; quote: string } | undefined {
  const s = symbol.toUpperCase().replace(/[\s/_-]/g, '');
  for (const q of QUOTES) {
    if (s.endsWith(q) && s.length - q.length >= 2) return { base: s.slice(0, -q.length), quote: q };
  }
  return undefined;
}

/**
 * Resolve a statement symbol to an instrument: exact id, exact symbol, symbol
 * with exchange prefix / suffix stripped, exchange pair (BTCUSDT -> BTC spot
 * when the quote currency matches), unique quote symbol, then name (weak).
 */
export function matchInstrument(
  symbol: string | undefined,
  name: string | undefined,
  instruments: Instrument[],
  preferCurrency?: string,
): InstrumentMatch | undefined {
  const pick = (list: Instrument[]): Instrument | undefined =>
    list.find((i) => i.active && preferCurrency && i.currency === preferCurrency) ??
    list.find((i) => i.active) ??
    list[0];
  const raw = (symbol ?? '').normalize('NFKC').trim();
  if (raw) {
    const up = raw.toUpperCase();
    const byId =
      instruments.find((i) => i.id === raw) ?? instruments.find((i) => i.id.toUpperCase() === up);
    if (byId) return { instrument: byId, how: 'id', needsReview: false };
    const bySym = pick(instruments.filter((i) => i.symbol.toUpperCase() === up));
    if (bySym) return { instrument: bySym, how: 'symbol', needsReview: false };

    const candidates = new Set<string>();
    const stripped = up.replace(PREFIX_RE, '').replace(SUFFIX_RE, '').trim();
    if (stripped && stripped !== up) candidates.add(stripped);
    const first = up.split(/[\s　]+/)[0];
    if (first && first !== up) candidates.add(first.replace(PREFIX_RE, '').replace(SUFFIX_RE, ''));
    for (const c of candidates) {
      const hit = pick(instruments.filter((i) => i.symbol.toUpperCase() === c));
      if (hit) return { instrument: hit, how: 'stripped', needsReview: false };
    }

    const pair = parsePair(stripped || up);
    if (pair) {
      const hit = pick(
        instruments.filter(
          (i) =>
            i.type === 'crypto' &&
            i.symbol.toUpperCase() === pair.base &&
            i.currency.toUpperCase() === pair.quote,
        ),
      );
      if (hit) return { instrument: hit, how: 'pair', needsReview: false };
    }

    const byQuote = instruments.filter((i) => i.quoteSymbol?.toUpperCase() === (stripped || up));
    if (byQuote.length === 1)
      return { instrument: byQuote[0], how: 'quoteSymbol', needsReview: false };
  }
  const nm = (name ?? '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, '');
  if (nm.length >= 3) {
    const hit = instruments.find((i) => {
      const n = i.name.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
      return n === nm || (n.length >= 3 && (n.includes(nm) || nm.includes(n)));
    });
    if (hit) return { instrument: hit, how: 'name', needsReview: true };
  }
  return undefined;
}

export interface InstrumentProposal {
  /** Key shared by all statement rows with this symbol. */
  key: string;
  /** Draft instrument for the user to confirm or edit; not in the data yet. */
  instrument: Instrument;
  rows: number;
  /** Why this draft needs attention. */
  hints: string[];
  /** True once the caller passed it in `confirmedInstruments`: only these are written. */
  confirmed: boolean;
  /** Existing instrument whose name resembles the statement's (weak match, needs the user's say). */
  weakMatch?: Instrument;
}

/** Draft a new instrument for an unmatched symbol. Conservative guesses; the user confirms. */
export function proposeInstrument(
  symbol: string | undefined,
  name: string | undefined,
  account: Account | undefined,
  existing: Instrument[],
  defaultCurrency?: string,
): Instrument {
  const raw = (symbol ?? name ?? '').normalize('NFKC').trim();
  const pair = parsePair(raw);
  const accType = account?.type;
  let type: InstrumentType = 'stock';
  let currency = defaultCurrency ?? account?.baseCurrency ?? 'TWD';
  let sym = raw.replace(PREFIX_RE, '').replace(SUFFIX_RE, '').trim() || raw;
  if (accType === 'futures') type = 'future';
  else if (accType === 'crypto') {
    type = 'crypto';
    if (pair) {
      sym = pair.base;
      currency = pair.quote;
    }
  } else if (/etf/i.test(name ?? '') || (/^00\d{2,4}[A-Z]?$/.test(sym) && currency === 'TWD')) {
    type = 'etf';
  }
  const prefix =
    type === 'future' ? 'fut' : type === 'crypto' ? 'crypto' : currency === 'TWD' ? 'tw' : 'us';
  const base = `${prefix}_${sym.replace(/[^A-Za-z0-9]+/g, '_')}`;
  let id = base;
  for (let n = 2; existing.some((i) => i.id === id); n++) id = `${base}_${n}`;
  return {
    id,
    symbol: sym.toUpperCase(),
    name: name?.trim() || sym,
    type,
    exchange:
      type === 'crypto'
        ? 'CRYPTO'
        : currency === 'TWD'
          ? 'TWSE'
          : currency === 'USD'
            ? 'US'
            : 'OTHER',
    currency,
    leverage: 1,
    multiplier: 1,
    lotSize: 1,
    quoteSource: 'manual',
    active: true,
    note: '由對帳單匯入時建立，請確認類型、幣別與契約規格',
  };
}

// ------------------------------------------------------------ build step

export interface RowOutcome {
  rowNumber: number;
  status: 'ok' | 'duplicate' | 'error' | 'needs_instrument' | 'needs_review';
  message?: string;
  transactionId?: string;
}

export interface StatementBuildResult {
  transactions: Transaction[];
  /** Drafts for unmatched symbols. Rows for them are imported only once confirmed in `options`. */
  newInstruments: InstrumentProposal[];
  skipped: Array<{
    rowNumber: number;
    reason: 'duplicate' | 'unresolved' | 'review';
    message: string;
  }>;
  errors: Array<{ rowNumber: number; message: string }>;
  warnings: string[];
  /** Rows skipped because the same transaction is already in the data. */
  duplicates: number;
  /** Per-row status for the review table. */
  outcomes: RowOutcome[];
}

/** 53-bit string hash (cyrb53): deterministic ids from row content, no crypto needed. */
function hashString(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const r8 = (n: number | undefined) => (n === undefined ? '' : String(Math.round(n * 1e8) / 1e8));

/** Deterministic transaction id from the row's content. Same file or overlapping range -> same ids. */
export function statementTxId(
  parts: Array<string | number | undefined>,
  occurrence: number,
): string {
  return `st_${hashString(parts.map((p) => p ?? '').join('|'))}${occurrence > 1 ? `_${occurrence}` : ''}`;
}

const isLotScaled = (inst: Instrument) => inst.type === 'stock' || inst.type === 'etf';

/**
 * Turn parsed rows into transactions with the ledger's field semantics: buy /
 * sell carry a positive quantity, amount 0 and the instrument currency; cash
 * rows carry a positive amount (funding_fee is signed). Rows with unresolved
 * instruments, unreviewed name matches, errors or ids already in `data` are
 * not turned into transactions; each is accounted for in `outcomes`.
 */
export function buildStatementTransactions(
  rows: ParsedRow[],
  mapping: StatementMapping,
  options: StatementOptions,
  data: AppData,
): StatementBuildResult {
  const account = data.accounts.find((a) => a.id === options.accountId);
  const broker = account ? data.brokers.find((b) => b.id === account.brokerId) : undefined;
  const defaultCurrency = options.defaultCurrency || account?.baseCurrency || 'TWD';
  const lotSize = options.lotSize ?? 1000;
  const existingIds = new Set(data.transactions.map((t) => t.id));
  const result: StatementBuildResult = {
    transactions: [],
    newInstruments: [],
    skipped: [],
    errors: [],
    warnings: [],
    duplicates: 0,
    outcomes: [],
  };
  if (!account) {
    result.warnings.push('找不到目標帳戶');
    return result;
  }
  const occurrences = new Map<string, number>();
  const proposals = new Map<string, InstrumentProposal>();
  const confirmed = options.confirmedInstruments ?? {};
  const choices = options.instrumentChoices ?? {};
  const known = [
    ...data.instruments,
    ...Object.values(confirmed).filter((c) => !data.instruments.some((i) => i.id === c.id)),
  ];
  const matchCache = new Map<
    string,
    { inst?: Instrument; match?: InstrumentMatch; confirmedNew?: boolean }
  >();

  const fail = (row: ParsedRow, message: string) => {
    result.errors.push({ rowNumber: row.rowNumber, message });
    result.outcomes.push({ rowNumber: row.rowNumber, status: 'error', message });
  };

  const resolve = (row: ParsedRow) => {
    const key = symbolKey(row.symbol, row.name);
    const cached = matchCache.get(key);
    if (cached) return { key, ...cached };
    let entry: { inst?: Instrument; match?: InstrumentMatch; confirmedNew?: boolean };
    const chosen = choices[key] ? known.find((i) => i.id === choices[key]) : undefined;
    if (chosen) entry = { inst: chosen };
    else if (confirmed[key]) entry = { inst: confirmed[key], confirmedNew: true };
    else {
      const match = matchInstrument(row.symbol, row.name, data.instruments, account.baseCurrency);
      entry = match && !match.needsReview ? { inst: match.instrument, match } : { match };
    }
    matchCache.set(key, entry);
    return { key, ...entry };
  };

  for (const row of rows) {
    if (row.errors.length) {
      fail(row, row.errors.join('；'));
      continue;
    }
    const type = row.type!;
    const date = row.date!;
    const notes = [...row.notes];

    if (type === 'buy' || type === 'sell') {
      if (!row.symbol && !row.name) {
        fail(row, '缺少商品代號');
        continue;
      }
      const { key, inst, match, confirmedNew } = resolve(row);
      if (!inst) {
        if (match?.needsReview) {
          const msg = `代號「${row.symbol ?? ''}」僅以名稱比對到 ${match.instrument.symbol} ${match.instrument.name}，請確認`;
          result.skipped.push({ rowNumber: row.rowNumber, reason: 'review', message: msg });
          result.outcomes.push({ rowNumber: row.rowNumber, status: 'needs_review', message: msg });
        } else {
          const msg = `找不到商品「${row.symbol ?? row.name}」，請確認新商品或指定既有商品`;
          result.skipped.push({ rowNumber: row.rowNumber, reason: 'unresolved', message: msg });
          result.outcomes.push({
            rowNumber: row.rowNumber,
            status: 'needs_instrument',
            message: msg,
          });
        }
        const p = proposals.get(key);
        if (p) p.rows++;
        else {
          const taken = [...data.instruments, ...[...proposals.values()].map((x) => x.instrument)];
          const draft = proposeInstrument(
            row.symbol,
            row.name,
            account,
            taken,
            options.defaultCurrency,
          );
          const hints = ['類型為保守推測'];
          if (draft.type === 'future') hints.push('期貨請確認契約乘數');
          if (match?.needsReview) hints.push(`名稱近似既有商品 ${match.instrument.symbol}`);
          proposals.set(key, {
            key,
            instrument: draft,
            rows: 1,
            hints,
            confirmed: false,
            weakMatch: match?.needsReview ? match.instrument : undefined,
          });
        }
        continue;
      }
      if (confirmedNew && !data.instruments.some((i) => i.id === inst.id)) {
        // new instrument that the user confirmed: reported so the caller can write it
        if (!proposals.has(key)) {
          proposals.set(key, {
            key,
            instrument: inst,
            rows: 0,
            hints: ['已確認，將於匯入時建立'],
            confirmed: true,
          });
        }
        proposals.get(key)!.rows++;
      }

      // Quantity (shares), unit conversion.
      let qty = row.quantity;
      let price = row.price;
      const amountAbs = row.amount === undefined ? undefined : Math.abs(row.amount);
      if (qty !== undefined && options.quantityUnit === 'lot' && isLotScaled(inst)) {
        qty *= lotSize;
        notes.push(`數量 ${row.quantity} 張 × ${lotSize} 換算為股`);
      }
      if ((price === undefined || price === 0) && amountAbs !== undefined && qty) {
        price = amountAbs / (qty * inst.multiplier);
        notes.push('價格由 金額 ÷ 數量 推算（若金額已含手續費，價格會略有偏差）');
      } else if (!qty && price && amountAbs !== undefined) {
        qty = amountAbs / (price * inst.multiplier);
        notes.push('數量由 金額 ÷ 價格 推算');
      }
      if (!qty || qty <= 0) {
        fail(row, '缺少數量');
        continue;
      }
      if (price === undefined || !(price >= 0)) {
        fail(row, '缺少價格，且無法由金額推算');
        continue;
      }
      if (row.price && amountAbs !== undefined && amountAbs > 0 && qty) {
        const ratio = amountAbs / (qty * row.price * inst.multiplier);
        if (ratio > 1.05 || ratio < 0.95) {
          const fees = (row.fee ?? 0) + (row.tax ?? 0);
          const net1 = (amountAbs - fees) / (qty * row.price * inst.multiplier);
          const net2 = (amountAbs + fees) / (qty * row.price * inst.multiplier);
          if (Math.abs(net1 - 1) > 0.03 && Math.abs(net2 - 1) > 0.03)
            result.warnings.push(
              `第 ${row.rowNumber} 列：金額與 數量 × 價格 差距甚大（比值 ${ratio.toFixed(3)}），請檢查數量單位（股／張）`,
            );
        }
      }
      if (row.currency && row.currency !== inst.currency)
        result.warnings.push(
          `第 ${row.rowNumber} 列：對帳單幣別 ${row.currency} 與商品幣別 ${inst.currency} 不同，交易以商品幣別記錄，未換算`,
        );

      // Fee / tax.
      let fee = row.fee;
      let tax = row.tax;
      if (fee !== undefined && row.feeUnit && row.feeUnit !== inst.currency) {
        const baseAsset = inst.type === 'crypto' && row.feeUnit === inst.symbol.toUpperCase();
        if (baseAsset) {
          fee = fee * price;
          notes.push(`手續費以 ${row.feeUnit} 計，已按成交價折算為 ${inst.currency}`);
        } else if (!['元', '股', '張', '口'].includes(row.feeUnit)) {
          result.warnings.push(
            `第 ${row.rowNumber} 列：手續費幣別 ${row.feeUnit} 與商品幣別 ${inst.currency} 不同，手續費未計入`,
          );
          notes.push(`手續費 ${row.fee} ${row.feeUnit} 未計入`);
          fee = undefined;
        }
      }
      if (options.estimateMissingFees && (fee === undefined || tax === undefined)) {
        const est = estimateFees(broker, inst, type, qty, price);
        if (est.known) {
          const parts: string[] = [];
          if (fee === undefined && est.fee > 0) {
            fee = Math.round(est.fee * 100) / 100;
            parts.push('手續費');
          }
          if (tax === undefined && est.tax > 0) {
            tax = Math.round(est.tax * 100) / 100;
            parts.push('稅');
          }
          if (parts.length) notes.push(`${parts.join('、')}為依機構費率估算`);
        }
      }

      const idParts = [options.accountId, date, inst.id, type, r8(qty), r8(price), row.orderId];
      const baseKey = idParts.join('|');
      const occ = (occurrences.get(baseKey) ?? 0) + 1;
      occurrences.set(baseKey, occ);
      const id = statementTxId(idParts, occ);
      const note = ['對帳單匯入', row.orderId ? `編號 ${row.orderId}` : '', ...notes]
        .filter(Boolean)
        .join('；');
      const tx: Transaction = {
        id,
        date,
        type,
        accountId: options.accountId,
        bucket: options.bucket,
        currency: inst.currency,
        amount: 0,
        instrumentId: inst.id,
        quantity: qty,
        price,
        note,
      };
      if (fee) tx.fee = fee;
      if (tax) tx.tax = tax;
      if (existingIds.has(id)) {
        result.duplicates++;
        const msg = '已匯入過（相同內容的交易已存在）';
        result.skipped.push({ rowNumber: row.rowNumber, reason: 'duplicate', message: msg });
        result.outcomes.push({
          rowNumber: row.rowNumber,
          status: 'duplicate',
          message: msg,
          transactionId: id,
        });
        continue;
      }
      result.transactions.push(tx);
      result.outcomes.push({ rowNumber: row.rowNumber, status: 'ok', transactionId: id });
      continue;
    }

    // Cash rows: dividend, deposit, withdraw, fee, interest, funding_fee.
    let value = row.amount;
    if (value === undefined && (type === 'fee' || type === 'interest')) {
      value = row.fee ?? (row.price && row.quantity ? row.price * row.quantity : undefined);
    }
    if (value === undefined && row.price && row.quantity) value = row.price * row.quantity;
    if (value === undefined || !Number.isFinite(value)) {
      fail(row, '缺少金額');
      continue;
    }
    let inst: Instrument | undefined;
    if (type === 'dividend' && (row.symbol || row.name)) {
      const r = resolve(row);
      inst = r.inst;
      if (!inst) notes.push('商品未對應，股息未連結到持倉');
    }
    // Funding fees: statements show money received as positive; the ledger stores paid as positive.
    const amount = type === 'funding_fee' ? -value : Math.abs(value);
    if (type === 'funding_fee') notes.push('資金費率金額已依對帳單收支方向轉換（對帳單正＝收到）');
    const currency = row.currency || inst?.currency || defaultCurrency;
    const idParts = [
      options.accountId,
      date,
      type,
      currency,
      r8(amount),
      inst?.id,
      row.orderId,
      row.note,
    ];
    const baseKey = idParts.join('|');
    const occ = (occurrences.get(baseKey) ?? 0) + 1;
    occurrences.set(baseKey, occ);
    const id = statementTxId(idParts, occ);
    const tx: Transaction = {
      id,
      date,
      type,
      accountId: options.accountId,
      bucket: options.bucket,
      currency,
      amount,
      note: ['對帳單匯入', row.orderId ? `編號 ${row.orderId}` : '', row.note ?? '', ...notes]
        .filter(Boolean)
        .join('；'),
    };
    if (inst) tx.instrumentId = inst.id;
    if (type === 'dividend') {
      if (row.fee) tx.fee = row.fee;
      if (row.tax) tx.tax = row.tax;
    }
    if (existingIds.has(id)) {
      result.duplicates++;
      const msg = '已匯入過（相同內容的交易已存在）';
      result.skipped.push({ rowNumber: row.rowNumber, reason: 'duplicate', message: msg });
      result.outcomes.push({
        rowNumber: row.rowNumber,
        status: 'duplicate',
        message: msg,
        transactionId: id,
      });
      continue;
    }
    result.transactions.push(tx);
    result.outcomes.push({ rowNumber: row.rowNumber, status: 'ok', transactionId: id });
  }

  void mapping;
  result.newInstruments = [...proposals.values()];
  return result;
}

// ------------------------------------------------------------ impact preview

export interface PositionChange {
  key: string;
  accountId: string;
  instrumentId: string;
  bucket: string;
  quantityBefore: number;
  quantityAfter: number;
  avgCostBefore: number;
  avgCostAfter: number;
  /** Realized P&L created by the import, in the instrument currency. */
  realizedPnlDelta: number;
  currency: string;
}

export interface CashChange {
  accountId: string;
  currency: string;
  before: number;
  after: number;
  /** Lowest end-of-day balance from the first imported day on, after the import. */
  minAfter: number;
  minDate?: string;
}

export interface ImpactWarning {
  level: 'info' | 'warn';
  code: 'short_position' | 'negative_cash';
  message: string;
}

export interface ImportImpact {
  positions: PositionChange[];
  cash: CashChange[];
  /** Realized P&L created, per instrument currency. */
  realizedPnl: Array<{ currency: string; amount: number }>;
  /** Change in the ledger's base-currency totals. */
  totalsDelta: { realizedPnl: number; contributedCapital: number; fees: number; dividends: number };
  warnings: ImpactWarning[];
}

const EPS = 1e-6;

function withTransactions(data: AppData, transactions: Transaction[]): AppData {
  return { ...data, transactions: [...data.transactions, ...transactions] };
}

/** Cash currency each imported transaction touches (account|currency keys). */
function touchedCash(data: AppData, txs: Transaction[]): Set<string> {
  const inst = new Map(data.instruments.map((i) => [i.id, i]));
  const keys = new Set<string>();
  for (const t of txs) {
    const cur =
      (t.type === 'buy' || t.type === 'sell') && t.instrumentId
        ? (inst.get(t.instrumentId)?.currency ?? t.currency)
        : t.currency;
    keys.add(`${t.accountId}|${cur}`);
  }
  return keys;
}

/** Distinct transaction dates on or after `from`, ascending. */
function datesFrom(data: AppData, from: string): string[] {
  return [...new Set(data.transactions.map((t) => t.date).filter((d) => d >= from))].sort();
}

/**
 * Replay the ledger with and without the new transactions: per-position
 * quantity and average cost, per-account cash, realized P&L created, and the
 * warnings that matter (short positions, negative cash).
 */
export function importImpact(data: AppData, transactions: Transaction[]): ImportImpact {
  const empty: ImportImpact = {
    positions: [],
    cash: [],
    realizedPnl: [],
    totalsDelta: { realizedPnl: 0, contributedCapital: 0, fees: 0, dividends: 0 },
    warnings: [],
  };
  if (!transactions.length) return empty;
  const after = withTransactions(data, transactions);
  const before = buildLedger(data);
  const ledger = buildLedger(after);
  const instruments = new Map(after.instruments.map((i) => [i.id, i]));

  const bPos = new Map(before.positions.map((p) => [p.key, p]));
  const aPos = new Map(ledger.positions.map((p) => [p.key, p]));
  const touchedPos = new Set(
    transactions
      .filter(
        (t) => t.instrumentId && (t.type === 'buy' || t.type === 'sell' || t.type === 'dividend'),
      )
      .map((t) => `${t.accountId}|${t.instrumentId}|${t.bucket}`),
  );
  const positions: PositionChange[] = [];
  const pnl = new Map<string, number>();
  for (const key of touchedPos) {
    const b = bPos.get(key);
    const a = aPos.get(key);
    const ref = a ?? b;
    if (!ref) continue;
    const currency = instruments.get(ref.instrumentId)?.currency ?? '';
    const delta = (a?.realizedPnl ?? 0) - (b?.realizedPnl ?? 0);
    positions.push({
      key,
      accountId: ref.accountId,
      instrumentId: ref.instrumentId,
      bucket: ref.bucket,
      quantityBefore: b?.quantity ?? 0,
      quantityAfter: a?.quantity ?? 0,
      avgCostBefore: b?.avgCost ?? 0,
      avgCostAfter: a?.avgCost ?? 0,
      realizedPnlDelta: delta,
      currency,
    });
    pnl.set(currency, (pnl.get(currency) ?? 0) + delta);
  }

  // Walk end-of-day balances to find short positions and negative cash.
  const from = transactions.reduce((m, t) => (t.date < m ? t.date : m), transactions[0].date);
  const dates = datesFrom(after, from);
  const cashKeys = touchedCash(after, transactions);
  const warnings: ImpactWarning[] = [];
  const minCash = new Map<string, { amount: number; date: string }>();
  const shortSeen = new Set<string>();
  const beforeAt = (d: string) => buildLedger(data, { asOf: d });
  for (const d of dates) {
    const l = buildLedger(after, { asOf: d });
    for (const c of l.cash) {
      const k = `${c.accountId}|${c.currency}`;
      if (!cashKeys.has(k)) continue;
      const cur = minCash.get(k);
      if (!cur || c.amount < cur.amount) minCash.set(k, { amount: c.amount, date: d });
    }
    for (const p of l.positions) {
      if (p.quantity >= -EPS || !touchedPos.has(p.key) || shortSeen.has(p.key)) continue;
      const inst = instruments.get(p.instrumentId);
      if (!inst) continue;
      const wasShort = beforeAt(d).positions.some((q) => q.key === p.key && q.quantity < -EPS);
      if (wasShort) continue;
      shortSeen.add(p.key);
      warnings.push(
        isDerivative(inst.type)
          ? {
              level: 'info',
              code: 'short_position',
              message: `${inst.symbol} 在 ${d} 出現空頭部位（${p.quantity}）：期貨可以放空，請確認方向是否正確`,
            }
          : {
              level: 'warn',
              code: 'short_position',
              message: `${inst.symbol} 在 ${d} 賣出數量超過持有（${p.quantity}），建立了空頭部位：股票通常代表缺少較早的買進紀錄`,
            },
      );
    }
  }
  const cash: CashChange[] = [];
  for (const k of cashKeys) {
    const [accountId, currency] = k.split('|');
    const find = (cs: typeof ledger.cash) =>
      cs.find((c) => c.accountId === accountId && c.currency === currency)?.amount ?? 0;
    const min = minCash.get(k);
    cash.push({
      accountId,
      currency,
      before: find(before.cash),
      after: find(ledger.cash),
      minAfter: min?.amount ?? find(ledger.cash),
      minDate: min?.date,
    });
    if (min && min.amount < -EPS) {
      const beforeCash =
        beforeAt(min.date).cash.find((c) => c.accountId === accountId && c.currency === currency)
          ?.amount ?? 0;
      if (min.amount < beforeCash - EPS) {
        const name = data.accounts.find((a) => a.id === accountId)?.name ?? accountId;
        warnings.push({
          level: 'warn',
          code: 'negative_cash',
          message: `${name} 的 ${currency} 現金在 ${min.date} 降到 ${Math.round(min.amount * 100) / 100}：對帳單有交易、但沒有資金來源（入金）紀錄`,
        });
      }
    }
  }

  return {
    positions,
    cash,
    realizedPnl: [...pnl].map(([currency, amount]) => ({ currency, amount })),
    totalsDelta: {
      realizedPnl: ledger.totals.realizedPnl - before.totals.realizedPnl,
      contributedCapital: ledger.totals.contributedCapital - before.totals.contributedCapital,
      fees: ledger.totals.fees - before.totals.fees,
      dividends: ledger.totals.dividends - before.totals.dividends,
    },
    warnings,
  };
}

// ----------------------------------------------------------- funding option

export type BalancingMode = 'none' | 'opening';

export const BALANCING_EXPLANATION =
  '對帳單通常只有成交紀錄、沒有當初的入金，匯入後現金會變成負數。「開帳入金」會在最早一筆成交的前一天，替每個受影響的帳戶／幣別補一筆外部入金，金額剛好讓現金全程不為負。這是一個假設：它會增加累計投入資本，並影響資金加權報酬（XIRR／MWR）。取得真實的入金與出金紀錄後，請刪除這筆合成入金並改匯入真實資金流。';

const prevDay = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/**
 * Synthetic funding for a trade-only statement. `none` returns nothing.
 * `opening` returns one external deposit per affected account / currency,
 * dated the day before the first imported transaction there, sized so cash
 * never goes negative from then on. ASSUMPTION: this is invented money; it
 * raises contributed capital and changes money-weighted returns, so replace
 * it with the real deposits when they are known.
 */
export function balancingDeposits(
  data: AppData,
  transactions: Transaction[],
  mode: BalancingMode,
): Transaction[] {
  if (mode === 'none' || !transactions.length) return [];
  const after = withTransactions(data, transactions);
  const keys = touchedCash(after, transactions);
  const inst = new Map(after.instruments.map((i) => [i.id, i]));
  const firstDate = new Map<string, { date: string; bucket: string }>();
  for (const t of transactions) {
    const cur =
      (t.type === 'buy' || t.type === 'sell') && t.instrumentId
        ? (inst.get(t.instrumentId)?.currency ?? t.currency)
        : t.currency;
    const k = `${t.accountId}|${cur}`;
    const f = firstDate.get(k);
    if (!f || t.date < f.date) firstDate.set(k, { date: t.date, bucket: t.bucket });
  }
  const need = new Map<string, number>();
  const from = [...firstDate.values()].reduce((m, f) => (f.date < m ? f.date : m), '9999-12-31');
  for (const d of datesFrom(after, from)) {
    const l = buildLedger(after, { asOf: d });
    for (const c of l.cash) {
      const k = `${c.accountId}|${c.currency}`;
      const f = firstDate.get(k);
      if (!keys.has(k) || !f || d < f.date) continue;
      if (c.amount < -EPS) need.set(k, Math.max(need.get(k) ?? 0, -c.amount));
    }
  }
  const out: Transaction[] = [];
  for (const [k, shortfall] of need) {
    const [accountId, currency] = k.split('|');
    const f = firstDate.get(k)!;
    const amount = Math.ceil(shortfall * 100 - 1e-9) / 100;
    const date = prevDay(f.date);
    out.push({
      id: statementTxId(['opening', accountId, currency, date, r8(amount)], 1),
      date,
      type: 'deposit',
      accountId,
      bucket: f.bucket,
      currency,
      amount,
      note: '【假設】匯入對帳單時自動補的開帳入金（讓現金不為負），不是真實入金；取得真實資金流後請刪除',
      tags: ['statement-balancing'],
    });
  }
  return out;
}

// ----------------------------------------------------------------- profiles

/** Options worth saving with a profile (not the account, bucket or per-symbol choices). */
const PROFILE_OPTION_KEYS = [
  'dateOrder',
  'roc',
  'quantityUnit',
  'lotSize',
  'estimateMissingFees',
  'defaultCurrency',
] as const;

/** Build an `importProfiles` row from a confirmed mapping and options. */
export function profileFromImport(
  name: string,
  headers: string[],
  mapping: StatementMapping,
  options: Partial<StatementOptions>,
  extra: { brokerId?: string; note?: string; id?: string } = {},
): ImportProfile {
  const opts: Record<string, unknown> = { headers };
  for (const k of PROFILE_OPTION_KEYS) if (options[k] !== undefined) opts[k] = options[k];
  return {
    id: extra.id ?? newId('prof'),
    name,
    brokerId: extra.brokerId,
    mapping: Object.fromEntries(Object.entries(mapping).filter(([, v]) => v)) as Record<
      string,
      string
    >,
    options: opts,
    note: extra.note,
  };
}

const headerSet = (headers: string[]) =>
  new Set(headers.map(normalizeHeader).filter((h) => h !== ''));

/** Saved headers of a profile: the stored list, or else the mapped column names. */
function profileHeaders(p: ImportProfile): string[] {
  const stored = p.options.headers;
  return Array.isArray(stored) ? stored.map(String) : Object.values(p.mapping);
}

/** Jaccard similarity of two header lists, 0..1. */
export function headerSimilarity(a: string[], b: string[]): number {
  const sa = headerSet(a);
  const sb = headerSet(b);
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const h of sa) if (sb.has(h)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/** Best saved profile for a file's headers, if any is similar enough. */
export function pickProfile(
  headers: string[],
  profiles: ImportProfile[],
  minScore = 0.6,
): { profile: ImportProfile; score: number } | undefined {
  let best: { profile: ImportProfile; score: number } | undefined;
  for (const profile of profiles) {
    const score = headerSimilarity(headers, profileHeaders(profile));
    if (score >= minScore && (!best || score > best.score)) best = { profile, score };
  }
  return best;
}

/** Mapping and options from a profile, keeping only columns present in `headers`. */
export function applyProfile(
  profile: ImportProfile,
  headers: string[],
): { mapping: StatementMapping; options: Partial<StatementOptions> } {
  const mapping: StatementMapping = {};
  for (const [field, header] of Object.entries(profile.mapping)) {
    if (headers.includes(header)) mapping[field as StatementField] = header;
  }
  const options: Record<string, unknown> = {};
  for (const k of PROFILE_OPTION_KEYS)
    if (profile.options[k] !== undefined) options[k] = profile.options[k];
  return { mapping, options: options as Partial<StatementOptions> };
}
