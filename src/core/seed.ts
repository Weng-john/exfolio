import {
  emptyData,
  type AppData,
  type Broker,
  type Instrument,
  type UnderlyingIndex,
} from './types';

// Reference data only: public instruments and index definitions. Nothing in
// this file describes a real person's holdings.

export const SEED_INDICES: UnderlyingIndex[] = [
  { id: 'tw50', name: '台灣 50', market: 'TW', currency: 'TWD' },
  { id: 'taiex', name: '加權指數 TAIEX', market: 'TW', currency: 'TWD' },
  { id: 'tw_elec', name: '台灣電子類指數', market: 'TW', currency: 'TWD' },
  { id: 'sp500', name: 'S&P 500', market: 'US', currency: 'USD' },
  { id: 'ndx', name: 'Nasdaq 100', market: 'US', currency: 'USD' },
  { id: 'global_ex_us', name: '全球除美國', market: 'GLOBAL', currency: 'USD' },
  { id: 'btc', name: 'Bitcoin', market: 'CRYPTO', currency: 'USD' },
];

// Fee rules are list prices or common defaults, not anyone's actual
// contract: every user should set their own rates and discounts.
const TW_BROKER_FEES: Broker['fees'] = {
  stock: { rate: 0.001425, discount: 1, minFee: 20, sellTaxRate: 0.003 },
  etf: { rate: 0.001425, discount: 1, minFee: 20, sellTaxRate: 0.001 },
  future: { perUnit: 0, taxRate: 0.00002 },
};
const US_BROKER_FEES: Broker['fees'] = { stock: { rate: 0 }, etf: { rate: 0 }, future: { perUnit: 0 } };
const CRYPTO_FEES: Broker['fees'] = { crypto: { rate: 0.001 }, perpetual: { rate: 0.0005 } };

const tw = (id: string, name: string): Broker => ({ id, name, kind: 'broker', fees: TW_BROKER_FEES });
const us = (id: string, name: string): Broker => ({ id, name, kind: 'broker', fees: US_BROKER_FEES });
const ex = (id: string, name: string): Broker => ({ id, name, kind: 'exchange', fees: CRYPTO_FEES });
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

type Spec = Pick<Instrument, 'id' | 'symbol' | 'name' | 'indexId'> & Partial<Instrument>;

const twEtf = (s: Spec): Instrument => ({
  type: 'etf',
  exchange: 'TWSE',
  currency: 'TWD',
  leverage: 1,
  multiplier: 1,
  lotSize: 1,
  quoteSource: 'yahoo',
  quoteSymbol: `${s.symbol}.TW`,
  active: true,
  ...s,
});

const usEtf = (s: Spec): Instrument => ({
  type: 'etf',
  exchange: 'US',
  currency: 'USD',
  leverage: 1,
  multiplier: 1,
  lotSize: 1,
  quoteSource: 'yahoo',
  quoteSymbol: s.symbol,
  active: true,
  ...s,
});

// Continuous front-month series. Contract specs and margins change: confirm
// them with the exchange and broker before relying on them.
const future = (s: Spec & Pick<Instrument, 'multiplier' | 'currency' | 'exchange'>): Instrument => ({
  type: 'future',
  leverage: 1,
  lotSize: 1,
  quoteSource: 'manual',
  settlement: 'cash',
  seriesId: s.id,
  active: true,
  ...s,
});

export const SEED_INSTRUMENTS: Instrument[] = [
  twEtf({ id: 'tw_0050', symbol: '0050', name: '元大台灣50', indexId: 'tw50' }),
  twEtf({ id: 'tw_00631L', symbol: '00631L', name: '元大台灣50正2', indexId: 'tw50', leverage: 2 }),
  twEtf({ id: 'tw_00675L', symbol: '00675L', name: '富邦臺灣加權正2', indexId: 'taiex', leverage: 2 }),
  usEtf({ id: 'us_VOO', symbol: 'VOO', name: 'Vanguard S&P 500 ETF', indexId: 'sp500' }),
  usEtf({ id: 'us_SPY', symbol: 'SPY', name: 'SPDR S&P 500 ETF', indexId: 'sp500' }),
  usEtf({ id: 'us_IVV', symbol: 'IVV', name: 'iShares Core S&P 500 ETF', indexId: 'sp500' }),
  usEtf({ id: 'us_SPYM', symbol: 'SPYM', name: 'SPDR Portfolio S&P 500 ETF（舊稱 SPLG）', indexId: 'sp500' }),
  usEtf({ id: 'us_SSO', symbol: 'SSO', name: 'ProShares Ultra S&P500', indexId: 'sp500', leverage: 2 }),
  usEtf({ id: 'us_UPRO', symbol: 'UPRO', name: 'ProShares UltraPro S&P500', indexId: 'sp500', leverage: 3 }),
  usEtf({ id: 'us_QQQ', symbol: 'QQQ', name: 'Invesco QQQ', indexId: 'ndx' }),
  usEtf({ id: 'us_QQQM', symbol: 'QQQM', name: 'Invesco Nasdaq 100 ETF', indexId: 'ndx' }),
  usEtf({ id: 'us_QLD', symbol: 'QLD', name: 'ProShares Ultra QQQ', indexId: 'ndx', leverage: 2 }),
  usEtf({ id: 'us_TQQQ', symbol: 'TQQQ', name: 'ProShares UltraPro QQQ', indexId: 'ndx', leverage: 3 }),
  usEtf({ id: 'us_VXUS', symbol: 'VXUS', name: 'Vanguard Total International Stock ETF', indexId: 'global_ex_us' }),
  future({ id: 'fut_TX', symbol: 'TX', name: '臺股期貨', indexId: 'taiex', exchange: 'TAIFEX', currency: 'TWD', multiplier: 200 }),
  future({ id: 'fut_MTX', symbol: 'MTX', name: '小型臺指期貨', indexId: 'taiex', exchange: 'TAIFEX', currency: 'TWD', multiplier: 50 }),
  future({ id: 'fut_TMF', symbol: 'TMF', name: '微型臺指期貨', indexId: 'taiex', exchange: 'TAIFEX', currency: 'TWD', multiplier: 10 }),
  future({ id: 'fut_ES', symbol: 'ES', name: 'E-mini S&P 500', indexId: 'sp500', exchange: 'CME', currency: 'USD', multiplier: 50, quoteSource: 'yahoo', quoteSymbol: 'ES=F' }),
  future({ id: 'fut_MES', symbol: 'MES', name: 'Micro E-mini S&P 500', indexId: 'sp500', exchange: 'CME', currency: 'USD', multiplier: 5, quoteSource: 'yahoo', quoteSymbol: 'MES=F' }),
  future({ id: 'fut_NQ', symbol: 'NQ', name: 'E-mini Nasdaq 100', indexId: 'ndx', exchange: 'CME', currency: 'USD', multiplier: 20, quoteSource: 'yahoo', quoteSymbol: 'NQ=F' }),
  future({ id: 'fut_MNQ', symbol: 'MNQ', name: 'Micro E-mini Nasdaq 100', indexId: 'ndx', exchange: 'CME', currency: 'USD', multiplier: 2, quoteSource: 'yahoo', quoteSymbol: 'MNQ=F' }),
  {
    id: 'crypto_BTC', symbol: 'BTC', name: 'Bitcoin 現貨', type: 'crypto', exchange: 'CRYPTO',
    currency: 'USDT', indexId: 'btc', leverage: 1, multiplier: 1, lotSize: 0.00001,
    quoteSource: 'binance', quoteSymbol: 'BTCUSDT', active: true,
  },
  {
    id: 'perp_BTCUSDT', symbol: 'BTCUSDT-PERP', name: 'Bitcoin 永續合約', type: 'perpetual', exchange: 'CRYPTO',
    currency: 'USDT', indexId: 'btc', leverage: 1, multiplier: 1, lotSize: 0.001,
    quoteSource: 'binance', quoteSymbol: 'BTCUSDT', settlement: 'cash', active: true,
  },
];

/** FX pairs the app keeps quoted, as [from, to, quote source, quote symbol]. */
export const SEED_FX_PAIRS: Array<[string, string, 'yahoo' | 'binance', string]> = [
  ['USD', 'TWD', 'yahoo', 'USDTWD=X'],
  ['USDT', 'USD', 'yahoo', 'USDT-USD'],
];

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
