import { useSyncExternalStore } from 'react';
import {
  demoData,
  emptyData,
  SEED_INSTRUMENTS,
  seedData,
  TABLE_NAMES,
  type AppData,
  type TableName,
} from '@core/index';
import { connectBackend, type Backend } from './backend';

// Single in-memory copy of the dataset. Pages read it with useData() and
// change it through setTable / upsertRow / removeRow; changed tables are
// written back to the backend after a short debounce.

export type SyncStatus = 'loading' | 'ready' | 'saving' | 'error' | 'conflict';

export interface StoreState {
  data: AppData;
  status: SyncStatus;
  backendLabel: string;
  /** True while an admin is looking at another member's data. */
  readOnly: boolean;
  /** True for a signed-out visitor exploring the fictional demo portfolio. */
  demo: boolean;
  error?: string;
  lastSavedAt?: string;
}

let state: StoreState = {
  data: emptyData(),
  status: 'loading',
  backendLabel: '',
  readOnly: false,
  demo: false,
};
let backend: Backend | undefined;
let revision = 0;
const dirty = new Set<TableName>();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

function set(patch: Partial<StoreState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function getState(): StoreState {
  return state;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useStore(): StoreState {
  return useSyncExternalStore(subscribe, getState);
}

export function useData(): AppData {
  return useStore().data;
}

export function getBackend(): Backend | undefined {
  return backend;
}

/** Connect once and share the connection with the sign-in code. */
export async function ensureBackend(): Promise<Backend> {
  backend ??= await connectBackend();
  return backend;
}

/** Forget the connection, e.g. after the backend address changed. */
export function resetBackend() {
  backend = undefined;
}

let onSignedOut: (() => void) | undefined;

/** Called when the backend stops accepting the session. */
export function setSignedOutHandler(handler: () => void) {
  onSignedOut = handler;
}

// Tables that only cache market data or derive from it: safe to refresh in
// memory while viewing someone else's portfolio.
const DERIVED_TABLES: TableName[] = ['prices', 'fxRates', 'snapshots', 'priceHistory'];

let loading: Promise<void> | undefined;

/**
 * Show the fictional demo portfolio. Edits work in memory so a visitor can
 * try the pages, but nothing is ever sent to a backend.
 */
export function loadDemo() {
  clearTimeout(timer);
  dirty.clear();
  set({
    data: demoData(),
    status: 'ready',
    backendLabel: '示範資料',
    readOnly: false,
    demo: true,
    error: undefined,
  });
}

/**
 * Connect and load. Seeds reference data into an empty store. With
 * `asUser`, loads that member's data for an admin, read-only.
 */
export function initStore(asUser?: string): Promise<void> {
  // Concurrent calls share one load: two would both seed an empty store
  // and the second save would be rejected as a conflict.
  loading ??= load(asUser).finally(() => (loading = undefined));
  return loading;
}

async function load(asUser?: string): Promise<void> {
  clearTimeout(timer);
  dirty.clear();
  const readOnly = Boolean(asUser);
  set({ status: 'loading', error: undefined, readOnly, demo: false });
  try {
    backend = await ensureBackend();
    const res = await backend.call({ action: 'load', ...(asUser ? { asUser } : {}) });
    if (!res.ok) {
      if (res.error === 'unauthenticated') onSignedOut?.();
      throw new Error(res.error);
    }
    revision = res.revision ?? 0;
    const tables = res.tables ?? {};
    const isEmpty = TABLE_NAMES.every((t) => !tables[t]?.length);
    const data = isEmpty ? seedData() : { ...emptyData(), ...stripEmpty(tables) };
    if (!data.settings.length) data.settings = emptyData().settings;
    const upgraded = adoptSeedQuoteSources(data);
    dirty.clear();
    set({ data, status: 'ready', backendLabel: backend.label });
    if (readOnly) return;
    if (isEmpty) {
      TABLE_NAMES.forEach((t) => dirty.add(t));
      scheduleSave();
    } else if (upgraded) {
      dirty.add('instruments');
      scheduleSave();
    }
  } catch (err) {
    set({ status: 'error', error: message(err), backendLabel: backend?.label ?? '' });
  }
}

/**
 * Seed instruments saved before a quote source existed for them are still
 * marked manual. Give them the seed's source, unless the user set a symbol.
 */
function adoptSeedQuoteSources(data: AppData): boolean {
  let changed = false;
  data.instruments = data.instruments.map((i) => {
    const seed = SEED_INSTRUMENTS.find((s) => s.id === i.id);
    if (!seed || i.quoteSource !== 'manual' || i.quoteSymbol || seed.quoteSource === 'manual')
      return i;
    changed = true;
    return { ...i, quoteSource: seed.quoteSource, quoteSymbol: seed.quoteSymbol };
  });
  return changed;
}

function stripEmpty(tables: Partial<AppData>): Partial<AppData> {
  return Object.fromEntries(Object.entries(tables).filter(([, rows]) => Array.isArray(rows)));
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function scheduleSave() {
  if (state.readOnly || state.demo) return;
  clearTimeout(timer);
  timer = setTimeout(() => void flush(), 500);
}

/** Write pending changes now. */
export async function flush(): Promise<void> {
  clearTimeout(timer);
  if (!backend || !dirty.size || state.readOnly || state.demo) return;
  const names = [...dirty];
  dirty.clear();
  const tables = Object.fromEntries(names.map((n) => [n, state.data[n]])) as Partial<AppData>;
  set({ status: 'saving' });
  try {
    const res = await backend.call({ action: 'save', tables, baseRevision: revision });
    if (!res.ok) {
      names.forEach((n) => dirty.add(n));
      if (res.error === 'unauthenticated') onSignedOut?.();
      set(
        res.error === 'conflict'
          ? { status: 'conflict', error: '資料已在別處被修改，請重新載入後再編輯' }
          : { status: 'error', error: res.error },
      );
      return;
    }
    revision = res.revision ?? revision + 1;
    set({ status: 'ready', error: undefined, lastSavedAt: new Date().toISOString() });
    if (dirty.size) scheduleSave();
  } catch (err) {
    names.forEach((n) => dirty.add(n));
    set({ status: 'error', error: message(err) });
  }
}

/** Replace a whole table. */
export function setTable<T extends TableName>(table: T, rows: AppData[T]) {
  if (state.readOnly) {
    // Nothing is ever written back; only market data may change in memory.
    if (DERIVED_TABLES.includes(table)) set({ data: { ...state.data, [table]: rows } });
    else set({ error: '唯讀檢視中，無法修改資料' });
    return;
  }
  dirty.add(table);
  set({ data: { ...state.data, [table]: rows } });
  scheduleSave();
}

type Row<T extends TableName> = AppData[T][number];

/** Insert a row, or replace the row with the same id. */
export function upsertRow<T extends TableName>(table: T, row: Row<T>) {
  const rows = state.data[table] as Row<T>[];
  const exists = rows.some((r) => r.id === row.id);
  const next = exists ? rows.map((r) => (r.id === row.id ? row : r)) : [...rows, row];
  setTable(table, next as AppData[T]);
}

export function removeRow<T extends TableName>(table: T, id: string) {
  const rows = state.data[table] as Row<T>[];
  setTable(table, rows.filter((r) => r.id !== id) as AppData[T]);
}

/** Replace the entire dataset, e.g. when restoring a backup. */
export function replaceAll(data: AppData) {
  if (state.readOnly) return;
  if (state.demo) {
    set({ data: { ...emptyData(), ...data } });
    return;
  }
  TABLE_NAMES.forEach((t) => dirty.add(t));
  set({ data: { ...emptyData(), ...data } });
  scheduleSave();
}
