import {
  emptyData,
  type Account,
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

export const SEED_BROKERS: Broker[] = [
  { id: 'kgi', name: '凱基' },
  { id: 'sinopac', name: '永豐' },
  { id: 'binance', name: 'Binance' },
];

export const SEED_ACCOUNTS: Account[] = [
  { id: 'kgi_tw', brokerId: 'kgi', name: '凱基 台股', type: 'securities', baseCurrency: 'TWD', active: true },
  { id: 'kgi_fut', brokerId: 'kgi', name: '凱基 期貨', type: 'futures', baseCurrency: 'TWD', active: true },
  { id: 'sinopac_tw', brokerId: 'sinopac', name: '永豐 台股', type: 'securities', baseCurrency: 'TWD', active: true },
  { id: 'sinopac_us', brokerId: 'sinopac', name: '永豐 美股複委託', type: 'securities', baseCurrency: 'USD', active: true },
  { id: 'binance_main', brokerId: 'binance', name: 'Binance', type: 'crypto', baseCurrency: 'USDT', active: true },
];

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
  twEtf({ id: 'tw_00675L', symbol: '00675L', name: '富邦臺灣加權正2', indexId: 'taiex', leverage: 2,
    note: '請確認追蹤指數；與 00631L 不是同一指數' }),
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
    id: 'crypto_BTC', symbol: 'BTC', name: 'Bitcoin 現貨', type: 'crypto', exchange: 'Binance',
    currency: 'USDT', indexId: 'btc', leverage: 1, multiplier: 1, lotSize: 0.00001,
    quoteSource: 'binance', quoteSymbol: 'BTCUSDT', active: true,
  },
  {
    id: 'perp_BTCUSDT', symbol: 'BTCUSDT-PERP', name: 'Bitcoin 永續合約', type: 'perpetual', exchange: 'Binance',
    currency: 'USDT', indexId: 'btc', leverage: 1, multiplier: 1, lotSize: 0.001,
    quoteSource: 'binance', quoteSymbol: 'BTCUSDT', settlement: 'cash', active: true,
  },
];

/** FX pairs the app keeps quoted, as [from, to, quote source, quote symbol]. */
export const SEED_FX_PAIRS: Array<[string, string, 'yahoo' | 'binance', string]> = [
  ['USD', 'TWD', 'yahoo', 'USDTWD=X'],
  ['USDT', 'USD', 'yahoo', 'USDT-USD'],
];

/** A fresh dataset holding only reference data: no holdings, no cash. */
export function seedData(): AppData {
  const data = emptyData();
  data.indices = SEED_INDICES.map((x) => ({ ...x }));
  data.brokers = SEED_BROKERS.map((x) => ({ ...x }));
  data.accounts = SEED_ACCOUNTS.map((x) => ({ ...x }));
  data.instruments = SEED_INSTRUMENTS.map((x) => ({ ...x }));
  return data;
}
