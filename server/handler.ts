import type { IncomingMessage, ServerResponse } from 'node:http';
import { fetchHistory, fetchQuotes } from './quotes';
import * as auth from './auth';
import * as integrations from './integrations';
import { ApiError } from './auth';
import { loadStore, localDataFile, saveTables, userDataFile } from './store';
import type { ApiRequest, ApiResponse } from '../src/core/api';

// One POST endpoint taking { action, ... }: the same protocol the Google Apps
// Script backend speaks, so the frontend needs a single remote adapter.

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 20 * 1024 * 1024) throw new Error('Request body too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function dispatch(request: ApiRequest): Promise<ApiResponse> {
  try {
    return await route(request);
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: err.code };
    throw err;
  }
}

async function route(request: ApiRequest): Promise<ApiResponse> {
  // Open to anyone: nothing here reveals or changes member data.
  switch (request.action) {
    case 'ping':
      return { ok: true, backend: 'node' };
    case 'config':
      return { ok: true, config: await auth.getConfig() };
  }

  if (auth.authOff()) {
    return (await exchange(request, LOCAL_USER)) ?? data(request, localDataFile(), false);
  }

  switch (request.action) {
    case 'register':
      return { ok: true, ...(await auth.register(request)) };
    case 'login':
      return { ok: true, ...(await auth.login(request)) };
    case 'loginGoogle':
      return { ok: true, ...(await auth.loginGoogle(request)) };
    case 'logout':
      await auth.logout(request.session);
      return { ok: true };
  }

  // Everything below needs an active, signed-in member.
  const user = await auth.authenticate(request.session);
  switch (request.action) {
    case 'me':
      return { ok: true, user: auth.toPublic(user) };
    case 'updateProfile':
      return { ok: true, user: await auth.updateProfile(user, request) };
    case 'changePassword':
      return { ok: true, user: await auth.changePassword(user, request, request.session) };
    case 'linkGoogle':
      return { ok: true, user: await auth.linkGoogle(user, request) };
    case 'adminUsers':
      return { ok: true, users: await auth.listUsers(user) };
    case 'adminUpdateUser':
      return { ok: true, user: await auth.adminUpdateUser(user, request) };
    case 'adminDeleteUser':
      await auth.adminDeleteUser(user, request);
      await integrations.removeIntegrations(String(request.userId));
      return { ok: true };
    case 'adminSetConfig':
      return { ok: true, config: await auth.adminSetConfig(user, request) };
    case 'adminAudit':
      return { ok: true, audit: await auth.listAudit(user) };
    case 'load': {
      const target = await auth.resolveReadTarget(user, request.asUser);
      return data(request, userDataFile(target), target !== user.id);
    }
    default:
      return (await exchange(request, user.id)) ?? data(request, userDataFile(user.id), false);
  }
}

/** Owner of exchange connections when authentication is off. */
const LOCAL_USER = 'local';

/** Exchange connections: always the caller's own, never another member's. */
async function exchange(request: ApiRequest, userId: string): Promise<ApiResponse | undefined> {
  switch (request.action) {
    case 'integrationStatus':
      return { ok: true, integrations: await integrations.integrationStatus(userId) };
    case 'integrationSave':
      return { ok: true, integrations: await integrations.integrationSave(userId, request) };
    case 'integrationDelete':
      return { ok: true, integrations: await integrations.integrationDelete(userId, request.id) };
    case 'integrationSync':
      return { ok: true, snapshot: await integrations.integrationSync(userId, request.id) };
    case 'integrationTrades':
      return { ok: true, trades: await integrations.integrationTrades(userId, request) };
    default:
      return undefined;
  }
}

/** Data and market actions against one member's file. */
async function data(request: ApiRequest, file: string, readOnly: boolean): Promise<ApiResponse> {
  switch (request.action) {
    case 'load': {
      const store = await loadStore(file);
      return { ok: true, revision: store.revision, tables: store.tables };
    }
    case 'save': {
      if (readOnly) return { ok: false, error: 'forbidden' };
      const result = await saveTables(file, request.tables, request.baseRevision);
      return result.conflict
        ? { ok: false, error: 'conflict', revision: result.revision }
        : { ok: true, revision: result.revision };
    }
    case 'quotes':
      return { ok: true, quotes: await fetchQuotes(request.items) };
    case 'history':
      return { ok: true, history: await fetchHistory(request.items, request.from) };
    default:
      return { ok: false, error: `Unknown action: ${(request as { action?: string }).action}` };
  }
}

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/** Host names this backend answers to: loopback, plus any the operator lists. */
function allowedHosts(): string[] {
  const extra = (process.env.EXFOLIO_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return [...LOOPBACK_HOSTS, ...extra];
}

const hostName = (host: string) => host.toLowerCase().replace(/:\d+$/, '');

/**
 * Why a request must be refused, or '' when it may proceed.
 *
 * A browser lets any web page POST plain text to a server on this machine,
 * so the address alone proves nothing. Two checks close that door: the Host
 * header must name this machine (a hostile domain made to resolve to
 * 127.0.0.1 fails here), and a request sent by a page must come from a page
 * this server itself served.
 */
export function hostAllowed(host: string | undefined): boolean {
  return Boolean(host) && allowedHosts().includes(hostName(host!));
}

export function refusal(headers: IncomingMessage['headers']): string {
  const host = headers.host;
  if (!host || !hostAllowed(host)) return 'Host not allowed';
  // Browsers label every request with where it came from; a page on another
  // site is refused even if it manages to omit an Origin.
  const site = headers['sec-fetch-site'];
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') {
    return 'Origin not allowed';
  }
  const origin = headers.origin;
  if (!origin) return '';
  try {
    const from = new URL(origin);
    const web = from.protocol === 'http:' || from.protocol === 'https:';
    return web && from.host.toLowerCase() === host.toLowerCase() ? '' : 'Origin not allowed';
  } catch {
    return 'Origin not allowed';
  }
}

export async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let response: ApiResponse;
  const refused = refusal(req.headers);
  if (refused) {
    res.statusCode = 403;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: refused }));
    return;
  }
  try {
    if (req.method !== 'POST') {
      response = { ok: false, error: 'Use POST' };
    } else {
      response = await dispatch(JSON.parse(await readBody(req)) as ApiRequest);
    }
  } catch (err) {
    response = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(response));
}
