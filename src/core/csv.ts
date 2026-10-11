import { newId } from './ids';
import {
  CORE_BUCKET,
  type AppData,
  type FundingSource,
  type Transaction,
  type TxType,
} from './types';

// Transaction CSV (spec 9.2, MVP import path). One header row, then one
// transaction per row. UTF-8, comma separated, RFC 4180 quoting.
//
// Columns (header names are case-insensitive; unknown columns are ignored):
//   id          optional on import (generated when empty); rows whose id already exists are skipped
//   date        YYYY-MM-DD                                   required
//   type        buy | sell | deposit | withdraw | transfer | dividend | fee |
//               position_transfer | interest | loan_draw | loan_repay |
//               loan_accrual | loan_extension | funding_fee | adjust      required
//   account     account id or account name                   required
//   bucket      'core' (default) or a strategy id
//   currency    cash currency; buy / sell default to the instrument currency
//   amount      cash magnitude, positive (adjust / funding_fee are signed); ignored for buy / sell
//   instrument  instrument id or symbol (required for buy / sell)
//   quantity    positive magnitude (buy / sell)
//   price       per unit (buy / sell)
//   fee, tax, fxRate
//   toAccount, toCurrency, toAmount, toBucket   transfer only (toAccount required)
//   loanId, principal, interest, source          loan transactions (source: external | portfolio | unconfirmed)
//   note, tags  tags are separated by ';'

export const CSV_COLUMNS = [
  'id',
  'date',
  'type',
  'account',
  'bucket',
  'currency',
  'amount',
  'instrument',
  'quantity',
  'price',
  'fee',
  'tax',
  'fxRate',
  'toAccount',
  'toCurrency',
  'toAmount',
  'toBucket',
  'loanId',
  'principal',
  'interest',
  'source',
  'note',
  'tags',
] as const;

export const TX_TYPES: TxType[] = [
  'buy',
  'sell',
  'deposit',
  'withdraw',
  'transfer',
  'position_transfer',
  'dividend',
  'fee',
  'interest',
  'loan_draw',
  'loan_repay',
  'loan_accrual',
  'loan_extension',
  'funding_fee',
  'adjust',
];

const SIGNED_TYPES: TxType[] = ['adjust', 'funding_fee'];

export interface CsvRowError {
  /** 1-based record number in the file; the header is row 1. */
  row: number;
  message: string;
}

export interface CsvImportResult {
  transactions: Transaction[];
  errors: CsvRowError[];
}

/** Quote a field when it contains a comma, quote, CR or LF. */
function quoteField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// Spreadsheet programs run a cell that starts with one of these as a formula.
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Text that would be read as a formula gets a leading apostrophe, which
 * spreadsheets show as plain text. Numbers are never touched, so a negative
 * amount stays a number.
 */
export function neutralizeFormula(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

/** Undo `neutralizeFormula` when the file is read back. */
function restoreFormulaText(value: string): string {
  return value.startsWith("'") && FORMULA_START.test(value.slice(1)) ? value.slice(1) : value;
}

/** Transactions to CSV text (ids for accounts / instruments, CRLF line breaks, no BOM). */
export function transactionsToCsv(transactions: Transaction[]): string {
  const cell = (v: string | number | undefined): string =>
    v === undefined ? '' : quoteField(typeof v === 'string' ? neutralizeFormula(v) : String(v));
  const lines = [CSV_COLUMNS.join(',')];
  for (const t of transactions) {
    lines.push(
      [
        t.id,
        t.date,
        t.type,
        t.accountId,
        t.bucket,
        t.currency,
        t.amount,
        t.instrumentId,
        t.quantity,
        t.price,
        t.fee,
        t.tax,
        t.fxRate,
        t.toAccountId,
        t.toCurrency,
        t.toAmount,
        t.toBucket,
        t.loanId,
        t.principal,
        t.interest,
        t.source,
        t.note,
        t.tags?.join(';'),
      ]
        .map(cell)
        .join(','),
    );
  }
  return lines.join('\r\n') + '\r\n';
}

/** Split CSV text into records of fields. Tolerates a BOM, CRLF / LF / CR and quoted newlines. */
export function parseCsvRecords(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  let pending = false; // a record is in progress (avoids a phantom row after the final newline)

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
    } else if (ch === ',') {
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

/**
 * Parse CSV text into transactions. Never throws: bad rows are reported in
 * `errors` and left out of `transactions`. Accounts resolve by id or name,
 * instruments by id or symbol, against `data`.
 */
export function parseTransactionsCsv(text: string, data: AppData): CsvImportResult {
  const records = parseCsvRecords(text);
  const result: CsvImportResult = { transactions: [], errors: [] };
  if (!records.length) {
    result.errors.push({ row: 1, message: '檔案是空的' });
    return result;
  }

  const header = records[0].map((h) => h.trim().toLowerCase());
  const col = new Map<string, number>();
  header.forEach((h, i) => col.has(h) || col.set(h, i));
  const missing = ['date', 'type', 'account'].filter((c) => !col.has(c));
  if (missing.length) {
    result.errors.push({ row: 1, message: `缺少必要欄位：${missing.join('、')}` });
    return result;
  }

  const accounts = new Map<string, string>();
  for (const a of data.accounts) accounts.set(a.name, a.id);
  for (const a of data.accounts) accounts.set(a.id, a.id); // ids win over names
  const instruments = new Map<string, (typeof data.instruments)[number]>();
  for (const i of data.instruments) instruments.set(i.symbol, i);
  for (const i of data.instruments) instruments.set(i.id, i);
  const strategies = new Set(data.strategies.map((s) => s.id));
  const loanIds = new Set(data.loans.map((l) => l.id));
  const seenIds = new Set<string>();

  for (let r = 1; r < records.length; r++) {
    const row = r + 1;
    const rec = records[r];
    if (rec.every((f) => f.trim() === '')) continue;
    const get = (name: string): string =>
      restoreFormulaText((rec[col.get(name.toLowerCase()) ?? -1] ?? '').trim());
    const errs: string[] = [];

    const num = (name: string): number | undefined => {
      const raw = get(name).replace(/,/g, '');
      if (raw === '') return undefined;
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        errs.push(`${name} 不是有效數字：${raw}`);
        return undefined;
      }
      return n;
    };
    const nonNegative = (name: string): number | undefined => {
      const n = num(name);
      if (n !== undefined && n < 0) errs.push(`${name} 不可為負數`);
      return n;
    };

    const date = get('date');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
      errs.push(`date 格式須為 YYYY-MM-DD：${date || '(空白)'}`);
    }
    const type = get('type').toLowerCase() as TxType;
    if (!TX_TYPES.includes(type)) errs.push(`type 無法辨識：${get('type') || '(空白)'}`);

    const accountRaw = get('account');
    const accountId = accounts.get(accountRaw);
    if (!accountId) errs.push(`找不到帳戶：${accountRaw || '(空白)'}`);

    const bucket = get('bucket') || CORE_BUCKET;
    if (bucket !== CORE_BUCKET && !strategies.has(bucket)) errs.push(`找不到策略：${bucket}`);

    const instRaw = get('instrument');
    const inst = instRaw ? instruments.get(instRaw) : undefined;
    if (instRaw && !inst) errs.push(`找不到商品：${instRaw}`);

    const isTrade = type === 'buy' || type === 'sell';
    const isPositionTransfer = type === 'position_transfer';
    const quantity = isTrade ? nonNegative('quantity') : num('quantity');
    const price = isTrade ? nonNegative('price') : num('price');
    if (isTrade) {
      if (!instRaw) errs.push('買賣需指定 instrument');
      if (!quantity) errs.push('買賣的 quantity 須大於 0');
      if (price === undefined) errs.push('買賣需指定 price');
    }
    if (isPositionTransfer) {
      if (!inst || !['stock', 'etf', 'crypto'].includes(inst.type))
        errs.push('證券移轉需指定現貨商品');
      if (!quantity || quantity <= 0) errs.push('證券移轉的 quantity 須大於 0');
    }

    const currency = (get('currency') || (isTrade && inst ? inst.currency : '')).toUpperCase();
    if (!currency) errs.push('缺少 currency');

    let amount = num('amount');
    if (isTrade || isPositionTransfer) amount = 0;
    else if (amount === undefined) {
      if (type !== 'loan_repay') errs.push('缺少 amount');
      else amount = (num('principal') ?? 0) + (num('interest') ?? 0);
    } else if (!SIGNED_TYPES.includes(type) && amount < 0) {
      errs.push('amount 須為正數（調整與資金費率除外）');
    }

    const toAccountRaw = get('toAccount');
    const toAccountId = toAccountRaw ? accounts.get(toAccountRaw) : undefined;
    if (type === 'transfer' || isPositionTransfer) {
      if (!toAccountRaw) errs.push('轉帳需指定 toAccount');
      else if (!toAccountId) errs.push(`找不到轉入帳戶：${toAccountRaw}`);
    }
    const toBucket = get('toBucket');
    if (isPositionTransfer && (toAccountId === accountId || (toBucket && toBucket !== bucket)))
      errs.push('證券移轉須為不同帳戶且同一策略桶');
    if (toBucket && toBucket !== CORE_BUCKET && !strategies.has(toBucket)) {
      errs.push(`找不到策略：${toBucket}`);
    }

    const loanId = get('loanId');
    if (
      (type === 'loan_draw' ||
        type === 'loan_repay' ||
        type === 'loan_accrual' ||
        type === 'loan_extension') &&
      !loanId
    )
      errs.push('貸款交易需指定 loanId');
    if (loanId && !loanIds.has(loanId)) errs.push(`找不到貸款：${loanId}`);

    const sourceRaw = get('source').toLowerCase();
    if (sourceRaw && !['external', 'portfolio', 'unconfirmed'].includes(sourceRaw)) {
      errs.push(`source 須為 external、portfolio 或 unconfirmed：${sourceRaw}`);
    }
    if (type === 'loan_repay' && !sourceRaw)
      errs.push('還款需指定 source（external、portfolio 或 unconfirmed）');

    const fee = nonNegative('fee');
    const tax = nonNegative('tax');
    if ((isPositionTransfer || type === 'loan_accrual') && ((fee ?? 0) !== 0 || (tax ?? 0) !== 0))
      errs.push('移轉與應計利息的額外費用請另列費用交易');
    if (type === 'loan_accrual' && !(amount! > 0)) errs.push('應計利息金額須大於 0');
    const fxRate = num('fxRate');
    if (fxRate !== undefined && fxRate <= 0) errs.push('fxRate 須大於 0');
    const toAmount = nonNegative('toAmount');
    const principal = nonNegative('principal');
    const interest = nonNegative('interest');

    const id = get('id') || newId('tx');
    if (seenIds.has(id)) errs.push(`檔案內 id 重複：${id}`);

    if (errs.length) {
      result.errors.push({ row, message: errs.join('；') });
      continue;
    }
    seenIds.add(id);

    const tx: Transaction = {
      id,
      date,
      type,
      accountId: accountId!,
      bucket,
      currency,
      amount: amount ?? 0,
    };
    if (inst) tx.instrumentId = inst.id;
    if (quantity !== undefined) tx.quantity = quantity;
    if (price !== undefined) tx.price = price;
    if (fee !== undefined) tx.fee = fee;
    if (tax !== undefined) tx.tax = tax;
    if (fxRate !== undefined) tx.fxRate = fxRate;
    if (toAccountId) tx.toAccountId = toAccountId;
    if (get('toCurrency')) tx.toCurrency = get('toCurrency').toUpperCase();
    if (toAmount !== undefined) tx.toAmount = toAmount;
    if (toBucket) tx.toBucket = toBucket;
    if (loanId) tx.loanId = loanId;
    if (principal !== undefined) tx.principal = principal;
    if (interest !== undefined) tx.interest = interest;
    if (sourceRaw) tx.source = sourceRaw as FundingSource;
    if (get('note')) tx.note = get('note');
    const tags = get('tags')
      .split(';')
      .map((t) => t.trim())
      .filter(Boolean);
    if (tags.length) tx.tags = tags;
    result.transactions.push(tx);
  }
  return result;
}

/** Split parsed transactions into new ones and ones whose id already exists. */
export function splitExisting(
  parsed: Transaction[],
  existing: Transaction[],
): { fresh: Transaction[]; skipped: Transaction[] } {
  const ids = new Set(existing.map((t) => t.id));
  const fresh: Transaction[] = [];
  const skipped: Transaction[] = [];
  for (const t of parsed) (ids.has(t.id) ? skipped : fresh).push(t);
  return { fresh, skipped };
}
