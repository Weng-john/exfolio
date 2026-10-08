import { seedData, type AllocationTarget, type AppData, type Transaction } from '@core/index';

let seq = 0;

/** Build a transaction with test defaults: core bucket, TWD, 凱基 台股. */
export function tx(partial: Partial<Transaction> & Pick<Transaction, 'type' | 'date'>): Transaction {
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
  data.prices.push({ id, price, currency, asOf: NOW.toISOString(), source: 'manual', status: 'manual' });
}

export function setFx(data: AppData, from: string, to: string, rate: number) {
  const id = `${from}/${to}`;
  data.fxRates = data.fxRates.filter((r) => r.id !== id);
  data.fxRates.push({ id, from, to, rate, asOf: NOW.toISOString(), source: 'manual' });
}

export const NOW = new Date('2026-10-09T08:00:00Z');

export function fresh(): AppData {
  return seedData();
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
