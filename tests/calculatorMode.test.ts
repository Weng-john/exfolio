import { beforeEach, describe, expect, it } from 'vitest';

// Calculator mode keeps a visitor's figures in memory only; signing in can
// take them along. Runs against browser storage standing in for a backend.

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
memory.set('exfolio.backend', JSON.stringify({ mode: 'browser', url: '/api' }));

const store = await import('../src/web/store');
const auth = await import('../src/web/auth');
const vault = await import('../src/web/localVault');

const broker = (name: string) => ({ id: 'b1', name });
const stored = () => memory.get('exfolio.data') ?? '';

beforeEach(async () => {
  await vault.eraseEverything();
  memory.set('exfolio.backend', JSON.stringify({ mode: 'browser', url: '/api' }));
});

describe('calculator mode', () => {
  it('starts from the catalogue and never writes anything', async () => {
    store.loadScratch();
    const state = store.getState();
    expect(state).toMatchObject({ scratch: true, demo: true, scratchEdited: false });
    expect(state.data.instruments.length).toBeGreaterThan(100);
    store.upsertRow('brokers', broker('試算券商'));
    expect(await store.flush()).toBe(true);
    expect(stored()).toBe('');
    expect(store.getState().scratchEdited).toBe(true);
  });

  it('does not count refreshed prices as the visitor’s own figures', () => {
    store.loadScratch();
    store.setTable('prices', []);
    expect(store.scratchToCarry()).toBeUndefined();
  });

  it('fills an empty account with the figures entered before signing in', async () => {
    store.loadScratch();
    store.upsertRow('brokers', broker('試算券商'));
    const carry = store.scratchToCarry();
    expect(carry).toBeDefined();
    await store.initStore(undefined, carry);
    expect(store.getState()).toMatchObject({ scratch: false, demo: false });
    expect(store.getState().pendingCarry).toBeUndefined();
    expect(await store.flush()).toBe(true);
    expect(stored()).toContain('試算券商');
  });

  it('leaves an account that has data alone until the member chooses', async () => {
    await store.initStore();
    store.upsertRow('brokers', broker('帳號原有'));
    expect(await store.flush()).toBe(true);

    store.loadScratch();
    store.upsertRow('brokers', broker('試算券商'));
    await store.initStore(undefined, store.scratchToCarry());
    expect(store.getState().data.brokers).toEqual([broker('帳號原有')]);
    expect(store.getState().pendingCarry?.brokers).toEqual([broker('試算券商')]);

    store.dropCarry();
    expect(store.getState().pendingCarry).toBeUndefined();
    expect(store.getState().data.brokers).toEqual([broker('帳號原有')]);
  });

  it('replaces the account data only when the member says so', async () => {
    await store.initStore();
    store.upsertRow('brokers', broker('帳號原有'));
    await store.flush();
    store.loadScratch();
    store.upsertRow('brokers', broker('試算券商'));
    await store.initStore(undefined, store.scratchToCarry());
    store.adoptCarry();
    expect(await store.flush()).toBe(true);
    expect(stored()).toContain('試算券商');
    expect(stored()).not.toContain('帳號原有');
  });

  it('opens data from an older visit with figures marked as the visitor’s', () => {
    store.loadScratch({ brokers: [broker('舊資料')] });
    expect(store.scratchToCarry()?.brokers).toEqual([broker('舊資料')]);
  });

  it('ignores a member load that finishes after the visitor switched to the calculator', async () => {
    await store.initStore();
    store.upsertRow('brokers', broker('帳號原有'));
    await store.flush();
    // Sign-out happens while a load is still on its way.
    const late = store.initStore(undefined, undefined);
    store.loadScratch();
    await late;
    expect(store.getState()).toMatchObject({ scratch: true, scratchEdited: false });
    expect(store.getState().data.brokers).toEqual([]);
    expect(store.scratchToCarry()).toBeUndefined();
  });

  it('starts a separate load for a different request instead of reusing the pending one', async () => {
    store.loadScratch();
    store.upsertRow('brokers', broker('試算券商'));
    const carry = store.scratchToCarry();
    const plain = store.initStore();
    const withCarry = store.initStore(undefined, carry);
    expect(withCarry).not.toBe(plain);
    await Promise.all([plain, withCarry]);
    // The later request wins; the earlier one changes nothing when it lands.
    expect(store.getState().data.brokers).toEqual([broker('試算券商')]);
  });

  it('drops the member data from memory as soon as they sign out', async () => {
    await store.initStore();
    store.upsertRow('brokers', broker('帳號原有'));
    expect(await auth.logout()).toBe(true);
    expect(store.getState().data.brokers).toEqual([]);
    expect(store.scratchToCarry()).toBeUndefined();
  });

  it('saves pending changes before signing out', async () => {
    await store.initStore();
    store.upsertRow('brokers', broker('剛新增'));
    expect(await auth.logout()).toBe(true);
    expect(stored()).toContain('剛新增');
  });

  it('does not reuse or accept a load begun for the previous person', async () => {
    await store.initStore();
    store.upsertRow('brokers', broker('前一位'));
    await store.flush();
    const old = store.initStore();
    // Someone else signs in while that load is on its way.
    store.newIdentity();
    store.loadScratch();
    store.upsertRow('brokers', broker('新的人'));
    const fresh = store.initStore(undefined, store.scratchToCarry());
    expect(fresh).not.toBe(old);
    await Promise.all([old, fresh]);
    expect(store.getState().data.brokers).toEqual([broker('前一位')]);
    expect(store.getState().pendingCarry?.brokers).toEqual([broker('新的人')]);
  });

  it('refuses edits while signing out, so none is silently lost', async () => {
    await store.initStore();
    const leaving = auth.logout();
    store.upsertRow('brokers', broker('登出中新增'));
    expect(store.getState().data.brokers).toEqual([]);
    expect(store.getState().error).toMatch(/登出/);
    expect(await leaving).toBe(true);
    expect(stored()).not.toContain('登出中新增');
  });

  it('joins a second sign-out to the first instead of running it twice', async () => {
    await store.initStore();
    const first = auth.logout();
    expect(auth.logout()).toBe(first);
    expect(await first).toBe(true);
  });
});
