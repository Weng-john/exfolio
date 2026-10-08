import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import path from 'node:path';
import type {
  ExchangeBalance,
  ExchangePosition,
  ExchangeSnapshot,
  ExchangeTrade,
  IntegrationInfo,
  IntegrationProvider,
  IntegrationStatus,
} from '../src/core/api';
import { ApiError } from './auth';
import { dataDir, readJson, serialize, writeJson } from './store';

// Read-only exchange connections. A member's API key and secret are kept
// encrypted on this machine and are never sent back to any client. The key
// itself must be read-only: one that can trade or withdraw is refused.

interface StoredIntegration {
  id: string;
  provider: IntegrationProvider;
  label: string;
  keyHint: string;
  createdAt: string;
  lastSyncAt?: string;
  /** AES-256-GCM of JSON { apiKey, apiSecret }: iv, tag and ciphertext, base64. */
  sealed: { iv: string; tag: string; data: string };
}

const DISABLED_REASON =
  '後端未設定 EXFOLIO_SECRET_KEY，無法安全保存 API 金鑰。設定方式見 docs/INTEGRATIONS.md。';

/**
 * Encryption key for stored secrets, from the environment. Without it the
 * feature is off: secrets are never written unencrypted.
 */
function masterKey(): Buffer | undefined {
  const raw = process.env.EXFOLIO_SECRET_KEY;
  if (!raw || raw.length < 32) return undefined;
  return createHash('sha256').update(raw).digest();
}

function seal(key: Buffer, value: object): StoredIntegration['sealed'] {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

function unseal<T>(key: Buffer, sealed: StoredIntegration['sealed']): T {
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    const text = Buffer.concat([
      decipher.update(Buffer.from(sealed.data, 'base64')),
      decipher.final(),
    ]);
    return JSON.parse(text.toString('utf8')) as T;
  } catch {
    throw new ApiError(
      '無法解開已保存的金鑰：EXFOLIO_SECRET_KEY 可能已變更。請刪除這個連線後重新新增。',
    );
  }
}

function file(userId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(userId)) throw new Error('Invalid user id');
  return path.join(dataDir(), 'secrets', `${userId}.json`);
}

const readAll = (userId: string) => readJson<StoredIntegration[]>(file(userId), []);

function toInfo(i: StoredIntegration): IntegrationInfo {
  return {
    id: i.id,
    provider: i.provider,
    label: i.label,
    keyHint: i.keyHint,
    createdAt: i.createdAt,
    ...(i.lastSyncAt ? { lastSyncAt: i.lastSyncAt } : {}),
  };
}

// ---- Binance ---------------------------------------------------------------

export type HttpGet = (
  url: string,
  headers: Record<string, string>,
) => Promise<{ status: number; body: unknown }>;

const defaultGet: HttpGet = async (url, headers) => {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  return { status: res.status, body };
};

let httpGet = defaultGet;

/** Tests substitute the network. */
export function setExchangeHttp(get?: HttpGet) {
  httpGet = get ?? defaultGet;
}

interface Credentials {
  apiKey: string;
  apiSecret: string;
}

const SPOT = 'https://api.binance.com';
const FUTURES = 'https://fapi.binance.com';

/** Signed GET. Every endpoint used here is a read: nothing can change the account. */
async function binanceGet(
  creds: Credentials,
  base: string,
  endpoint: string,
  params: Record<string, string | number> = {},
): Promise<unknown> {
  const query = new URLSearchParams({
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    recvWindow: '10000',
    timestamp: String(Date.now()),
  }).toString();
  const signature = createHmac('sha256', creds.apiSecret).update(query).digest('hex');
  const { status, body } = await httpGet(`${base}${endpoint}?${query}&signature=${signature}`, {
    'X-MBX-APIKEY': creds.apiKey,
  });
  if (status !== 200) {
    const msg = (body as { msg?: string } | undefined)?.msg;
    // The exchange's message may mention the request; never include the key.
    throw new ApiError(`交易所回應 HTTP ${status}${msg ? `：${msg}` : ''}`);
  }
  return body;
}

// Permissions that let a key move money or place orders.
const WRITE_PERMISSIONS: Record<string, string> = {
  enableWithdrawals: '提領',
  enableInternalTransfer: '內部轉帳',
  permitsUniversalTransfer: '萬向劃轉',
  enableSpotAndMarginTrading: '現貨與槓桿交易',
  enableMargin: '槓桿借貸',
  enableFutures: '合約交易',
  enableVanillaOptions: '選擇權交易',
  enablePortfolioMarginTrading: '統一帳戶交易',
};

/** Refuse any key that can do more than read. */
async function requireReadOnly(creds: Credentials): Promise<void> {
  const r = (await binanceGet(creds, SPOT, '/sapi/v1/account/apiRestrictions')) as Record<
    string,
    unknown
  >;
  if (r.enableReading !== true) throw new ApiError('這把 API 金鑰沒有讀取權限');
  const writable = Object.keys(WRITE_PERMISSIONS).filter((p) => r[p] === true);
  if (writable.length) {
    throw new ApiError(
      `這把 API 金鑰不是唯讀：已開啟 ${writable.map((p) => WRITE_PERMISSIONS[p]).join('、')}。` +
        '請在交易所建立只勾選「讀取」的金鑰。',
    );
  }
}

const num = (v: unknown) => Number(v) || 0;

async function binanceSnapshot(creds: Credentials): Promise<ExchangeSnapshot> {
  const warnings: string[] = [];
  const account = (await binanceGet(creds, SPOT, '/api/v3/account', {
    omitZeroBalances: 'true',
  })) as {
    balances?: Array<{ asset: string; free: string; locked: string }>;
  };
  const balances: ExchangeBalance[] = (account.balances ?? [])
    .map((b) => ({ asset: b.asset, free: num(b.free), locked: num(b.locked) }))
    .filter((b) => b.free !== 0 || b.locked !== 0);

  // The derivatives wallet is optional: an account without it answers with an error.
  let futuresBalances: ExchangeBalance[] = [];
  let positions: ExchangePosition[] = [];
  try {
    const wallet = (await binanceGet(creds, FUTURES, '/fapi/v2/balance')) as Array<{
      asset: string;
      balance: string;
      availableBalance: string;
    }>;
    futuresBalances = wallet
      .map((b) => ({
        asset: b.asset,
        free: num(b.availableBalance),
        locked: num(b.balance) - num(b.availableBalance),
      }))
      .filter((b) => b.free !== 0 || b.locked !== 0);
    const risk = (await binanceGet(creds, FUTURES, '/fapi/v2/positionRisk')) as Array<
      Record<string, string>
    >;
    positions = risk
      .map((p) => ({
        symbol: p.symbol,
        quantity: num(p.positionAmt),
        entryPrice: num(p.entryPrice),
        markPrice: num(p.markPrice),
        unrealizedPnl: num(p.unRealizedProfit),
      }))
      .filter((p) => p.quantity !== 0);
  } catch (err) {
    warnings.push(`無法讀取合約帳戶：${err instanceof Error ? err.message : String(err)}`);
  }
  return { fetchedAt: new Date().toISOString(), balances, futuresBalances, positions, warnings };
}

async function binanceTrades(
  creds: Credentials,
  market: 'spot' | 'futures',
  symbol: string,
  since?: string,
): Promise<ExchangeTrade[]> {
  if (!/^[A-Z0-9]{5,20}$/.test(symbol)) throw new ApiError('交易對代號格式不正確');
  const startTime = since ? new Date(`${since}T00:00:00Z`).getTime() : undefined;
  if (startTime !== undefined && Number.isNaN(startTime)) throw new ApiError('起始日期格式不正確');
  const params = { symbol, limit: 1000, ...(startTime !== undefined ? { startTime } : {}) };
  if (market === 'spot') {
    const rows = (await binanceGet(creds, SPOT, '/api/v3/myTrades', params)) as Array<
      Record<string, unknown>
    >;
    return rows.map((t) => ({
      id: `binance:spot:${symbol}:${t.id}`,
      market,
      symbol,
      time: new Date(num(t.time)).toISOString(),
      side: t.isBuyer ? 'buy' : 'sell',
      quantity: num(t.qty),
      price: num(t.price),
      fee: num(t.commission),
      feeAsset: String(t.commissionAsset ?? ''),
    }));
  }
  const rows = (await binanceGet(creds, FUTURES, '/fapi/v1/userTrades', params)) as Array<
    Record<string, unknown>
  >;
  return rows.map((t) => ({
    id: `binance:futures:${symbol}:${t.id}`,
    market,
    symbol,
    time: new Date(num(t.time)).toISOString(),
    side: t.side === 'BUY' ? 'buy' : 'sell',
    quantity: num(t.qty),
    price: num(t.price),
    fee: num(t.commission),
    feeAsset: String(t.commissionAsset ?? ''),
    realizedPnl: num(t.realizedPnl),
  }));
}

// ---- Operations ------------------------------------------------------------

export async function integrationStatus(userId: string): Promise<IntegrationStatus> {
  const list = (await readAll(userId)).map(toInfo);
  return masterKey() ? { enabled: true, list } : { enabled: false, reason: DISABLED_REASON, list };
}

function requireKey(): Buffer {
  const key = masterKey();
  if (!key) throw new ApiError(DISABLED_REASON);
  return key;
}

export async function integrationSave(
  userId: string,
  input: { provider: unknown; label: unknown; apiKey: unknown; apiSecret: unknown },
): Promise<IntegrationStatus> {
  const key = requireKey();
  if (input.provider !== 'binance') throw new ApiError('目前只支援 Binance');
  const apiKey = String(input.apiKey ?? '').trim();
  const apiSecret = String(input.apiSecret ?? '').trim();
  if (!/^[A-Za-z0-9]{16,128}$/.test(apiKey) || !/^[A-Za-z0-9]{16,128}$/.test(apiSecret)) {
    throw new ApiError('API Key 或 Secret 格式不正確');
  }
  // Checked before anything is stored: a key that can trade never rests here.
  await requireReadOnly({ apiKey, apiSecret });
  const label =
    String(input.label ?? '')
      .trim()
      .slice(0, 60) || 'Binance';
  await serialize(async () => {
    const all = await readAll(userId);
    all.push({
      id: `int_${randomBytes(9).toString('base64url')}`,
      provider: 'binance',
      label,
      keyHint: apiKey.slice(-4),
      createdAt: new Date().toISOString(),
      sealed: seal(key, { apiKey, apiSecret }),
    });
    await writeJson(file(userId), all);
  });
  return integrationStatus(userId);
}

export async function integrationDelete(userId: string, id: unknown): Promise<IntegrationStatus> {
  await serialize(async () => {
    const all = await readAll(userId);
    await writeJson(
      file(userId),
      all.filter((i) => i.id !== id),
    );
  });
  return integrationStatus(userId);
}

async function credentials(userId: string, id: unknown): Promise<Credentials> {
  const key = requireKey();
  const found = (await readAll(userId)).find((i) => i.id === id);
  if (!found) throw new ApiError('找不到這個連線');
  return unseal<Credentials>(key, found.sealed);
}

export async function integrationSync(userId: string, id: unknown): Promise<ExchangeSnapshot> {
  const creds = await credentials(userId, id);
  // Permissions can be widened after the key was stored: check on every use.
  await requireReadOnly(creds);
  const snapshot = await binanceSnapshot(creds);
  await serialize(async () => {
    const all = await readAll(userId);
    const row = all.find((i) => i.id === id);
    if (row) {
      row.lastSyncAt = snapshot.fetchedAt;
      await writeJson(file(userId), all);
    }
  });
  return snapshot;
}

export async function integrationTrades(
  userId: string,
  input: { id: unknown; market: unknown; symbol: unknown; since?: unknown },
): Promise<ExchangeTrade[]> {
  const creds = await credentials(userId, input.id);
  await requireReadOnly(creds);
  const market = input.market === 'futures' ? 'futures' : 'spot';
  return binanceTrades(
    creds,
    market,
    String(input.symbol ?? '').toUpperCase(),
    input.since ? String(input.since) : undefined,
  );
}

/** Forget a deleted member's stored keys. */
export async function removeIntegrations(userId: string): Promise<void> {
  const { rm } = await import('node:fs/promises');
  await rm(file(userId), { force: true });
}
