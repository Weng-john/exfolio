import { FxTable } from './fx';
import { buildLedger, type Position } from './ledger';
import { estimateFees } from './fees';
import { getSettings, isDerivative, type AppData, type Currency, type ID, type Instrument, type ISODate, type PriceQuote, type RolloverRecord, type Transaction } from './types';
import { type Portfolio, type PriceStatus, type ValuedPosition } from './valuation';

const DAY = 86_400_000;

export type FuturesStatus = PriceStatus;

export interface FuturesPosition {
  key: string;
  accountId: ID;
  bucket: ID;
  instrumentId: ID;
  symbol: string;
  seriesId: ID;
  type: Instrument['type'];
  currency: Currency;
  contracts: number;
  /** Alias retained for callers that use the ledger's terminology. */
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  status: FuturesStatus;
  priceStatus: FuturesStatus;
  currentPriceStatus: FuturesStatus;
  priceAsOf?: string;
  multiplier: number;
  /** Signed notional before FX, then in the portfolio base currency. */
  notionalInstrument: number;
  notionalBase: number;
  /** Common aliases for consumers that use valuation terminology. */
  notionalLocal: number;
  notional: number;
  /** Signed index exposure in base currency. */
  exposure: number;
  exposureNav?: number;
  exposureWeight?: number;
  unrealizedPnlInstrument: number;
  unrealizedPnl: number;
  expiry?: ISODate;
  daysToExpiry?: number;
  initialMargin?: number;
  maintenanceMargin?: number;
  initialMarginRequired?: number;
  maintenanceMarginRequired?: number;
  marginSpecMissing: boolean;
}

export interface MarginByAccount {
  accountId: ID;
  accountName: string;
  baseCurrency: Currency;
  cash: number;
  unrealizedPnl: number;
  equity: number;
  accountEquity: number;
  initialMarginRequired?: number;
  maintenanceMarginRequired?: number;
  initialMargin?: number;
  maintenanceMargin?: number;
  excessMaintenance?: number;
  excessOverMaintenance?: number;
  shortfall?: number;
  marginSpecMissing: boolean;
}

export interface SeriesContractHistory {
  instrumentId: ID;
  symbol: string;
  expiry?: ISODate;
  trades: Transaction[];
  realizedPnl: number;
}

export interface SeriesHistory {
  seriesId: ID;
  instruments: SeriesContractHistory[];
  rollovers: RolloverRecord[];
  cumulativeRealizedPnl: number;
  cumulativeRollCost: number;
  cumulativeFees: number;
  /** Whether the cumulative amounts are in the portfolio base currency. */
  baseCurrency: Currency;
}

export interface RolloverPlan {
  id: string;
  accountId: ID;
  bucket: ID;
  seriesId: ID;
  fromInstrumentId: ID;
  toInstrumentId: ID;
  quantity: number;
  contracts: number;
  fromPrice: number;
  toPrice: number;
  spread: number;
  /** Positive for a long position rolling from a lower to a higher price. */
  spreadCost: number;
  estimatedFee: number;
  estimatedTax: number;
  estimatedCosts: number;
  marginChange?: number;
  marginChangeBase?: number;
  marginSpecMissing: boolean;
  currency: Currency;
}

export interface BookedRollover {
  transactions: [Transaction, Transaction];
  rollover: RolloverRecord;
}

type PriceInput = Record<string, number> | Map<string, number> | PriceQuote[];

function parseDate(date: ISODate): [number, number, number] {
  const [year, month, day] = date.split('-').map(Number);
  return [year, month, day];
}

function daysBetween(from: ISODate, to: ISODate): number {
  const [fy, fm, fd] = parseDate(from);
  const [ty, tm, td] = parseDate(to);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / DAY);
}

function priceOf(prices: PriceInput, id: ID): number | undefined {
  if (Array.isArray(prices)) return prices.find((p) => p.id === id)?.price;
  return prices instanceof Map ? prices.get(id) : prices[id];
}

function instrumentOf(data: AppData, id: ID): Instrument {
  const instrument = data.instruments.find((i) => i.id === id);
  if (!instrument) throw new Error(`找不到商品 ${id}`);
  return instrument;
}

function valuedFuturesPosition(p: ValuedPosition, nav: number, today: ISODate): FuturesPosition | undefined {
  const instrument = p.instrument;
  if (!isDerivative(instrument.type) || p.quantity === 0) return undefined;
  const initial = instrument.initialMargin;
  const maintenance = instrument.maintenanceMargin;
  const missing = !(initial !== undefined && initial > 0) || !(maintenance !== undefined && maintenance > 0);
  return {
    key: p.key,
    accountId: p.accountId,
    bucket: p.bucket,
    instrumentId: p.instrumentId,
    symbol: instrument.symbol,
    seriesId: instrument.seriesId ?? instrument.id,
    type: instrument.type,
    currency: instrument.currency,
    contracts: p.quantity,
    quantity: p.quantity,
    averagePrice: p.avgCost,
    currentPrice: p.price,
    status: p.priceStatus,
    priceStatus: p.priceStatus,
    currentPriceStatus: p.priceStatus,
    priceAsOf: p.priceAsOf,
    multiplier: instrument.multiplier,
    notionalInstrument: p.quantity * p.price * instrument.multiplier,
    notionalBase: p.notional,
    notionalLocal: p.quantity * p.price * instrument.multiplier,
    notional: p.notional,
    exposure: p.exposure,
    exposureNav: nav > 0 ? p.exposure / nav : undefined,
    exposureWeight: nav > 0 ? p.exposure / nav : undefined,
    unrealizedPnlInstrument: p.quantity * (p.price - p.avgCost) * instrument.multiplier,
    unrealizedPnl: p.unrealizedPnl,
    expiry: instrument.expiry,
    daysToExpiry: instrument.expiry ? daysBetween(today, instrument.expiry) : undefined,
    initialMargin: instrument.initialMargin,
    maintenanceMargin: instrument.maintenanceMargin,
    initialMarginRequired: initial !== undefined && initial > 0 ? Math.abs(p.quantity) * initial : undefined,
    maintenanceMarginRequired:
      maintenance !== undefined && maintenance > 0 ? Math.abs(p.quantity) * maintenance : undefined,
    marginSpecMissing: missing,
  };
}

/** Open futures and perpetual positions, marked with the portfolio's quotes. */
export function futuresPositions(_data: AppData, portfolio: Portfolio, today: ISODate): FuturesPosition[] {
  return portfolio.valuation.positions
    .map((p) => valuedFuturesPosition(p, portfolio.valuation.nav, today))
    .filter((p): p is FuturesPosition => p !== undefined)
    .sort((a, b) => (a.expiry ?? '9999-12-31').localeCompare(b.expiry ?? '9999-12-31') || a.symbol.localeCompare(b.symbol));
}

function convert(fx: FxTable, amount: number, from: Currency, to: Currency): number {
  return amount * (fx.rate(from, to) ?? 0);
}

/**
 * Derivative margin is cash set aside in the account. It is neither exposure
 * nor a liability; only derivative P&L changes equity and NAV.
 */
export function marginByAccount(data: AppData, portfolio: Portfolio): MarginByAccount[] {
  const fx = new FxTable(data.fxRates);
  const accounts = new Map(data.accounts.map((a) => [a.id, a]));
  const rows = new Map<ID, MarginByAccount>();
  const positions = futuresPositions(data, portfolio, portfolio.ledger.asOf ?? '9999-12-31');

  for (const p of positions) {
    const account = accounts.get(p.accountId);
    const base = account?.baseCurrency ?? getSettings(data).baseCurrency;
    const row = rows.get(p.accountId) ?? {
      accountId: p.accountId,
      accountName: account?.name ?? p.accountId,
      baseCurrency: base,
      cash: 0,
      unrealizedPnl: 0,
      equity: 0,
      accountEquity: 0,
      initialMarginRequired: 0,
      maintenanceMarginRequired: 0,
      marginSpecMissing: false,
    };
    row.unrealizedPnl += convert(fx, p.unrealizedPnlInstrument, p.currency, base);
    if (p.initialMarginRequired === undefined) row.initialMarginRequired = undefined;
    else if (row.initialMarginRequired !== undefined) row.initialMarginRequired += convert(fx, p.initialMarginRequired, p.currency, base);
    if (p.maintenanceMarginRequired === undefined) row.maintenanceMarginRequired = undefined;
    else if (row.maintenanceMarginRequired !== undefined)
      row.maintenanceMarginRequired += convert(fx, p.maintenanceMarginRequired, p.currency, base);
    row.marginSpecMissing ||= p.marginSpecMissing;
    rows.set(p.accountId, row);
  }

  for (const cash of portfolio.ledger.cash) {
    const account = accounts.get(cash.accountId);
    const row = rows.get(cash.accountId);
    if (!row) continue;
    const base = account?.baseCurrency ?? row.baseCurrency;
    row.cash += convert(fx, cash.amount, cash.currency, base);
  }
  for (const row of rows.values()) {
    row.equity = row.cash + row.unrealizedPnl;
    row.accountEquity = row.equity;
    row.initialMargin = row.initialMarginRequired;
    row.maintenanceMargin = row.maintenanceMarginRequired;
    if (row.maintenanceMarginRequired !== undefined) {
      row.excessMaintenance = row.equity - row.maintenanceMarginRequired;
      row.excessOverMaintenance = row.excessMaintenance;
      row.shortfall = Math.max(0, row.maintenanceMarginRequired - row.equity);
    }
  }
  return [...rows.values()].sort((a, b) => a.accountName.localeCompare(b.accountName));
}

/** Follow one futures strategy across every contract month in a series. */
export function seriesHistory(data: AppData, seriesId: ID): SeriesHistory {
  const instruments = data.instruments.filter((i) => i.seriesId === seriesId && isDerivative(i.type));
  const ids = new Set(instruments.map((i) => i.id));
  const ledger = buildLedger(data);
  const byInstrument = new Map<ID, number>();
  for (const p of ledger.positions) if (ids.has(p.instrumentId)) byInstrument.set(p.instrumentId, (byInstrument.get(p.instrumentId) ?? 0) + p.realizedPnl);
  const contracts = instruments
    .map((instrument) => ({
      instrumentId: instrument.id,
      symbol: instrument.symbol,
      expiry: instrument.expiry,
      trades: data.transactions.filter((t) => t.instrumentId === instrument.id && (t.type === 'buy' || t.type === 'sell')),
      realizedPnl: byInstrument.get(instrument.id) ?? 0,
    }))
    .sort((a, b) => (a.expiry ?? '9999-12-31').localeCompare(b.expiry ?? '9999-12-31'));
  const rollovers = data.rollovers.filter((r) => r.seriesId === seriesId).sort((a, b) => a.date.localeCompare(b.date));
  const base = getSettings(data).baseCurrency;
  const fx = new FxTable(data.fxRates);
  const cumulativeRealizedPnl = contracts.reduce((s, c) => {
    const instrument = instrumentOf(data, c.instrumentId);
    return s + convert(fx, c.realizedPnl, instrument.currency, base);
  }, 0);
  const cumulativeRollCost = rollovers.reduce((s, r) => {
    const from = instrumentOf(data, r.fromInstrumentId);
    return s + convert(fx, (r.openPrice - r.closePrice) * from.multiplier * r.quantity, from.currency, base);
  }, 0);
  const transactionIds = new Set(rollovers.flatMap((r) => r.transactionIds ?? []));
  const tradeFees = data.transactions
    .filter((t) => ids.has(t.instrumentId ?? '') && (t.type === 'buy' || t.type === 'sell'))
    .reduce((s, t) => {
      const i = instrumentOf(data, t.instrumentId!);
      return s + convert(fx, (t.fee ?? 0) + (t.tax ?? 0), i.currency, base);
    }, 0);
  const unlinkedRollFees = rollovers.reduce((s, r) => {
    const hasLinked = (r.transactionIds ?? []).some((id) => transactionIds.has(id));
    if (hasLinked) return s;
    const i = instrumentOf(data, r.fromInstrumentId);
    return s + convert(fx, r.fee ?? 0, i.currency, base);
  }, 0);
  return {
    seriesId,
    instruments: contracts,
    rollovers,
    cumulativeRealizedPnl,
    cumulativeRollCost,
    cumulativeFees: tradeFees + unlinkedRollFees,
    baseCurrency: base,
  };
}

function positionInstrument(data: AppData, position: FuturesPosition | ValuedPosition | Position): Instrument {
  return instrumentOf(data, position.instrumentId);
}

function positionQuantity(position: FuturesPosition | ValuedPosition | Position): number {
  return 'contracts' in position ? position.contracts : position.quantity;
}

function positionPrice(position: FuturesPosition | ValuedPosition | Position): number | undefined {
  if ('currentPrice' in position) return position.currentPrice;
  if ('price' in position) return position.price;
  return undefined;
}

/** Advisory roll estimate. It never creates transactions or sends an order. */
export function planRollover(
  data: AppData,
  position: FuturesPosition | ValuedPosition | Position,
  toInstrumentId: ID,
  prices: PriceInput,
): RolloverPlan {
  const from = positionInstrument(data, position);
  const to = instrumentOf(data, toInstrumentId);
  const quantity = positionQuantity(position);
  if (!isDerivative(from.type) || !isDerivative(to.type)) throw new Error('轉倉只適用於期貨或永續合約');
  if (!from.seriesId || from.seriesId !== to.seriesId) throw new Error('目標合約必須屬於同一 series');
  if (!quantity) throw new Error('沒有可轉倉的部位');
  const fromPrice = priceOf(prices, from.id) ?? positionPrice(position);
  const toPrice = priceOf(prices, to.id);
  if (!(fromPrice && fromPrice > 0) || !(toPrice && toPrice > 0)) throw new Error('缺少轉倉價格');
  const accountId = position.accountId;
  const bucket = position.bucket;
  const account = data.accounts.find((a) => a.id === accountId);
  const broker = data.brokers.find((b) => b.id === account?.brokerId);
  const closeSide = quantity > 0 ? 'sell' : 'buy';
  const openSide = quantity > 0 ? 'buy' : 'sell';
  const contracts = Math.abs(quantity);
  const closeFee = estimateFees(broker, from, closeSide, contracts, fromPrice);
  const openFee = estimateFees(broker, to, openSide, contracts, toPrice);
  const marginMissing = !(from.initialMargin && from.initialMargin > 0) || !(to.initialMargin && to.initialMargin > 0);
  const marginChange = marginMissing ? undefined : contracts * (to.initialMargin! - from.initialMargin!);
  const base = getSettings(data).baseCurrency;
  const fx = new FxTable(data.fxRates);
  return {
    id: `roll-${accountId}-${bucket}-${from.id}-${to.id}`,
    accountId,
    bucket,
    seriesId: from.seriesId,
    fromInstrumentId: from.id,
    toInstrumentId: to.id,
    quantity,
    contracts,
    fromPrice,
    toPrice,
    spread: toPrice - fromPrice,
    spreadCost: (toPrice - fromPrice) * from.multiplier * quantity,
    estimatedFee: closeFee.fee + openFee.fee,
    estimatedTax: closeFee.tax + openFee.tax,
    estimatedCosts: closeFee.fee + closeFee.tax + openFee.fee + openFee.tax,
    marginChange,
    marginChangeBase: marginChange === undefined ? undefined : convert(fx, marginChange, to.currency, base),
    marginSpecMissing: marginMissing,
    currency: from.currency,
  };
}

/** Build the close/open transactions and link record for an already executed roll. */
export function bookRollover(
  data: AppData,
  plan: RolloverPlan,
  actualPrices: PriceInput,
  date: ISODate,
): BookedRollover {
  const from = instrumentOf(data, plan.fromInstrumentId);
  const to = instrumentOf(data, plan.toInstrumentId);
  const closePrice = priceOf(actualPrices, from.id) ?? plan.fromPrice;
  const openPrice = priceOf(actualPrices, to.id) ?? plan.toPrice;
  if (!(closePrice > 0) || !(openPrice > 0)) throw new Error('缺少實際成交價格');
  const quantity = plan.quantity;
  const contracts = Math.abs(quantity);
  const account = data.accounts.find((a) => a.id === plan.accountId);
  const broker = data.brokers.find((b) => b.id === account?.brokerId);
  const closeSide = quantity > 0 ? 'sell' : 'buy';
  const openSide = quantity > 0 ? 'buy' : 'sell';
  const closeEstimate = estimateFees(broker, from, closeSide, contracts, closePrice);
  const openEstimate = estimateFees(broker, to, openSide, contracts, openPrice);
  const prefix = `${plan.id}-${date}`;
  const close: Transaction = {
    id: `${prefix}-close`,
    date,
    type: closeSide,
    accountId: plan.accountId,
    bucket: plan.bucket,
    currency: from.currency,
    amount: 0,
    instrumentId: from.id,
    quantity: contracts,
    price: closePrice,
    fee: closeEstimate.fee,
    tax: closeEstimate.tax,
    note: `轉倉平倉 ${from.symbol}`,
  };
  const open: Transaction = {
    id: `${prefix}-open`,
    date,
    type: openSide,
    accountId: plan.accountId,
    bucket: plan.bucket,
    currency: to.currency,
    amount: 0,
    instrumentId: to.id,
    quantity: contracts,
    price: openPrice,
    fee: openEstimate.fee,
    tax: openEstimate.tax,
    note: `轉倉開倉 ${to.symbol}`,
  };
  const rollover: RolloverRecord = {
    id: `${prefix}-record`,
    date,
    accountId: plan.accountId,
    bucket: plan.bucket,
    seriesId: plan.seriesId,
    fromInstrumentId: from.id,
    toInstrumentId: to.id,
    quantity,
    closePrice,
    openPrice,
    fee: closeEstimate.fee + closeEstimate.tax + openEstimate.fee + openEstimate.tax,
    transactionIds: [close.id, open.id],
    note: '使用者已在券商執行；本筆只記錄帳務，不會送出訂單',
  };
  return { transactions: [close, open], rollover };
}
