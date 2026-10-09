import { FxTable } from './fx';
import { buildLedger, type Position } from './ledger';
import {
  CORE_BUCKET,
  getSettings,
  isDerivative,
  type AppData,
  type ID,
  type ISODate,
  type Transaction,
} from './types';
import { xirr } from './xirr';
import { sortedTransactions } from './journal';

export type PerformanceScope = 'total' | 'core' | 'strategies' | ID | { positionKey: string };

export interface MissingClose {
  instrumentId: ID;
  date: ISODate;
}

export interface HistoricalValue {
  value: number;
  missing: MissingClose[];
  notes: string[];
}

/** Positive means cash enters the measured scope. */
export interface ExternalFlow {
  date: ISODate;
  amount: number;
}

export interface ReturnPeriod {
  from: ISODate;
  to: ISODate;
  startValue: number;
  endValue: number;
  flow: number;
  return?: number;
}

export interface TimeWeightedResult {
  cumulative?: number;
  annualized?: number;
  days: number;
  shortPeriod: boolean;
  undefinedPeriods: boolean;
  periods: ReturnPeriod[];
  missing: MissingClose[];
  notes: string[];
}

export interface MoneyWeightedResult {
  xirr?: number;
  flows: ExternalFlow[];
  endingValue: number;
  missing: MissingClose[];
  notes: string[];
}

export interface PnlBreakdown {
  realized: number;
  unrealized: number;
  dividends: number;
  feesAndTaxes: number;
  fundingCost: number;
  /** No dated FX series exists yet, so this is intentionally not inferred. */
  fxEffect?: number;
  gross: number;
  net: number;
  notes: string[];
}

export interface BenchmarkResult {
  instrumentId: ID;
  buyAndHold?: number;
  flowMatched: { twr?: number; mwr?: number; endingValue?: number };
  missing: MissingClose[];
}

export interface RiskStatistics {
  maxDrawdown?: number;
  peakDate?: ISODate;
  troughDate?: ISODate;
  volatility?: number;
  sampling: 'daily';
  riskAdjusted?: number;
  observations: number;
  missing: MissingClose[];
}

export interface PerformanceSummary {
  id: string;
  label: string;
  scope: PerformanceScope;
  twr: TimeWeightedResult;
  mwr: MoneyWeightedResult;
  risk: RiskStatistics;
  benchmark?: BenchmarkResult;
  excessReturn?: number;
}

export interface PositionPerformance extends PerformanceSummary {
  positionKey: string;
  instrumentId: ID;
  currentValue: number;
  cost: number;
  pnl: number;
  cumulativeReturn?: number;
  holdingDays: number;
  derivativePnlPerAverageNotional?: number;
}

const DAY_MS = 86_400_000;

function dayNumber(date: ISODate): number {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

function daysBetween(from: ISODate, to: ISODate): number {
  return Math.max(0, Math.round(dayNumber(to) - dayNumber(from)));
}

function previousDay(date: ISODate): ISODate {
  // Inverse Gregorian conversion, kept numeric so engine calculations never
  // read the wall clock or construct a Date.
  let z = dayNumber(date) - 1 + 719468;
  const era = ((z >= 0 ? z : z - 146096) / 146097) | 0;
  const doe = z - era * 146097;
  const yoe = ((doe - ((doe / 1460) | 0) + ((doe / 36524) | 0) - ((doe / 146096) | 0)) / 365) | 0;
  let year = yoe + era * 400;
  const doy = doe - (365 * yoe + ((yoe / 4) | 0) - ((yoe / 100) | 0));
  const mp = ((5 * doy + 2) / 153) | 0;
  const day = (doy - (153 * mp + 2) / 5) | 0;
  const month = mp + (mp < 10 ? 3 : -9);
  year += month <= 2 ? 1 : 0;
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${(day + 1).toString().padStart(2, '0')}`;
}

function isPositionScope(scope: PerformanceScope): scope is { positionKey: string } {
  return typeof scope === 'object';
}

function bucketFor(scope: PerformanceScope): ID | undefined {
  if (scope === 'core') return CORE_BUCKET;
  if (
    typeof scope === 'string' &&
    scope !== 'total' &&
    scope !== 'strategies' &&
    scope !== CORE_BUCKET
  )
    return scope;
  return undefined;
}

function inScopeBucket(bucket: ID, scope: PerformanceScope): boolean {
  if (scope === 'total') return true;
  if (scope === 'strategies') return bucket !== CORE_BUCKET;
  const wanted = bucketFor(scope);
  return wanted === bucket;
}

function positionInScope(position: Position, scope: PerformanceScope): boolean {
  if (isPositionScope(scope)) return position.key === scope.positionKey;
  return inScopeBucket(position.bucket, scope);
}

function addMissing(target: MissingClose[], additions: MissingClose[]) {
  for (const next of additions) {
    if (
      !target.some(
        (existing) => existing.instrumentId === next.instrumentId && existing.date === next.date,
      )
    )
      target.push(next);
  }
}

// Closes per instrument, sorted by date. Built once per history array:
// valuing every day of a window would otherwise rescan the whole table.
const priceIndex = new WeakMap<object, Map<ID, AppData['priceHistory']>>();

function closesOf(data: AppData, instrumentId: ID): AppData['priceHistory'] {
  let index = priceIndex.get(data.priceHistory);
  if (!index) {
    index = new Map();
    for (const point of data.priceHistory) {
      const rows = index.get(point.instrumentId);
      if (rows) rows.push(point);
      else index.set(point.instrumentId, [point]);
    }
    for (const rows of index.values())
      rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    priceIndex.set(data.priceHistory, index);
  }
  return index.get(instrumentId) ?? [];
}

/** Latest close on or before `date`. */
function historicalPrice(
  data: AppData,
  instrumentId: ID,
  date: ISODate,
  adjusted = false,
): number | undefined {
  const rows = closesOf(data, instrumentId);
  let lo = 0;
  let hi = rows.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].date <= date) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found < 0) return undefined;
  const point = rows[found];
  return adjusted ? (point.adjClose ?? point.close) : point.close;
}

/** Earliest adjusted close after `from`, no later than `to`. */
function firstCloseAfter(
  data: AppData,
  instrumentId: ID,
  from: ISODate,
  to: ISODate,
): number | undefined {
  const point = closesOf(data, instrumentId).find((row) => row.date > from && row.date <= to);
  return point && (point.adjClose ?? point.close);
}

function rateToBase(data: AppData, currency: string): number | undefined {
  return new FxTable(data.fxRates).rate(currency, getSettings(data).baseCurrency);
}

function loanBuckets(data: AppData, asOf: ISODate): Map<ID, ID> {
  const buckets = new Map<ID, ID>();
  for (const tx of data.transactions) {
    if (tx.date <= asOf && tx.type === 'loan_draw' && tx.loanId && !buckets.has(tx.loanId)) {
      buckets.set(tx.loanId, tx.bucket || CORE_BUCKET);
    }
  }
  return buckets;
}

function valueAt(
  data: AppData,
  date: ISODate,
  scope: PerformanceScope,
  today: ISODate,
  ledgerDate = date,
): HistoricalValue {
  const ledger = buildLedger(data, { asOf: ledgerDate });
  const instruments = new Map(data.instruments.map((instrument) => [instrument.id, instrument]));
  const currentQuotes = new Map(data.prices.map((quote) => [quote.id, quote.price]));
  const missing: MissingClose[] = [];
  const notes: string[] = [];
  const base = getSettings(data).baseCurrency;
  const fx = new FxTable(data.fxRates);
  let value = 0;
  let usedNonBase = false;

  for (const position of ledger.positions) {
    if (!positionInScope(position, scope) || position.quantity === 0) continue;
    const instrument = instruments.get(position.instrumentId);
    if (!instrument) continue;
    const price =
      date === today
        ? currentQuotes.get(instrument.id)
        : historicalPrice(data, instrument.id, date);
    if (!(price && price > 0)) {
      missing.push({ instrumentId: instrument.id, date });
      continue;
    }
    const rate = fx.rate(instrument.currency, base);
    if (rate === undefined) {
      notes.push(`缺少 ${instrument.currency}/${base} 匯率，${instrument.symbol} 未計入估值`);
      continue;
    }
    if (instrument.currency !== base && date !== today) usedNonBase = true;
    const notional = position.quantity * price * instrument.multiplier * rate;
    const cost = position.quantity * position.avgCost * instrument.multiplier * rate;
    value += isDerivative(instrument.type) ? notional - cost : notional;
  }

  if (!isPositionScope(scope)) {
    const cash =
      scope === 'total'
        ? ledger.cash
        : ledger.bucketCash.filter((entry) => inScopeBucket(entry.bucket, scope));
    for (const entry of cash) {
      const rate = fx.rate(entry.currency, base);
      if (rate === undefined) {
        notes.push(`缺少 ${entry.currency}/${base} 匯率，現金未計入估值`);
        continue;
      }
      if (entry.currency !== base && date !== today) usedNonBase = true;
      value += entry.amount * rate;
    }
    const buckets = loanBuckets(data, ledgerDate);
    for (const loan of ledger.loans) {
      if (scope !== 'total' && !inScopeBucket(buckets.get(loan.loanId) ?? CORE_BUCKET, scope))
        continue;
      const rate = fx.rate(loan.currency, base);
      if (rate === undefined) {
        notes.push(`缺少 ${loan.currency}/${base} 匯率，貸款未計入估值`);
        continue;
      }
      if (loan.currency !== base && date !== today) usedNonBase = true;
      value -= loan.balance * rate;
    }
  }
  if (usedNonBase) notes.push('歷史估值沒有歷史 FX 序列，非本位幣金額使用目前 FX。');
  return { value, missing, notes: [...new Set(notes)] };
}

/** Value a total portfolio, bucket, combined strategies, or a position at a historical close. */
export function valueAsOf(
  data: AppData,
  date: ISODate,
  scope: PerformanceScope,
  today = date,
): HistoricalValue {
  return valueAt(data, date, scope, today);
}

function txBaseAmount(data: AppData, tx: Transaction, amount: number): number {
  const base = getSettings(data).baseCurrency;
  if (tx.currency === base) return amount;
  const rate = tx.fxRate ?? rateToBase(data, tx.currency);
  return rate === undefined ? 0 : amount * rate;
}

function transactionMatchesPosition(tx: Transaction, key: string): boolean {
  const [accountId, instrumentId, bucket] = key.split('|');
  return (
    (tx.accountId === accountId ||
      (tx.type === 'position_transfer' && tx.toAccountId === accountId)) &&
    tx.instrumentId === instrumentId &&
    (tx.bucket || CORE_BUCKET) === bucket
  );
}

/** Cash flows that change the measured capital, expressed in base currency. */
export function externalFlows(
  data: AppData,
  scope: PerformanceScope,
  from: ISODate,
  to: ISODate,
): ExternalFlow[] {
  const flows = new Map<ISODate, number>();
  const add = (date: ISODate, amount: number) => flows.set(date, (flows.get(date) ?? 0) + amount);
  for (const tx of data.transactions) {
    if (tx.date < from || tx.date > to) continue;
    const bucket = tx.bucket || CORE_BUCKET;
    if (isPositionScope(scope)) {
      if (!transactionMatchesPosition(tx, scope.positionKey)) continue;
      const gross =
        (tx.quantity ?? 0) *
        (tx.price ?? 0) *
        (data.instruments.find((i) => i.id === tx.instrumentId)?.multiplier ?? 1);
      const costs = (tx.fee ?? 0) + (tx.tax ?? 0);
      if (tx.type === 'buy') add(tx.date, txBaseAmount(data, tx, gross + costs));
      if (tx.type === 'sell') add(tx.date, -txBaseAmount(data, tx, gross - costs));
      if (tx.type === 'dividend') add(tx.date, -txBaseAmount(data, tx, tx.amount - costs));
      if (tx.type === 'position_transfer') {
        const price = historicalPrice(data, tx.instrumentId!, tx.date);
        if (price !== undefined) {
          const direction = scope.positionKey.split('|')[0] === tx.accountId ? -1 : 1;
          add(
            tx.date,
            direction *
              txBaseAmount(
                data,
                tx,
                (tx.quantity ?? 0) *
                  price *
                  (data.instruments.find((i) => i.id === tx.instrumentId)?.multiplier ?? 1),
              ),
          );
        }
      }
      continue;
    }
    if (tx.type === 'deposit' && inScopeBucket(bucket, scope))
      add(tx.date, txBaseAmount(data, tx, tx.amount));
    if (tx.type === 'withdraw' && inScopeBucket(bucket, scope))
      add(tx.date, -txBaseAmount(data, tx, tx.amount));
    if (tx.type === 'loan_repay' && tx.source === 'external' && inScopeBucket(bucket, scope)) {
      add(
        tx.date,
        txBaseAmount(
          data,
          tx,
          (tx.principal ?? tx.amount - (tx.interest ?? 0)) +
            (tx.interest ?? 0) +
            (tx.fee ?? 0) +
            (tx.tax ?? 0),
        ),
      );
    }
    if (tx.type === 'transfer' && scope !== 'total') {
      const destination = tx.toBucket ?? bucket;
      if (bucket !== destination) {
        if (inScopeBucket(bucket, scope)) add(tx.date, -txBaseAmount(data, tx, tx.amount));
        if (inScopeBucket(destination, scope)) {
          const toCurrency = tx.toCurrency ?? tx.currency;
          const toAmount = tx.toAmount ?? tx.amount;
          const base = getSettings(data).baseCurrency;
          const rate = toCurrency === base ? 1 : rateToBase(data, toCurrency);
          if (rate !== undefined) add(tx.date, toAmount * rate);
        }
      }
    }
  }
  return [...flows.entries()]
    .filter(([, amount]) => amount !== 0)
    .map(([date, amount]) => ({ date, amount }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * Chain-links returns between capital flows. Transactions are date-only, so a
 * flow is treated as occurring after that date's close; the preceding ledger
 * is valued at that close and the next period starts after the flow.
 */
export function timeWeightedReturn(
  data: AppData,
  scope: PerformanceScope,
  from: ISODate,
  to: ISODate,
  today: ISODate,
): TimeWeightedResult {
  const flows = externalFlows(data, scope, from, to).filter((flow) => flow.date > from);
  const missing: MissingClose[] = [];
  const notes: string[] = [];
  const collect = (valuation: HistoricalValue) => {
    addMissing(missing, valuation.missing);
    notes.push(...valuation.notes);
    return valuation.value;
  };
  const periods: ReturnPeriod[] = [];
  let startDate = from;
  let startValue = collect(valueAt(data, from, scope, today));
  let undefinedPeriods = false;
  let cumulative = 1;
  for (const flow of flows) {
    const before = collect(valueAt(data, flow.date, scope, today, previousDay(flow.date)));
    const period: ReturnPeriod = {
      from: startDate,
      to: flow.date,
      startValue,
      endValue: before,
      flow: flow.amount,
    };
    if (startValue === 0 && before === 0) {
      // Nothing was invested yet: the window opens before the first money
      // arrived, so measurement starts at this flow.
      startDate = flow.date;
      startValue = collect(valueAt(data, flow.date, scope, today));
      continue;
    }
    if (startValue > 0) {
      period.return = before / startValue - 1;
      cumulative *= 1 + period.return;
    } else {
      undefinedPeriods = true;
    }
    periods.push(period);
    startDate = flow.date;
    startValue = collect(valueAt(data, flow.date, scope, today));
  }
  if (startDate < to || periods.length === 0) {
    const endValue = collect(valueAt(data, to, scope, today));
    const period: ReturnPeriod = { from: startDate, to, startValue, endValue, flow: 0 };
    if (startValue > 0) {
      period.return = endValue / startValue - 1;
      cumulative *= 1 + period.return;
    } else {
      undefinedPeriods = true;
    }
    periods.push(period);
  }
  const days = daysBetween(from, to);
  const result = undefinedPeriods ? undefined : cumulative - 1;
  return {
    cumulative: result,
    annualized:
      result !== undefined && days > 0 && cumulative >= 0
        ? cumulative ** (365 / days) - 1
        : undefined,
    days,
    shortPeriod: days < 365,
    undefinedPeriods,
    periods,
    missing,
    notes: [...new Set(notes)],
  };
}

export function moneyWeightedReturn(
  data: AppData,
  scope: PerformanceScope,
  from: ISODate,
  to: ISODate,
  today: ISODate,
): MoneyWeightedResult {
  const opening = valueAt(data, from, scope, today);
  const ending = valueAt(data, to, scope, today);
  const flows = externalFlows(data, scope, from, to).filter((flow) => flow.date > from);
  const cashFlows = [
    ...(opening.value !== 0 ? [{ date: from, amount: -opening.value }] : []),
    ...flows.map((flow) => ({ date: flow.date, amount: -flow.amount })),
    { date: to, amount: ending.value },
  ];
  return {
    xirr: xirr(cashFlows),
    flows,
    endingValue: ending.value,
    missing: [...opening.missing, ...ending.missing],
    notes: [...new Set([...opening.notes, ...ending.notes])],
  };
}

function scopedTotals(data: AppData, scope: PerformanceScope, from: ISODate, to: ISODate) {
  let dividends = 0;
  let feesAndTaxes = 0;
  let fundingCost = 0;
  const accruedByLoan = new Map<ID, number>();
  for (const tx of sortedTransactions(data)) {
    if (tx.type === 'loan_repay' && tx.source === 'unconfirmed') continue;
    const loanId = tx.loanId ?? '';
    const accruedPaid =
      tx.type === 'loan_repay' ? Math.min(tx.interest ?? 0, accruedByLoan.get(loanId) ?? 0) : 0;
    if (tx.type === 'loan_accrual')
      accruedByLoan.set(loanId, (accruedByLoan.get(loanId) ?? 0) + tx.amount);
    if (tx.type === 'loan_repay')
      accruedByLoan.set(loanId, (accruedByLoan.get(loanId) ?? 0) - accruedPaid);
    if (tx.date < from || tx.date > to) continue;
    const matches = isPositionScope(scope)
      ? transactionMatchesPosition(tx, scope.positionKey)
      : inScopeBucket(tx.bucket || CORE_BUCKET, scope);
    if (!matches) continue;
    const costs = (tx.fee ?? 0) + (tx.tax ?? 0);
    feesAndTaxes += txBaseAmount(data, tx, costs + (tx.type === 'fee' ? tx.amount : 0));
    if (tx.type === 'dividend') dividends += txBaseAmount(data, tx, tx.amount);
    if (tx.type === 'interest' || tx.type === 'funding_fee' || tx.type === 'loan_accrual')
      fundingCost += txBaseAmount(data, tx, tx.amount);
    if (tx.type === 'loan_repay')
      fundingCost += txBaseAmount(data, tx, (tx.interest ?? 0) - accruedPaid);
  }
  return { dividends, feesAndTaxes, fundingCost };
}

function scopedPositionMetric(
  data: AppData,
  scope: PerformanceScope,
  date: ISODate,
  today: ISODate,
  metric: 'realizedPnl' | 'unrealized',
): number {
  const ledger = buildLedger(data, { asOf: date });
  const instruments = new Map(data.instruments.map((instrument) => [instrument.id, instrument]));
  let total = 0;
  for (const position of ledger.positions) {
    if (!positionInScope(position, scope)) continue;
    const instrument = instruments.get(position.instrumentId);
    if (!instrument) continue;
    const rate = rateToBase(data, instrument.currency) ?? 0;
    if (metric === 'realizedPnl') total += position.realizedPnl * rate;
    else {
      const price =
        date === today
          ? data.prices.find((quote) => quote.id === instrument.id)?.price
          : historicalPrice(data, instrument.id, date);
      if (price !== undefined)
        total += (price - position.avgCost) * position.quantity * instrument.multiplier * rate;
    }
  }
  return total;
}

export function pnlBreakdown(
  data: AppData,
  scope: PerformanceScope,
  from: ISODate,
  to: ISODate,
  today: ISODate,
): PnlBreakdown {
  const totals = scopedTotals(data, scope, from, to);
  const realized =
    scopedPositionMetric(data, scope, to, today, 'realizedPnl') -
    scopedPositionMetric(data, scope, previousDay(from), today, 'realizedPnl');
  const unrealized =
    scopedPositionMetric(data, scope, to, today, 'unrealized') -
    scopedPositionMetric(data, scope, previousDay(from), today, 'unrealized');
  const gross = realized + unrealized + totals.dividends - totals.feesAndTaxes;
  return {
    realized,
    unrealized,
    dividends: totals.dividends,
    feesAndTaxes: totals.feesAndTaxes,
    fundingCost: totals.fundingCost,
    gross,
    net: gross - totals.fundingCost,
    notes: ['尚無歷史 FX 序列，因此不單獨推估匯兌損益。'],
  };
}

export function benchmarkReturn(
  data: AppData,
  instrumentId: ID,
  from: ISODate,
  to: ISODate,
  flows: ExternalFlow[],
): BenchmarkResult {
  // A window may open on a holiday or before the downloaded history begins:
  // then the first close inside the window is the benchmark's starting price.
  const start =
    historicalPrice(data, instrumentId, from, true) ??
    firstCloseAfter(data, instrumentId, from, to);
  const end = historicalPrice(data, instrumentId, to, true);
  const missing: MissingClose[] = [];
  if (!(start && start > 0)) missing.push({ instrumentId, date: from });
  if (!(end && end > 0)) missing.push({ instrumentId, date: to });
  const buyAndHold = start && end ? end / start - 1 : undefined;
  let units = 0;
  for (const flow of flows) {
    const price = historicalPrice(data, instrumentId, flow.date, true);
    if (!(price && price > 0)) {
      missing.push({ instrumentId, date: flow.date });
      continue;
    }
    units += flow.amount / price;
  }
  const endingValue = end === undefined ? undefined : units * end;
  const mwr =
    endingValue === undefined
      ? undefined
      : xirr([
          ...flows.map((flow) => ({ date: flow.date, amount: -flow.amount })),
          { date: to, amount: endingValue },
        ]);
  return { instrumentId, buyAndHold, flowMatched: { twr: buyAndHold, mwr, endingValue }, missing };
}

export function riskStatistics(
  data: AppData,
  scope: PerformanceScope,
  from: ISODate,
  to: ISODate,
  today: ISODate,
  riskFreeRate = 0,
): RiskStatistics {
  const dates = new Set<ISODate>([from, to]);
  data.snapshots.forEach(
    (snapshot) => snapshot.date >= from && snapshot.date <= to && dates.add(snapshot.date),
  );
  data.priceHistory.forEach(
    (point) => point.date >= from && point.date <= to && dates.add(point.date),
  );
  const ordered = [...dates].sort();
  const flowByDate = new Map(
    externalFlows(data, scope, from, to).map((flow) => [flow.date, flow.amount]),
  );
  const missing: MissingClose[] = [];
  const returns: Array<{ date: ISODate; value: number }> = [];
  let prior = valueAt(data, ordered[0], scope, today);
  addMissing(missing, prior.missing);
  for (const date of ordered.slice(1)) {
    const current = valueAt(data, date, scope, today);
    addMissing(missing, current.missing);
    if (prior.value > 0)
      returns.push({
        date,
        value: (current.value - (flowByDate.get(date) ?? 0)) / prior.value - 1,
      });
    prior = current;
  }
  let index = 1;
  let peak = 1;
  let peakDate = ordered[0];
  let maxDrawdown = 0;
  let troughDate: ISODate | undefined;
  for (const row of returns) {
    index *= 1 + row.value;
    if (index > peak) {
      peak = index;
      peakDate = row.date;
    }
    const drawdown = index / peak - 1;
    if (drawdown < maxDrawdown) {
      maxDrawdown = drawdown;
      troughDate = row.date;
    }
  }
  const mean = returns.reduce((sum, row) => sum + row.value, 0) / returns.length;
  const variance =
    returns.length > 1
      ? returns.reduce((sum, row) => sum + (row.value - mean) ** 2, 0) / (returns.length - 1)
      : undefined;
  const volatility = variance === undefined ? undefined : Math.sqrt(variance * 252);
  const twr = timeWeightedReturn(data, scope, from, to, today);
  return {
    maxDrawdown: returns.length ? maxDrawdown : undefined,
    peakDate: troughDate ? peakDate : undefined,
    troughDate,
    volatility,
    sampling: 'daily',
    riskAdjusted:
      volatility && twr.annualized !== undefined
        ? (twr.annualized - riskFreeRate) / volatility
        : undefined,
    observations: returns.length,
    missing,
  };
}

function strategyBenchmark(data: AppData, scope: PerformanceScope): ID | undefined {
  const bucket = isPositionScope(scope) ? scope.positionKey.split('|')[2] : bucketFor(scope);
  const strategy =
    bucket && bucket !== CORE_BUCKET ? data.strategies.find((row) => row.id === bucket) : undefined;
  if (!strategy) return undefined;
  return (
    strategy.benchmarkInstrumentId ??
    data.instruments.find(
      (instrument) => instrument.indexId === strategy.benchmarkIndexId && instrument.leverage === 1,
    )?.id
  );
}

function summary(
  data: AppData,
  id: string,
  label: string,
  scope: PerformanceScope,
  from: ISODate,
  to: ISODate,
  today: ISODate,
): PerformanceSummary {
  const twr = timeWeightedReturn(data, scope, from, to, today);
  const mwr = moneyWeightedReturn(data, scope, from, to, today);
  const benchmarkId = strategyBenchmark(data, scope);
  const opening = valueAt(data, from, scope, today).value;
  const benchmark = benchmarkId
    ? benchmarkReturn(data, benchmarkId, from, to, [{ date: from, amount: opening }, ...mwr.flows])
    : undefined;
  return {
    id,
    label,
    scope,
    twr,
    mwr,
    risk: riskStatistics(data, scope, from, to, today),
    benchmark,
    excessReturn:
      twr.cumulative !== undefined && benchmark?.flowMatched.twr !== undefined
        ? twr.cumulative - benchmark.flowMatched.twr
        : undefined,
  };
}

/** Core, each strategy, all strategies, then the complete portfolio. */
export function performanceLevels(
  data: AppData,
  from: ISODate,
  to: ISODate,
  today: ISODate,
): PerformanceSummary[] {
  return [
    summary(data, CORE_BUCKET, 'Core Passive', 'core', from, to, today),
    ...data.strategies.map((strategy) =>
      summary(data, strategy.id, strategy.name, strategy.id, from, to, today),
    ),
    summary(data, 'strategies', 'All Active Strategies', 'strategies', from, to, today),
    summary(data, 'total', 'Total Portfolio', 'total', from, to, today),
  ];
}

/** Current per-position metrics. Futures report currency P&L and notional-normalised P&L separately. */
export function positionPerformance(
  data: AppData,
  positionKey: string,
  today: ISODate,
): PositionPerformance | undefined {
  const ledger = buildLedger(data, { asOf: today });
  const position = ledger.positions.find((row) => row.key === positionKey && row.quantity !== 0);
  const instrument = position && data.instruments.find((row) => row.id === position.instrumentId);
  if (!position || !instrument) return undefined;
  const start = position.lots.map((lot) => lot.date).sort()[0] ?? today;
  const scope = { positionKey };
  const rate = rateToBase(data, instrument.currency) ?? 0;
  const price = data.prices.find((quote) => quote.id === instrument.id)?.price;
  const cost = position.quantity * position.avgCost * instrument.multiplier * rate;
  const currentNotional = (price ?? 0) * position.quantity * instrument.multiplier * rate;
  const derivative = isDerivative(instrument.type);
  const currentValue = derivative ? currentNotional - cost : currentNotional;
  const pnl = derivative
    ? currentValue + position.realizedPnl * rate
    : currentValue - cost + position.realizedPnl * rate;
  const baseSummary = summary(data, positionKey, instrument.symbol, scope, start, today, today);
  const averageNotional = (Math.abs(currentNotional) + Math.abs(cost)) / 2;
  return {
    ...baseSummary,
    twr: derivative
      ? { ...baseSummary.twr, cumulative: undefined, annualized: undefined, undefinedPeriods: true }
      : baseSummary.twr,
    positionKey,
    instrumentId: instrument.id,
    currentValue,
    cost,
    pnl,
    cumulativeReturn: !derivative && cost !== 0 ? pnl / Math.abs(cost) : undefined,
    holdingDays: daysBetween(start, today),
    derivativePnlPerAverageNotional:
      derivative && averageNotional > 0 ? pnl / averageNotional : undefined,
  };
}
