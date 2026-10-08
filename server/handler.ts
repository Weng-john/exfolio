import type { IncomingMessage, ServerResponse } from 'node:http';
import { fetchHistory, fetchQuotes } from './quotes';
import * as auth from './auth';
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

  if (auth.authOff()) return data(request, localDataFile(), false);

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
      return data(request, userDataFile(user.id), false);
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

export async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let response: ApiResponse;
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
