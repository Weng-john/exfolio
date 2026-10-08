import { FxTable } from './fx';
import { daysBetween, makeBaseConverter, replayTrades, sortedTransactions } from './journal';
import type { Portfolio } from './valuation';
import {
  CORE_BUCKET,
  getSettings,
  isDerivative,
  type AppData,
  type Currency,
  type ID,
  type ISODate,
  type RotationCycle,
  type Strategy,
  type StrategyStatus,
  type Transaction,
} from './types';

const EPS = 1e-9;

/*
 * Accounting decisions
 * - A bucket's equity = its cash (signed, per currency) + securities market
 *   value + unrealized P&L of its futures / perpetuals.
 * - Loans belong to the bucket on the loan_draw / loan_repay transaction
 *   (default `core`). Bucket "net equity" = equity - that bucket's loans, so
 *   the sum of net equities over all buckets is total NAV.
 * - Capital allocated to a bucket = external deposits - withdrawals booked to
 *   it + internal transfers in - out + external loan repayments booked to it.
 *   The total over all buckets equals ledger contributed capital.
 * - An internal transfer is valued at the source amount converted to base, on
 *   both sides, so a transfer never creates or removes base value.
 * - Bucket P&L = net equity - capital. Internal transfers cancel out of it.
 */

export type SummaryLevel = 'core' | 'strategy' | 'strategies' | 'total';

export interface BucketCashLine {
  currency: Currency;
  amount: number;
  /** Base currency. */
  value: number;
}

export interface BucketSummary {
  level: SummaryLevel;
  /** Bucket id; `core`, `strategies` (all strategies combined) or `total` for the aggregates. */
  bucket: ID;
  name: string;
  status?: StrategyStatus;
  /** True when transactions reference a bucket that has no strategy row. */
  orphan?: boolean;
  /** External money booked directly to the bucket (base). */
  externalCapital: number;
  /** Net internal transfers in minus out (base). */
  transferNet: number;
  /** externalCapital + transferNet. */
  capital: number;
  cash: BucketCashLine[];
  cashValue: number;
  securitiesValue: number;
  /** Unrealized P&L of derivatives. */
  derivativesEquity: number;
  /** cashValue + securitiesValue + derivativesEquity. */
  equity: number;
  /** Loan balances attributed to the bucket (base). */
  loanLiability: number;
  /** equity - loanLiability. */
  netEquity: number;
  unrealizedPnl: number;
  realizedPnl: number;
  dividends: number;
  fees: number;
  fundingCost: number;
  adjustments: number;
  /** netEquity - capital. */
  totalPnl: number;
  grossExposure: number;
  netExposure: number;
  /** Ratios to equity are undefined when equity is not positive. */
  grossToEquity?: number;
  netToEquity?: number;
  /** Ratios to total NAV are undefined when NAV is not positive. */
  grossToNav?: number;
  netToNav?: number;
  /** netEquity / NAV. */
  shareOfNav?: number;
  positionCount: number;
}

export interface StrategySummaries {
  core: BucketSummary;
  strategies: BucketSummary[];
  allStrategies: BucketSummary;
  total: BucketSummary;
  /** The four levels in the order of spec 7.4: core, every strategy, all strategies, total. */
  levels: BucketSummary[];
  warnings: string[];
}

interface Acc {
  externalCapital: number;
  transferNet: number;
  realizedPnl: number;
  dividends: number;
  fees: number;
  fundingCost: number;
  adjustments: number;
  loanLiability: number;
}

const newAcc = (): Acc => ({
  externalCapital: 0,
  transferNet: 0,
  realizedPnl: 0,
  dividends: 0,
  fees: 0,
  fundingCost: 0,
  adjustments: 0,
  loanLiability: 0,
});

/** Does this transfer move capital between two different buckets? */
function isBucketTransfer(tx: Transaction): boolean {
  return tx.type === 'transfer' && !!tx.toBucket && tx.toBucket !== (tx.bucket || CORE_BUCKET);
}

/** Summaries at the four levels of spec 7.4. Reconciles to total NAV. */
export function strategySummaries(data: AppData, portfolio: Portfolio): StrategySummaries {
  const { ledger, valuation } = portfolio;
  const warnings: string[] = [];
  const base = getSettings(data).baseCurrency;
  const fx = new FxTable(data.fxRates);
  const toBase = makeBaseConverter(data, warnings);
  const rate = (c: Currency) => (c === base ? 1 : (fx.rate(c, base) ?? 0));

  const acc = new Map<ID, Acc>();
  const get = (b: ID) => {
    let a = acc.get(b);
    if (!a) acc.set(b, (a = newAcc()));
    return a;
  };
  get(CORE_BUCKET);
  for (const s of data.strategies) get(s.id);

  for (const tx of sortedTransactions(data)) {
    const b = get(tx.bucket || CORE_BUCKET);
    const costs = (tx.fee ?? 0) + (tx.tax ?? 0);
    switch (tx.type) {
      case 'buy':
      case 'sell': {
        const inst = data.instruments.find((i) => i.id === tx.instrumentId);
        if (inst) b.fees += toBase(costs, inst.currency, tx);
        break;
      }
      case 'deposit':
        b.externalCapital += toBase(tx.amount, tx.currency, tx);
        break;
      case 'withdraw':
        b.externalCapital -= toBase(tx.amount, tx.currency, tx);
        break;
      case 'transfer': {
        b.fees += toBase(costs, tx.currency, tx);
        if (isBucketTransfer(tx)) {
          const v = toBase(tx.amount, tx.currency, tx);
          b.transferNet -= v;
          get(tx.toBucket!).transferNet += v;
        }
        break;
      }
      case 'dividend':
        b.dividends += toBase(tx.amount, tx.currency, tx);
        b.fees += toBase(costs, tx.currency, tx);
        break;
      case 'fee':
        b.fees += toBase(tx.amount, tx.currency, tx);
        break;
      case 'interest':
      case 'funding_fee':
        b.fundingCost += toBase(tx.amount, tx.currency, tx);
        break;
      case 'adjust':
        b.adjustments += toBase(tx.amount, tx.currency, tx);
        break;
      case 'loan_draw':
        b.loanLiability += toBase(tx.amount, tx.currency, tx);
        b.fees += toBase(costs, tx.currency, tx);
        break;
      case 'loan_repay': {
        const interest = tx.interest ?? 0;
        const principal = tx.principal ?? tx.amount - interest;
        b.loanLiability -= toBase(principal, tx.currency, tx);
        b.fundingCost += toBase(interest, tx.currency, tx);
        b.fees += toBase(costs, tx.currency, tx);
        if (tx.source === 'external') {
          b.externalCapital += toBase(principal + interest + costs, tx.currency, tx);
        }
        break;
      }
    }
  }
  for (const e of replayTrades(data).entries) get(e.strategyId).realizedPnl += e.realizedPnlBase;

  const known = new Set(data.strategies.map((s) => s.id));
  const nav = valuation.nav;
  const ratio = (x: number, d: number) => (d > 0 ? x / d : undefined);

  const make = (level: SummaryLevel, bucket: ID, name: string, bucketIds: ID[]): BucketSummary => {
    const ids = new Set(bucketIds);
    const sum = (k: keyof Acc) => bucketIds.reduce((s, id) => s + (acc.get(id)?.[k] ?? 0), 0);
    const cashMap = new Map<Currency, number>();
    for (const c of ledger.bucketCash) {
      if (ids.has(c.bucket)) cashMap.set(c.currency, (cashMap.get(c.currency) ?? 0) + c.amount);
    }
    const cash = [...cashMap].map(([currency, amount]) => ({
      currency,
      amount,
      value: amount * rate(currency),
    }));
    const cashValue = cash.reduce((s, c) => s + c.value, 0);
    const positions = valuation.positions.filter((p) => ids.has(p.bucket));
    const securitiesValue = positions.reduce((s, p) => s + p.marketValue, 0);
    const derivativesEquity = positions
      .filter((p) => isDerivative(p.instrument.type))
      .reduce((s, p) => s + p.unrealizedPnl, 0);
    const unrealizedPnl = positions.reduce((s, p) => s + p.unrealizedPnl, 0);
    const equity = cashValue + securitiesValue + derivativesEquity;
    const loanLiability = sum('loanLiability');
    const netEquity = equity - loanLiability;
    const capital = sum('externalCapital') + sum('transferNet');
    const grossExposure = positions.reduce((s, p) => s + Math.abs(p.exposure), 0);
    const netExposure = positions.reduce((s, p) => s + p.exposure, 0);
    return {
      level,
      bucket,
      name,
      externalCapital: sum('externalCapital'),
      transferNet: sum('transferNet'),
      capital,
      cash,
      cashValue,
      securitiesValue,
      derivativesEquity,
      equity,
      loanLiability,
      netEquity,
      unrealizedPnl,
      realizedPnl: sum('realizedPnl'),
      dividends: sum('dividends'),
      fees: sum('fees'),
      fundingCost: sum('fundingCost'),
      adjustments: sum('adjustments'),
      totalPnl: netEquity - capital,
      grossExposure,
      netExposure,
      grossToEquity: ratio(grossExposure, equity),
      netToEquity: equity > 0 ? netExposure / equity : undefined,
      grossToNav: ratio(grossExposure, nav),
      netToNav: nav > 0 ? netExposure / nav : undefined,
      shareOfNav: ratio(netEquity, nav),
      positionCount: positions.length,
    };
  };

  const strategyIds = [...data.strategies.map((s) => s.id)];
  for (const id of acc.keys()) if (id !== CORE_BUCKET && !known.has(id)) strategyIds.push(id);
  for (const p of valuation.positions) {
    if (p.bucket !== CORE_BUCKET && !strategyIds.includes(p.bucket)) strategyIds.push(p.bucket);
  }

  const core = make('core', CORE_BUCKET, '核心被動', [CORE_BUCKET]);
  const strategies = strategyIds.map((id) => {
    const s = data.strategies.find((x) => x.id === id);
    const row = make('strategy', id, s?.name ?? id, [id]);
    row.status = s?.status;
    if (!s) row.orphan = true;
    return row;
  });
  const allStrategies = make('strategies', 'strategies', '所有主動策略合計', strategyIds);
  const total = make('total', 'total', '整體組合', [CORE_BUCKET, ...strategyIds]);
  return {
    core,
    strategies,
    allStrategies,
    total,
    levels: [core, ...strategies, allStrategies, total],
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Strategy capital ledger

export type CapitalFlowKind =
  'external_deposit' | 'external_withdrawal' | 'transfer_in' | 'transfer_out';

export interface CapitalFlow {
  txId: ID;
  date: ISODate;
  kind: CapitalFlowKind;
  /** The other bucket for internal transfers. */
  counterparty?: ID;
  /** Signed in the strategy's view: positive adds capital. */
  amount: number;
  currency: Currency;
  /** Signed, base currency. For transfers: the source amount converted to base, on both sides. */
  baseAmount: number;
  /** Allocated capital after this movement (base). */
  runningCapital: number;
  /** Set when the money came from an external loan repayment. */
  source?: 'loan_repay';
  note?: string;
}

/** Chronological capital movements of one bucket. Internal transfers are never profit. */
export function strategyCapitalFlows(data: AppData, strategyId: ID): CapitalFlow[] {
  const toBase = makeBaseConverter(data);
  const flows: Omit<CapitalFlow, 'runningCapital'>[] = [];
  for (const tx of sortedTransactions(data)) {
    const bucket = tx.bucket || CORE_BUCKET;
    if (bucket === strategyId && tx.type === 'deposit') {
      flows.push({
        txId: tx.id,
        date: tx.date,
        kind: 'external_deposit',
        amount: tx.amount,
        currency: tx.currency,
        baseAmount: toBase(tx.amount, tx.currency, tx),
        note: tx.note,
      });
    } else if (bucket === strategyId && tx.type === 'withdraw') {
      flows.push({
        txId: tx.id,
        date: tx.date,
        kind: 'external_withdrawal',
        amount: -tx.amount,
        currency: tx.currency,
        baseAmount: -toBase(tx.amount, tx.currency, tx),
        note: tx.note,
      });
    } else if (bucket === strategyId && tx.type === 'loan_repay' && tx.source === 'external') {
      const interest = tx.interest ?? 0;
      const paid =
        (tx.principal ?? tx.amount - interest) + interest + (tx.fee ?? 0) + (tx.tax ?? 0);
      flows.push({
        txId: tx.id,
        date: tx.date,
        kind: 'external_deposit',
        amount: paid,
        currency: tx.currency,
        baseAmount: toBase(paid, tx.currency, tx),
        source: 'loan_repay',
        note: tx.note,
      });
    } else if (isBucketTransfer(tx) && bucket === strategyId) {
      flows.push({
        txId: tx.id,
        date: tx.date,
        kind: 'transfer_out',
        counterparty: tx.toBucket,
        amount: -tx.amount,
        currency: tx.currency,
        baseAmount: -toBase(tx.amount, tx.currency, tx),
        note: tx.note,
      });
    } else if (isBucketTransfer(tx) && tx.toBucket === strategyId) {
      flows.push({
        txId: tx.id,
        date: tx.date,
        kind: 'transfer_in',
        counterparty: bucket,
        amount: tx.toAmount ?? tx.amount,
        currency: tx.toCurrency ?? tx.currency,
        baseAmount: toBase(tx.amount, tx.currency, tx),
        note: tx.note,
      });
    }
  }
  let running = 0;
  return flows.map((f) => ({ ...f, runningCapital: (running += f.baseAmount) }));
}

// ---------------------------------------------------------------------------
// Validation helpers

/** Empty / missing allowed list means the strategy is unrestricted. */
export function isInstrumentAllowed(strategy: Strategy, instrumentId: ID): boolean {
  const allowed = strategy.allowedInstrumentIds;
  return !allowed?.length || allowed.includes(instrumentId);
}

/** Strategies that may trade the instrument (unrestricted ones included). */
export function strategiesAllowingInstrument(data: AppData, instrumentId: ID): Strategy[] {
  return data.strategies.filter((s) => isInstrumentAllowed(s, instrumentId));
}

/** Trades in a strategy bucket on instruments outside its allowed list (a warning, never a block). */
export function allowedInstrumentViolations(data: AppData, strategyId: ID): Transaction[] {
  const s = data.strategies.find((x) => x.id === strategyId);
  if (!s) return [];
  return data.transactions.filter(
    (t) =>
      (t.type === 'buy' || t.type === 'sell') &&
      t.bucket === strategyId &&
      t.instrumentId &&
      !isInstrumentAllowed(s, t.instrumentId),
  );
}

export interface StrategyReferences {
  transactions: number;
  tradeGroups: number;
  rotationCycles: number;
  total: number;
}

/** What still points at a strategy. Non-zero total = close it instead of deleting. */
export function strategyReferences(data: AppData, strategyId: ID): StrategyReferences {
  const transactions = data.transactions.filter(
    (t) => t.bucket === strategyId || t.toBucket === strategyId,
  ).length;
  const tradeGroups = data.tradeGroups.filter((g) => g.strategyId === strategyId).length;
  const rotationCycles = data.rotationCycles.filter((c) => c.strategyId === strategyId).length;
  return {
    transactions,
    tradeGroups,
    rotationCycles,
    total: transactions + tradeGroups + rotationCycles,
  };
}

// ---------------------------------------------------------------------------
// Rotation cycles

/**
 * Price on or before `date`: `close`, or `adjClose` (falling back to close)
 * when `adjusted`. Undefined when there is no point within the allowed gap.
 */
export type PriceLookup = (
  instrumentId: ID,
  date: ISODate,
  adjusted?: boolean,
) => number | undefined;

export function makePriceLookup(data: AppData, options: { maxGapDays?: number } = {}): PriceLookup {
  const maxGap = options.maxGapDays ?? 10;
  const series = new Map<ID, { date: ISODate; close: number; adjClose?: number }[]>();
  for (const p of data.priceHistory) {
    const list = series.get(p.instrumentId) ?? [];
    list.push(p);
    series.set(p.instrumentId, list);
  }
  for (const list of series.values())
    list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return (instrumentId, date, adjusted) => {
    const list = series.get(instrumentId);
    if (!list?.length) return undefined;
    let lo = 0;
    let hi = list.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].date <= date) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (found < 0 || daysBetween(list[found].date, date) > maxGap) return undefined;
    const p = list[found];
    return adjusted ? (p.adjClose ?? p.close) : p.close;
  };
}

export interface MissingPrice {
  instrumentId: ID;
  date: ISODate;
  /** Why the price is needed. */
  purpose: string;
}

export interface RotationCycleReport {
  cycleId: ID;
  strategyId: ID;
  open: boolean;
  /** False when the cycle has no buy / sell yet. */
  hasTrades: boolean;
  startDate?: ISODate;
  endDate?: ISODate;
  holdingDays?: number;
  /** Money rotated at the start: proceeds of the opening sell(s) of the from-instrument (base). */
  startCapital: number;
  /** Net external flows inside the cycle (deposits +, withdrawals -; base). */
  netFlows: number;
  /** startCapital + netFlows: the denominator of both returns. */
  investedCapital: number;
  /** Fees + taxes of the cycle trades (base). */
  tradingCosts: number;
  /** Cycle end value of everything it holds, plus leftover cash (base). */
  endValue?: number;
  /** Realized + unrealized, after costs (base). */
  pnl?: number;
  pnlBeforeCosts?: number;
  /** pnl / investedCapital. */
  returnPct?: number;
  benchmarkInstrumentId: ID;
  benchmarkEndValue?: number;
  benchmarkPnl?: number;
  benchmarkReturnPct?: number;
  /** (returnPct - benchmarkReturnPct) in percentage points. */
  excessPp?: number;
  excessPnl?: number;
  beatBenchmark?: boolean;
  /** Prices that were needed but not available. Non-empty = something is undefined. */
  missing: MissingPrice[];
  notes: string[];
}

export interface RotationReportOptions {
  /** End date for an open cycle. Defaults to today. */
  asOf?: ISODate;
}

/**
 * Report on one rotation cycle against "did not rotate, kept the benchmark".
 *
 * - Cycle transactions are those carrying the cycle's id. Buys / sells are
 *   the rotation; deposits, withdrawals and internal transfers in / out of the
 *   strategy tagged with the cycle are external flows.
 * - Start capital = proceeds of the cycle's sells of the from-instrument that
 *   come before it is bought back. The counterfactual puts the same capital
 *   into the benchmark on the same date, and each external flow into the
 *   benchmark on its own date, so both sides see the same cash flows.
 * - Actual end value = leftover cash + flows + every holding the cycle created,
 *   marked at the end date. Benchmarks use adjClose; marks use close; an open
 *   cycle falls back to the current quote when history has no usable point.
 * - Foreign-currency prices convert at the current FX rate on both sides.
 */
export function rotationCycleReport(
  data: AppData,
  cycle: RotationCycle,
  priceLookup: PriceLookup,
  options: RotationReportOptions = {},
): RotationCycleReport {
  const base = getSettings(data).baseCurrency;
  const fx = new FxTable(data.fxRates);
  const toBase = makeBaseConverter(data);
  const instruments = new Map(data.instruments.map((i) => [i.id, i]));
  const quotes = new Map(data.prices.map((p) => [p.id, p]));
  const open = cycle.status !== 'closed';
  const missing: MissingPrice[] = [];
  const notes: string[] = [];
  const addMissing = (instrumentId: ID, date: ISODate, purpose: string) => {
    if (!missing.some((m) => m.instrumentId === instrumentId && m.date === date)) {
      missing.push({ instrumentId, date, purpose });
    }
  };

  const txs = sortedTransactions(data).filter((t) => t.rotationCycleId === cycle.id);
  const trades = txs.filter((t) => t.type === 'buy' || t.type === 'sell');
  const report: RotationCycleReport = {
    cycleId: cycle.id,
    strategyId: cycle.strategyId,
    open,
    hasTrades: trades.length > 0,
    startCapital: 0,
    netFlows: 0,
    investedCapital: 0,
    tradingCosts: 0,
    benchmarkInstrumentId: cycle.benchmarkInstrumentId,
    missing,
    notes,
  };
  if (!trades.length) {
    notes.push('這個週期還沒有掛上任何買賣交易');
    return report;
  }

  const startDate = trades[0].date;
  const lastDate = txs[txs.length - 1].date;
  const asOf = options.asOf ?? new Date().toISOString().slice(0, 10);
  const endDate = open ? (asOf >= lastDate ? asOf : lastDate) : (cycle.closedAt ?? lastDate);
  report.startDate = startDate;
  report.endDate = endDate;
  report.holdingDays = daysBetween(startDate, endDate);

  const instRate = (instrumentId: ID): number | undefined => {
    const cur = instruments.get(instrumentId)?.currency ?? base;
    return cur === base ? 1 : fx.rate(cur, base);
  };
  const mult = (instrumentId: ID) => instruments.get(instrumentId)?.multiplier ?? 1;

  // Opening sells: the from-instrument sold before it is bought back.
  let openingQty = 0;
  let startCapital = 0;
  let boughtBack = false;
  let netCash = 0;
  let costs = 0;
  const held = new Map<ID, number>();
  for (const t of trades) {
    const id = t.instrumentId!;
    const cur = instruments.get(id)?.currency ?? t.currency;
    const gross = toBase((t.quantity ?? 0) * (t.price ?? 0) * mult(id), cur, t);
    const c = toBase((t.fee ?? 0) + (t.tax ?? 0), cur, t);
    costs += c;
    const qty = t.quantity ?? 0;
    if (t.type === 'sell') {
      netCash += gross - c;
      held.set(id, (held.get(id) ?? 0) - qty);
      if (id === cycle.fromInstrumentId && !boughtBack) {
        openingQty += qty;
        startCapital += gross;
      }
    } else {
      netCash -= gross + c;
      held.set(id, (held.get(id) ?? 0) + qty);
      if (id === cycle.fromInstrumentId) boughtBack = true;
    }
  }
  if (openingQty === 0) {
    // Cycle began from cash: the capital is what the first day's buys cost.
    startCapital = trades
      .filter((t) => t.type === 'buy' && t.date === startDate)
      .reduce((s, t) => {
        const cur = instruments.get(t.instrumentId!)?.currency ?? t.currency;
        return s + toBase((t.quantity ?? 0) * (t.price ?? 0) * mult(t.instrumentId!), cur, t);
      }, 0);
    notes.push('週期沒有切出 from 商品的賣出，起始資金以第一天的買進金額計');
  } else {
    held.set(cycle.fromInstrumentId, (held.get(cycle.fromInstrumentId) ?? 0) + openingQty);
  }

  // External flows tagged with the cycle.
  const flows: { date: ISODate; value: number }[] = [];
  for (const t of txs) {
    if (t.type === 'deposit') flows.push({ date: t.date, value: toBase(t.amount, t.currency, t) });
    else if (t.type === 'withdraw')
      flows.push({ date: t.date, value: -toBase(t.amount, t.currency, t) });
    else if (isBucketTransfer(t) && t.toBucket === cycle.strategyId) {
      flows.push({ date: t.date, value: toBase(t.amount, t.currency, t) });
    } else if (isBucketTransfer(t) && (t.bucket || CORE_BUCKET) === cycle.strategyId) {
      flows.push({ date: t.date, value: -toBase(t.amount, t.currency, t) });
    }
  }
  const netFlows = flows.reduce((s, f) => s + f.value, 0);
  const invested = startCapital + netFlows;
  Object.assign(report, { startCapital, netFlows, investedCapital: invested, tradingCosts: costs });

  // Actual side: mark what the cycle still holds.
  let holdingsValue: number | undefined = 0;
  for (const [id, qty] of held) {
    if (Math.abs(qty) <= EPS) continue;
    let price = priceLookup(id, endDate, false);
    if (price === undefined && open) price = quotes.get(id)?.price;
    const r = instRate(id);
    if (price === undefined || r === undefined) {
      addMissing(id, endDate, r === undefined ? '估值匯率' : '週期結束時的持倉估值');
      holdingsValue = undefined;
    } else if (holdingsValue !== undefined) {
      holdingsValue += qty * price * mult(id) * r;
    }
  }
  if (holdingsValue !== undefined) {
    const endValue = netCash + netFlows + holdingsValue;
    report.endValue = endValue;
    report.pnl = endValue - invested;
    report.pnlBeforeCosts = report.pnl + costs;
    report.returnPct = invested > 0 ? report.pnl / invested : undefined;
  }

  // Counterfactual: same capital and flows, kept in the benchmark.
  const bId = cycle.benchmarkInstrumentId;
  const bRate = instRate(bId);
  const bPrice = (date: ISODate, purpose: string, isEnd = false): number | undefined => {
    let p = priceLookup(bId, date, true);
    if (p === undefined && isEnd && open) p = quotes.get(bId)?.price;
    if (p === undefined) addMissing(bId, date, purpose);
    return p;
  };
  if (!bId || bRate === undefined) {
    if (bId) addMissing(bId, endDate, '基準商品的匯率');
    notes.push('缺少基準商品或匯率，無法計算反事實基準');
  } else {
    const p0 = bPrice(startDate, '基準起始價');
    const pe = bPrice(endDate, '基準結束價', true);
    let units = p0 === undefined ? undefined : startCapital / (p0 * bRate);
    for (const f of flows) {
      const pf = bPrice(f.date, '基準於外部資金流日的價格');
      units = units === undefined || pf === undefined ? undefined : units + f.value / (pf * bRate);
    }
    if (units !== undefined && pe !== undefined) {
      const value = units * pe * bRate;
      report.benchmarkEndValue = value;
      report.benchmarkPnl = value - invested;
      report.benchmarkReturnPct = invested > 0 ? report.benchmarkPnl / invested : undefined;
    }
  }
  if (report.pnl !== undefined && report.benchmarkPnl !== undefined) {
    report.excessPnl = report.pnl - report.benchmarkPnl;
    if (report.returnPct !== undefined && report.benchmarkReturnPct !== undefined) {
      report.excessPp = (report.returnPct - report.benchmarkReturnPct) * 100;
      report.beatBenchmark = report.excessPp > 0;
    }
  }
  return report;
}

export interface RotationSeriesSummary {
  /** Cycles with a computed return. */
  cycles: number;
  /** Cycles that also have a benchmark return. */
  comparable: number;
  /** Sum of cycle P&L (base). */
  cumulativePnl: number;
  /** Compounded return of the cycles in order. */
  cumulativeReturn?: number;
  /** Compounded benchmark return over the comparable cycles. */
  cumulativeBenchmarkReturn?: number;
  /** Sum of per-cycle excess, percentage points. */
  cumulativeExcessPp?: number;
  /** Share of comparable cycles that beat the benchmark. */
  beatShare?: number;
  /** Largest peak-to-trough fall (fraction) of the compounded cycle-return curve. */
  maxDrawdown?: number;
}

/** Cumulative result of a strategy's cycles, in order of start date. */
export function summarizeRotationCycles(reports: RotationCycleReport[]): RotationSeriesSummary {
  const done = reports
    .filter((r) => r.returnPct !== undefined && r.pnl !== undefined)
    .sort((a, b) =>
      (a.startDate ?? '') < (b.startDate ?? '')
        ? -1
        : (a.startDate ?? '') > (b.startDate ?? '')
          ? 1
          : 0,
    );
  const comparable = done.filter(
    (r) => r.benchmarkReturnPct !== undefined && r.excessPp !== undefined,
  );
  let eq = 1;
  let peak = 1;
  let maxDd = 0;
  for (const r of done) {
    eq *= 1 + r.returnPct!;
    peak = Math.max(peak, eq);
    maxDd = Math.max(maxDd, (peak - eq) / peak);
  }
  const compound = (xs: number[]) => xs.reduce((p, x) => p * (1 + x), 1) - 1;
  return {
    cycles: done.length,
    comparable: comparable.length,
    cumulativePnl: done.reduce((s, r) => s + r.pnl!, 0),
    cumulativeReturn: done.length ? compound(done.map((r) => r.returnPct!)) : undefined,
    cumulativeBenchmarkReturn: comparable.length
      ? compound(comparable.map((r) => r.benchmarkReturnPct!))
      : undefined,
    cumulativeExcessPp: comparable.length
      ? comparable.reduce((s, r) => s + r.excessPp!, 0)
      : undefined,
    beatShare: comparable.length
      ? comparable.filter((r) => r.beatBenchmark).length / comparable.length
      : undefined,
    maxDrawdown: done.length ? maxDd : undefined,
  };
}
