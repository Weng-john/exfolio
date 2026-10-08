import { FxTable } from './fx';
import { buildLedger, type Ledger } from './ledger';
import { externalFlows, type ExternalFlow } from './performance';
import { getSettings, isDerivative, type AppData, type ID, type ISODate } from './types';

const EPS = 1e-9;
export const MIN_CORRELATION_OBSERVATIONS = 5;

export interface HistoryRow {
  date: ISODate;
  totalAssets: number;
  liabilities: number;
  nav: number;
  /** Signed cash; negative balances are reported as liabilities too. */
  cash: number;
  grossExposure: number;
  netExposure: number;
  grossLeverage?: number;
  netLeverage?: number;
  debtToNav?: number;
  contributedCapital: number;
  netExposureByIndex: Record<ID, number>;
  /** A row with a held instrument that could not be marked at a usable price. */
  incomplete: boolean;
  missing: ID[];
  /** Marked prior holdings before this date's transactions, for attribution. */
  marketNav?: number;
  marketGrossExposure?: number;
}

export interface ReconstructedHistory {
  rows: HistoryRow[];
  notes: string[];
}

interface MarkedValue {
  totalAssets: number;
  liabilities: number;
  nav: number;
  cash: number;
  grossExposure: number;
  netExposure: number;
  contributedCapital: number;
  netExposureByIndex: Record<ID, number>;
  incomplete: boolean;
  missing: ID[];
  notes: string[];
}

function historyIndex(data: AppData) {
  const byInstrument = new Map<ID, AppData['priceHistory']>();
  for (const point of data.priceHistory) {
    const rows = byInstrument.get(point.instrumentId);
    if (rows) rows.push(point);
    else byInstrument.set(point.instrumentId, [point]);
  }
  for (const rows of byInstrument.values()) rows.sort((a, b) => a.date.localeCompare(b.date));
  return byInstrument;
}

function closeOnOrBefore(
  index: Map<ID, AppData['priceHistory']>,
  instrumentId: ID,
  date: ISODate,
): number | undefined {
  const rows = index.get(instrumentId) ?? [];
  let low = 0;
  let high = rows.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (rows[middle].date <= date) {
      found = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return found < 0 ? undefined : rows[found].close;
}

function datesInWindow(data: AppData, from: ISODate, to: ISODate): ISODate[] {
  const traded = new Set(
    data.transactions
      .filter((tx) => tx.instrumentId && tx.date <= to)
      .map((tx) => tx.instrumentId!),
  );
  const dates = new Set<ISODate>([to]);
  for (const tx of data.transactions) if (tx.date >= from && tx.date <= to) dates.add(tx.date);
  for (const point of data.priceHistory) {
    if (traded.has(point.instrumentId) && point.date >= from && point.date <= to)
      dates.add(point.date);
  }
  return [...dates].sort();
}

function markedValue(
  data: AppData,
  ledger: Ledger,
  date: ISODate,
  today: ISODate,
  prices: Map<ID, number>,
  closes: Map<ID, AppData['priceHistory']>,
): MarkedValue {
  const base = getSettings(data).baseCurrency;
  const fx = new FxTable(data.fxRates);
  const instruments = new Map(data.instruments.map((instrument) => [instrument.id, instrument]));
  let securities = 0;
  let derivativeEquity = 0;
  let cash = 0;
  let overdrawn = 0;
  let loans = 0;
  let grossExposure = 0;
  let netExposure = 0;
  const netExposureByIndex: Record<ID, number> = {};
  const missing = new Set<ID>();
  const notes: string[] = [];

  for (const position of ledger.positions) {
    if (Math.abs(position.quantity) < EPS) continue;
    const instrument = instruments.get(position.instrumentId);
    if (!instrument) {
      missing.add(position.instrumentId);
      continue;
    }
    const price =
      date === today ? prices.get(instrument.id) : closeOnOrBefore(closes, instrument.id, date);
    if (!(price && price > 0)) {
      missing.add(instrument.id);
      continue;
    }
    const rate = fx.rate(instrument.currency, base);
    if (rate === undefined) {
      notes.push(`缺少 ${instrument.currency}/${base} 匯率，${instrument.symbol} 未計入估值`);
      continue;
    }
    const notional = position.quantity * price * instrument.multiplier * rate;
    const cost = position.quantity * position.avgCost * instrument.multiplier * rate;
    if (isDerivative(instrument.type)) derivativeEquity += notional - cost;
    else securities += notional;
    const exposure = notional * instrument.leverage;
    grossExposure += Math.abs(exposure);
    netExposure += exposure;
    const indexId = instrument.indexId ?? 'unclassified';
    netExposureByIndex[indexId] = (netExposureByIndex[indexId] ?? 0) + exposure;
  }

  for (const balance of ledger.cash) {
    const rate = fx.rate(balance.currency, base);
    if (rate === undefined) {
      notes.push(`缺少 ${balance.currency}/${base} 匯率，現金未計入估值`);
      continue;
    }
    const value = balance.amount * rate;
    cash += value;
    if (value < 0) overdrawn -= value;
  }
  for (const loan of ledger.loans) {
    const rate = fx.rate(loan.currency, base);
    if (rate === undefined) {
      notes.push(`缺少 ${loan.currency}/${base} 匯率，貸款未計入估值`);
      continue;
    }
    loans += loan.balance * rate;
  }
  const totalAssets = securities + Math.max(0, cash) + derivativeEquity;
  const liabilities = loans + overdrawn;
  return {
    totalAssets,
    liabilities,
    nav: totalAssets - liabilities,
    cash,
    grossExposure,
    netExposure,
    contributedCapital: ledger.totals.contributedCapital,
    netExposureByIndex,
    incomplete: missing.size > 0,
    missing: [...missing].sort(),
    notes,
  };
}

/**
 * Rebuild daily marks from the transaction ledger and closes. Historical FX is
 * intentionally not invented: all non-base amounts use the current FX table.
 */
export function reconstructHistory(
  data: AppData,
  from: ISODate,
  to: ISODate,
  today: ISODate,
): ReconstructedHistory {
  const closes = historyIndex(data);
  const quotes = new Map(data.prices.map((quote) => [quote.id, quote.price]));
  const transactionDates = new Set(
    data.transactions.filter((tx) => tx.date <= to).map((tx) => tx.date),
  );
  const closingInstrumentsByDate = new Map<ISODate, Set<ID>>();
  for (const point of data.priceHistory) {
    if (point.date < from || point.date > to) continue;
    const ids = closingInstrumentsByDate.get(point.date) ?? new Set<ID>();
    ids.add(point.instrumentId);
    closingInstrumentsByDate.set(point.date, ids);
  }
  const rows: HistoryRow[] = [];
  const notes = new Set<string>(['歷史估值沒有歷史 FX 序列，非本位幣金額使用目前 FX。']);
  let ledger = buildLedger(data, { asOf: from });
  let previousLedger: Ledger | undefined;

  for (const date of datesInWindow(data, from, to)) {
    if (date !== from && transactionDates.has(date)) ledger = buildLedger(data, { asOf: date });
    const held = new Set(
      ledger.positions
        .filter((position) => Math.abs(position.quantity) > EPS)
        .map((position) => position.instrumentId),
    );
    const hasHeldClose = [...(closingInstrumentsByDate.get(date) ?? [])].some((id) => held.has(id));
    if (date !== to && !transactionDates.has(date) && !hasHeldClose) continue;
    const mark = markedValue(data, ledger, date, today, quotes, closes);
    mark.notes.forEach((note) => notes.add(note));
    const previousMark = previousLedger
      ? markedValue(data, previousLedger, date, today, quotes, closes)
      : undefined;
    if (previousMark) previousMark.notes.forEach((note) => notes.add(note));
    const ratio = (value: number) => (mark.nav > 0 ? value / mark.nav : undefined);
    rows.push({
      date,
      totalAssets: mark.totalAssets,
      liabilities: mark.liabilities,
      nav: mark.nav,
      cash: mark.cash,
      grossExposure: mark.grossExposure,
      netExposure: mark.netExposure,
      grossLeverage: ratio(mark.grossExposure),
      netLeverage: ratio(mark.netExposure),
      debtToNav: ratio(mark.liabilities),
      contributedCapital: mark.contributedCapital,
      netExposureByIndex: mark.netExposureByIndex,
      incomplete: mark.incomplete,
      missing: mark.missing,
      marketNav: previousMark?.nav,
      marketGrossExposure: previousMark?.grossExposure,
    });
    previousLedger = ledger;
  }
  return { rows, notes: [...notes] };
}

export interface IndexedHistoryPoint {
  date: ISODate;
  nav: number;
  index: number;
  dailyReturn?: number;
}

/** Build the flow-adjusted NAV index used by every return-derived analysis. */
export function flowAdjustedIndex(
  history: HistoryRow[],
  flows: ExternalFlow[],
): IndexedHistoryPoint[] {
  const flowByDate = new Map<ISODate, number>();
  flows.forEach((flow) =>
    flowByDate.set(flow.date, (flowByDate.get(flow.date) ?? 0) + flow.amount),
  );
  const rows = [...history]
    .filter((row) => !row.incomplete)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!rows.length) return [];
  const result: IndexedHistoryPoint[] = [{ date: rows[0].date, nav: rows[0].nav, index: 1 }];
  let index = 1;
  for (let i = 1; i < rows.length; i += 1) {
    const previous = rows[i - 1];
    const current = rows[i];
    const flow = flowByDate.get(current.date) ?? 0;
    const dailyReturn = previous.nav > 0 ? (current.nav - flow) / previous.nav - 1 : undefined;
    if (dailyReturn !== undefined) index *= 1 + dailyReturn;
    result.push({ date: current.date, nav: current.nav, index, dailyReturn });
  }
  return result;
}

export interface Drawdown {
  peakDate: ISODate;
  troughDate: ISODate;
  depth: number;
  daysToTrough: number;
  recoveryDate?: ISODate;
  daysToRecover?: number;
}

export interface DrawdownResult {
  drawdowns: Drawdown[];
  current?: Drawdown;
  index: IndexedHistoryPoint[];
}

function daysBetween(from: ISODate, to: ISODate) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Largest non-overlapping peak-to-trough episodes, based only on complete rows. */
export function drawdownTable(
  series: HistoryRow[],
  flows: ExternalFlow[],
  topN: number,
): DrawdownResult {
  const index = flowAdjustedIndex(series, flows);
  if (!index.length) return { drawdowns: [], index };
  let high = index[0];
  let active: Drawdown | undefined;
  const episodes: Drawdown[] = [];
  for (const point of index.slice(1)) {
    if (point.index >= high.index - EPS) {
      if (active) {
        active.recoveryDate = point.date;
        active.daysToRecover = daysBetween(active.peakDate, point.date);
        episodes.push(active);
        active = undefined;
      }
      high = point;
      continue;
    }
    const depth = point.index / high.index - 1;
    if (!active) {
      active = {
        peakDate: high.date,
        troughDate: point.date,
        depth,
        daysToTrough: daysBetween(high.date, point.date),
      };
    } else if (depth < active.depth) {
      active.troughDate = point.date;
      active.depth = depth;
      active.daysToTrough = daysBetween(active.peakDate, point.date);
    }
  }
  if (active) episodes.push(active);
  return {
    drawdowns: [...episodes].sort((a, b) => a.depth - b.depth).slice(0, Math.max(0, topN)),
    current: active,
    index,
  };
}

export type RollingWindow = '1M' | '3M' | '6M' | '1Y';
export type RollingReturns = Record<RollingWindow, Array<{ date: ISODate; return?: number }>>;

function monthsBefore(date: ISODate, months: number): ISODate {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() - months);
  return value.toISOString().slice(0, 10);
}

/** Rolling flow-adjusted returns; a value is omitted until a full window exists. */
export function rollingReturns(history: HistoryRow[], flows: ExternalFlow[]): RollingReturns {
  const indexed = flowAdjustedIndex(history, flows);
  const windows: Array<[RollingWindow, number]> = [
    ['1M', 1],
    ['3M', 3],
    ['6M', 6],
    ['1Y', 12],
  ];
  return Object.fromEntries(
    windows.map(([label, months]) => [
      label,
      indexed.map((point) => {
        const target = monthsBefore(point.date, months);
        const start = [...indexed].reverse().find((candidate) => candidate.date <= target);
        return { date: point.date, return: start ? point.index / start.index - 1 : undefined };
      }),
    ]),
  ) as RollingReturns;
}

export interface CalendarReturnYear {
  year: string;
  months: Record<string, number | undefined>;
  total?: number;
}

/** Monthly and calendar-year returns, compounded from the same daily index. */
export function calendarReturns(
  history: HistoryRow[],
  flows: ExternalFlow[],
): CalendarReturnYear[] {
  const indexed = flowAdjustedIndex(history, flows);
  const years = new Map<string, CalendarReturnYear>();
  for (let i = 1; i < indexed.length; i += 1) {
    const current = indexed[i];
    if (current.dailyReturn === undefined) continue;
    const year = current.date.slice(0, 4);
    const month = current.date.slice(5, 7);
    const row = years.get(year) ?? { year, months: {} };
    row.months[month] = (1 + (row.months[month] ?? 0)) * (1 + current.dailyReturn) - 1;
    years.set(year, row);
  }
  return [...years.values()]
    .sort((a, b) => a.year.localeCompare(b.year))
    .map((row) => ({
      ...row,
      total:
        Object.values(row.months).reduce<number | undefined>(
          (value, next) =>
            value === undefined || next === undefined ? undefined : value * (1 + next),
          1,
        )! - 1,
    }));
}

export interface LeverageAttribution {
  from: ISODate;
  to: ISODate;
  start?: number;
  end?: number;
  totalChange?: number;
  marketMoves: number;
  externalFlows: number;
  debtChanges: number;
  trading: number;
  residual: number;
}

/**
 * Sequential counterfactual attribution. We mark yesterday's holdings at
 * today's close (market), add external capital to NAV (flow), then compare
 * with the actual end-of-day ledger (trading). Internal debt draw/repayment
 * swaps cash and debt equally, so it has zero direct NAV-leverage effect;
 * external repayment is already an external flow. The explicit residual makes
 * any future accounting extension visible rather than silently forcing a fit.
 */
export function leverageAttribution(
  history: HistoryRow[],
  flows: ExternalFlow[],
): LeverageAttribution {
  const rows = [...history]
    .filter((row) => !row.incomplete)
    .sort((a, b) => a.date.localeCompare(b.date));
  const first = rows[0];
  const last = rows[rows.length - 1];
  const empty = {
    from: first?.date ?? '',
    to: last?.date ?? '',
    marketMoves: 0,
    externalFlows: 0,
    debtChanges: 0,
    trading: 0,
    residual: 0,
  };
  if (!first || !last || rows.length < 2 || first.nav <= 0 || last.nav <= 0) return empty;
  const flowByDate = new Map<ISODate, number>();
  flows.forEach((flow) =>
    flowByDate.set(flow.date, (flowByDate.get(flow.date) ?? 0) + flow.amount),
  );
  let marketMoves = 0;
  let externalFlowEffect = 0;
  let trading = 0;
  for (let i = 1; i < rows.length; i += 1) {
    const previous = rows[i - 1];
    const current = rows[i];
    if (previous.nav <= 0 || current.nav <= 0) continue;
    const start = previous.grossExposure / previous.nav;
    const marketNav = current.marketNav ?? current.nav;
    const marketExposure = current.marketGrossExposure ?? previous.grossExposure;
    if (marketNav <= 0) continue;
    const afterMarket = marketExposure / marketNav;
    const afterFlowNav = marketNav + (flowByDate.get(current.date) ?? 0);
    const afterFlows = afterFlowNav > 0 ? marketExposure / afterFlowNav : afterMarket;
    const actual = current.grossExposure / current.nav;
    marketMoves += afterMarket - start;
    externalFlowEffect += afterFlows - afterMarket;
    trading += actual - afterFlows;
  }
  const start = first.grossExposure / first.nav;
  const end = last.grossExposure / last.nav;
  const totalChange = end - start;
  const debtChanges = 0;
  return {
    from: first.date,
    to: last.date,
    start,
    end,
    totalChange,
    marketMoves,
    externalFlows: externalFlowEffect,
    debtChanges,
    trading,
    residual: totalChange - marketMoves - externalFlowEffect - debtChanges - trading,
  };
}

export interface PnlContributionItem {
  id: string;
  priceEffect: number;
  realizedPnl: number;
  dividends: number;
  total: number;
}

export interface PnlContributionResult {
  byIndex: PnlContributionItem[];
  byPosition: PnlContributionItem[];
  navChangeNetOfFlows?: number;
  explained: number;
  unexplained?: number;
}

function baseAmount(data: AppData, amount: number, currency: string, txRate?: number) {
  const base = getSettings(data).baseCurrency;
  if (currency === base) return amount;
  const rate = txRate ?? new FxTable(data.fxRates).rate(currency, base);
  return rate === undefined ? 0 : amount * rate;
}

function addContribution(
  map: Map<string, PnlContributionItem>,
  id: string,
  part: keyof PnlContributionItem,
  value: number,
) {
  const current = map.get(id) ?? { id, priceEffect: 0, realizedPnl: 0, dividends: 0, total: 0 };
  if (part !== 'id' && part !== 'total') current[part] += value;
  current.total = current.priceEffect + current.realizedPnl + current.dividends;
  map.set(id, current);
}

/** P&L sources that cannot be attributed safely remain explicit as unexplained. */
export function pnlContribution(
  data: AppData,
  history: HistoryRow[],
  flows: ExternalFlow[],
): PnlContributionResult {
  const rows = [...history]
    .filter((row) => !row.incomplete)
    .sort((a, b) => a.date.localeCompare(b.date));
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (!first || !last) return { byIndex: [], byPosition: [], explained: 0 };
  const instruments = new Map(data.instruments.map((instrument) => [instrument.id, instrument]));
  const before = buildLedger(data, { asOf: first.date });
  const after = buildLedger(data, { asOf: last.date });
  const beforePositions = new Map(before.positions.map((position) => [position.key, position]));
  const byPosition = new Map<string, PnlContributionItem>();
  const byIndex = new Map<string, PnlContributionItem>();
  const add = (
    positionId: string,
    instrumentId: string,
    part: keyof PnlContributionItem,
    value: number,
  ) => {
    const indexId = instruments.get(instrumentId)?.indexId ?? 'unclassified';
    addContribution(byPosition, positionId, part, value);
    addContribution(byIndex, indexId, part, value);
  };
  for (const position of after.positions) {
    const previous = beforePositions.get(position.key);
    const instrument = instruments.get(position.instrumentId);
    if (!instrument) continue;
    const rate =
      new FxTable(data.fxRates).rate(instrument.currency, getSettings(data).baseCurrency) ?? 0;
    const realized = baseAmount(
      data,
      position.realizedPnl - (previous?.realizedPnl ?? 0),
      instrument.currency,
    );
    add(position.key, position.instrumentId, 'realizedPnl', realized);
    const endPrice = closeOnOrBefore(historyIndex(data), instrument.id, last.date);
    const startPrice = closeOnOrBefore(historyIndex(data), instrument.id, first.date);
    if (endPrice !== undefined && startPrice !== undefined) {
      const endUnrealized =
        position.quantity * (endPrice - position.avgCost) * instrument.multiplier * rate;
      const startUnrealized =
        (previous?.quantity ?? 0) *
        (startPrice - (previous?.avgCost ?? 0)) *
        instrument.multiplier *
        rate;
      add(position.key, position.instrumentId, 'priceEffect', endUnrealized - startUnrealized);
    }
  }
  for (const tx of data.transactions) {
    if (tx.type !== 'dividend' || !tx.instrumentId || tx.date <= first.date || tx.date > last.date)
      continue;
    add(
      `${tx.accountId}|${tx.instrumentId}|${tx.bucket}`,
      tx.instrumentId,
      'dividends',
      baseAmount(data, tx.amount, tx.currency, tx.fxRate),
    );
  }
  const positionItems = [...byPosition.values()].sort(
    (a, b) => Math.abs(b.total) - Math.abs(a.total),
  );
  const indexItems = [...byIndex.values()].sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  const explained = positionItems.reduce((sum, item) => sum + item.total, 0);
  const netFlows = flows
    .filter((flow) => flow.date > first.date && flow.date <= last.date)
    .reduce((sum, flow) => sum + flow.amount, 0);
  const navChangeNetOfFlows = last.nav - first.nav - netFlows;
  return {
    byIndex: indexItems,
    byPosition: positionItems,
    navChangeNetOfFlows,
    explained,
    unexplained: navChangeNetOfFlows - explained,
  };
}

export interface IndexCorrelation {
  indexId: ID;
  instrumentId: ID;
  observations: number;
  correlations: Record<ID, number | undefined>;
}

export interface IndexOverlap {
  rows: IndexCorrelation[];
  effectiveIndependentBets?: number;
  formula: string;
}

function pearson(left: number[], right: number[]) {
  if (left.length < MIN_CORRELATION_OBSERVATIONS || left.length !== right.length) return undefined;
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let numerator = 0;
  let leftSquares = 0;
  let rightSquares = 0;
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i] - leftMean;
    const b = right[i] - rightMean;
    numerator += a * b;
    leftSquares += a * a;
    rightSquares += b * b;
  }
  return leftSquares > 0 && rightSquares > 0
    ? numerator / Math.sqrt(leftSquares * rightSquares)
    : undefined;
}

/**
 * Equal-weight effective-bets approximation: n² / sum(i,j) rho(i,j). It is
 * n for uncorrelated indices and 1 when all correlations equal +1.
 */
export function indexOverlap(data: AppData, history: HistoryRow[]): IndexOverlap {
  const held = new Set(history.flatMap((row) => Object.keys(row.netExposureByIndex)));
  const candidates = data.instruments.filter(
    (instrument) =>
      instrument.indexId &&
      held.has(instrument.indexId) &&
      instrument.leverage === 1 &&
      !isDerivative(instrument.type),
  );
  const representative = new Map<ID, ID>();
  for (const instrument of candidates)
    if (!representative.has(instrument.indexId!))
      representative.set(instrument.indexId!, instrument.id);
  const closeByInstrument = new Map<ID, Map<ISODate, number>>();
  for (const [indexId, instrumentId] of representative) {
    const map = new Map<ISODate, number>();
    data.priceHistory
      .filter((point) => point.instrumentId === instrumentId)
      .forEach((point) => map.set(point.date, point.adjClose ?? point.close));
    closeByInstrument.set(indexId, map);
  }
  const series = new Map<ID, Map<ISODate, number>>();
  for (const [indexId, closes] of closeByInstrument) {
    const returns = new Map<ISODate, number>();
    const dates = [...closes.keys()].sort();
    for (let i = 1; i < dates.length; i += 1) {
      const prior = closes.get(dates[i - 1])!;
      const current = closes.get(dates[i])!;
      if (prior > 0 && current > 0) returns.set(dates[i], current / prior - 1);
    }
    series.set(indexId, returns);
  }
  const ids = [...representative.keys()];
  const rows = ids.map((indexId) => {
    const correlations: Record<ID, number | undefined> = {};
    for (const otherId of ids) {
      const left = series.get(indexId)!;
      const right = series.get(otherId)!;
      const dates = [...left.keys()].filter((date) => right.has(date));
      correlations[otherId] = pearson(
        dates.map((date) => left.get(date)!),
        dates.map((date) => right.get(date)!),
      );
    }
    return {
      indexId,
      instrumentId: representative.get(indexId)!,
      observations: series.get(indexId)?.size ?? 0,
      correlations,
    };
  });
  let denominator = 0;
  let complete = rows.length > 0;
  for (const row of rows)
    for (const id of ids) {
      const correlation = row.correlations[id];
      if (correlation === undefined) complete = false;
      else denominator += correlation;
    }
  return {
    rows,
    effectiveIndependentBets:
      complete && denominator > 0 ? (ids.length * ids.length) / denominator : undefined,
    formula: '等權近似：n² ÷ Σᵢⱼρᵢⱼ；未滿 5 個共同日報酬或分母非正時不顯示。',
  };
}

/** Convenience helper for UI callers using the standard total-portfolio flows. */
export function historyFlows(data: AppData, from: ISODate, to: ISODate) {
  return externalFlows(data, 'total', from, to);
}
