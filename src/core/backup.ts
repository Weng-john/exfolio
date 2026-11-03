import { SEED_INDICES, SEED_INSTRUMENTS } from './seed';
import {
  emptyData,
  isDerivative,
  TABLE_NAMES,
  type AppData,
  type Instrument,
  type TableName,
} from './types';

// Backup / restore and the registry rules of the Settings page. Pure
// functions only: the page calls them and writes the result to the store.

export const BACKUP_FORMAT = 'exfolio-backup';
export const BACKUP_VERSION = 1;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  tables: AppData;
}

/** Download file name: matches the git-ignored `exfolio-backup-*.json` pattern. */
export function backupFileName(now = new Date()): string {
  return `exfolio-backup-${now.toISOString().slice(0, 10)}.json`;
}

export function serializeBackup(data: AppData, now = new Date()): string {
  const tables = Object.fromEntries(
    TABLE_NAMES.map((t) => [t, data[t] ?? []]),
  ) as unknown as AppData;
  const file: BackupFile = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    tables,
  };
  return JSON.stringify(file, null, 2);
}

export type ParseResult =
  { ok: true; data: AppData; exportedAt?: string } | { ok: false; errors: string[] };

/** Validate backup text. Missing tables become empty arrays; the rest must be well-formed. */
export function parseBackup(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['檔案不是有效的 JSON'] };
  }
  if (!isObject(raw)) return { ok: false, errors: ['檔案內容必須是 JSON 物件'] };
  if (raw.format !== undefined && raw.format !== BACKUP_FORMAT) {
    return { ok: false, errors: [`不是 exfolio 備份檔（format = ${String(raw.format)}）`] };
  }
  if (typeof raw.version === 'number' && raw.version > BACKUP_VERSION) {
    return {
      ok: false,
      errors: [`備份檔版本 ${raw.version} 比本程式支援的版本 ${BACKUP_VERSION} 新`],
    };
  }
  // Accept the wrapped format, or a bare { table: rows } object.
  const source = isObject(raw.tables) ? raw.tables : raw;
  const errors: string[] = [];
  const data = emptyData();
  data.settings = [];
  let known = 0;
  for (const table of TABLE_NAMES) {
    const rows = source[table];
    if (rows === undefined) continue;
    known++;
    if (!Array.isArray(rows)) {
      errors.push(`${table}：必須是陣列`);
      continue;
    }
    const seen = new Set<string>();
    rows.forEach((row, i) => {
      if (!isObject(row)) {
        errors.push(`${table}[${i}]：必須是物件`);
      } else if (typeof row.id !== 'string' || !row.id) {
        errors.push(`${table}[${i}]：缺少 id`);
      } else if (seen.has(row.id)) {
        errors.push(`${table}[${i}]：id 重複（${row.id}）`);
      } else {
        seen.add(row.id);
        errors.push(...validateBackupRow(table, row, i));
      }
    });
    (data[table] as unknown[]) = rows;
  }
  if (!known) errors.push('找不到任何資料表');
  if (errors.length) return { ok: false, errors };
  if (!data.settings.length) data.settings = emptyData().settings;
  return {
    ok: true,
    data,
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : undefined,
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

type BackupRow = Record<string, unknown>;

const strings = (row: BackupRow, fields: string[], path: string, errors: string[]) => {
  for (const field of fields)
    if (typeof row[field] !== 'string' || !row[field])
      errors.push(`${path}.${field}：必須是非空字串`);
};
const finite = (row: BackupRow, fields: string[], path: string, errors: string[]) => {
  for (const field of fields)
    if (typeof row[field] !== 'number' || !Number.isFinite(row[field]))
      errors.push(`${path}.${field}：必須是有限數字`);
};
const optionalFinite = (row: BackupRow, fields: string[], path: string, errors: string[]) => {
  for (const field of fields)
    if (
      row[field] !== undefined &&
      (typeof row[field] !== 'number' || !Number.isFinite(row[field]))
    )
      errors.push(`${path}.${field}：必須是有限數字`);
};
const oneOf = (row: BackupRow, field: string, values: string[], path: string, errors: string[]) => {
  if (typeof row[field] !== 'string' || !values.includes(row[field] as string))
    errors.push(`${path}.${field}：值無效`);
};
const object = (row: BackupRow, field: string, path: string, errors: string[]) => {
  if (!isObject(row[field])) errors.push(`${path}.${field}：必須是物件`);
};
const array = (row: BackupRow, field: string, path: string, errors: string[]) => {
  if (!Array.isArray(row[field])) errors.push(`${path}.${field}：必須是陣列`);
};

/**
 * Validate the persisted shape of every table before a restore reaches the
 * store. This deliberately checks structural data only: cross-table links can
 * legitimately be restored in a later import, while malformed primitives
 * would make the calculation engine unsafe immediately.
 */
function validateBackupRow(table: TableName, row: BackupRow, index: number): string[] {
  const errors: string[] = [];
  const path = `${table}[${index}]`;
  switch (table) {
    case 'brokers':
      strings(row, ['name'], path, errors);
      if (row.kind !== undefined) oneOf(row, 'kind', ['broker', 'bank', 'exchange'], path, errors);
      break;
    case 'accounts':
      strings(row, ['brokerId', 'name', 'baseCurrency'], path, errors);
      oneOf(row, 'type', ['securities', 'futures', 'crypto', 'bank'], path, errors);
      if (typeof row.active !== 'boolean') errors.push(`${path}.active：必須是布林值`);
      break;
    case 'indices':
      strings(row, ['name', 'market', 'currency'], path, errors);
      oneOf(
        row,
        'market',
        [
          'TW',
          'US',
          'JP',
          'KR',
          'HK',
          'CN',
          'IN',
          'EU',
          'UK',
          'AMERICAS',
          'APAC',
          'EM',
          'GLOBAL',
          'CRYPTO',
          'OTHER',
        ],
        path,
        errors,
      );
      if (row.weighting !== undefined)
        oneOf(row, 'weighting', ['market_cap', 'price', 'other'], path, errors);
      break;
    case 'instruments':
      strings(row, ['symbol', 'name', 'exchange', 'currency'], path, errors);
      oneOf(row, 'type', ['stock', 'etf', 'future', 'perpetual', 'crypto', 'option'], path, errors);
      oneOf(
        row,
        'quoteSource',
        ['manual', 'yahoo', 'binance', 'binance_futures', 'taifex'],
        path,
        errors,
      );
      finite(row, ['leverage', 'multiplier', 'lotSize'], path, errors);
      if (typeof row.active !== 'boolean') errors.push(`${path}.active：必須是布林值`);
      optionalFinite(
        row,
        ['expenseRatio', 'tickSize', 'initialMargin', 'maintenanceMargin', 'strike', 'impliedVol'],
        path,
        errors,
      );
      if (row.optionRight !== undefined) oneOf(row, 'optionRight', ['call', 'put'], path, errors);
      if (row.underlyingId !== undefined && typeof row.underlyingId !== 'string')
        errors.push(`${path}.underlyingId：必須是文字`);
      break;
    case 'transactions':
      strings(row, ['date', 'accountId', 'bucket', 'currency'], path, errors);
      oneOf(
        row,
        'type',
        [
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
        ],
        path,
        errors,
      );
      finite(row, ['amount'], path, errors);
      optionalFinite(
        row,
        ['quantity', 'price', 'fee', 'tax', 'fxRate', 'toAmount', 'principal', 'interest'],
        path,
        errors,
      );
      break;
    case 'loans':
      strings(row, ['name', 'lender', 'currency', 'startDate'], path, errors);
      oneOf(row, 'kind', ['credit', 'pledge', 'margin', 'other'], path, errors);
      oneOf(
        row,
        'method',
        ['annuity', 'equal_principal', 'interest_only', 'revolving'],
        path,
        errors,
      );
      finite(row, ['principal', 'annualRate'], path, errors);
      if (typeof row.active !== 'boolean') errors.push(`${path}.active：必須是布林值`);
      if (row.collateral !== undefined) array(row, 'collateral', path, errors);
      break;
    case 'prices':
      strings(row, ['currency', 'asOf'], path, errors);
      finite(row, ['price'], path, errors);
      oneOf(
        row,
        'source',
        ['manual', 'yahoo', 'binance', 'binance_futures', 'taifex'],
        path,
        errors,
      );
      oneOf(row, 'status', ['realtime', 'delayed', 'manual', 'stale'], path, errors);
      break;
    case 'fxRates':
      strings(row, ['from', 'to', 'asOf'], path, errors);
      finite(row, ['rate'], path, errors);
      oneOf(
        row,
        'source',
        ['manual', 'yahoo', 'binance', 'binance_futures', 'taifex'],
        path,
        errors,
      );
      break;
    case 'targets':
      strings(row, ['indexId'], path, errors);
      finite(row, ['targetWeight', 'tolerance'], path, errors);
      break;
    case 'strategies':
      strings(row, ['name'], path, errors);
      oneOf(row, 'status', ['active', 'paused', 'closed'], path, errors);
      break;
    case 'snapshots':
      strings(row, ['date'], path, errors);
      finite(
        row,
        [
          'nav',
          'assets',
          'liabilities',
          'cash',
          'grossExposure',
          'netExposure',
          'contributedCapital',
        ],
        path,
        errors,
      );
      object(row, 'byIndex', path, errors);
      break;
    case 'settings':
      strings(row, ['baseCurrency'], path, errors);
      object(row, 'alerts', path, errors);
      break;
    case 'tradeGroups':
      strings(row, ['strategyId', 'name'], path, errors);
      oneOf(row, 'status', ['open', 'closed'], path, errors);
      break;
    case 'rotationCycles':
      strings(
        row,
        [
          'strategyId',
          'name',
          'fromInstrumentId',
          'toInstrumentId',
          'benchmarkInstrumentId',
          'openedAt',
        ],
        path,
        errors,
      );
      oneOf(row, 'status', ['open', 'closed'], path, errors);
      break;
    case 'priceHistory':
      strings(row, ['instrumentId', 'date'], path, errors);
      finite(row, ['close'], path, errors);
      optionalFinite(row, ['adjClose'], path, errors);
      break;
    case 'rollovers':
      strings(
        row,
        ['date', 'accountId', 'bucket', 'seriesId', 'fromInstrumentId', 'toInstrumentId'],
        path,
        errors,
      );
      finite(row, ['quantity', 'closePrice', 'openPrice'], path, errors);
      optionalFinite(row, ['fee'], path, errors);
      break;
    case 'cashflowItems':
      strings(row, ['name', 'currency', 'startDate'], path, errors);
      oneOf(row, 'kind', ['income', 'expense'], path, errors);
      oneOf(row, 'frequency', ['once', 'monthly', 'quarterly', 'yearly'], path, errors);
      finite(row, ['amount'], path, errors);
      if (typeof row.affectsPortfolio !== 'boolean')
        errors.push(`${path}.affectsPortfolio：必須是布林值`);
      break;
    case 'scenarios':
      strings(row, ['name'], path, errors);
      oneOf(row, 'kind', ['stress', 'cashflow'], path, errors);
      object(row, 'params', path, errors);
      break;
    case 'importProfiles':
      strings(row, ['name'], path, errors);
      object(row, 'mapping', path, errors);
      object(row, 'options', path, errors);
      break;
  }
  return errors;
}

export function rowCounts(data: AppData): Record<TableName, number> {
  return Object.fromEntries(TABLE_NAMES.map((t) => [t, data[t].length])) as Record<
    TableName,
    number
  >;
}

export interface SeedAddition {
  data: AppData;
  added: { instruments: number; indices: number };
}

/**
 * Add seed instruments and indices whose ids are missing. Existing rows are
 * never overwritten. Institutions and accounts are never added here.
 */
export function addMissingSeed(data: AppData): SeedAddition {
  const add = <T extends { id: string }>(have: T[], seed: T[]) => {
    const ids = new Set(have.map((r) => r.id));
    const extra = seed.filter((r) => !ids.has(r.id)).map((r) => ({ ...r }));
    return { rows: [...have, ...extra], count: extra.length };
  };
  const indices = add(data.indices, SEED_INDICES);
  const instruments = add(data.instruments, SEED_INSTRUMENTS);
  return {
    data: { ...data, indices: indices.rows, instruments: instruments.rows },
    added: { instruments: instruments.count, indices: indices.count },
  };
}

/** Form errors for an instrument; empty when valid. `isNew` enables the unique-id check. */
export function validateInstrument(
  i: Instrument,
  existing: Instrument[],
  isNew: boolean,
): string[] {
  const errors: string[] = [];
  if (!i.id.trim()) errors.push('id 為必填');
  else if (isNew && existing.some((x) => x.id === i.id)) errors.push(`id「${i.id}」已存在`);
  if (!i.symbol.trim()) errors.push('代號為必填');
  if (!i.name.trim()) errors.push('名稱為必填');
  if (!i.exchange.trim()) errors.push('交易所為必填');
  if (!i.currency.trim()) errors.push('幣別為必填');
  if (!Number.isFinite(i.leverage) || i.leverage === 0)
    errors.push('槓桿倍數不可為 0（反向商品請用負數）');
  if (!Number.isFinite(i.multiplier) || i.multiplier <= 0) errors.push('合約乘數必須大於 0');
  if (!Number.isFinite(i.lotSize) || i.lotSize <= 0) errors.push('最小交易單位必須大於 0');
  if (i.quoteSource !== 'manual' && !i.quoteSymbol?.trim())
    errors.push('非手動報價來源必須填寫報價代號');
  if (i.expenseRatio !== undefined && (!Number.isFinite(i.expenseRatio) || i.expenseRatio < 0)) {
    errors.push('費用率不可為負');
  }
  if (isDerivative(i.type)) {
    for (const [label, v] of [
      ['跳動點', i.tickSize],
      ['原始保證金', i.initialMargin],
      ['維持保證金', i.maintenanceMargin],
    ] as const) {
      if (v !== undefined && (!Number.isFinite(v) || v < 0)) errors.push(`${label}不可為負`);
    }
  }
  if (i.validFrom && i.validTo && i.validFrom > i.validTo) errors.push('生效日不可晚於失效日');
  return errors;
}

export interface Reference {
  table: string;
  count: number;
}

/** What still points at an instrument. Prices only count while a position needs them. */
export function instrumentReferences(data: AppData, id: string, hasPosition = false): Reference[] {
  const refs: Reference[] = [
    { table: '交易紀錄', count: data.transactions.filter((t) => t.instrumentId === id).length },
    {
      table: '借款擔保品',
      count: data.loans.filter((l) => l.collateral?.some((c) => c.instrumentId === id)).length,
    },
    { table: '配置目標', count: data.targets.filter((t) => t.preferredInstrumentId === id).length },
  ];
  if (hasPosition)
    refs.push({ table: '持倉報價', count: data.prices.filter((p) => p.id === id).length });
  return refs.filter((r) => r.count > 0);
}

/** What still points at an underlying index. */
export function indexReferences(data: AppData, id: string): Reference[] {
  const refs: Reference[] = [
    { table: '商品', count: data.instruments.filter((i) => i.indexId === id).length },
    { table: '配置目標', count: data.targets.filter((t) => t.indexId === id).length },
    { table: '策略基準', count: data.strategies.filter((s) => s.benchmarkIndexId === id).length },
  ];
  return refs.filter((r) => r.count > 0);
}
