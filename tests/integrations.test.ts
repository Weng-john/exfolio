import { createHmac } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ApiRequest, ApiResponse } from '@core/api';
import { dispatch } from '../server/handler';
import { setExchangeHttp } from '../server/integrations';

// A fake exchange and fictional credentials: no real key appears here.

type Ok = Extract<ApiResponse, { ok: true }>;
const KEY = 'FictionalApiKey0000000000000000abcd';
const SECRET = 'FictionalApiSecret00000000000000wxyz';
const passwordKey = (n: number) => n.toString(16).padStart(64, '0');
const ok = async (request: ApiRequest): Promise<Ok> => {
  const res = await dispatch(request);
  if (!res.ok) throw new Error(`expected ok, got ${res.error}`);
  return res;
};
const fail = async (request: ApiRequest): Promise<string> => {
  const res = await dispatch(request);
  if (res.ok) throw new Error('expected an error');
  return res.error;
};

let dir: string;
let restrictions: Record<string, boolean>;
let calls: Array<{ url: string; headers: Record<string, string> }>;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'exfolio-int-'));
  process.env.EXFOLIO_DATA_DIR = dir;
  process.env.EXFOLIO_SECRET_KEY = 'a-fictional-master-key-for-tests-only-0123456789';
  delete process.env.EXFOLIO_AUTH;
  restrictions = {
    enableReading: true,
    enableWithdrawals: false,
    enableSpotAndMarginTrading: false,
    enableFutures: false,
  };
  calls = [];
  setExchangeHttp(async (url, headers) => {
    calls.push({ url, headers });
    const u = new URL(url);
    // Reject any request whose signature does not match its query string.
    const params = new URLSearchParams(u.search);
    const signature = params.get('signature');
    params.delete('signature');
    if (signature !== createHmac('sha256', SECRET).update(params.toString()).digest('hex')) {
      return { status: 401, body: { msg: 'Signature for this request is not valid.' } };
    }
    switch (u.pathname) {
      case '/sapi/v1/account/apiRestrictions':
        return { status: 200, body: restrictions };
      case '/api/v3/account':
        return {
          status: 200,
          body: {
            balances: [
              { asset: 'BTC', free: '0.5', locked: '0.1' },
              { asset: 'USDT', free: '1000', locked: '0' },
            ],
          },
        };
      case '/fapi/v2/balance':
        return { status: 200, body: [{ asset: 'USDT', balance: '500', availableBalance: '400' }] };
      case '/fapi/v2/positionRisk':
        return {
          status: 200,
          body: [
            {
              symbol: 'BTCUSDT',
              positionAmt: '-0.02',
              entryPrice: '80000',
              markPrice: '79000',
              unRealizedProfit: '20',
            },
            {
              symbol: 'ETHUSDT',
              positionAmt: '0',
              entryPrice: '0',
              markPrice: '0',
              unRealizedProfit: '0',
            },
          ],
        };
      case '/api/v3/myTrades':
        return {
          status: 200,
          body: [
            {
              id: 7,
              time: 1_767_225_600_000,
              isBuyer: true,
              qty: '0.5',
              price: '80000',
              commission: '0.0005',
              commissionAsset: 'BTC',
            },
          ],
        };
      case '/fapi/v1/userTrades':
        return {
          status: 200,
          body: [
            {
              id: 9,
              time: 1_767_225_600_000,
              side: 'SELL',
              qty: '0.02',
              price: '80000',
              commission: '0.8',
              commissionAsset: 'USDT',
              realizedPnl: '0',
            },
          ],
        };
      default:
        return { status: 404, body: { msg: 'unknown endpoint' } };
    }
  });
});
afterEach(() => {
  setExchangeHttp();
  delete process.env.EXFOLIO_SECRET_KEY;
  rmSync(dir, { recursive: true, force: true });
});

async function member(username: string, n: number) {
  const res = await ok({ action: 'register', username, passwordKey: passwordKey(n) });
  return { session: res.session, id: res.user!.id };
}

async function connected() {
  const admin = await member('admin', 1);
  const status = (
    await ok({
      action: 'integrationSave',
      session: admin.session,
      provider: 'binance',
      label: '示範交易所',
      apiKey: KEY,
      apiSecret: SECRET,
    })
  ).integrations!;
  return { ...admin, integrationId: status.list[0].id, status };
}

describe('read-only exchange connections', () => {
  it('is off, and stores nothing, without a master key', async () => {
    delete process.env.EXFOLIO_SECRET_KEY;
    const admin = await member('admin', 1);
    const status = (await ok({ action: 'integrationStatus', session: admin.session }))
      .integrations!;
    expect(status.enabled).toBe(false);
    expect(
      (
        await dispatch({
          action: 'integrationSave',
          session: admin.session,
          provider: 'binance',
          label: 'x',
          apiKey: KEY,
          apiSecret: SECRET,
        })
      ).ok,
    ).toBe(false);
    expect(existsSync(path.join(dir, 'secrets'))).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('needs a signed-in member', async () => {
    expect(await fail({ action: 'integrationStatus' })).toBe('unauthenticated');
    expect(await fail({ action: 'integrationSync', id: 'x' })).toBe('unauthenticated');
  });

  it('refuses a key that can trade or withdraw, before storing it', async () => {
    const admin = await member('admin', 1);
    for (const permission of ['enableSpotAndMarginTrading', 'enableWithdrawals', 'enableFutures']) {
      restrictions = { enableReading: true, [permission]: true };
      const error = await fail({
        action: 'integrationSave',
        session: admin.session,
        provider: 'binance',
        label: 'x',
        apiKey: KEY,
        apiSecret: SECRET,
      });
      expect(error).toContain('不是唯讀');
    }
    restrictions = { enableReading: false };
    expect(
      (
        await dispatch({
          action: 'integrationSave',
          session: admin.session,
          provider: 'binance',
          label: 'x',
          apiKey: KEY,
          apiSecret: SECRET,
        })
      ).ok,
    ).toBe(false);
    expect(existsSync(path.join(dir, 'secrets', `${admin.id}.json`))).toBe(false);
  });

  it('stores the key encrypted and never returns it', async () => {
    const c = await connected();
    expect(c.status.list[0]).toMatchObject({
      provider: 'binance',
      label: '示範交易所',
      keyHint: 'abcd',
    });
    expect(JSON.stringify(c.status)).not.toContain(KEY);
    const raw = readFileSync(path.join(dir, 'secrets', `${c.id}.json`), 'utf8');
    expect(raw).not.toContain(KEY);
    expect(raw).not.toContain(SECRET);
    const again = JSON.stringify(await ok({ action: 'integrationStatus', session: c.session }));
    expect(again).not.toContain(SECRET);
  });

  it('reads balances and open positions with correctly signed requests', async () => {
    const c = await connected();
    const snapshot = (
      await ok({ action: 'integrationSync', session: c.session, id: c.integrationId })
    ).snapshot!;
    expect(snapshot.balances).toEqual([
      { asset: 'BTC', free: 0.5, locked: 0.1 },
      { asset: 'USDT', free: 1000, locked: 0 },
    ]);
    expect(snapshot.futuresBalances).toEqual([{ asset: 'USDT', free: 400, locked: 100 }]);
    expect(snapshot.positions).toEqual([
      {
        symbol: 'BTCUSDT',
        quantity: -0.02,
        entryPrice: 80000,
        markPrice: 79000,
        unrealizedPnl: 20,
      },
    ]);
    expect(calls.every((call) => call.headers['X-MBX-APIKEY'] === KEY)).toBe(true);
    const status = (await ok({ action: 'integrationStatus', session: c.session })).integrations!;
    expect(status.list[0].lastSyncAt).toBe(snapshot.fetchedAt);
  });

  it('only ever calls read endpoints', async () => {
    const c = await connected();
    await ok({ action: 'integrationSync', session: c.session, id: c.integrationId });
    await ok({
      action: 'integrationTrades',
      session: c.session,
      id: c.integrationId,
      market: 'spot',
      symbol: 'BTCUSDT',
    });
    const paths = [...new Set(calls.map((call) => new URL(call.url).pathname))].sort();
    expect(paths).toEqual([
      '/api/v3/account',
      '/api/v3/myTrades',
      '/fapi/v2/balance',
      '/fapi/v2/positionRisk',
      '/sapi/v1/account/apiRestrictions',
    ]);
  });

  it('stops using a key whose permissions were widened later', async () => {
    const c = await connected();
    restrictions = { enableReading: true, enableWithdrawals: true };
    expect(
      await fail({ action: 'integrationSync', session: c.session, id: c.integrationId }),
    ).toContain('不是唯讀');
  });

  it('returns trades with stable ids', async () => {
    const c = await connected();
    const spot = (
      await ok({
        action: 'integrationTrades',
        session: c.session,
        id: c.integrationId,
        market: 'spot',
        symbol: 'btcusdt',
      })
    ).trades!;
    expect(spot[0]).toMatchObject({
      id: 'binance:spot:BTCUSDT:7',
      side: 'buy',
      quantity: 0.5,
      price: 80000,
      fee: 0.0005,
      feeAsset: 'BTC',
    });
    const futures = (
      await ok({
        action: 'integrationTrades',
        session: c.session,
        id: c.integrationId,
        market: 'futures',
        symbol: 'BTCUSDT',
        since: '2026-01-01',
      })
    ).trades!;
    expect(futures[0]).toMatchObject({
      id: 'binance:futures:BTCUSDT:9',
      side: 'sell',
      quantity: 0.02,
    });
    expect(
      (
        await dispatch({
          action: 'integrationTrades',
          session: c.session,
          id: c.integrationId,
          market: 'spot',
          symbol: '../etc',
        })
      ).ok,
    ).toBe(false);
  });

  it('keeps connections private to their owner', async () => {
    const c = await connected();
    await ok({ action: 'adminSetConfig', session: c.session, registration: 'open' });
    const amy = await member('amy', 2);
    expect(
      (await ok({ action: 'integrationStatus', session: amy.session })).integrations!.list,
    ).toEqual([]);
    expect(
      (await dispatch({ action: 'integrationSync', session: amy.session, id: c.integrationId })).ok,
    ).toBe(false);
    expect(
      (await dispatch({ action: 'integrationDelete', session: amy.session, id: c.integrationId }))
        .ok,
    ).toBe(true);
    expect(
      (await ok({ action: 'integrationStatus', session: c.session })).integrations!.list,
    ).toHaveLength(1);
  });

  it('cannot decrypt after the master key changes, and says so', async () => {
    const c = await connected();
    process.env.EXFOLIO_SECRET_KEY = 'a-different-fictional-master-key-0123456789abcdef';
    expect(
      await fail({ action: 'integrationSync', session: c.session, id: c.integrationId }),
    ).toContain('EXFOLIO_SECRET_KEY');
  });

  it("deletes a connection, and a deleted member's keys", async () => {
    const c = await connected();
    await ok({ action: 'adminSetConfig', session: c.session, registration: 'open' });
    const amy = await member('amy', 2);
    await ok({
      action: 'integrationSave',
      session: amy.session,
      provider: 'binance',
      label: 'x',
      apiKey: KEY,
      apiSecret: SECRET,
    });
    expect(existsSync(path.join(dir, 'secrets', `${amy.id}.json`))).toBe(true);
    await ok({ action: 'adminDeleteUser', session: c.session, userId: amy.id });
    expect(existsSync(path.join(dir, 'secrets', `${amy.id}.json`))).toBe(false);
    const status = (
      await ok({ action: 'integrationDelete', session: c.session, id: c.integrationId })
    ).integrations!;
    expect(status.list).toEqual([]);
  });
});
