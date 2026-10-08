import { useSyncExternalStore } from 'react';
import { emptyData, seedData, TABLE_NAMES, type AppData, type TableName } from '@core/index';
import { connectBackend, type Backend } from './backend';

// Single in-memory copy of the dataset. Pages read it with useData() and
// change it through setTable / upsertRow / removeRow; changed tables are
// written back to the backend after a short debounce.

export type SyncStatus = 'loading' | 'ready' | 'saving' | 'error' | 'conflict';

export interface StoreState {
  data: AppData;
  status: SyncStatus;
  backendLabel: string;
  error?: string;
  lastSavedAt?: string;
}

let state: StoreState = { data: emptyData(), status: 'loading', backendLabel: '' };
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

let loading: Promise<void> | undefined;

/** Connect and load. Seeds reference data into an empty store. */
export function initStore(): Promise<void> {
  // Concurrent calls share one load: two would both seed an empty store
  // and the second save would be rejected as a conflict.
  loading ??= load().finally(() => (loading = undefined));
  return loading;
}

async function load(): Promise<void> {
  clearTimeout(timer);
  set({ status: 'loading', error: undefined });
  try {
    backend = await connectBackend();
    const res = await backend.call({ action: 'load' });
    if (!res.ok) throw new Error(res.error);
    revision = res.revision ?? 0;
    const tables = res.tables ?? {};
    const isEmpty = TABLE_NAMES.every((t) => !tables[t]?.length);
    const data = isEmpty ? seedData() : { ...emptyData(), ...stripEmpty(tables) };
    if (!data.settings.length) data.settings = emptyData().settings;
    dirty.clear();
    set({ data, status: 'ready', backendLabel: backend.label });
    if (isEmpty) {
      TABLE_NAMES.forEach((t) => dirty.add(t));
      scheduleSave();
    }
  } catch (err) {
    set({ status: 'error', error: message(err), backendLabel: backend?.label ?? '' });
  }
}

function stripEmpty(tables: Partial<AppData>): Partial<AppData> {
  return Object.fromEntries(Object.entries(tables).filter(([, rows]) => Array.isArray(rows)));
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function scheduleSave() {
  clearTimeout(timer);
  timer = setTimeout(() => void flush(), 500);
}

/** Write pending changes now. */
export async function flush(): Promise<void> {
  clearTimeout(timer);
  if (!backend || !dirty.size) return;
  const names = [...dirty];
  dirty.clear();
  const tables = Object.fromEntries(names.map((n) => [n, state.data[n]])) as Partial<AppData>;
  set({ status: 'saving' });
  try {
    const res = await backend.call({ action: 'save', tables, baseRevision: revision });
    if (!res.ok) {
      names.forEach((n) => dirty.add(n));
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
  TABLE_NAMES.forEach((t) => dirty.add(t));
  set({ data: { ...emptyData(), ...data } });
  scheduleSave();
}
