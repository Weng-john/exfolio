import { CATALOG_FX_PAIRS, CATALOG_INDICES, CATALOG_INSTRUMENTS } from './catalog';
import {
  emptyData,
  type AppData,
  type Broker,
  type Instrument,
  type UnderlyingIndex,
} from './types';

// Reference data only: public instruments and index definitions. Nothing in
// this file describes a real person's holdings.

export const SEED_INDICES: UnderlyingIndex[] = CATALOG_INDICES;

// Fee rules are list prices or common defaults, not anyone's actual
// contract: every user should set their own rates and discounts.
const TW_BROKER_FEES: Broker['fees'] = {
  stock: { rate: 0.001425, discount: 1, minFee: 20, sellTaxRate: 0.003 },
  etf: { rate: 0.001425, discount: 1, minFee: 20, sellTaxRate: 0.001 },
  future: { perUnit: 0, taxRate: 0.00002 },
};
const US_BROKER_FEES: Broker['fees'] = {
  stock: { rate: 0 },
  etf: { rate: 0 },
  future: { perUnit: 0 },
};
const CRYPTO_FEES: Broker['fees'] = { crypto: { rate: 0.001 }, perpetual: { rate: 0.0005 } };

const tw = (id: string, name: string): Broker => ({
  id,
  name,
  kind: 'broker',
  fees: TW_BROKER_FEES,
});
const us = (id: string, name: string): Broker => ({
  id,
  name,
  kind: 'broker',
  fees: US_BROKER_FEES,
});
const ex = (id: string, name: string): Broker => ({
  id,
  name,
  kind: 'exchange',
  fees: CRYPTO_FEES,
});
const bank = (id: string, name: string): Broker => ({ id, name, kind: 'bank' });

/**
 * Institutions a user can add with one click. Nothing here is added to a
 * dataset automatically, and any other institution can be created by hand.
 */
export const INSTITUTION_CATALOG: Broker[] = [
  tw('yuanta', '元大證券'),
  tw('kgi', '凱基證券'),
  tw('fubon_sec', '富邦證券'),
  tw('sinopac', '永豐金證券'),
  tw('cathay_sec', '國泰證券'),
  tw('capital', '群益證券'),
  tw('esun_sec', '玉山證券'),
  tw('mega_sec', '兆豐證券'),
  tw('ctbc_sec', '中國信託證券'),
  tw('taishin_sec', '台新證券'),
  tw('hncb_sec', '華南永昌證券'),
  tw('pscnet', '統一證券'),
  tw('masterlink', '元富證券'),
  tw('fsc_sec', '第一金證券'),
  us('ibkr', 'Interactive Brokers'),
  us('schwab', 'Charles Schwab'),
  us('firstrade', 'Firstrade'),
  us('fidelity', 'Fidelity'),
  ex('binance', 'Binance'),
  ex('okx', 'OKX'),
  ex('bybit', 'Bybit'),
  ex('coinbase', 'Coinbase'),
  ex('kraken', 'Kraken'),
  ex('max', 'MAX'),
  ex('bitopro', 'BitoPro'),
  bank('bot', '臺灣銀行'),
  bank('ctbc_bank', '中國信託銀行'),
  bank('cathay_bank', '國泰世華銀行'),
  bank('fubon_bank', '台北富邦銀行'),
  bank('esun_bank', '玉山銀行'),
  bank('taishin_bank', '台新銀行'),
  bank('sinopac_bank', '永豐銀行'),
  bank('mega_bank', '兆豐銀行'),
  bank('first_bank', '第一銀行'),
  bank('hncb_bank', '華南銀行'),
  bank('land_bank', '土地銀行'),
  bank('tcb_bank', '合作金庫銀行'),
  bank('post', '中華郵政'),
];

/** A catalog entry as an independent row, safe to edit. */
export function fromCatalog(id: string): Broker | undefined {
  const entry = INSTITUTION_CATALOG.find((b) => b.id === id);
  return entry && (JSON.parse(JSON.stringify(entry)) as Broker);
}

export const SEED_INSTRUMENTS: Instrument[] = CATALOG_INSTRUMENTS;

/** FX pairs the app keeps quoted, as [from, to, quote source, quote symbol]. */
export const SEED_FX_PAIRS = CATALOG_FX_PAIRS;

/**
 * A fresh dataset holding only public reference data: indices and
 * instruments. Institutions and accounts are the user's to add.
 */
export function seedData(): AppData {
  const data = emptyData();
  data.indices = SEED_INDICES.map((x) => ({ ...x }));
  data.instruments = SEED_INSTRUMENTS.map((x) => ({ ...x }));
  return data;
}
