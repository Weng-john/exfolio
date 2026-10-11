// The dataset as kept in this browser's localStorage, optionally encrypted.
//
// Unencrypted, anything that can run script on this site's origin can read
// it: a browser extension, the next person at a shared computer, or another
// page served from the same origin (on GitHub Pages every project of one
// account shares `<account>.github.io`). With a passphrase the stored copy
// is AES-GCM ciphertext and the key lives only in this tab's memory.
//
// Encryption protects the stored copy. It does not stop script that already
// runs on this origin: such script can delete or replace the record, or
// watch the page once it is unlocked.
//
// Every operation runs one at a time, here and — through the Web Locks API
// where the browser has it — across tabs, and uses the key it started with.
// A record that is encrypted is never rewritten as plain text.

const DATA_KEY = 'exfolio.data';
const LOCK_NAME = 'exfolio.data';
const ITERATIONS = 600_000;
export const MIN_PASSPHRASE_LENGTH = 12;

export interface StoredData {
  revision: number;
  tables: object;
}

interface Sealed {
  vault: 1;
  /** PBKDF2 rounds used for this record. */
  iterations: number;
  salt: string;
  iv: string;
  data: string;
}

type Bytes = Uint8Array<ArrayBuffer>;

interface KeyRing {
  key: CryptoKey;
  salt: Bytes;
  iterations: number;
}

/** Thrown when the stored record is encrypted and no passphrase has been given. */
export class LockedError extends Error {
  constructor() {
    super('locked');
  }
}

let ring: KeyRing | undefined;

function b64(bytes: Uint8Array): string {
  // Chunked, so a large dataset does not overflow the argument list.
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(text);
}

function unb64(text: string): Bytes {
  const binary = atob(text);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function raw(): StoredData | Sealed | undefined {
  try {
    return JSON.parse(localStorage.getItem(DATA_KEY) ?? '') as StoredData | Sealed;
  } catch {
    return undefined;
  }
}

const isSealed = (value: StoredData | Sealed | undefined): value is Sealed =>
  Boolean(value && (value as Sealed).vault === 1);

export function isEncrypted(): boolean {
  return isSealed(raw());
}

/** Encrypted data is present and no passphrase has been given in this tab. */
export function isLocked(): boolean {
  return isEncrypted() && !ring;
}

/** Whether anything is stored at all. */
export function hasData(): boolean {
  return raw() !== undefined;
}

// ---- One operation at a time ------------------------------------------------

let queue: Promise<unknown> = Promise.resolve();

/** Run `task` after everything queued before it, in this tab and in others. */
function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks;
  const guarded = () => (locks ? (locks.request(LOCK_NAME, task) as Promise<T>) : task());
  const next = queue.then(guarded, guarded);
  queue = next.catch(() => undefined);
  return next;
}

/** Resolves once every operation queued so far has finished, whether it succeeded or not. */
export function settled(): Promise<void> {
  return queue.then(
    () => undefined,
    () => undefined,
  );
}

// ---- Crypto -----------------------------------------------------------------

async function deriveKey(passphrase: string, salt: Bytes, iterations: number): Promise<CryptoKey> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('這個網址不是安全連線（需要 https 或 localhost），無法加密');
  }
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function open(sealed: Sealed, key: CryptoKey): Promise<StoredData> {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(sealed.iv) },
    key,
    unb64(sealed.data),
  );
  return JSON.parse(new TextDecoder().decode(plain)) as StoredData;
}

async function seal(data: StoredData, keys: KeyRing): Promise<Sealed> {
  // A fresh IV for every save: AES-GCM must never reuse one under a key.
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    keys.key,
    new TextEncoder().encode(JSON.stringify(data)),
  );
  return {
    vault: 1,
    iterations: keys.iterations,
    salt: b64(keys.salt),
    iv: b64(iv),
    data: b64(new Uint8Array(cipher)),
  };
}

/** Read with the keys this operation started with. */
async function readWith(keys: KeyRing | undefined): Promise<StoredData> {
  const stored = raw();
  if (!stored) return { revision: 0, tables: {} };
  if (!isSealed(stored)) return stored;
  if (!keys) throw new LockedError();
  return open(stored, keys.key);
}

/** Write with the keys this operation started with; never downgrade a sealed record. */
async function writeWith(data: StoredData, keys: KeyRing | undefined): Promise<void> {
  if (!keys) {
    if (isEncrypted()) throw new LockedError();
    localStorage.setItem(DATA_KEY, JSON.stringify(data));
    return;
  }
  localStorage.setItem(DATA_KEY, JSON.stringify(await seal(data, keys)));
}

// ---- Operations -------------------------------------------------------------

/** Try a passphrase. Returns false when it is wrong. */
export function unlock(passphrase: string): Promise<boolean> {
  return exclusive(async () => {
    const stored = raw();
    if (!isSealed(stored)) return true;
    const salt = unb64(stored.salt);
    const iterations = stored.iterations ?? ITERATIONS;
    const key = await deriveKey(passphrase, salt, iterations);
    try {
      await open(stored, key);
    } catch {
      return false;
    }
    ring = { key, salt, iterations };
    return true;
  });
}

/** Forget the key once pending operations are done. */
export function lock(): Promise<void> {
  return exclusive(async () => {
    ring = undefined;
  });
}

export function read(): Promise<StoredData> {
  return exclusive(() => readWith(ring));
}

export type SaveResult = { ok: true; revision: number } | { ok: false; revision: number };

/**
 * Merge tables into the stored dataset as one step. Rejects a stale
 * `baseRevision` — another tab saved in between — instead of overwriting.
 */
export function save(tables: object, baseRevision?: number): Promise<SaveResult> {
  return exclusive(async () => {
    const keys = ring;
    const stored = await readWith(keys);
    if (baseRevision !== undefined && baseRevision !== stored.revision) {
      return { ok: false, revision: stored.revision };
    }
    const next = { revision: stored.revision + 1, tables: { ...stored.tables, ...tables } };
    await writeWith(next, keys);
    return { ok: true, revision: next.revision };
  });
}

/**
 * Start encrypting the stored data, or change the passphrase. The new key
 * replaces the old one only after the ciphertext is safely stored.
 */
export function enableEncryption(passphrase: string): Promise<void> {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    return Promise.reject(new Error(`密碼至少 ${MIN_PASSPHRASE_LENGTH} 個字元`));
  }
  return exclusive(async () => {
    const data = await readWith(ring);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const next: KeyRing = {
      key: await deriveKey(passphrase, salt, ITERATIONS),
      salt,
      iterations: ITERATIONS,
    };
    localStorage.setItem(DATA_KEY, JSON.stringify(await seal(data, next)));
    ring = next;
  });
}

/** Store the data unencrypted again. Needs the vault unlocked. */
export function disableEncryption(): Promise<void> {
  return exclusive(async () => {
    const data = await readWith(ring);
    localStorage.setItem(DATA_KEY, JSON.stringify(data));
    ring = undefined;
  });
}

/** Erase everything this site keeps in this browser. Cannot be undone. */
export function eraseEverything(): Promise<void> {
  return exclusive(async () => {
    ring = undefined;
    for (const name of Object.keys(localStorage)) {
      if (name.startsWith('exfolio.')) localStorage.removeItem(name);
    }
  });
}

/** Remove settings only the full edition uses, e.g. left over from an older visit. */
export function dropBackendLeftovers() {
  localStorage.removeItem('exfolio.session');
  localStorage.removeItem('exfolio.backend');
}

/** Call `listener` when another tab changes the stored record. */
export function onExternalChange(listener: () => void): () => void {
  const handler = (event: StorageEvent) => {
    if (event.key === DATA_KEY || event.key === null) listener();
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}
