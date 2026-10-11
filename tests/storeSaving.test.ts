import { beforeEach, describe, expect, it } from 'vitest';

// The store saving to browser storage, with storage that can be made to fail.

const memory = new Map<string, string>();
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
memory.set('exfolio.backend', JSON.stringify({ mode: 'browser', url: '/api' }));

const { lockLocalData, unlockLocalData } = await import('../src/web/auth');
const vault = await import('../src/web/localVault');
const { flush, getState, initStore, setTable, upsertRow } = await import('../src/web/store');

const PASS = 'correct horse battery staple';
const broker = (name: string) => ({ id: 'a', name });

beforeEach(async () => {
  quotaExceeded = false;
  await vault.lock();
  for (const k of [...memory.keys()]) if (k !== 'exfolio.backend') memory.delete(k);
  await initStore();
  await flush();
});

describe('saving to browser storage', () => {
  it('reports success only when nothing is left unsaved', async () => {
    upsertRow('brokers', broker('示範券商甲'));
    expect(await flush()).toBe(true);
    quotaExceeded = true;
    upsertRow('brokers', broker('示範券商乙'));
    expect(await flush()).toBe(false);
    expect(getState().status).toBe('error');
    // Still failing: asking again must not pretend the change was saved.
    expect(await flush()).toBe(false);
    quotaExceeded = false;
    upsertRow('brokers', broker('示範券商丙'));
    expect(await flush()).toBe(true);
    expect((await vault.read()).tables).toMatchObject({ brokers: [broker('示範券商丙')] });
  });

  it('waits for a save already under way instead of reporting nothing to do', async () => {
    upsertRow('brokers', broker('示範券商甲'));
    const first = flush();
    const second = flush();
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(memory.get('exfolio.data')).toContain('示範券商甲');
  });

  it('will not lock while a change could not be saved, and keeps that change', async () => {
    await vault.enableEncryption(PASS);
    quotaExceeded = true;
    upsertRow('brokers', broker('未儲存的變更'));
    expect(await lockLocalData()).toBe(false);
    expect(vault.isLocked()).toBe(false);
    expect(getState().data.brokers).toEqual([broker('未儲存的變更')]);
    quotaExceeded = false;
    expect(await flush()).toBe(true);
  });

  it('locking saves first, then drops the decrypted copy and the key', async () => {
    await vault.enableEncryption(PASS);
    setTable('brokers', [broker('示範券商甲')]);
    // Lock straight away: the pending save must land, encrypted, before the key goes.
    expect(await lockLocalData()).toBe(true);
    expect(vault.isLocked()).toBe(true);
    expect(getState().data.brokers).toEqual([]);
    expect(memory.get('exfolio.data')).not.toContain('示範券商甲');
    expect(await unlockLocalData(PASS)).toBe(true);
    await initStore();
    expect(getState().data.brokers).toEqual([broker('示範券商甲')]);
  });

  it('stops with a conflict when another tab has saved in between', async () => {
    upsertRow('brokers', broker('示範券商甲'));
    expect(await flush()).toBe(true);
    await vault.save({ accounts: [{ id: 'other-tab' }] });
    upsertRow('brokers', broker('示範券商乙'));
    expect(await flush()).toBe(false);
    expect(getState().status).toBe('conflict');
    expect((await vault.read()).tables).toMatchObject({ brokers: [broker('示範券商甲')] });
  });
});
