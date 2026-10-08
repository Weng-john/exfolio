// Domain model. Every table is an array of rows with a stable `id`, so the
// same shape maps onto the local JSON store and onto Google Sheets.

export type ID = string;
export type Currency = string; // 'TWD' | 'USD' | 'USDT' | 'BTC' | ...
export type ISODate = string; // YYYY-MM-DD
export type ISODateTime = string;

/** Bucket id of the passive core portfolio. Any other bucket is a strategy id. */
export const CORE_BUCKET = 'core';

export interface Broker {
  id: ID;
  name: string;
  note?: string;
}

export type AccountType = 'securities' | 'futures' | 'crypto' | 'bank';

export interface Account {
  id: ID;
  brokerId: ID;
  name: string;
  type: AccountType;
  baseCurrency: Currency;
  active: boolean;
  note?: string;
}

export type Market = 'TW' | 'US' | 'GLOBAL' | 'CRYPTO' | 'OTHER';

export interface UnderlyingIndex {
  id: ID;
  name: string;
  market: Market;
  currency: Currency;
  note?: string;
}

export type InstrumentType = 'stock' | 'etf' | 'future' | 'perpetual' | 'crypto' | 'option';

export type QuoteSource = 'manual' | 'yahoo' | 'binance';

export interface Instrument {
  id: ID;
  symbol: string;
  name: string;
  type: InstrumentType;
  exchange: string;
  currency: Currency;
  /** Underlying index this instrument gives exposure to. */
  indexId?: ID;
  /** Daily target leverage (ETF). 1 for plain instruments, negative for inverse. */
  leverage: number;
  /** Contract multiplier. 1 for stocks / ETFs / spot. */
  multiplier: number;
  /** Smallest tradable quantity step. */
  lotSize: number;
  quoteSource: QuoteSource;
  quoteSymbol?: string;
  expenseRatio?: number;
  // Futures / perpetual contract spec
  seriesId?: ID;
  expiry?: ISODate;
  tickSize?: number;
  initialMargin?: number;
  maintenanceMargin?: number;
  settlement?: 'cash' | 'physical';
  /** Brokers where this instrument can be traded. Empty = unrestricted. */
  brokerIds?: ID[];
  validFrom?: ISODate;
  validTo?: ISODate;
  active: boolean;
  note?: string;
}

/** Derivatives carry exposure but no market value; P&L settles to cash. */
export function isDerivative(type: InstrumentType): boolean {
  return type === 'future' || type === 'perpetual';
}

export type TxType =
  | 'buy'
  | 'sell'
  | 'deposit' // external money in: raises contributed capital
  | 'withdraw' // external money out
  | 'transfer' // internal move between accounts / currencies: never P&L
  | 'dividend'
  | 'fee'
  | 'interest' // non-loan financing cost, e.g. margin interest
  | 'loan_draw'
  | 'loan_repay'
  | 'funding_fee' // perpetual funding; positive = paid, negative = received
  | 'adjust'; // signed cash reconciliation

export type FundingSource = 'external' | 'portfolio';

export interface Transaction {
  id: ID;
  date: ISODate;
  type: TxType;
  accountId: ID;
  /** CORE_BUCKET or a strategy id. */
  bucket: ID;
  currency: Currency;
  /**
   * Cash magnitude in `currency`. Positive, except `adjust` and `funding_fee`
   * which are signed. Unused for buy/sell (derived from quantity x price).
   */
  amount: number;
  instrumentId?: ID;
  quantity?: number;
  price?: number;
  fee?: number;
  tax?: number;
  /** Base currency per 1 unit of `currency` on the trade date. */
  fxRate?: number;
  // transfer
  toAccountId?: ID;
  toCurrency?: Currency;
  toAmount?: number;
  /** Destination bucket when capital moves between core and a strategy. */
  toBucket?: ID;
  // loan_draw / loan_repay
  loanId?: ID;
  principal?: number;
  interest?: number;
  /** Where repayment money came from. External repayment raises NAV. */
  source?: FundingSource;
  note?: string;
  tags?: string[];
}

export type LoanKind = 'credit' | 'pledge' | 'margin' | 'other';
export type RepaymentMethod = 'annuity' | 'equal_principal' | 'interest_only' | 'revolving';

export interface CollateralItem {
  instrumentId: ID;
  accountId: ID;
  quantity: number;
  /** Fraction of market value the lender counts (折算率). */
  loanableRatio: number;
}

export interface Loan {
  id: ID;
  name: string;
  kind: LoanKind;
  lender: string;
  currency: Currency;
  /** Original principal. The outstanding balance is derived from transactions. */
  principal: number;
  annualRate: number;
  method: RepaymentMethod;
  startDate: ISODate;
  termMonths?: number;
  payDay?: number;
  collateral?: CollateralItem[];
  /** Maintenance ratio (collateral value / balance) that triggers a margin call. */
  callRatio?: number;
  active: boolean;
  note?: string;
}

export type QuoteStatus = 'realtime' | 'delayed' | 'manual' | 'stale';

export interface PriceQuote {
  /** Equals instrumentId: one current price per instrument. */
  id: ID;
  price: number;
  currency: Currency;
  asOf: ISODateTime;
  source: QuoteSource;
  status: QuoteStatus;
}

export interface FxRate {
  /** `${from}/${to}` */
  id: ID;
  from: Currency;
  to: Currency;
  /** Units of `to` per 1 unit of `from`. */
  rate: number;
  asOf: ISODateTime;
  source: QuoteSource;
}

export interface AllocationTarget {
  id: ID;
  indexId: ID;
  /** Signed fraction of NAV. May exceed 1 or be negative. */
  targetWeight: number;
  /** Absolute band around the target before a rebalance is suggested. */
  tolerance: number;
  /** Instrument used to implement the target in suggestions. */
  preferredInstrumentId?: ID;
  note?: string;
}

/** Alert thresholds only. Nothing here blocks a trade or caps leverage. */
export interface AlertSettings {
  grossLeverage?: number;
  debtToNav?: number;
  maintenanceRatio?: number;
  staleQuoteMinutes: number;
}

export interface Settings {
  id: 'default';
  baseCurrency: Currency;
  alerts: AlertSettings;
}

export type StrategyStatus = 'active' | 'paused' | 'closed';

export interface Strategy {
  id: ID;
  name: string;
  description?: string;
  category?: string;
  status: StrategyStatus;
  benchmarkIndexId?: ID;
}

export interface NavSnapshot {
  /** Equals date: one snapshot per day. */
  id: ID;
  date: ISODate;
  nav: number;
  assets: number;
  liabilities: number;
  cash: number;
  grossExposure: number;
  netExposure: number;
  contributedCapital: number;
  /** Net exposure per index id, in base currency. */
  byIndex: Record<ID, number>;
}

export interface AppData {
  brokers: Broker[];
  accounts: Account[];
  indices: UnderlyingIndex[];
  instruments: Instrument[];
  transactions: Transaction[];
  loans: Loan[];
  prices: PriceQuote[];
  fxRates: FxRate[];
  targets: AllocationTarget[];
  strategies: Strategy[];
  snapshots: NavSnapshot[];
  settings: Settings[];
}

export type TableName = keyof AppData;

export const TABLE_NAMES: TableName[] = [
  'brokers',
  'accounts',
  'indices',
  'instruments',
  'transactions',
  'loans',
  'prices',
  'fxRates',
  'targets',
  'strategies',
  'snapshots',
  'settings',
];

export const DEFAULT_SETTINGS: Settings = {
  id: 'default',
  baseCurrency: 'TWD',
  alerts: { staleQuoteMinutes: 60 * 24 },
};

export function emptyData(): AppData {
  return {
    brokers: [],
    accounts: [],
    indices: [],
    instruments: [],
    transactions: [],
    loans: [],
    prices: [],
    fxRates: [],
    targets: [],
    strategies: [],
    snapshots: [],
    settings: [{ ...DEFAULT_SETTINGS, alerts: { ...DEFAULT_SETTINGS.alerts } }],
  };
}

export function getSettings(data: AppData): Settings {
  return data.settings[0] ?? DEFAULT_SETTINGS;
}
