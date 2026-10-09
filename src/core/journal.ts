import { daysBetween } from './dates';
import { FxTable } from './fx';
import { transferLots } from './positionTransfer';
import {
  CORE_BUCKET,
  getSettings,
  isDerivative,
  type AppData,
  type Currency,
  type ID,
  type ISODate,
  type Transaction,
  type TradeGroup,
} from './types';

const EPS = 1e-9;

/**
 * Converter from a transaction amount to the base currency, mirroring the
 * ledger: the transaction's own fxRate when the amount is in its currency,
 * otherwise the current FX table. Unconvertible amounts count as 0 and add a
 * warning.
 */
export function makeBaseConverter(data: AppData, warnings: string[] = []) {
  const base = getSettings(data).baseCurrency;
  const fx = new FxTable(data.fxRates);
  return (amount: number, currency: Currency, tx: Transaction): number => {
    if (amount === 0 || currency === base) return amount;
    const rate = currency === tx.currency && tx.fxRate ? tx.fxRate : fx.rate(currency, base);
    if (rate === undefined) {
      warnings.push(`交易 ${tx.id}（${tx.date}）缺少 ${currency}/${base} 匯率，未計入`);
      return 0;
    }
    return amount * rate;
  };
}

/** Same order the ledger replays in: by date, then by position in the table. */
export function sortedTransactions(data: AppData): Transaction[] {
  return data.transactions
    .map((tx, i) => ({ tx, i }))
    .sort((a, b) => (a.tx.date < b.tx.date ? -1 : a.tx.date > b.tx.date ? 1 : a.i - b.i))
    .map(({ tx }) => tx);
}

export type TradeSide = 'buy' | 'sell';

/** One buy or sell with its FIFO outcome. Money is in the instrument currency unless named Base. */
export interface JournalEntry {
  txId: ID;
  /** Bucket the trade belongs to: a strategy id, or `core`. */
  strategyId: ID;
  accountId: ID;
  instrumentId: ID;
  side: TradeSide;
  date: ISODate;
  price: number;
  quantity: number;
  currency: Currency;
  fee: number;
  tax: number;
  /** fee + tax. */
  costs: number;
  costsBase: number;
  /** FIFO realized P&L of this trade before costs (same number the ledger books). */
  realizedPnl: number;
  realizedPnlBase: number;
  /** Quantity of this trade still open (not yet matched by a later trade). */
  openQuantity: number;
  reason?: string;
  tags: string[];
  note?: string;
  tradeGroupId?: ID;
  rotationCycleId?: ID;
}

/** One entry lot matched against one exit trade. */
export interface RoundTrip {
  /** `${entryTxId}>${exitTxId}` */
  id: string;
  strategyId: ID;
  accountId: ID;
  instrumentId: ID;
  currency: Currency;
  direction: 'long' | 'short';
  entryTxId: ID;
  exitTxId: ID;
  entryDate: ISODate;
  exitDate: ISODate;
  entryPrice: number;
  exitPrice: number;
  /** Matched size (positive). */
  quantity: number;
  holdingDays: number;
  /** Before costs, instrument currency. */
  grossPnl: number;
  /** Pro-rata share of the entry and exit trade costs. */
  costs: number;
  /** After costs. */
  netPnl: number;
  grossPnlBase: number;
  costsBase: number;
  netPnlBase: number;
  /**
   * Net P&L / entry notional. Undefined for futures and perpetuals: their
   * notional is not capital, so no percentage is invented from it.
   */
  returnPct?: number;
  tradeGroupId?: ID;
  rotationCycleId?: ID;
  tags: string[];
}

interface OpenLot {
  txId: ID;
  date: ISODate;
  quantity: number;
  price: number;
  /** Total trade cost of the originating transaction and its size, for pro-rata. */
  txCosts: number;
  txCostsBase: number;
  txQuantity: number;
  tx: Transaction;
}

export interface TradeReplay {
  entries: JournalEntry[];
  roundTrips: RoundTrip[];
  warnings: string[];
}

/**
 * Replay every buy / sell FIFO per account|instrument|bucket, exactly as the
 * ledger does, and keep what the ledger throws away: per-trade realized P&L
 * and which entry lots each exit closed.
 */
export function replayTrades(data: AppData): TradeReplay {
  const warnings: string[] = [];
  const toBase = makeBaseConverter(data, warnings);
  const instruments = new Map(data.instruments.map((i) => [i.id, i]));
  const lotsByKey = new Map<string, OpenLot[]>();
  const entryByTx = new Map<ID, JournalEntry>();
  const entries: JournalEntry[] = [];
  const roundTrips: RoundTrip[] = [];

  for (const tx of sortedTransactions(data)) {
    if (tx.type === 'position_transfer') {
      const inst = instruments.get(tx.instrumentId ?? '');
      const bucket = tx.bucket || CORE_BUCKET;
      const key = `${tx.accountId}|${tx.instrumentId}|${bucket}`;
      const toKey = `${tx.toAccountId}|${tx.instrumentId}|${bucket}`;
      const from = lotsByKey.get(key) ?? [];
      const to = lotsByKey.get(toKey) ?? [];
      if (
        !inst ||
        isDerivative(inst.type) ||
        inst.type === 'option' ||
        !tx.toAccountId ||
        !data.accounts.some((a) => a.id === tx.toAccountId) ||
        key === toKey ||
        (tx.toBucket && tx.toBucket !== bucket) ||
        tx.amount !== 0 ||
        (tx.fee ?? 0) + (tx.tax ?? 0) !== 0 ||
        !transferLots(from, to, tx.quantity ?? 0)
      ) {
        warnings.push(`交易 ${tx.id} 的證券移轉設定或持倉不正確，已略過`);
      } else {
        lotsByKey.set(key, from);
        lotsByKey.set(toKey, to);
      }
      continue;
    }
    if (tx.type !== 'buy' && tx.type !== 'sell') continue;
    const inst = tx.instrumentId ? instruments.get(tx.instrumentId) : undefined;
    if (!inst || !tx.quantity || tx.price === undefined) continue; // the ledger warns about these
    const bucket = tx.bucket || CORE_BUCKET;
    const key = `${tx.accountId}|${inst.id}|${bucket}`;
    const lots = lotsByKey.get(key) ?? [];
    lotsByKey.set(key, lots);

    const costs = (tx.fee ?? 0) + (tx.tax ?? 0);
    const costsBase = toBase(costs, inst.currency, tx);
    const signedQty = tx.type === 'buy' ? tx.quantity : -tx.quantity;
    let remaining = signedQty;
    let realized = 0;
    let realizedBase = 0;

    while (Math.abs(remaining) > EPS && lots.length) {
      const lot = lots[0];
      if (Math.sign(lot.quantity) === Math.sign(remaining)) break;
      const matched = Math.min(Math.abs(lot.quantity), Math.abs(remaining));
      const side = Math.sign(lot.quantity);
      const gross = (tx.price - lot.price) * matched * side * inst.multiplier;
      const grossBase = toBase(gross, inst.currency, tx);
      const costShare = (lot.txCosts * matched) / lot.txQuantity + (costs * matched) / tx.quantity;
      const costShareBase =
        (lot.txCostsBase * matched) / lot.txQuantity + (costsBase * matched) / tx.quantity;
      const entryNotional = lot.price * matched * inst.multiplier;
      const entryEntry = entryByTx.get(lot.txId);
      if (entryEntry) entryEntry.openQuantity -= matched;
      roundTrips.push({
        id: `${lot.txId}>${tx.id}`,
        strategyId: bucket,
        accountId: tx.accountId,
        instrumentId: inst.id,
        currency: inst.currency,
        direction: side > 0 ? 'long' : 'short',
        entryTxId: lot.txId,
        exitTxId: tx.id,
        entryDate: lot.date,
        exitDate: tx.date,
        entryPrice: lot.price,
        exitPrice: tx.price,
        quantity: matched,
        holdingDays: daysBetween(lot.date, tx.date),
        grossPnl: gross,
        costs: costShare,
        netPnl: gross - costShare,
        grossPnlBase: grossBase,
        costsBase: costShareBase,
        netPnlBase: grossBase - costShareBase,
        returnPct:
          isDerivative(inst.type) || entryNotional === 0
            ? undefined
            : (gross - costShare) / entryNotional,
        tradeGroupId: tx.tradeGroupId ?? lot.tx.tradeGroupId,
        rotationCycleId: tx.rotationCycleId ?? lot.tx.rotationCycleId,
        tags: [...new Set([...(lot.tx.tags ?? []), ...(tx.tags ?? [])])],
      });
      realized += gross;
      realizedBase += grossBase;
      lot.quantity -= side * matched;
      remaining += side * matched;
      if (Math.abs(lot.quantity) <= EPS) lots.shift();
    }
    const openQuantity = Math.abs(remaining) > EPS ? Math.abs(remaining) : 0;
    if (openQuantity > 0) {
      lots.push({
        txId: tx.id,
        date: tx.date,
        quantity: remaining,
        price: tx.price,
        txCosts: costs,
        txCostsBase: costsBase,
        txQuantity: tx.quantity,
        tx,
      });
    }

    const entry: JournalEntry = {
      txId: tx.id,
      strategyId: bucket,
      accountId: tx.accountId,
      instrumentId: inst.id,
      side: tx.type,
      date: tx.date,
      price: tx.price,
      quantity: tx.quantity,
      currency: inst.currency,
      fee: tx.fee ?? 0,
      tax: tx.tax ?? 0,
      costs,
      costsBase,
      realizedPnl: realized,
      realizedPnlBase: realizedBase,
      openQuantity,
      reason: tx.reason,
      tags: tx.tags ?? [],
      note: tx.note,
      tradeGroupId: tx.tradeGroupId,
      rotationCycleId: tx.rotationCycleId,
    };
    entries.push(entry);
    entryByTx.set(tx.id, entry);
  }
  return { entries, roundTrips, warnings };
}

export interface JournalFilter {
  /** Bucket id (a strategy, or `core`). Omitted = every strategy bucket. */
  strategyId?: ID;
  /** Also include the core bucket when no strategyId is given. */
  includeCore?: boolean;
  instrumentId?: ID;
  from?: ISODate;
  to?: ISODate;
  tag?: string;
  tradeGroupId?: ID;
  rotationCycleId?: ID;
}

function bucketMatches(bucket: ID, f: JournalFilter): boolean {
  if (f.strategyId) return bucket === f.strategyId;
  return f.includeCore ? true : bucket !== CORE_BUCKET;
}

/** Journal view of trades in strategy buckets, newest first. */
export function journalEntries(data: AppData, filter: JournalFilter = {}): JournalEntry[] {
  return replayTrades(data)
    .entries.filter(
      (e) =>
        bucketMatches(e.strategyId, filter) &&
        (!filter.instrumentId || e.instrumentId === filter.instrumentId) &&
        (!filter.from || e.date >= filter.from) &&
        (!filter.to || e.date <= filter.to) &&
        (!filter.tag || e.tags.includes(filter.tag)) &&
        (!filter.tradeGroupId || e.tradeGroupId === filter.tradeGroupId) &&
        (!filter.rotationCycleId || e.rotationCycleId === filter.rotationCycleId),
    )
    .reverse();
}

/** Closed round trips, oldest exit first, filtered like the journal. */
export function roundTrips(data: AppData, filter: JournalFilter = {}): RoundTrip[] {
  return replayTrades(data)
    .roundTrips.filter(
      (r) =>
        bucketMatches(r.strategyId, filter) &&
        (!filter.instrumentId || r.instrumentId === filter.instrumentId) &&
        (!filter.from || r.exitDate >= filter.from) &&
        (!filter.to || r.exitDate <= filter.to) &&
        (!filter.tag || r.tags.includes(filter.tag)) &&
        (!filter.tradeGroupId || r.tradeGroupId === filter.tradeGroupId) &&
        (!filter.rotationCycleId || r.rotationCycleId === filter.rotationCycleId),
    )
    .sort((a, b) => (a.exitDate < b.exitDate ? -1 : a.exitDate > b.exitDate ? 1 : 0));
}

export interface TradeGroupSummary {
  group?: TradeGroup;
  groupId: ID;
  legs: JournalEntry[];
  /** Realized P&L of the legs before costs, base currency. */
  realizedPnlBase: number;
  costsBase: number;
  /** Realized P&L after the costs of every leg. */
  netPnlBase: number;
  /** Stored status of the group. */
  status: 'open' | 'closed';
  /** True when no leg has quantity left open. */
  fullyClosed: boolean;
  firstDate?: ISODate;
  lastDate?: ISODate;
}

/** Multi-leg unit: all trades that share a trade group id. */
export function tradeGroupSummary(
  data: AppData,
  groupId: ID,
  replay?: TradeReplay,
): TradeGroupSummary {
  const legs = (replay ?? replayTrades(data)).entries.filter((e) => e.tradeGroupId === groupId);
  const group = data.tradeGroups.find((g) => g.id === groupId);
  const realizedPnlBase = legs.reduce((s, l) => s + l.realizedPnlBase, 0);
  const costsBase = legs.reduce((s, l) => s + l.costsBase, 0);
  const dates = legs.map((l) => l.date).sort();
  return {
    group,
    groupId,
    legs,
    realizedPnlBase,
    costsBase,
    netPnlBase: realizedPnlBase - costsBase,
    status: group?.status ?? 'open',
    fullyClosed: legs.length > 0 && legs.every((l) => l.openQuantity <= EPS),
    firstDate: dates[0],
    lastDate: dates[dates.length - 1],
  };
}

export interface TradeStats {
  count: number;
  wins: number;
  losses: number;
  /** wins / count. */
  winRate?: number;
  /** Mean net P&L of winning trades. */
  averageWin?: number;
  /** Mean net P&L of losing trades (a negative number). */
  averageLoss?: number;
  /** Gross profit / gross loss. Undefined with no losing trade (no finite value). */
  profitFactor?: number;
  /** Mean net P&L per trade. */
  expectancy?: number;
  totalNetPnl: number;
  totalCosts: number;
  averageHoldingDays?: number;
  largestWin?: number;
  largestLoss?: number;
  /** Largest peak-to-trough fall of cumulative closed-trade P&L (a positive amount). */
  maxDrawdown: number;
}

/**
 * Statistics over closed round trips, in base currency and after costs.
 * Ratios with no meaning (no trades, no losses) are undefined, never Infinity.
 */
export function tradeStats(trips: RoundTrip[]): TradeStats {
  const count = trips.length;
  const ordered = [...trips].sort((a, b) =>
    a.exitDate < b.exitDate ? -1 : a.exitDate > b.exitDate ? 1 : 0,
  );
  const winners = trips.filter((t) => t.netPnlBase > 0);
  const losers = trips.filter((t) => t.netPnlBase < 0);
  const grossWin = winners.reduce((s, t) => s + t.netPnlBase, 0);
  const grossLoss = losers.reduce((s, t) => s + t.netPnlBase, 0);
  const totalNetPnl = grossWin + grossLoss;

  let cum = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const t of ordered) {
    cum += t.netPnlBase;
    peak = Math.max(peak, cum);
    maxDrawdown = Math.max(maxDrawdown, peak - cum);
  }

  return {
    count,
    wins: winners.length,
    losses: losers.length,
    winRate: count ? winners.length / count : undefined,
    averageWin: winners.length ? grossWin / winners.length : undefined,
    averageLoss: losers.length ? grossLoss / losers.length : undefined,
    profitFactor: losers.length ? grossWin / -grossLoss : undefined,
    expectancy: count ? totalNetPnl / count : undefined,
    totalNetPnl,
    totalCosts: trips.reduce((s, t) => s + t.costsBase, 0),
    averageHoldingDays: count ? trips.reduce((s, t) => s + t.holdingDays, 0) / count : undefined,
    largestWin: winners.length ? Math.max(...winners.map((t) => t.netPnlBase)) : undefined,
    largestLoss: losers.length ? Math.min(...losers.map((t) => t.netPnlBase)) : undefined,
    maxDrawdown,
  };
}
