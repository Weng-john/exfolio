import { seedData, type AllocationTarget, type AppData, type Transaction } from '@core/index';

let seq = 0;

/** Build a transaction with test defaults: core bucket, TWD, account kgi_tw. */
export function tx(
  partial: Partial<Transaction> & Pick<Transaction, 'type' | 'date'>,
): Transaction {
  return {
    id: `t${++seq}`,
    accountId: 'kgi_tw',
    bucket: 'core',
    currency: 'TWD',
    amount: 0,
    ...partial,
  };
}

export function setPrice(data: AppData, id: string, price: number, currency = 'TWD') {
  data.prices = data.prices.filter((p) => p.id !== id);
  data.prices.push({
    id,
    price,
    currency,
    asOf: NOW.toISOString(),
    source: 'manual',
    status: 'manual',
  });
}

export function setFx(data: AppData, from: string, to: string, rate: number) {
  const id = `${from}/${to}`;
  data.fxRates = data.fxRates.filter((r) => r.id !== id);
  data.fxRates.push({ id, from, to, rate, asOf: NOW.toISOString(), source: 'manual' });
}

export const NOW = new Date('2026-10-09T08:00:00Z');

/** Reference data plus fictional institutions and accounts for tests. */
export function fresh(): AppData {
  const data = seedData();
  data.brokers = [
    { id: 'kgi', name: '示範券商甲', kind: 'broker' },
    { id: 'sinopac', name: '示範券商乙', kind: 'broker' },
    { id: 'binance', name: '示範交易所', kind: 'exchange' },
  ];
  data.accounts = [
    {
      id: 'kgi_tw',
      brokerId: 'kgi',
      name: '甲 台股',
      type: 'securities',
      baseCurrency: 'TWD',
      active: true,
    },
    {
      id: 'kgi_fut',
      brokerId: 'kgi',
      name: '甲 期貨',
      type: 'futures',
      baseCurrency: 'TWD',
      active: true,
    },
    {
      id: 'sinopac_tw',
      brokerId: 'sinopac',
      name: '乙 台股',
      type: 'securities',
      baseCurrency: 'TWD',
      active: true,
    },
    {
      id: 'sinopac_us',
      brokerId: 'sinopac',
      name: '乙 美股複委託',
      type: 'securities',
      baseCurrency: 'USD',
      active: true,
    },
    {
      id: 'binance_main',
      brokerId: 'binance',
      name: '示範交易所帳戶',
      type: 'crypto',
      baseCurrency: 'USDT',
      active: true,
    },
  ];
  return data;
}

/** Add (or replace) an allocation target row. */
export function setTarget(
  data: AppData,
  indexId: string,
  targetWeight: number,
  extra: Partial<AllocationTarget> = {},
) {
  data.targets = data.targets.filter((t) => t.indexId !== indexId);
  data.targets.push({ id: `tg_${indexId}`, indexId, targetWeight, tolerance: 0.02, ...extra });
}
