import { beforeEach, describe, expect, it } from 'vitest';
import * as vault from '../src/web/localVault';

// The vault against an in-memory stand-in for localStorage.

const memory = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = new Proxy(
  {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  },
  {
    ownKeys: () => [...memory.keys()],
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  },
);

const data = { revision: 3, tables: { brokers: [{ id: 'a', name: '示範券商甲' }] } };

beforeEach(() => {
  memory.clear();
  vault.lock();
});

describe('local data vault', () => {
  it('stores plain data until a passphrase is set', async () => {
    await vault.write(data);
    expect(vault.isEncrypted()).toBe(false);
    expect(memory.get('exfolio.data')).toContain('示範券商甲');
    expect(await vault.read()).toEqual(data);
  });

  it('keeps only ciphertext once encrypted, and reads it back', async () => {
    await vault.write(data);
    await vault.enableEncryption('correct horse battery');
    const stored = memory.get('exfolio.data')!;
    expect(vault.isEncrypted()).toBe(true);
    expect(stored).not.toContain('示範券商甲');
    expect(stored).not.toContain('brokers');
    expect(await vault.read()).toEqual(data);
  });

  it('is locked in a new tab and opens only with the right passphrase', async () => {
    await vault.write(data);
    await vault.enableEncryption('correct horse battery');
    vault.lock();
    expect(vault.isLocked()).toBe(true);
    await expect(vault.read()).rejects.toThrow('locked');
    expect(await vault.unlock('wrong passphrase')).toBe(false);
    expect(vault.isLocked()).toBe(true);
    expect(await vault.unlock('correct horse battery')).toBe(true);
    expect(await vault.read()).toEqual(data);
  });

  it('uses a fresh IV for every save', async () => {
    await vault.enableEncryption('correct horse battery');
    await vault.write(data);
    const first = JSON.parse(memory.get('exfolio.data')!);
    await vault.write(data);
    const second = JSON.parse(memory.get('exfolio.data')!);
    expect(second.iv).not.toBe(first.iv);
    expect(second.data).not.toBe(first.data);
    expect(second.salt).toBe(first.salt);
  });

  it('detects tampering instead of returning altered data', async () => {
    await vault.write(data);
    await vault.enableEncryption('correct horse battery');
    const sealed = JSON.parse(memory.get('exfolio.data')!);
    const flipped = sealed.data.slice(0, -4) + (sealed.data.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    memory.set('exfolio.data', JSON.stringify({ ...sealed, data: flipped }));
    await expect(vault.read()).rejects.toThrow();
  });

  it('can go back to plain storage', async () => {
    await vault.write(data);
    await vault.enableEncryption('correct horse battery');
    await vault.disableEncryption();
    expect(vault.isEncrypted()).toBe(false);
    expect(await vault.read()).toEqual(data);
  });

  it('handles a dataset far larger than one argument list', async () => {
    const big = {
      revision: 1,
      tables: {
        priceHistory: Array.from({ length: 40_000 }, (_, i) => ({ id: `p${i}`, close: i })),
      },
    };
    await vault.enableEncryption('correct horse battery');
    await vault.write(big);
    expect(await vault.read()).toEqual(big);
  });

  it('erases everything of this site and nothing else', async () => {
    await vault.write(data);
    memory.set('exfolio.theme', 'dark');
    memory.set('exfolio.session', 'x');
    memory.set('another-site.key', 'keep');
    vault.dropBackendLeftovers();
    expect(memory.has('exfolio.session')).toBe(false);
    expect(memory.has('exfolio.theme')).toBe(true);
    vault.eraseEverything();
    expect([...memory.keys()]).toEqual(['another-site.key']);
  });
});
