import type { ApiRequest, ApiResponse, QuoteResult } from '@core/api';

// Where data is stored. Connection settings stay in this browser's
// localStorage: they are never part of the built site or the repository.

export type BackendMode = 'auto' | 'remote' | 'browser';

export interface BackendConfig {
  mode: BackendMode;
  /** Remote endpoint: the local Node server (`/api`) or a GAS web app URL. */
  url: string;
}

const CONFIG_KEY = 'exfolio.backend';
const DATA_KEY = 'exfolio.data';
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

/** Session token of the signed-in member, kept in this browser only. */
export function getSession(): string {
  return localStorage.getItem(SESSION_KEY) ?? '';
}

export function setSession(token: string | undefined) {
  if (token) localStorage.setItem(SESSION_KEY, token);
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
  const read = () => {
    try {
      return JSON.parse(localStorage.getItem(DATA_KEY) ?? '') as {
        revision: number;
        tables: object;
      };
    } catch {
      return { revision: 0, tables: {} };
    }
  };
  return {
    label: '此瀏覽器（無後端）',
    remote: false,
    async call(request) {
      switch (request.action) {
        case 'ping':
          return { ok: true, backend: 'browser' };
        case 'load':
          return { ok: true, ...read() };
        case 'save': {
          const store = read();
          const next = {
            revision: store.revision + 1,
            tables: { ...store.tables, ...request.tables },
          };
          localStorage.setItem(DATA_KEY, JSON.stringify(next));
          return { ok: true, revision: next.revision };
        }
        case 'quotes': {
          const quotes: QuoteResult[] = request.items.map((item) => ({
            ...item,
            error: '無後端模式無法取得線上報價',
          }));
          return { ok: true, quotes };
        }
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

/** Pick the backend: the configured one, or the first that answers a ping. */
export async function connectBackend(config = loadBackendConfig()): Promise<Backend> {
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
