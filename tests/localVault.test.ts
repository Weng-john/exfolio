import { beforeEach, describe, expect, it } from 'vitest';
import * as vault from '../src/web/localVault';

// The vault against an in-memory stand-in for localStorage.

const memory = new Map<string, string>();
/** When set, the next writes to storage fail the way a full disk quota does. */
let quotaExceeded = false;
(globalThis as { localStorage?: unknown }).localStorage = new Proxy(
  {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (quotaExceeded) throw new DOMException('quota', 'QuotaExceededError');
      memory.set(k, v);
    },
    removeItem: (k: string) => void memory.delete(k),
  },
  {
    ownKeys: () => [...memory.keys()],
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  },
);

const PASS = 'correct horse battery staple';
const tables = { brokers: [{ id: 'a', name: '示範券商甲' }] };
const stored = () => memory.get('exfolio.data') ?? '';

beforeEach(async () => {
  await vault.lock();
  memory.clear();
  quotaExceeded = false;
});

describe('local data vault', () => {
  it('stores plain data until a passphrase is set', async () => {
    expect(await vault.save(tables)).toEqual({ ok: true, revision: 1 });
    expect(vault.isEncrypted()).toBe(false);
    expect(stored()).toContain('示範券商甲');
    expect(await vault.read()).toEqual({ revision: 1, tables });
  });

  it('keeps only ciphertext once encrypted, and reads it back', async () => {
    await vault.save(tables);
    await vault.enableEncryption(PASS);
    expect(vault.isEncrypted()).toBe(true);
    expect(stored()).not.toContain('示範券商甲');
    expect(stored()).not.toContain('brokers');
    expect(await vault.read()).toEqual({ revision: 1, tables });
  });

  it('refuses a short passphrase', async () => {
    await expect(vault.enableEncryption('short')).rejects.toThrow();
    expect(vault.isEncrypted()).toBe(false);
  });

  it('is locked in a new tab and opens only with the right passphrase', async () => {
    await vault.save(tables);
    await vault.enableEncryption(PASS);
    await vault.lock();
    expect(vault.isLocked()).toBe(true);
    await expect(vault.read()).rejects.toThrow('locked');
    expect(await vault.unlock('the wrong passphrase')).toBe(false);
    expect(vault.isLocked()).toBe(true);
    expect(await vault.unlock(PASS)).toBe(true);
    expect(await vault.read()).toEqual({ revision: 1, tables });
  });

  it('uses a fresh IV for every save', async () => {
    await vault.enableEncryption(PASS);
    await vault.save(tables);
    const first = JSON.parse(stored());
    await vault.save(tables);
    const second = JSON.parse(stored());
    expect(second.iv).not.toBe(first.iv);
    expect(second.data).not.toBe(first.data);
    expect(second.salt).toBe(first.salt);
  });

  it('detects tampering instead of returning altered data', async () => {
    await vault.save(tables);
    await vault.enableEncryption(PASS);
    const sealed = JSON.parse(stored());
    const flipped = sealed.data.slice(0, -4) + (sealed.data.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    memory.set('exfolio.data', JSON.stringify({ ...sealed, data: flipped }));
    await expect(vault.read()).rejects.toThrow();
  });

  it('can go back to plain storage and change the passphrase', async () => {
    await vault.save(tables);
    await vault.enableEncryption(PASS);
    await vault.enableEncryption('another long passphrase');
    await vault.lock();
    expect(await vault.unlock(PASS)).toBe(false);
    expect(await vault.unlock('another long passphrase')).toBe(true);
    await vault.disableEncryption();
    expect(vault.isEncrypted()).toBe(false);
    expect(await vault.read()).toEqual({ revision: 1, tables });
  });

  it('handles a dataset far larger than one argument list', async () => {
    const big = {
      priceHistory: Array.from({ length: 40_000 }, (_, i) => ({ id: `p${i}`, close: i })),
    };
    await vault.enableEncryption(PASS);
    await vault.save(big);
    expect((await vault.read()).tables).toEqual(big);
  });

  it('erases everything of this site and nothing else', async () => {
    await vault.save(tables);
    memory.set('exfolio.theme', 'dark');
    memory.set('exfolio.session', 'x');
    memory.set('another-site.key', 'keep');
    vault.dropBackendLeftovers();
    expect(memory.has('exfolio.session')).toBe(false);
    expect(memory.has('exfolio.theme')).toBe(true);
    await vault.eraseEverything();
    expect([...memory.keys()]).toEqual(['another-site.key']);
  });
});

describe('operations that overlap', () => {
  it('never writes plaintext when a lock arrives during a save', async () => {
    await vault.enableEncryption(PASS);
    await vault.save(tables);
    // Not awaited: the lock is requested while the save is still decrypting.
    const saving = vault.save({ accounts: [{ id: 'x' }] });
    const locking = vault.lock();
    await Promise.all([saving, locking]);
    expect(vault.isEncrypted()).toBe(true);
    expect(stored()).not.toContain('示範券商甲');
    expect(vault.isLocked()).toBe(true);
    expect(await vault.unlock(PASS)).toBe(true);
    expect((await vault.read()).tables).toEqual({ ...tables, accounts: [{ id: 'x' }] });
  });

  it('refuses to save over an encrypted record once locked', async () => {
    await vault.enableEncryption(PASS);
    await vault.save(tables);
    await vault.lock();
    const before = stored();
    await expect(vault.save({ brokers: [] })).rejects.toThrow('locked');
    expect(stored()).toBe(before);
  });

  it('stays decryptable when encryption is switched on twice at once', async () => {
    await vault.save(tables);
    await Promise.all([vault.enableEncryption(PASS), vault.enableEncryption(PASS)]);
    await vault.lock();
    expect(await vault.unlock(PASS)).toBe(true);
    expect(await vault.read()).toEqual({ revision: 1, tables });
  });

  it('keeps a save made while encryption is being switched on', async () => {
    await vault.save(tables);
    const enabling = vault.enableEncryption(PASS);
    const saving = vault.save({ accounts: [{ id: 'x' }] });
    await Promise.all([enabling, saving]);
    expect(vault.isEncrypted()).toBe(true);
    expect(await vault.read()).toEqual({
      revision: 2,
      tables: { ...tables, accounts: [{ id: 'x' }] },
    });
  });

  it('rejects a save based on a revision another tab has moved past', async () => {
    await vault.save(tables, 0);
    await vault.save({ accounts: [{ id: 'other-tab' }] }, 1);
    expect(await vault.save({ brokers: [] }, 1)).toEqual({ ok: false, revision: 2 });
    expect((await vault.read()).tables).toEqual({ ...tables, accounts: [{ id: 'other-tab' }] });
  });
});

describe('storage failures', () => {
  it('reports a failed save and leaves the stored record as it was', async () => {
    await vault.enableEncryption(PASS);
    await vault.save(tables);
    const before = stored();
    quotaExceeded = true;
    await expect(vault.save({ brokers: [] })).rejects.toThrow();
    quotaExceeded = false;
    expect(stored()).toBe(before);
    expect(await vault.read()).toEqual({ revision: 1, tables });
  });

  it('does not switch keys when the ciphertext could not be stored', async () => {
    await vault.save(tables);
    quotaExceeded = true;
    await expect(vault.enableEncryption(PASS)).rejects.toThrow();
    quotaExceeded = false;
    // Still plain and still usable: nothing was half-switched.
    expect(vault.isEncrypted()).toBe(false);
    expect(await vault.save({ accounts: [] })).toEqual({ ok: true, revision: 2 });
    expect(stored()).toContain('示範券商甲');
  });

  it('keeps going after an operation fails', async () => {
    quotaExceeded = true;
    await expect(vault.save(tables)).rejects.toThrow();
    quotaExceeded = false;
    expect(await vault.save(tables)).toEqual({ ok: true, revision: 1 });
  });
});
