import type { Currency, ID, Instrument, Market, QuoteSource, UnderlyingIndex } from './types';

// Public reference catalogue: broad market indices and the instruments that
// track them — ordinary and leveraged / inverse ETFs, index futures, and
// Binance's USDT-margined perpetuals on index ETFs. Nothing here describes
// anyone's holdings. Users can add any instrument this list lacks.
//
// Leverage is the fund's *daily* target multiple (negative for inverse
// funds). Contract sizes and margins change: confirm them with the exchange
// and broker before relying on them.

// ---- Indices -----------------------------------------------------------------

const idx = (
  id: ID,
  name: string,
  market: Market,
  currency: Currency,
  extra: Partial<UnderlyingIndex> = {},
): UnderlyingIndex => ({ id, name, market, currency, weighting: 'market_cap', ...extra });

export const CATALOG_INDICES: UnderlyingIndex[] = [
  idx('tw50', '台灣 50', 'TW', 'TWD'),
  idx('taiex', '加權指數 TAIEX', 'TW', 'TWD'),
  idx('tw_elec', '台灣電子類指數', 'TW', 'TWD'),
  idx('msci_taiwan', 'MSCI 台灣', 'TW', 'USD'),
  idx('sp500', 'S&P 500', 'US', 'USD'),
  idx('ndx', 'Nasdaq 100', 'US', 'USD', { note: '修正市值加權' }),
  idx('rut2000', 'Russell 2000', 'US', 'USD'),
  idx('us_total', '美國全市場', 'US', 'USD'),
  idx('topix', 'TOPIX 東證股價指數', 'JP', 'JPY'),
  idx('nikkei225', '日經 225', 'JP', 'JPY', {
    weighting: 'price',
    note: '價格加權，不是市值加權',
  }),
  idx('msci_japan', 'MSCI 日本', 'JP', 'USD'),
  idx('kospi200', 'KOSPI 200', 'KR', 'KRW'),
  idx('msci_korea', 'MSCI 韓國', 'KR', 'USD'),
  idx('hsi', '恒生指數', 'HK', 'HKD', { note: '個股權重有上限' }),
  idx('hscei', '恒生中國企業指數', 'HK', 'HKD'),
  idx('csi300', '滬深 300', 'CN', 'CNY'),
  idx('ftse_china50', '富時中國 50', 'CN', 'USD'),
  idx('msci_china', 'MSCI 中國', 'CN', 'USD'),
  idx('nifty50', 'Nifty 50', 'IN', 'INR'),
  idx('msci_india', 'MSCI 印度', 'IN', 'USD'),
  idx('europe_dev', '富時已開發歐洲', 'EU', 'USD'),
  idx('euro_stoxx50', 'Euro Stoxx 50', 'EU', 'EUR'),
  idx('msci_eurozone', 'MSCI 歐元區', 'EU', 'USD'),
  idx('dax', 'DAX 40', 'EU', 'EUR'),
  idx('msci_germany', 'MSCI 德國', 'EU', 'USD'),
  idx('msci_uk', 'MSCI 英國', 'UK', 'USD'),
  idx('msci_canada', 'MSCI 加拿大', 'AMERICAS', 'USD'),
  idx('msci_brazil', 'MSCI 巴西', 'AMERICAS', 'USD'),
  idx('msci_mexico', 'MSCI 墨西哥', 'AMERICAS', 'USD'),
  idx('msci_australia', 'MSCI 澳洲', 'APAC', 'USD'),
  idx('emerging', '新興市場', 'EM', 'USD', { note: 'MSCI 與富時新興市場指數歸在一起' }),
  idx('eafe', 'MSCI EAFE（歐澳遠東）', 'GLOBAL', 'USD'),
  idx('global_ex_us', '全球除美國', 'GLOBAL', 'USD'),
  idx('world_dev', 'MSCI 世界（已開發）', 'GLOBAL', 'USD'),
  idx('global_all', '全球股市（ACWI／全球全市場）', 'GLOBAL', 'USD'),
  idx('btc', 'Bitcoin', 'CRYPTO', 'USD', { weighting: 'other' }),
  idx('eth', 'Ethereum', 'CRYPTO', 'USD', { weighting: 'other' }),
];

// ---- Instrument builders --------------------------------------------------------

type Listing = {
  exchange: string;
  currency: Currency;
  /** Turns a ticker into the quote source's symbol. */
  quote: (symbol: string) => string;
  /** Prefix of the instrument id, e.g. `us`. */
  prefix: string;
  lotSize?: number;
};

const US: Listing = { exchange: 'US', currency: 'USD', quote: (s) => s, prefix: 'us' };
const TW: Listing = { exchange: 'TWSE', currency: 'TWD', quote: (s) => `${s}.TW`, prefix: 'tw' };
const JP: Listing = { exchange: 'TSE', currency: 'JPY', quote: (s) => `${s}.T`, prefix: 'jp' };
const KR: Listing = { exchange: 'KRX', currency: 'KRW', quote: (s) => `${s}.KS`, prefix: 'kr' };
const HK: Listing = { exchange: 'HKEX', currency: 'HKD', quote: (s) => `${s}.HK`, prefix: 'hk' };
const SH: Listing = { exchange: 'SSE', currency: 'CNY', quote: (s) => `${s}.SS`, prefix: 'cn' };
const NS: Listing = { exchange: 'NSE', currency: 'INR', quote: (s) => `${s}.NS`, prefix: 'in' };

/** An exchange-traded fund. `leverage` is the daily target multiple. */
const etf = (
  listing: Listing,
  symbol: string,
  name: string,
  indexId: ID,
  leverage = 1,
  extra: Partial<Instrument> = {},
): Instrument => ({
  id: `${listing.prefix}_${symbol}`,
  symbol,
  name,
  type: 'etf',
  exchange: listing.exchange,
  currency: listing.currency,
  indexId,
  leverage,
  multiplier: 1,
  lotSize: listing.lotSize ?? 1,
  quoteSource: 'yahoo',
  quoteSymbol: listing.quote(symbol),
  active: true,
  ...extra,
});

/** A continuous front-month index future. */
const future = (
  symbol: string,
  name: string,
  indexId: ID,
  exchange: string,
  currency: Currency,
  multiplier: number,
  quote?: { source: QuoteSource; symbol: string },
  extra: Partial<Instrument> = {},
): Instrument => ({
  id: `fut_${symbol}`,
  symbol,
  name,
  type: 'future',
  exchange,
  currency,
  indexId,
  leverage: 1,
  multiplier,
  lotSize: 1,
  quoteSource: quote?.source ?? 'manual',
  ...(quote ? { quoteSymbol: quote.symbol } : {}),
  settlement: 'cash',
  seriesId: `fut_${symbol}`,
  active: true,
  ...extra,
});

/**
 * A Binance USDⓈ-M perpetual. One unit tracks one unit of the underlying
 * (a share of the ETF, or one coin), priced in USDT; `leverage` is the
 * underlying ETF's own multiple, not the margin leverage you trade with.
 */
const perp = (
  symbol: string,
  name: string,
  indexId: ID,
  leverage = 1,
  extra: Partial<Instrument> = {},
): Instrument => ({
  id: `perp_${symbol}`,
  symbol: `${symbol}-PERP`,
  name,
  type: 'perpetual',
  exchange: 'Binance',
  currency: 'USDT',
  indexId,
  leverage,
  multiplier: 1,
  lotSize: 0.001,
  quoteSource: 'binance_futures',
  quoteSymbol: symbol,
  settlement: 'cash',
  active: true,
  ...extra,
});

// ---- Instruments ----------------------------------------------------------------

export const CATALOG_INSTRUMENTS: Instrument[] = [
  // Taiwan
  etf(TW, '0050', '元大台灣50', 'tw50'),
  etf(TW, '006208', '富邦台50', 'tw50'),
  etf(TW, '00631L', '元大台灣50正2', 'tw50', 2),
  etf(TW, '00632R', '元大台灣50反1', 'tw50', -1),
  etf(TW, '00675L', '富邦臺灣加權正2', 'taiex', 2),
  etf(TW, '00676R', '富邦臺灣加權反1', 'taiex', -1),
  etf(TW, '00663L', '國泰臺灣加權正2', 'taiex', 2),
  etf(TW, '00664R', '國泰臺灣加權反1', 'taiex', -1),
  etf(TW, '00685L', '群益臺灣加權正2', 'taiex', 2),
  etf(US, 'EWT', 'iShares MSCI Taiwan', 'msci_taiwan'),
  future('TX', '臺股期貨', 'taiex', 'TAIFEX', 'TWD', 200, { source: 'taifex', symbol: 'TXF' }),
  future('MTX', '小型臺指期貨', 'taiex', 'TAIFEX', 'TWD', 50, { source: 'taifex', symbol: 'MXF' }),
  future('TMF', '微型臺指期貨', 'taiex', 'TAIFEX', 'TWD', 10, { source: 'taifex', symbol: 'TMF' }),
  perp('EWTUSDT', 'Binance EWT 永續（MSCI 台灣）', 'msci_taiwan'),

  // United States — S&P 500
  etf(US, 'VOO', 'Vanguard S&P 500 ETF', 'sp500'),
  etf(US, 'SPY', 'SPDR S&P 500 ETF', 'sp500'),
  etf(US, 'IVV', 'iShares Core S&P 500 ETF', 'sp500'),
  etf(US, 'SPYM', 'SPDR Portfolio S&P 500 ETF（舊稱 SPLG）', 'sp500'),
  etf(US, 'SSO', 'ProShares Ultra S&P500', 'sp500', 2),
  etf(US, 'UPRO', 'ProShares UltraPro S&P500', 'sp500', 3),
  etf(US, 'SPXL', 'Direxion Daily S&P 500 Bull 3X', 'sp500', 3),
  etf(US, 'SH', 'ProShares Short S&P500', 'sp500', -1),
  etf(US, 'SDS', 'ProShares UltraShort S&P500', 'sp500', -2),
  etf(US, 'SPXU', 'ProShares UltraPro Short S&P500', 'sp500', -3),
  etf(US, 'SPXS', 'Direxion Daily S&P 500 Bear 3X', 'sp500', -3),
  etf(TW, '00646', '元大S&P500', 'sp500'),
  etf(TW, '00647L', '元大S&P500正2', 'sp500', 2),
  etf(TW, '00648R', '元大S&P500反1', 'sp500', -1),
  future('ES', 'E-mini S&P 500', 'sp500', 'CME', 'USD', 50, { source: 'yahoo', symbol: 'ES=F' }),
  future('MES', 'Micro E-mini S&P 500', 'sp500', 'CME', 'USD', 5, {
    source: 'yahoo',
    symbol: 'MES=F',
  }),
  perp('SPYUSDT', 'Binance SPY 永續（S&P 500）', 'sp500'),

  // United States — Nasdaq 100
  etf(US, 'QQQ', 'Invesco QQQ', 'ndx'),
  etf(US, 'QQQM', 'Invesco Nasdaq 100 ETF', 'ndx'),
  etf(US, 'QLD', 'ProShares Ultra QQQ', 'ndx', 2),
  etf(US, 'TQQQ', 'ProShares UltraPro QQQ', 'ndx', 3),
  etf(US, 'PSQ', 'ProShares Short QQQ', 'ndx', -1),
  etf(US, 'QID', 'ProShares UltraShort QQQ', 'ndx', -2),
  etf(US, 'SQQQ', 'ProShares UltraPro Short QQQ', 'ndx', -3),
  etf(TW, '00662', '富邦NASDAQ', 'ndx'),
  etf(TW, '00670L', '富邦NASDAQ正2', 'ndx', 2),
  etf(TW, '00671R', '富邦NASDAQ反1', 'ndx', -1),
  future('NQ', 'E-mini Nasdaq 100', 'ndx', 'CME', 'USD', 20, { source: 'yahoo', symbol: 'NQ=F' }),
  future('MNQ', 'Micro E-mini Nasdaq 100', 'ndx', 'CME', 'USD', 2, {
    source: 'yahoo',
    symbol: 'MNQ=F',
  }),
  perp('QQQUSDT', 'Binance QQQ 永續（Nasdaq 100）', 'ndx'),
  perp('TQQQUSDT', 'Binance TQQQ 永續（Nasdaq 100 三倍）', 'ndx', 3),
  perp('SQQQUSDT', 'Binance SQQQ 永續（Nasdaq 100 反向三倍）', 'ndx', -3),

  // United States — Russell 2000 and total market
  etf(US, 'IWM', 'iShares Russell 2000', 'rut2000'),
  etf(US, 'VTWO', 'Vanguard Russell 2000', 'rut2000'),
  etf(US, 'UWM', 'ProShares Ultra Russell2000', 'rut2000', 2),
  etf(US, 'TNA', 'Direxion Daily Small Cap Bull 3X', 'rut2000', 3),
  etf(US, 'RWM', 'ProShares Short Russell2000', 'rut2000', -1),
  etf(US, 'TWM', 'ProShares UltraShort Russell2000', 'rut2000', -2),
  etf(US, 'TZA', 'Direxion Daily Small Cap Bear 3X', 'rut2000', -3),
  future('RTY', 'E-mini Russell 2000', 'rut2000', 'CME', 'USD', 50, {
    source: 'yahoo',
    symbol: 'RTY=F',
  }),
  future('M2K', 'Micro E-mini Russell 2000', 'rut2000', 'CME', 'USD', 5, {
    source: 'yahoo',
    symbol: 'M2K=F',
  }),
  perp('IWMUSDT', 'Binance IWM 永續（Russell 2000）', 'rut2000'),
  etf(US, 'VTI', 'Vanguard Total Stock Market', 'us_total'),
  etf(US, 'ITOT', 'iShares Core S&P Total U.S. Stock Market', 'us_total'),

  // Japan
  etf(JP, '1306', 'NEXT FUNDS TOPIX', 'topix'),
  etf(JP, '1475', 'iShares Core TOPIX', 'topix'),
  etf(JP, '1568', 'TOPIX ブル 2 倍', 'topix', 2),
  etf(JP, '1356', 'TOPIX ベア 2 倍', 'topix', -2),
  etf(JP, '1321', 'NEXT FUNDS 日經 225', 'nikkei225'),
  etf(JP, '1570', 'NEXT FUNDS 日經 225 槓桿', 'nikkei225', 2),
  etf(JP, '1571', 'NEXT FUNDS 日經 225 反向', 'nikkei225', -1),
  etf(JP, '1357', 'NEXT FUNDS 日經 225 雙倍反向', 'nikkei225', -2),
  etf(TW, '00645', '富邦日本', 'nikkei225'),
  etf(TW, '00640L', '富邦日本正2', 'nikkei225', 2),
  etf(TW, '00641R', '富邦日本反1', 'nikkei225', -1),
  etf(US, 'EWJ', 'iShares MSCI Japan', 'msci_japan'),
  etf(US, 'EZJ', 'ProShares Ultra MSCI Japan', 'msci_japan', 2),
  future('NKD', 'CME 日經 225（美元）', 'nikkei225', 'CME', 'USD', 5, {
    source: 'yahoo',
    symbol: 'NKD=F',
  }),
  future('NIY', 'CME 日經 225（日圓）', 'nikkei225', 'CME', 'JPY', 500, {
    source: 'yahoo',
    symbol: 'NIY=F',
  }),
  future('NK225M', '大阪 日經 225 mini', 'nikkei225', 'OSE', 'JPY', 100),
  perp('EWJUSDT', 'Binance EWJ 永續（MSCI 日本）', 'msci_japan'),

  // Korea
  etf(KR, '069500', 'KODEX 200', 'kospi200'),
  etf(KR, '102110', 'TIGER 200', 'kospi200'),
  etf(KR, '122630', 'KODEX 레버리지', 'kospi200', 2),
  etf(KR, '114800', 'KODEX 인버스', 'kospi200', -1),
  etf(KR, '252670', 'KODEX 200선물인버스2X', 'kospi200', -2),
  etf(US, 'EWY', 'iShares MSCI South Korea', 'msci_korea'),
  etf(US, 'KORU', 'Direxion Daily South Korea Bull 3X', 'msci_korea', 3),
  future('K200', 'KOSPI 200 期貨', 'kospi200', 'KRX', 'KRW', 250_000),
  perp('KODEX200USDT', 'Binance KODEX 200 永續（KOSPI 200）', 'kospi200'),
  perp('EWYUSDT', 'Binance EWY 永續（MSCI 韓國）', 'msci_korea'),
  perp('KORUUSDT', 'Binance KORU 永續（MSCI 韓國三倍）', 'msci_korea', 3),

  // Hong Kong and China
  etf(HK, '2800', '盈富基金', 'hsi'),
  etf(HK, '7200', '南方恒生指數每日槓桿（2x）', 'hsi', 2),
  etf(HK, '7300', '南方恒生指數每日反向（-1x）', 'hsi', -1),
  etf(HK, '2828', '恒生中國企業 ETF', 'hscei'),
  etf(HK, '7288', '南方恒生中國企業每日槓桿（2x）', 'hscei', 2),
  future('HSI', '恒生指數期貨', 'hsi', 'HKEX', 'HKD', 50),
  future('MHI', '小型恒生指數期貨', 'hsi', 'HKEX', 'HKD', 10),
  etf(SH, '510300', '華泰柏瑞滬深 300 ETF', 'csi300', 1, { lotSize: 100 }),
  etf(US, 'ASHR', 'Xtrackers Harvest CSI 300 China A', 'csi300'),
  etf(US, 'CHAU', 'Direxion Daily CSI 300 China A Bull 2X', 'csi300', 2),
  etf(TW, '0061', '元大寶滬深', 'csi300'),
  etf(TW, '00637L', '元大滬深300正2', 'csi300', 2),
  etf(TW, '00638R', '元大滬深300反1', 'csi300', -1),
  etf(US, 'FXI', 'iShares China Large-Cap', 'ftse_china50'),
  etf(US, 'XPP', 'ProShares Ultra FTSE China 50', 'ftse_china50', 2),
  etf(US, 'YINN', 'Direxion Daily FTSE China Bull 3X', 'ftse_china50', 3),
  etf(US, 'FXP', 'ProShares UltraShort FTSE China 50', 'ftse_china50', -2),
  etf(US, 'YANG', 'Direxion Daily FTSE China Bear 3X', 'ftse_china50', -3),
  etf(US, 'MCHI', 'iShares MSCI China', 'msci_china'),

  // India
  etf(NS, 'NIFTYBEES', 'Nippon India ETF Nifty 50 BeES', 'nifty50'),
  etf(US, 'INDA', 'iShares MSCI India', 'msci_india'),
  etf(US, 'INDL', 'Direxion Daily MSCI India Bull 2X', 'msci_india', 2),

  // Europe and the UK (US-listed funds, priced in USD)
  etf(US, 'VGK', 'Vanguard FTSE Europe', 'europe_dev'),
  etf(US, 'EURL', 'Direxion Daily FTSE Europe Bull 3X', 'europe_dev', 3),
  etf(US, 'FEZ', 'SPDR Euro Stoxx 50', 'euro_stoxx50'),
  etf(US, 'EZU', 'iShares MSCI Eurozone', 'msci_eurozone'),
  etf(US, 'EWG', 'iShares MSCI Germany', 'msci_germany'),
  etf(US, 'EWU', 'iShares MSCI United Kingdom', 'msci_uk'),
  future('FESX', 'Euro Stoxx 50 期貨', 'euro_stoxx50', 'Eurex', 'EUR', 10),
  future('FDAX', 'DAX 期貨', 'dax', 'Eurex', 'EUR', 25),
  future('FDXM', 'Mini-DAX 期貨', 'dax', 'Eurex', 'EUR', 5),

  // Americas, Asia-Pacific and emerging markets
  etf(US, 'EWC', 'iShares MSCI Canada', 'msci_canada'),
  etf(US, 'EWZ', 'iShares MSCI Brazil', 'msci_brazil'),
  etf(US, 'BRZU', 'Direxion Daily MSCI Brazil Bull 2X', 'msci_brazil', 2, {
    note: '槓桿倍數曾經調整，請確認目前倍數',
  }),
  etf(US, 'EWW', 'iShares MSCI Mexico', 'msci_mexico'),
  etf(US, 'EWA', 'iShares MSCI Australia', 'msci_australia'),
  perp('EWZUSDT', 'Binance EWZ 永續（MSCI 巴西）', 'msci_brazil'),
  etf(US, 'EEM', 'iShares MSCI Emerging Markets', 'emerging'),
  etf(US, 'IEMG', 'iShares Core MSCI Emerging Markets', 'emerging'),
  etf(US, 'VWO', 'Vanguard FTSE Emerging Markets', 'emerging'),
  etf(US, 'EET', 'ProShares Ultra MSCI Emerging Markets', 'emerging', 2),
  etf(US, 'EDC', 'Direxion Daily MSCI Emerging Markets Bull 3X', 'emerging', 3),
  etf(US, 'EUM', 'ProShares Short MSCI Emerging Markets', 'emerging', -1),
  etf(US, 'EDZ', 'Direxion Daily MSCI Emerging Markets Bear 3X', 'emerging', -3),

  // Global
  etf(US, 'VXUS', 'Vanguard Total International Stock ETF', 'global_ex_us'),
  etf(US, 'EFA', 'iShares MSCI EAFE', 'eafe'),
  etf(US, 'EFO', 'ProShares Ultra MSCI EAFE', 'eafe', 2),
  etf(US, 'EFZ', 'ProShares Short MSCI EAFE', 'eafe', -1),
  etf(US, 'URTH', 'iShares MSCI World', 'world_dev'),
  etf(US, 'ACWI', 'iShares MSCI ACWI', 'global_all'),
  etf(US, 'VT', 'Vanguard Total World Stock', 'global_all'),

  // Crypto
  {
    id: 'crypto_BTC',
    symbol: 'BTC',
    name: 'Bitcoin 現貨',
    type: 'crypto',
    exchange: 'CRYPTO',
    currency: 'USDT',
    indexId: 'btc',
    leverage: 1,
    multiplier: 1,
    lotSize: 0.00001,
    quoteSource: 'binance',
    quoteSymbol: 'BTCUSDT',
    active: true,
  },
  {
    id: 'crypto_ETH',
    symbol: 'ETH',
    name: 'Ethereum 現貨',
    type: 'crypto',
    exchange: 'CRYPTO',
    currency: 'USDT',
    indexId: 'eth',
    leverage: 1,
    multiplier: 1,
    lotSize: 0.0001,
    quoteSource: 'binance',
    quoteSymbol: 'ETHUSDT',
    active: true,
  },
  perp('BTCUSDT', 'Bitcoin 永續合約', 'btc'),
  perp('ETHUSDT', 'Ethereum 永續合約', 'eth'),
];

/** FX pairs the app keeps quoted, as [from, to, quote source, quote symbol]. */
export const CATALOG_FX_PAIRS: Array<[string, string, QuoteSource, string]> = [
  ['USD', 'TWD', 'yahoo', 'USDTWD=X'],
  ['USDT', 'USD', 'yahoo', 'USDT-USD'],
  ['USD', 'JPY', 'yahoo', 'USDJPY=X'],
  ['USD', 'KRW', 'yahoo', 'USDKRW=X'],
  ['USD', 'HKD', 'yahoo', 'USDHKD=X'],
  ['USD', 'CNY', 'yahoo', 'USDCNY=X'],
  ['USD', 'INR', 'yahoo', 'USDINR=X'],
  ['EUR', 'USD', 'yahoo', 'EURUSD=X'],
  ['GBP', 'USD', 'yahoo', 'GBPUSD=X'],
];
