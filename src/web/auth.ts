import { useSyncExternalStore } from 'react';
import type { ApiRequest, ApiResponse, PublicUser, ServerConfig } from '@core/api';
import { setSession, getSession } from './backend';
import { ensureBackend, initStore, resetBackend, setSignedOutHandler } from './store';

// Who is signed in. The backend decides everything about access; this
// module only tracks the session and offers the calls the pages need.

export type AuthPhase = 'loading' | 'signedOut' | 'ready' | 'error';

export interface AuthState {
  phase: AuthPhase;
  /** Backend without accounts: browser storage or single-user mode. */
  accountless: boolean;
  config?: ServerConfig;
  user?: PublicUser;
  /** Member whose data an admin is viewing read-only. */
  viewing?: PublicUser;
  backendLabel: string;
  error?: string;
}

let state: AuthState = { phase: 'loading', accountless: false, backendLabel: '' };
const listeners = new Set<() => void>();

function set(patch: Partial<AuthState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useAuth(): AuthState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

type Ok = Extract<ApiResponse, { ok: true }>;

const MESSAGES: Record<string, string> = {
  unauthenticated: '登入已失效，請重新登入',
  forbidden: '沒有權限執行這個操作',
  pending: '帳號尚待管理員核准',
  disabled: '帳號已被停用，請聯絡管理員',
  invalid_credentials: '帳號或密碼不正確',
  username_taken: '這個帳號名稱已被使用',
  rate_limited: '嘗試次數過多，請稍後再試',
};

/** Call the backend, turning an error code into a readable message. */
export async function api(request: ApiRequest): Promise<Ok> {
  const backend = await ensureBackend();
  const res = await backend.call(request);
  if (!res.ok) {
    if (res.error === 'unauthenticated') signedOut();
    throw new Error(MESSAGES[res.error] ?? res.error);
  }
  return res;
}

function signedOut() {
  setSession(undefined);
  set({ phase: 'signedOut', user: undefined, viewing: undefined });
}

setSignedOutHandler(signedOut);

/** Find the backend and learn whether someone is already signed in. */
export async function initAuth(): Promise<void> {
  set({ phase: 'loading', error: undefined });
  try {
    const backend = await ensureBackend();
    const configRes = await backend.call({ action: 'config' });
    if (!configRes.ok) throw new Error(configRes.error);
    const config = configRes.config!;
    set({ config, backendLabel: backend.label });
    if (!config.authRequired) {
      set({ phase: 'ready', accountless: true });
      return;
    }
    set({ accountless: false });
    if (getSession()) {
      const me = await backend.call({ action: 'me' });
      if (me.ok) {
        set({ phase: 'ready', user: me.user });
        return;
      }
      setSession(undefined);
    }
    set({ phase: 'signedOut' });
  } catch (err) {
    set({ phase: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}

/** Reconnect after the backend address changed. */
export function reconnect(): Promise<void> {
  resetBackend();
  return initAuth();
}

/**
 * Stretch a password into the key sent to the backend, so neither the
 * network nor the backend ever sees the password itself. The salt is tied
 * to the account name, so the same password gives different keys per user.
 */
export async function derivePasswordKey(username: string, password: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('這個網址不是安全連線（需要 https 或 localhost），無法安全地處理密碼');
  }
  const enc = new TextEncoder();
  const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: enc.encode(`exfolio:v1:${username.trim().toLowerCase()}`),
      iterations: 200_000,
    },
    material,
    256,
  );
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function accept(res: Ok): PublicUser {
  const user = res.user!;
  if (res.session) {
    setSession(res.session);
    set({ phase: 'ready', user, viewing: undefined, config: state.config && { ...state.config, hasUsers: true } });
  }
  return user;
}

/** Returns the new member; they are signed in only when already active. */
export async function register(username: string, password: string, displayName: string): Promise<PublicUser> {
  const passwordKey = await derivePasswordKey(username, password);
  return accept(await api({ action: 'register', username, displayName, passwordKey }));
}

export async function login(username: string, password: string): Promise<PublicUser> {
  const passwordKey = await derivePasswordKey(username, password);
  return accept(await api({ action: 'login', username, passwordKey }));
}

export async function loginWithGoogle(idToken: string): Promise<PublicUser> {
  return accept(await api({ action: 'loginGoogle', idToken }));
}

export async function logout(): Promise<void> {
  try {
    await (await ensureBackend()).call({ action: 'logout' });
  } finally {
    signedOut();
  }
}

export async function updateProfile(patch: { displayName?: string; allowAdminView?: boolean }): Promise<void> {
  set({ user: (await api({ action: 'updateProfile', ...patch })).user });
}

export async function changePassword(oldPassword: string | undefined, newPassword: string): Promise<void> {
  const username = state.user!.username;
  const res = await api({
    action: 'changePassword',
    ...(oldPassword ? { oldPasswordKey: await derivePasswordKey(username, oldPassword) } : {}),
    newPasswordKey: await derivePasswordKey(username, newPassword),
  });
  set({ user: res.user });
}

export async function linkGoogle(idToken: string): Promise<void> {
  set({ user: (await api({ action: 'linkGoogle', idToken })).user });
}

/** Admin: open a consenting member's portfolio read-only. */
export async function viewAs(member: PublicUser): Promise<void> {
  set({ viewing: member });
  await initStore(member.id);
}

/** Back to the admin's own data. */
export async function stopViewing(): Promise<void> {
  set({ viewing: undefined });
  await initStore();
}
