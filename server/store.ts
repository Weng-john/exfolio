import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { TABLE_NAMES, type AppData } from '../src/core/types';

// Personal data lives in JSON files outside version control: one file per
// member. Point EXFOLIO_DATA_DIR elsewhere to keep it out of the repository
// folder. Read on every call so tests can redirect it.
export function dataDir(): string {
  return path.resolve(process.env.EXFOLIO_DATA_DIR ?? 'data');
}

/** Data file of the single implicit user when authentication is off. */
export function localDataFile(): string {
  return path.join(dataDir(), 'exfolio.json');
}

export function userDataFile(userId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(userId)) throw new Error('Invalid user id');
  return path.join(dataDir(), 'users', `${userId}.json`);
}

export interface Store {
  revision: number;
  tables: Partial<AppData>;
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw err;
  }
}

/** Write atomically, readable by the owner only. */
export async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(tmp, file);
}

export function loadStore(file: string): Promise<Store> {
  return readJson<Store>(file, { revision: 0, tables: {} });
}

let queue: Promise<unknown> = Promise.resolve();

/** Run tasks one at a time, so two writes can never interleave. */
export function serialize<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
}

/** Replace the given tables. Rejects a stale `baseRevision` as a conflict. */
export function saveTables(
  file: string,
  tables: Partial<AppData>,
  baseRevision?: number,
): Promise<{ revision: number; conflict: boolean }> {
  return serialize(async () => {
    const store = await loadStore(file);
    if (baseRevision !== undefined && baseRevision !== store.revision) {
      return { revision: store.revision, conflict: true };
    }
    for (const name of TABLE_NAMES) {
      const rows = tables?.[name];
      if (Array.isArray(rows)) (store.tables as Record<string, unknown>)[name] = rows;
    }
    store.revision += 1;
    await writeJson(file, store);
    return { revision: store.revision, conflict: false };
  });
}
