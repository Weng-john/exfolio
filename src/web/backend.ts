import type { ApiRequest, ApiResponse } from '@core/api';
import { IS_PUBLIC, PUBLIC_GAS_URL } from './edition';
import * as vault from './localVault';
import { staticQuotes } from './staticQuotes';

// Where data is stored. Connection settings stay in this browser's
// localStorage: they are never part of the built site or the repository.

export type BackendMode = 'auto' | 'remote' | 'browser';

export interface BackendConfig {
  mode: BackendMode;
  /** Remote endpoint: the local Node server (`/api`) or a GAS web app URL. */
  url: string;
}

const CONFIG_KEY = 'exfolio.backend';
const SESSION_KEY = 'exfolio.session';
const DEFAULT_CONFIG: BackendConfig = { mode: 'auto', url: '/api' };

export function loadBackendConfig(): BackendConfig {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(localStorage.getItem(CONFIG_KEY) ?? '{}') };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveBackendConfig(config: BackendConfig) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

// The public edition shares its origin (<user>.github.io) with every other
// Pages site of the same account, so it keeps the session in memory only:
// closing or reloading the tab signs the member out.
let memorySession = '';

/** Session token of the signed-in member, kept in this browser only. */
export function getSession(): string {
  if (IS_PUBLIC) return memorySession;
  return localStorage.getItem(SESSION_KEY) ?? '';
}

export function setSession(token: string | undefined) {
  if (IS_PUBLIC) memorySession = token ?? '';
  else if (token) localStorage.setItem(SESSION_KEY, token);
  else localStorage.removeItem(SESSION_KEY);
}

export interface Backend {
  label: string;
  /** False for browser-only storage, which has no accounts. */
  remote: boolean;
  call(request: ApiRequest): Promise<ApiResponse>;
}

function remoteBackend(config: BackendConfig): Backend {
  return {
    label: config.url.startsWith('/') ? '本機 Node 後端' : '遠端後端（GAS）',
    remote: true,
    async call(request) {
      // text/plain keeps the request "simple", so a GAS web app needs no
      // CORS preflight. Both backends parse the body as JSON regardless.
      const res = await fetch(config.url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ ...request, session: getSession() || undefined }),
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`後端回應 HTTP ${res.status}`);
      return (await res.json()) as ApiResponse;
    },
  };
}

/** Storage in this browser only: lets the static site work with no backend. */
function browserBackend(): Backend {
  return {
    label: '此瀏覽器（無後端）',
    remote: false,
    async call(request) {
      switch (request.action) {
        case 'ping':
          return { ok: true, backend: 'browser' };
        case 'load':
          return { ok: true, ...(await vault.read()) };
        case 'save': {
          const result = await vault.save(request.tables, request.baseRevision);
          return result.ok
            ? { ok: true, revision: result.revision }
            : { ok: false, error: 'conflict', revision: result.revision };
        }
        case 'quotes':
          return { ok: true, quotes: await staticQuotes(request.items) };
        case 'history':
          return { ok: false, error: '無後端模式無法取得歷史價格' };
        case 'config':
          return {
            ok: true,
            config: { authRequired: false, registration: 'approval', hasUsers: true },
          };
        default:
          return { ok: false, error: '無後端模式沒有會員功能' };
      }
    },
  };
}

/**
 * Public edition: members' data goes to the Apps Script backend; prices come
 * from the published snapshot and Binance, the same as for visitors, which
 * is faster than asking Apps Script and needs no session.
 */
function publicBackend(): Backend {
  const remote = remoteBackend({ mode: 'remote', url: PUBLIC_GAS_URL });
  return {
    label: '會員資料（Google 試算表）',
    remote: true,
    call(request) {
      if (request.action === 'quotes' || request.action === 'history') {
        return browserBackend().call(request);
      }
      return remote.call(request);
    },
  };
}

/** Public edition without a members' backend: prices only, nothing stored. */
function calculatorBackend(): Backend {
  const browser = browserBackend();
  return {
    label: '試算模式（不儲存）',
    remote: false,
    call(request) {
      if (request.action === 'quotes' || request.action === 'history') return browser.call(request);
      if (request.action === 'ping') return browser.call(request);
      if (request.action === 'config') {
        return Promise.resolve({
          ok: true,
          config: { authRequired: true, registration: 'approval', hasUsers: false },
        });
      }
      return Promise.resolve({ ok: false, error: '這個網站沒有提供會員功能' });
    },
  };
}

/** Pick the backend: the configured one, or the first that answers a ping. */
export async function connectBackend(config = loadBackendConfig()): Promise<Backend> {
  // The public edition ignores whatever was configured in this browser.
  if (IS_PUBLIC) return PUBLIC_GAS_URL ? publicBackend() : calculatorBackend();
  if (config.mode === 'browser') return browserBackend();
  const remote = remoteBackend(config);
  if (config.mode === 'remote') return remote;
  try {
    const pong = await remote.call({ action: 'ping' });
    if (pong.ok) return remote;
  } catch {
    // No backend at this address: fall through to browser storage.
  }
  return browserBackend();
}
