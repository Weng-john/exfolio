import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { TABLE_NAMES, type AppData } from '../src/core/types';

// Personal data lives in one JSON file outside version control. Point
// EXFOLIO_DATA_DIR somewhere else to keep it out of the repository folder.
const DATA_DIR = path.resolve(process.env.EXFOLIO_DATA_DIR ?? 'data');
const DATA_FILE = path.join(DATA_DIR, 'exfolio.json');

export interface Store {
  revision: number;
  tables: Partial<AppData>;
}

export async function loadStore(): Promise<Store> {
  try {
    return JSON.parse(await readFile(DATA_FILE, 'utf8')) as Store;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { revision: 0, tables: {} };
    throw err;
  }
}

let queue: Promise<unknown> = Promise.resolve();

/** Replace the given tables. Rejects a stale `baseRevision` as a conflict. */
export function saveTables(
  tables: Partial<AppData>,
  baseRevision?: number,
): Promise<{ revision: number; conflict: boolean }> {
  const run = async () => {
    const store = await loadStore();
    if (baseRevision !== undefined && baseRevision !== store.revision) {
      return { revision: store.revision, conflict: true };
    }
    for (const name of TABLE_NAMES) {
      const rows = tables[name];
      if (Array.isArray(rows)) (store.tables as Record<string, unknown>)[name] = rows;
    }
    store.revision += 1;
    await mkdir(DATA_DIR, { recursive: true });
    const tmp = `${DATA_FILE}.tmp`;
    await writeFile(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
    await rename(tmp, DATA_FILE);
    return { revision: store.revision, conflict: false };
  };
  // Serialise writes so two saves cannot interleave.
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}
