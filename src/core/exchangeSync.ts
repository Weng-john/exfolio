import type { ExchangeSnapshot, ExchangeTrade } from './api';
import type { Portfolio } from './valuation';
import {
  CORE_BUCKET,
  isDerivative,
  type AppData,
  type ID,
  type Instrument,
  type Transaction,
} from './types';

// Comparing what an exchange reports with what the ledger says, and turning
// exchange fills into transactions. Nothing here talks to an exchange.

export interface BalanceCheck {
  asset: string;
  /** Spot and derivatives wallets together. */
  exchange: number;
  /** Cash in that currency plus spot holdings of that asset in the account. */
  ledger: number;
  difference: number;
  matches: boolean;
}

export interface PositionCheck {
  symbol: string;
  instrumentId?: ID;
  exchange: number;
  ledger: number;
  difference: number;
  matches: boolean;
}

export interface Reconciliation {
  balances: BalanceCheck[];
  positions: PositionCheck[];
  /** True when every balance and position agrees. */
  clean: boolean;
}

const near = (a: number, b: number) =>
  Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(a), Math.abs(b));

/** Spot instrument for an asset, e.g. BTC. */
function isSpotOf(instrument: Instrument, asset: string): boolean {
  return instrument.type === 'crypto' && instrument.symbol.toUpperCase() === asset;
}

/**
 * Line the exchange's balances and open positions up against one ledger
 * account. A difference means the ledger is missing something (a deposit,
 * a trade, a fee, a funding payment) or has something extra.
 */
export function reconcile(
  data: AppData,
  portfolio: Portfolio,
  accountId: ID,
  snapshot: ExchangeSnapshot,
): Reconciliation {
  const instruments = new Map(data.instruments.map((i) => [i.id, i]));
  const exchange = new Map<string, number>();
  for (const b of [...snapshot.balances, ...snapshot.futuresBalances]) {
    exchange.set(b.asset, (exchange.get(b.asset) ?? 0) + b.free + b.locked);
  }

  const ledger = new Map<string, number>();
  const add = (asset: string, amount: number) =>
    ledger.set(asset, (ledger.get(asset) ?? 0) + amount);
  for (const c of portfolio.ledger.cash) {
    if (c.accountId === accountId) add(c.currency.toUpperCase(), c.amount);
  }
  const derivatives = new Map<string, { instrumentId: ID; quantity: number }>();
  for (const p of portfolio.ledger.positions) {
    if (p.accountId !== accountId || p.quantity === 0) continue;
    const instrument = instruments.get(p.instrumentId);
    if (!instrument) continue;
    if (isDerivative(instrument.type)) {
      const symbol = (instrument.quoteSymbol ?? instrument.symbol).toUpperCase();
      const row = derivatives.get(symbol) ?? { instrumentId: instrument.id, quantity: 0 };
      row.quantity += p.quantity;
      derivatives.set(symbol, row);
    } else if (instrument.type === 'crypto') {
      add(instrument.symbol.toUpperCase(), p.quantity);
    }
  }

  const balances: BalanceCheck[] = [...new Set([...exchange.keys(), ...ledger.keys()])]
    .sort()
    .map((asset) => {
      const e = exchange.get(asset) ?? 0;
      const l = ledger.get(asset) ?? 0;
      return { asset, exchange: e, ledger: l, difference: e - l, matches: near(e, l) };
    });

  const reported = new Map(snapshot.positions.map((p) => [p.symbol.toUpperCase(), p.quantity]));
  const positions: PositionCheck[] = [...new Set([...reported.keys(), ...derivatives.keys()])]
    .sort()
    .map((symbol) => {
      const e = reported.get(symbol) ?? 0;
      const l = derivatives.get(symbol)?.quantity ?? 0;
      return {
        symbol,
        instrumentId:
          derivatives.get(symbol)?.instrumentId ??
          data.instruments.find(
            (i) => isDerivative(i.type) && (i.quoteSymbol ?? '').toUpperCase() === symbol,
          )?.id,
        exchange: e,
        ledger: l,
        difference: e - l,
        matches: near(e, l),
      };
    });

  return {
    balances,
    positions,
    clean: balances.every((b) => b.matches) && positions.every((p) => p.matches),
  };
}

export interface TradeImport {
  transactions: Transaction[];
  /** Fills already in the ledger, recognised by their exchange id. */
  duplicates: number;
  /** Symbols with no matching instrument: add the instrument, then retry. */
  unmatched: string[];
  warnings: string[];
}

/**
 * Turn exchange fills into ledger transactions. Each keeps the exchange's
 * own id, so importing an overlapping range twice adds nothing.
 */
export function tradesToTransactions(
  data: AppData,
  trades: ExchangeTrade[],
  target: { accountId: ID; bucket?: ID },
): TradeImport {
  const existing = new Set(data.transactions.map((t) => t.id));
  const transactions: Transaction[] = [];
  const unmatched = new Set<string>();
  const warnings: string[] = [];
  let duplicates = 0;

  for (const trade of [...trades].sort((a, b) => (a.time < b.time ? -1 : 1))) {
    if (existing.has(trade.id)) {
      duplicates += 1;
      continue;
    }
    const symbol = trade.symbol.toUpperCase();
    const instrument = data.instruments.find(
      (i) =>
        (i.quoteSymbol ?? '').toUpperCase() === symbol &&
        (trade.market === 'futures' ? isDerivative(i.type) : i.type === 'crypto'),
    );
    if (!instrument) {
      unmatched.add(symbol);
      continue;
    }

    let quantity = trade.quantity;
    let fee = 0;
    const feeAsset = trade.feeAsset.toUpperCase();
    if (trade.fee > 0) {
      if (feeAsset === instrument.currency.toUpperCase()) {
        fee = trade.fee;
      } else if (trade.market === 'spot' && isSpotOf(instrument, feeAsset)) {
        // The fee came out of the coins themselves: fewer arrive on a buy,
        // more leave on a sell. Booked as its value so cash still matches.
        quantity = trade.side === 'buy' ? quantity - trade.fee : quantity + trade.fee;
        fee = trade.fee * trade.price;
      } else {
        warnings.push(
          `${trade.time.slice(0, 10)} ${symbol}：手續費以 ${trade.feeAsset} 支付（${trade.fee}），未計入這筆交易，請另行記錄。`,
        );
      }
    }

    const tx: Transaction = {
      id: trade.id,
      date: trade.time.slice(0, 10),
      type: trade.side,
      accountId: target.accountId,
      bucket: target.bucket ?? CORE_BUCKET,
      currency: instrument.currency,
      amount: 0,
      instrumentId: instrument.id,
      quantity,
      price: trade.price,
      note: `由交易所同步匯入（${trade.market === 'futures' ? '合約' : '現貨'}）`,
    };
    if (fee > 0) tx.fee = fee;
    transactions.push(tx);
    existing.add(trade.id);
  }

  if (
    transactions.some((t) =>
      isDerivative(data.instruments.find((i) => i.id === t.instrumentId)!.type),
    )
  ) {
    warnings.push(
      '合約的已實現損益由帳本以先進先出重新計算，可能與交易所的均價法略有差異；資金費用需另行記錄。',
    );
  }
  return { transactions, duplicates, unmatched: [...unmatched].sort(), warnings };
}
