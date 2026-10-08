import type { IncomingMessage, ServerResponse } from 'node:http';
import { fetchQuotes } from './quotes';
import { loadStore, saveTables } from './store';
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
  switch (request.action) {
    case 'ping':
      return { ok: true, backend: 'node' };
    case 'load': {
      const store = await loadStore();
      return { ok: true, revision: store.revision, tables: store.tables };
    }
    case 'save': {
      const result = await saveTables(request.tables, request.baseRevision);
      return result.conflict
        ? { ok: false, error: 'conflict', revision: result.revision }
        : { ok: true, revision: result.revision };
    }
    case 'quotes':
      return { ok: true, quotes: await fetchQuotes(request.items) };
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
