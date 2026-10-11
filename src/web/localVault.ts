// The dataset as kept in this browser's localStorage, optionally encrypted.
//
// Unencrypted, anything that can run script on this site's origin can read
// it: a browser extension, the next person at a shared computer, or another
// page served from the same origin (on GitHub Pages every project of one
// account shares `<account>.github.io`). With a passphrase the stored copy
// is AES-GCM ciphertext and the key lives only in this tab's memory, so it
// has to be typed again on each visit.

const DATA_KEY = 'exfolio.data';
const ITERATIONS = 310_000;

export interface StoredData {
  revision: number;
  tables: object;
}

interface Sealed {
  vault: 1;
  salt: string;
  iv: string;
  data: string;
}

let key: CryptoKey | undefined;
let salt: Bytes | undefined;

type Bytes = Uint8Array<ArrayBuffer>;

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

function unb64(text: string): Bytes {
  const binary = atob(text);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Chunked, so a large dataset does not overflow the argument list. */
function b64Large(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(text);
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
  return isEncrypted() && !key;
}

async function deriveKey(passphrase: string, withSalt: Bytes): Promise<CryptoKey> {
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
    { name: 'PBKDF2', hash: 'SHA-256', salt: withSalt, iterations: ITERATIONS },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function open(sealed: Sealed, withKey: CryptoKey): Promise<StoredData> {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(sealed.iv) },
    withKey,
    unb64(sealed.data),
  );
  return JSON.parse(new TextDecoder().decode(plain)) as StoredData;
}

/** Try a passphrase. Returns false when it is wrong. */
export async function unlock(passphrase: string): Promise<boolean> {
  const stored = raw();
  if (!isSealed(stored)) return true;
  const candidateSalt = unb64(stored.salt);
  const candidate = await deriveKey(passphrase, candidateSalt);
  try {
    await open(stored, candidate);
  } catch {
    return false;
  }
  key = candidate;
  salt = candidateSalt;
  return true;
}

/** Forget the key: the data stays encrypted until the passphrase is typed again. */
export function lock() {
  key = undefined;
  salt = undefined;
}

export async function read(): Promise<StoredData> {
  const stored = raw();
  if (!stored) return { revision: 0, tables: {} };
  if (!isSealed(stored)) return stored;
  if (!key) throw new Error('locked');
  return open(stored, key);
}

export async function write(data: StoredData): Promise<void> {
  if (!key || !salt) {
    localStorage.setItem(DATA_KEY, JSON.stringify(data));
    return;
  }
  // A fresh IV for every save: AES-GCM must never reuse one under a key.
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify(data)),
  );
  const sealed: Sealed = {
    vault: 1,
    salt: b64(salt),
    iv: b64(iv),
    data: b64Large(new Uint8Array(cipher)),
  };
  localStorage.setItem(DATA_KEY, JSON.stringify(sealed));
}

/** Start encrypting the stored data with a passphrase. */
export async function enableEncryption(passphrase: string): Promise<void> {
  const data = await read();
  const newSalt = crypto.getRandomValues(new Uint8Array(16));
  key = await deriveKey(passphrase, newSalt);
  salt = newSalt;
  await write(data);
}

/** Store the data unencrypted again. Needs the vault unlocked. */
export async function disableEncryption(): Promise<void> {
  const data = await read();
  lock();
  await write(data);
}

/** Erase everything this site keeps in this browser. Cannot be undone. */
export function eraseEverything() {
  lock();
  for (const name of Object.keys(localStorage)) {
    if (name.startsWith('exfolio.')) localStorage.removeItem(name);
  }
}

/** Remove settings only the full edition uses, e.g. left over from an older visit. */
export function dropBackendLeftovers() {
  localStorage.removeItem('exfolio.session');
  localStorage.removeItem('exfolio.backend');
}
