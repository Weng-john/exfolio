import { FxTable } from './fx';
import { buildLedger, type Ledger, type LedgerOptions, type Position } from './ledger';
import {
  getSettings,
  isDerivative,
  type AppData,
  type Currency,
  type ID,
  type Instrument,
  type QuoteStatus,
} from './types';

/** Index id used for positions whose instrument has no underlying index. */
export const UNCLASSIFIED_INDEX = 'unclassified';

export type PriceStatus = QuoteStatus | 'missing';

export interface ValuedPosition extends Position {
  instrument: Instrument;
  indexId: ID;
  /** Price used, in the instrument currency. Falls back to cost when missing. */
  price: number;
  priceStatus: PriceStatus;
  priceAsOf?: string;
  /** Base currency per 1 unit of the instrument currency. */
  fxRate: number;
  /** Asset value in base currency. Always 0 for derivatives. */
  marketValue: number;
  /** Signed notional in base currency: quantity x price x multiplier. */
  notional: number;
  /** Signed index exposure in base currency: notional x daily target leverage. */
  exposure: number;
  costBasis: number;
  unrealizedPnl: number;
}

export interface CashValue {
  accountId: ID;
  currency: Currency;
  amount: number;
  /** In base currency. Negative when the account is overdrawn. */
  value: number;
}

export interface LoanValue {
  loanId: ID;
  currency: Currency;
  balance: number;
  value: number;
}

export interface IndexExposure {
  indexId: ID;
  long: number;
  short: number;
  net: number;
  gross: number;
  /** Net exposure / NAV. Undefined when NAV is not positive. */
  weight?: number;
}

export interface BucketExposure {
  bucket: ID;
  marketValue: number;
  net: number;
  gross: number;
  unrealizedPnl: number;
}

export interface Valuation {
  baseCurrency: Currency;
  /** Securities + positive cash + derivative equity. */
  totalAssets: number;
  securitiesValue: number;
  /** Unrealized P&L of open futures / perpetuals. Margin itself is cash. */
  derivativesEquity: number;
  cashValue: number;
  /** Loan balances plus overdrawn cash. */
  liabilities: number;
  nav: number;
  grossExposure: number;
  netExposure: number;
  /** Undefined when NAV is not positive: the ratio has no meaning then. */
  grossLeverage?: number;
  netLeverage?: number;
  debtToNav?: number;
  contributedCapital: number;
  /** NAV minus contributed capital: every gain, loss and cost so far. */
  totalPnl: number;
  unrealizedPnl: number;
  positions: ValuedPosition[];
  cash: CashValue[];
  loans: LoanValue[];
  byIndex: IndexExposure[];
  byBucket: BucketExposure[];
  warnings: string[];
}

export interface ValuationOptions {
  /** Reference time for deciding whether a quote is stale. */
  now?: Date;
}

/** Mark a ledger to market and derive NAV, exposure and leverage. */
export function valuePortfolio(
  data: AppData,
  ledger: Ledger,
  options: ValuationOptions = {},
): Valuation {
  const settings = getSettings(data);
  const base = settings.baseCurrency;
  const fx = new FxTable(data.fxRates);
  const instruments = new Map(data.instruments.map((i) => [i.id, i]));
  const prices = new Map(data.prices.map((p) => [p.id, p]));
  const now = (options.now ?? new Date()).getTime();
  const staleMs = settings.alerts.staleQuoteMinutes * 60_000;
  const warnings = [...ledger.warnings];

  const missingFx = new Set<Currency>();
  const rateToBase = (currency: Currency): number => {
    const r = fx.rate(currency, base);
    if (r === undefined) {
      if (!missingFx.has(currency)) {
        missingFx.add(currency);
        warnings.push(`缺少 ${currency}/${base} 匯率，相關金額以 0 計`);
      }
      return 0;
    }
    return r;
  };

  const positions: ValuedPosition[] = [];
  for (const pos of ledger.positions) {
    const instrument = instruments.get(pos.instrumentId);
    if (!instrument) {
      warnings.push(`持倉引用了不存在的商品 ${pos.instrumentId}`);
      continue;
    }
    const quote = prices.get(instrument.id);
    let price = pos.avgCost;
    let priceStatus: PriceStatus = 'missing';
    if (quote && quote.price > 0) {
      price = quote.price;
      const age = now - new Date(quote.asOf).getTime();
      priceStatus = age > staleMs ? 'stale' : quote.status;
    } else if (pos.quantity !== 0) {
      warnings.push(`${instrument.symbol} 沒有報價，暫以成本價估值`);
    }

    const fxRate = rateToBase(instrument.currency);
    const derivative = isDerivative(instrument.type);
    const notionalLocal = pos.quantity * price * instrument.multiplier;
    const costLocal = pos.quantity * pos.avgCost * instrument.multiplier;
    const notional = notionalLocal * fxRate;
    positions.push({
      ...pos,
      instrument,
      indexId: instrument.indexId ?? UNCLASSIFIED_INDEX,
      price,
      priceStatus,
      priceAsOf: quote?.asOf,
      fxRate,
      marketValue: derivative ? 0 : notional,
      notional,
      exposure: notional * instrument.leverage,
      costBasis: costLocal * fxRate,
      unrealizedPnl: (notionalLocal - costLocal) * fxRate,
    });
  }

  const cash: CashValue[] = ledger.cash.map((c) => ({
    ...c,
    value: c.amount * rateToBase(c.currency),
  }));
  const loans: LoanValue[] = ledger.loans.map((l) => ({
    loanId: l.loanId,
    currency: l.currency,
    balance: l.balance,
    value: l.balance * rateToBase(l.currency),
  }));

  let securitiesValue = 0;
  let derivativesEquity = 0;
  let unrealizedPnl = 0;
  let grossExposure = 0;
  let netExposure = 0;
  const byIndex = new Map<ID, IndexExposure>();
  const byBucket = new Map<ID, BucketExposure>();

  for (const p of positions) {
    const derivative = isDerivative(p.instrument.type);
    securitiesValue += p.marketValue;
    if (derivative) derivativesEquity += p.unrealizedPnl;
    unrealizedPnl += p.unrealizedPnl;
    grossExposure += Math.abs(p.exposure);
    netExposure += p.exposure;

    const ix = byIndex.get(p.indexId) ?? {
      indexId: p.indexId,
      long: 0,
      short: 0,
      net: 0,
      gross: 0,
    };
    if (p.exposure >= 0) ix.long += p.exposure;
    else ix.short += p.exposure;
    ix.net += p.exposure;
    ix.gross += Math.abs(p.exposure);
    byIndex.set(p.indexId, ix);

    const b = byBucket.get(p.bucket) ?? {
      bucket: p.bucket,
      marketValue: 0,
      net: 0,
      gross: 0,
      unrealizedPnl: 0,
    };
    b.marketValue += p.marketValue;
    b.net += p.exposure;
    b.gross += Math.abs(p.exposure);
    b.unrealizedPnl += p.unrealizedPnl;
    byBucket.set(p.bucket, b);
  }

  let cashValue = 0;
  let overdrawn = 0;
  for (const c of cash) {
    if (c.value >= 0) cashValue += c.value;
    else overdrawn -= c.value;
  }
  const loanValue = loans.reduce((s, l) => s + l.value, 0);

  const totalAssets = securitiesValue + cashValue + derivativesEquity;
  const liabilities = loanValue + overdrawn;
  const nav = totalAssets - liabilities;
  const ratio = (x: number) => (nav > 0 ? x / nav : undefined);
  for (const ix of byIndex.values()) ix.weight = ratio(ix.net);
  if (nav <= 0 && (positions.length || cash.length)) {
    warnings.push('NAV 不為正，槓桿與權重比率無法計算');
  }

  return {
    baseCurrency: base,
    totalAssets,
    securitiesValue,
    derivativesEquity,
    cashValue,
    liabilities,
    nav,
    grossExposure,
    netExposure,
    grossLeverage: ratio(grossExposure),
    netLeverage: ratio(netExposure),
    debtToNav: ratio(liabilities),
    contributedCapital: ledger.totals.contributedCapital,
    totalPnl: nav - ledger.totals.contributedCapital,
    unrealizedPnl,
    positions,
    cash,
    loans,
    byIndex: [...byIndex.values()].sort((a, b) => b.gross - a.gross),
    byBucket: [...byBucket.values()],
    // The same instrument held in two buckets would repeat its warning.
    warnings: [...new Set(warnings)],
  };
}

export interface Portfolio {
  ledger: Ledger;
  valuation: Valuation;
}

/** Ledger and valuation in one call: what every page reads from. */
export function computePortfolio(
  data: AppData,
  options: LedgerOptions & ValuationOptions = {},
): Portfolio {
  const ledger = buildLedger(data, options);
  return { ledger, valuation: valuePortfolio(data, ledger, options) };
}
