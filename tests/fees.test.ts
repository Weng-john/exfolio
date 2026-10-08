import { describe, expect, it } from 'vitest';
import { estimateFees, fromCatalog, INSTITUTION_CATALOG, seedData, type Broker } from '@core/index';

const data = seedData();
const inst = (id: string) => data.instruments.find((i) => i.id === id)!;

describe('estimateFees', () => {
  const broker: Broker = {
    id: 'b', name: '示範券商', kind: 'broker',
    fees: {
      stock: { rate: 0.001425, discount: 0.28, minFee: 20, sellTaxRate: 0.003 },
      etf: { rate: 0.001425, discount: 0.28, minFee: 20, sellTaxRate: 0.001 },
      future: { perUnit: 15, taxRate: 0.00002 },
    },
  };

  it('applies the discount to the list commission', () => {
    const e = estimateFees(broker, inst('tw_0050'), 'buy', 1000, 100);
    expect(e.fee).toBeCloseTo(100_000 * 0.001425 * 0.28);
    expect(e.tax).toBe(0);
    expect(e.known).toBe(true);
  });

  it('charges the minimum commission on small trades', () => {
    expect(estimateFees(broker, inst('tw_0050'), 'buy', 10, 100).fee).toBe(20);
  });

  it('taxes sells only, at the rate of the instrument class', () => {
    expect(estimateFees(broker, inst('tw_0050'), 'sell', 1000, 100).tax).toBeCloseTo(100);
  });

  it('charges futures per contract and taxes both sides on notional', () => {
    const buy = estimateFees(broker, inst('fut_MTX'), 'buy', 2, 20_000);
    expect(buy.fee).toBe(30);
    expect(buy.tax).toBeCloseTo(2 * 20_000 * 50 * 0.00002);
    expect(estimateFees(broker, inst('fut_MTX'), 'sell', 2, 20_000).tax).toBeCloseTo(buy.tax);
  });

  it('reports an unknown class instead of guessing', () => {
    expect(estimateFees(broker, inst('crypto_BTC'), 'buy', 1, 50_000)).toEqual({ fee: 0, tax: 0, known: false });
    expect(estimateFees(undefined, inst('tw_0050'), 'buy', 1, 100).known).toBe(false);
  });
});

describe('institutions', () => {
  it('seeds no institutions or accounts: those are the user\'s to add', () => {
    expect(data.brokers).toEqual([]);
    expect(data.accounts).toEqual([]);
  });

  it('offers brokers, banks and exchanges with unique ids', () => {
    const ids = INSTITUTION_CATALOG.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const kind of ['broker', 'bank', 'exchange']) {
      expect(INSTITUTION_CATALOG.filter((b) => b.kind === kind).length).toBeGreaterThan(3);
    }
  });

  it('hands out catalog entries as independent copies', () => {
    const a = fromCatalog('yuanta')!;
    a.fees!.stock!.discount = 0.5;
    expect(fromCatalog('yuanta')!.fees!.stock!.discount).toBe(1);
  });
});
