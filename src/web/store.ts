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
  /**
   * True while nothing is ever saved: a signed-out visitor exploring the
   * fictional demo portfolio, or using the calculator (`scratch`).
   */
  demo: boolean;
  /** Calculator mode: the visitor's own figures, held in this tab only. */
  scratch: boolean;
  /** The visitor has changed something in calculator mode. */
  scratchEdited: boolean;
  /**
   * Figures entered before signing in, waiting for the member to decide
   * whether they replace what the account already holds.
   */
  pendingCarry?: AppData;
  /** True when data lives on a backend, false when it is kept in this browser. */
  backendRemote: boolean;
  error?: string;
  lastSavedAt?: string;
}

let state: StoreState = {
  data: emptyData(),
  status: 'loading',
  backendLabel: '',
  readOnly: false,
  demo: false,
  scratch: false,
  scratchEdited: false,
  backendRemote: false,
};
let backend: Backend | undefined;
let revision = 0;
/**
 * Bumped whenever the dataset changes hands: a load starts, the visitor
 * switches to the demo or the calculator, or the data is dropped on sign-out.
 * A load or save that finishes under an older generation must not touch the
 * current state: it belongs to someone, or something, else.
 */
let generation = 0;
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

let loading: { key: string; promise: Promise<void> } | undefined;

/**
 * Show the fictional demo portfolio. Edits work in memory so a visitor can
 * try the pages, but nothing is ever sent to a backend.
 */
export function loadDemo() {
  generation++;
  clearTimeout(timer);
  dirty.clear();
  set({
    data: demoData(),
    status: 'ready',
    backendLabel: '示範資料',
    readOnly: false,
    demo: true,
    scratch: false,
    scratchEdited: false,
    error: undefined,
  });
}

/**
 * Calculator mode: start from the reference catalogue (or from `data`) and
 * keep every change in memory. Closing the tab discards it.
 */
export function loadScratch(data?: Partial<AppData>) {
  generation++;
  clearTimeout(timer);
  dirty.clear();
  set({
    data: data ? { ...emptyData(), ...stripEmpty(data) } : seedData(),
    status: 'ready',
    backendLabel: '試算模式（不儲存）',
    readOnly: false,
    demo: true,
    scratch: true,
    scratchEdited: Boolean(data),
    pendingCarry: undefined,
    error: undefined,
  });
}

/** The calculator's figures, when the visitor entered any. */
export function scratchToCarry(): AppData | undefined {
  return state.scratch && state.scratchEdited ? state.data : undefined;
}

/**
 * Connect and load. Seeds reference data into an empty store. With
 * `asUser`, loads that member's data for an admin, read-only.
 */
export function initStore(asUser?: string, carry?: AppData): Promise<void> {
  // Identical concurrent calls share one load: two would both seed an empty
  // store and the second save would be rejected as a conflict. A different
  // request (another member to view, figures to carry) starts its own load,
  // which supersedes the first.
  const key = `${asUser ?? ''}|${carry ? 'carry' : ''}`;
  if (loading?.key === key) return loading.promise;
  const promise: Promise<void> = load(asUser, carry).finally(() => {
    if (loading?.promise === promise) loading = undefined;
  });
  loading = { key, promise };
  return promise;
}

/**
 * `carry`: figures from calculator mode. They fill an empty account at once;
 * an account that already holds data keeps it until the member decides.
 */
async function load(asUser?: string, carry?: AppData): Promise<void> {
  const gen = ++generation;
  clearTimeout(timer);
  dirty.clear();
  const readOnly = Boolean(asUser);
  set({
    status: 'loading',
    error: undefined,
    readOnly,
    demo: false,
    scratch: false,
    scratchEdited: false,
    pendingCarry: undefined,
  });
  try {
    backend = await ensureBackend();
    const res = await backend.call({ action: 'load', ...(asUser ? { asUser } : {}) });
    if (gen !== generation) return;
    if (!res.ok) {
      if (res.error === 'unauthenticated') onSignedOut?.();
      throw new Error(res.error);
    }
    revision = res.revision ?? 0;
    const tables = res.tables ?? {};
    const isEmpty = TABLE_NAMES.every((t) => !tables[t]?.length);
    const adopt = Boolean(carry) && isEmpty && !readOnly;
    const data = adopt
      ? { ...emptyData(), ...carry }
      : isEmpty
        ? seedData()
        : { ...emptyData(), ...stripEmpty(tables) };
    if (!data.settings.length) data.settings = emptyData().settings;
    const upgraded = adoptSeedQuoteSources(data);
    dirty.clear();
    set({
      data,
      status: 'ready',
      backendLabel: backend.label,
      backendRemote: backend.remote,
      pendingCarry: carry && !adopt && !readOnly ? carry : undefined,
    });
    if (readOnly) return;
    if (isEmpty) {
      TABLE_NAMES.forEach((t) => dirty.add(t));
      scheduleSave();
    } else if (upgraded) {
      dirty.add('instruments');
      scheduleSave();
    }
  } catch (err) {
    if (gen !== generation) return;
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

/** Replace the account's data with the figures entered before signing in. */
export function adoptCarry() {
  const carry = state.pendingCarry;
  if (!carry) return;
  set({ pendingCarry: undefined });
  replaceAll(carry);
}

/** Keep the account's data and forget the calculator's figures. */
export function dropCarry() {
  set({ pendingCarry: undefined });
}

function scheduleSave() {
  if (state.readOnly || state.demo) return;
  clearTimeout(timer);
  timer = setTimeout(() => void flush(), 500);
}

let saving: Promise<boolean> | undefined;

/**
 * Write pending changes now. Resolves to true only when nothing is left
 * unsaved: a caller about to discard the in-memory copy (locking, signing
 * out, reloading) must not go ahead on false.
 */
export async function flush(): Promise<boolean> {
  clearTimeout(timer);
  // A save already under way has taken its tables off the dirty list: wait
  // for it rather than reporting "nothing to save" while it is still running.
  while (saving) await saving;
  if (!backend || state.readOnly || state.demo) return true;
  if (!dirty.size) return state.status !== 'error' && state.status !== 'conflict';
  saving = writeDirty().finally(() => (saving = undefined));
  return saving;
}

async function writeDirty(): Promise<boolean> {
  const gen = generation;
  const names = [...dirty];
  dirty.clear();
  const tables = Object.fromEntries(names.map((n) => [n, state.data[n]])) as Partial<AppData>;
  set({ status: 'saving' });
  try {
    const res = await backend!.call({ action: 'save', tables, baseRevision: revision });
    // The data changed hands meanwhile: this answer is about someone else's.
    if (gen !== generation) return false;
    if (!res.ok) {
      names.forEach((n) => dirty.add(n));
      if (res.error === 'unauthenticated') onSignedOut?.();
      set(
        res.error === 'conflict'
          ? { status: 'conflict', error: '資料已在別處被修改，請重新載入後再編輯' }
          : { status: 'error', error: res.error },
      );
      return false;
    }
    revision = res.revision ?? revision + 1;
    set({ status: 'ready', error: undefined, lastSavedAt: new Date().toISOString() });
    if (dirty.size) scheduleSave();
    return dirty.size === 0;
  } catch (err) {
    if (gen !== generation) return false;
    names.forEach((n) => dirty.add(n));
    set({ status: 'error', error: message(err) });
    return false;
  }
}

/** Another tab changed the stored data: stop saving over it until reloaded. */
export function markChangedElsewhere() {
  if (state.status === 'loading' || state.demo) return;
  clearTimeout(timer);
  set({ status: 'conflict', error: '資料已在另一個分頁變更，請重新載入' });
}

/** Drop the in-memory dataset, e.g. when the local vault is locked. */
export function clearData() {
  generation++;
  loading = undefined;
  clearTimeout(timer);
  dirty.clear();
  revision = 0;
  set({
    data: emptyData(),
    status: 'loading',
    error: undefined,
    demo: false,
    scratch: false,
    scratchEdited: false,
    pendingCarry: undefined,
    readOnly: false,
  });
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
  const edited = state.scratch && !DERIVED_TABLES.includes(table);
  set({ data: { ...state.data, [table]: rows }, ...(edited ? { scratchEdited: true } : {}) });
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
    set({ data: { ...emptyData(), ...data }, ...(state.scratch ? { scratchEdited: true } : {}) });
    return;
  }
  TABLE_NAMES.forEach((t) => dirty.add(t));
  set({ data: { ...emptyData(), ...data } });
  scheduleSave();
}
