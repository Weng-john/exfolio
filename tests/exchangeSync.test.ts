import { describe, expect, it } from 'vitest';
import {
  buildLedger,
  computePortfolio,
  reconcile,
  tradesToTransactions,
  type ExchangeSnapshot,
  type ExchangeTrade,
} from '@core/index';
import { fresh, NOW, setFx, setPrice, tx } from './helpers';

const ACCOUNT = 'binance_main';

function base() {
  const data = fresh();
  setFx(data, 'USDT', 'TWD', 32);
  setPrice(data, 'crypto_BTC', 80_000, 'USDT');
  setPrice(data, 'perp_BTCUSDT', 80_000, 'USDT');
  data.transactions.push(
    tx({
      type: 'deposit',
      date: '2026-01-01',
      accountId: ACCOUNT,
      currency: 'USDT',
      amount: 50_000,
    }),
  );
  return data;
}

const snapshot = (over: Partial<ExchangeSnapshot>): ExchangeSnapshot => ({
  fetchedAt: NOW.toISOString(),
  balances: [],
  futuresBalances: [],
  positions: [],
  warnings: [],
  ...over,
});

const spotBuy: ExchangeTrade = {
  id: 'binance:spot:BTCUSDT:7',
  market: 'spot',
  symbol: 'BTCUSDT',
  time: '2026-01-05T03:00:00.000Z',
  side: 'buy',
  quantity: 0.5,
  price: 80_000,
  fee: 0.0005,
  feeAsset: 'BTC',
};

describe('tradesToTransactions', () => {
  it('books a fee paid in the coin so both coin and cash match the exchange', () => {
    const data = base();
    const result = tradesToTransactions(data, [spotBuy], { accountId: ACCOUNT });
    expect(result.transactions[0]).toMatchObject({
      id: spotBuy.id,
      type: 'buy',
      instrumentId: 'crypto_BTC',
      quantity: 0.4995,
      price: 80_000,
      fee: 40,
      currency: 'USDT',
      date: '2026-01-05',
    });
    data.transactions.push(...result.transactions);
    const ledger = buildLedger(data);
    expect(ledger.positions[0].quantity).toBeCloseTo(0.4995);
    expect(ledger.cash[0].amount).toBeCloseTo(50_000 - 0.5 * 80_000);
  });

  it('adds nothing when the same fills are imported again', () => {
    const data = base();
    data.transactions.push(
      ...tradesToTransactions(data, [spotBuy], { accountId: ACCOUNT }).transactions,
    );
    const again = tradesToTransactions(data, [spotBuy, spotBuy], { accountId: ACCOUNT });
    expect(again.transactions).toEqual([]);
    expect(again.duplicates).toBe(2);
  });

  it('maps futures fills to the perpetual and spot fills to the coin', () => {
    const data = base();
    const perp: ExchangeTrade = {
      ...spotBuy,
      id: 'binance:futures:BTCUSDT:9',
      market: 'futures',
      side: 'sell',
      quantity: 0.02,
      fee: 0.8,
      feeAsset: 'USDT',
    };
    const result = tradesToTransactions(data, [perp], { accountId: ACCOUNT, bucket: 'hedge' });
    expect(result.transactions[0]).toMatchObject({
      instrumentId: 'perp_BTCUSDT',
      type: 'sell',
      quantity: 0.02,
      fee: 0.8,
      bucket: 'hedge',
    });
    expect(result.warnings.some((w) => w.includes('先進先出'))).toBe(true);
  });

  it('reports unknown symbols and third-asset fees instead of guessing', () => {
    const data = base();
    const result = tradesToTransactions(
      data,
      [
        { ...spotBuy, id: 'a', symbol: 'DOGEUSDT' },
        { ...spotBuy, id: 'b', feeAsset: 'BNB', fee: 0.01 },
      ],
      { accountId: ACCOUNT },
    );
    expect(result.unmatched).toEqual(['DOGEUSDT']);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].fee).toBeUndefined();
    expect(result.warnings[0]).toContain('BNB');
  });
});

describe('reconcile', () => {
  it('is clean when the ledger matches the exchange', () => {
    const data = base();
    data.transactions.push(
      ...tradesToTransactions(data, [spotBuy], { accountId: ACCOUNT }).transactions,
    );
    const result = reconcile(
      data,
      computePortfolio(data, { now: NOW }),
      ACCOUNT,
      snapshot({
        balances: [
          { asset: 'BTC', free: 0.4, locked: 0.0995 },
          { asset: 'USDT', free: 9_000, locked: 0 },
        ],
        futuresBalances: [{ asset: 'USDT', free: 1_000, locked: 0 }],
      }),
    );
    expect(result.clean).toBe(true);
    expect(result.balances.find((b) => b.asset === 'USDT')).toMatchObject({
      exchange: 10_000,
      ledger: 10_000,
    });
  });

  it('shows what the ledger is missing', () => {
    const data = base();
    const result = reconcile(
      data,
      computePortfolio(data, { now: NOW }),
      ACCOUNT,
      snapshot({
        balances: [
          { asset: 'BTC', free: 0.1, locked: 0 },
          { asset: 'USDT', free: 42_000, locked: 0 },
        ],
        positions: [
          {
            symbol: 'BTCUSDT',
            quantity: -0.02,
            entryPrice: 80_000,
            markPrice: 79_000,
            unrealizedPnl: 20,
          },
        ],
      }),
    );
    expect(result.clean).toBe(false);
    expect(result.balances.find((b) => b.asset === 'BTC')).toMatchObject({
      exchange: 0.1,
      ledger: 0,
      matches: false,
    });
    expect(result.balances.find((b) => b.asset === 'USDT')!.difference).toBe(-8_000);
    expect(result.positions[0]).toMatchObject({
      symbol: 'BTCUSDT',
      instrumentId: 'perp_BTCUSDT',
      exchange: -0.02,
      ledger: 0,
    });
  });

  it('looks only at the chosen account', () => {
    const data = base();
    data.transactions.push(
      tx({
        type: 'deposit',
        date: '2026-01-02',
        accountId: 'kgi_tw',
        currency: 'USDT',
        amount: 999,
      }),
    );
    const result = reconcile(
      data,
      computePortfolio(data, { now: NOW }),
      ACCOUNT,
      snapshot({ balances: [{ asset: 'USDT', free: 50_000, locked: 0 }] }),
    );
    expect(result.clean).toBe(true);
  });
});
