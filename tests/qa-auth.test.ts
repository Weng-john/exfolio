import { describe, expect, it, vi } from 'vitest';
import type { ApiResponse } from '@core/api';

const mockBackend = vi.hoisted(() => {
  let session = '';
  const backend = {
    label: 'QA backend',
    remote: true,
    call: vi.fn<(request: unknown) => Promise<ApiResponse>>(),
  };
  return {
    backend,
    connectBackend: vi.fn(async () => backend),
    getSession: () => session,
    setSession: (value: string | undefined) => {
      session = value ?? '';
    },
  };
});

vi.mock('../src/web/backend', () => mockBackend);

describe('QA: password and Google sign-in cancellation', () => {
  it('drops a late Google response after the sign-in page is left', async () => {
    const auth = await import('../src/web/auth');
    let resolveResponse!: (response: ApiResponse) => void;
    let started!: () => void;
    const requestStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    mockBackend.backend.call.mockImplementationOnce(
      () =>
        new Promise<ApiResponse>((resolve) => {
          resolveResponse = resolve;
          started();
        }),
    );

    const pending = auth.loginWithGoogle('qa-token');
    await requestStarted;
    auth.cancelSignIn();
    resolveResponse({
      ok: true,
      session: 'late-session',
      user: {
        id: 'u1',
        username: 'qa',
        displayName: 'QA',
        role: 'member',
        status: 'active',
        allowAdminView: false,
        hasPassword: false,
        googleLinked: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });

    await expect(pending).rejects.toThrow('這次登入已被取消');
    expect(mockBackend.getSession()).toBe('');
  });

  it('does not start a password login when the page is left during key derivation', async () => {
    const auth = await import('../src/web/auth');
    mockBackend.backend.call.mockClear();
    let resolveBits!: (bits: ArrayBuffer) => void;
    let started!: () => void;
    const derivationStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.stubGlobal('crypto', {
      subtle: {
        importKey: vi.fn(async () => ({})),
        deriveBits: vi.fn(
          () =>
            new Promise<ArrayBuffer>((resolve) => {
              resolveBits = resolve;
              started();
            }),
        ),
      },
    });

    try {
      const pending = auth.login('qa', 'password');
      await derivationStarted;
      auth.cancelSignIn();
      resolveBits(new Uint8Array(32).buffer);

      await expect(pending).rejects.toThrow('這次登入已被取消');
      expect(mockBackend.backend.call).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('clears member data when reconnect finds an expired session', async () => {
    const auth = await import('../src/web/auth');
    const store = await import('../src/web/store');
    mockBackend.backend.call.mockResolvedValueOnce({
      ok: true,
      session: 'qa-session',
      user: {
        id: 'u1',
        username: 'qa',
        displayName: 'QA',
        role: 'member',
        status: 'active',
        allowAdminView: false,
        hasPassword: false,
        googleLinked: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });
    await auth.loginWithGoogle('qa-token');
    store.loadScratch({ brokers: [{ id: 'b1', name: 'QA broker' }] });

    mockBackend.backend.call.mockImplementation(async (request) => {
      const action = (request as { action: string }).action;
      if (action === 'config') {
        return {
          ok: true,
          config: { authRequired: true, registration: 'approval', hasUsers: true },
        };
      }
      if (action === 'me') return { ok: false, error: 'unauthenticated' };
      throw new Error(`Unexpected request ${action}`);
    });

    await auth.initAuth();

    expect(mockBackend.getSession()).toBe('');
    expect(store.getState().data.brokers).toEqual([]);
  });
});
