import { FxTable } from './fx';
import {
  CORE_BUCKET,
  getSettings,
  isDerivative,
  type AppData,
  type Currency,
  type ID,
  type ISODate,
  type Instrument,
  type Transaction,
} from './types';

const EPS = 1e-9;

export interface Lot {
  date: ISODate;
  /** Signed remaining quantity: negative for a short lot. */
  quantity: number;
  price: number;
}

export interface Position {
  key: string;
  accountId: ID;
  instrumentId: ID;
  bucket: ID;
  /** Signed: negative when short. */
  quantity: number;
  /** Quantity-weighted open price of the remaining lots. */
  avgCost: number;
  lots: Lot[];
  /** In the instrument currency, before fees. */
  realizedPnl: number;
  dividends: number;
  fees: number;
}

export interface CashBalance {
  accountId: ID;
  currency: Currency;
  amount: number;
}

export interface BucketCash {
  bucket: ID;
  currency: Currency;
  amount: number;
}

export interface LoanState {
  loanId: ID;
  currency: Currency;
  drawn: number;
  principalRepaid: number;
  balance: number;
  interestPaid: number;
  /** Principal + interest repaid with money from outside the portfolio. */
  repaidExternally: number;
}

/** Cumulative flows in base currency, converted at each transaction's rate. */
export interface LedgerTotals {
  /** Net external money put in, including external repayment of loans. */
  contributedCapital: number;
  realizedPnl: number;
  dividends: number;
  /** Trading fees, taxes and standalone fee transactions. */
  fees: number;
  /** Loan interest, margin interest and net funding fees paid. */
  fundingCost: number;
  adjustments: number;
}

export interface Ledger {
  asOf?: ISODate;
  positions: Position[];
  cash: CashBalance[];
  bucketCash: BucketCash[];
  loans: LoanState[];
  totals: LedgerTotals;
  warnings: string[];
}

export interface LedgerOptions {
  /** Ignore transactions dated after this day. */
  asOf?: ISODate;
}

/**
 * Replay the transaction log into positions, cash, loan balances and
 * cumulative flows. Pure: the same data always gives the same ledger.
 */
export function buildLedger(data: AppData, options: LedgerOptions = {}): Ledger {
  const base = getSettings(data).baseCurrency;
  const fx = new FxTable(data.fxRates);
  const instruments = new Map(data.instruments.map((i) => [i.id, i]));
  const loanCurrency = new Map(data.loans.map((l) => [l.id, l.currency]));

  const positions = new Map<string, Position>();
  const cash = new Map<string, CashBalance>();
  const bucketCash = new Map<string, BucketCash>();
  const loans = new Map<ID, LoanState>();
  const totals: LedgerTotals = {
    contributedCapital: 0,
    realizedPnl: 0,
    dividends: 0,
    fees: 0,
    fundingCost: 0,
    adjustments: 0,
  };
  const warnings: string[] = [];

  const toBase = (amount: number, currency: Currency, tx: Transaction): number => {
    if (amount === 0 || currency === base) return amount;
    const rate = currency === tx.currency && tx.fxRate ? tx.fxRate : fx.rate(currency, base);
    if (rate === undefined) {
      warnings.push(`交易 ${tx.id}（${tx.date}）缺少 ${currency}/${base} 匯率，未計入累計金額`);
      return 0;
    }
    return amount * rate;
  };

  const moveCash = (accountId: ID, currency: Currency, bucket: ID, delta: number) => {
    if (delta === 0) return;
    const ck = `${accountId}|${currency}`;
    const c = cash.get(ck) ?? { accountId, currency, amount: 0 };
    c.amount += delta;
    cash.set(ck, c);
    const bk = `${bucket}|${currency}`;
    const b = bucketCash.get(bk) ?? { bucket, currency, amount: 0 };
    b.amount += delta;
    bucketCash.set(bk, b);
  };

  const loanState = (loanId: ID, currency: Currency): LoanState => {
    let s = loans.get(loanId);
    if (!s) {
      s = {
        loanId,
        currency: loanCurrency.get(loanId) ?? currency,
        drawn: 0,
        principalRepaid: 0,
        balance: 0,
        interestPaid: 0,
        repaidExternally: 0,
      };
      loans.set(loanId, s);
    }
    return s;
  };

  const position = (tx: Transaction, instrumentId: ID): Position => {
    const key = `${tx.accountId}|${instrumentId}|${tx.bucket}`;
    let p = positions.get(key);
    if (!p) {
      p = {
        key,
        accountId: tx.accountId,
        instrumentId,
        bucket: tx.bucket,
        quantity: 0,
        avgCost: 0,
        lots: [],
        realizedPnl: 0,
        dividends: 0,
        fees: 0,
      };
      positions.set(key, p);
    }
    return p;
  };

  const txs = data.transactions
    .map((tx, i) => ({ tx, i }))
    .filter(({ tx }) => !options.asOf || tx.date <= options.asOf)
    .sort((a, b) => (a.tx.date < b.tx.date ? -1 : a.tx.date > b.tx.date ? 1 : a.i - b.i))
    .map(({ tx }) => tx);

  for (const tx of txs) {
    const bucket = tx.bucket || CORE_BUCKET;
    const costs = (tx.fee ?? 0) + (tx.tax ?? 0);

    switch (tx.type) {
      case 'buy':
      case 'sell': {
        const inst = tx.instrumentId ? instruments.get(tx.instrumentId) : undefined;
        if (!inst || !tx.quantity || tx.price === undefined) {
          warnings.push(`交易 ${tx.id}（${tx.date}）缺少商品、數量或價格，已略過`);
          break;
        }
        const signedQty = tx.type === 'buy' ? tx.quantity : -tx.quantity;
        const pos = position(tx, inst.id);
        const realized = applyTrade(pos, inst, signedQty, tx.price, tx.date);
        pos.realizedPnl += realized;
        pos.fees += costs;
        // Securities exchange cash for the asset; derivatives only settle P&L.
        const cashDelta = isDerivative(inst.type)
          ? realized
          : -signedQty * tx.price * inst.multiplier;
        moveCash(tx.accountId, inst.currency, bucket, cashDelta - costs);
        totals.realizedPnl += toBase(realized, inst.currency, tx);
        totals.fees += toBase(costs, inst.currency, tx);
        break;
      }
      case 'deposit':
        moveCash(tx.accountId, tx.currency, bucket, tx.amount);
        totals.contributedCapital += toBase(tx.amount, tx.currency, tx);
        break;
      case 'withdraw':
        moveCash(tx.accountId, tx.currency, bucket, -tx.amount);
        totals.contributedCapital -= toBase(tx.amount, tx.currency, tx);
        break;
      case 'transfer': {
        const toCurrency = tx.toCurrency ?? tx.currency;
        const toAmount = tx.toAmount ?? tx.amount;
        moveCash(tx.accountId, tx.currency, bucket, -tx.amount - costs);
        moveCash(tx.toAccountId ?? tx.accountId, toCurrency, tx.toBucket ?? bucket, toAmount);
        totals.fees += toBase(costs, tx.currency, tx);
        break;
      }
      case 'dividend':
        moveCash(tx.accountId, tx.currency, bucket, tx.amount - costs);
        if (tx.instrumentId && instruments.has(tx.instrumentId)) {
          position(tx, tx.instrumentId).dividends += tx.amount;
        }
        totals.dividends += toBase(tx.amount, tx.currency, tx);
        totals.fees += toBase(costs, tx.currency, tx);
        break;
      case 'fee':
        moveCash(tx.accountId, tx.currency, bucket, -tx.amount);
        totals.fees += toBase(tx.amount, tx.currency, tx);
        break;
      case 'interest':
      case 'funding_fee':
        moveCash(tx.accountId, tx.currency, bucket, -tx.amount);
        totals.fundingCost += toBase(tx.amount, tx.currency, tx);
        break;
      case 'adjust':
        moveCash(tx.accountId, tx.currency, bucket, tx.amount);
        totals.adjustments += toBase(tx.amount, tx.currency, tx);
        break;
      case 'loan_draw': {
        if (!tx.loanId) {
          warnings.push(`交易 ${tx.id}（${tx.date}）未指定貸款，已略過`);
          break;
        }
        const s = loanState(tx.loanId, tx.currency);
        s.drawn += tx.amount;
        s.balance += tx.amount;
        moveCash(tx.accountId, tx.currency, bucket, tx.amount - costs);
        totals.fees += toBase(costs, tx.currency, tx);
        break;
      }
      case 'loan_repay': {
        if (!tx.loanId) {
          warnings.push(`交易 ${tx.id}（${tx.date}）未指定貸款，已略過`);
          break;
        }
        const interest = tx.interest ?? 0;
        const principal = tx.principal ?? tx.amount - interest;
        const paid = principal + interest + costs;
        const s = loanState(tx.loanId, tx.currency);
        s.principalRepaid += principal;
        s.balance -= principal;
        s.interestPaid += interest;
        if (tx.source === 'external') {
          // Outside money pays the lender directly: no portfolio cash moves,
          // the whole payment counts as contributed capital.
          s.repaidExternally += principal + interest;
          totals.contributedCapital += toBase(paid, tx.currency, tx);
        } else {
          moveCash(tx.accountId, tx.currency, bucket, -paid);
        }
        totals.fundingCost += toBase(interest, tx.currency, tx);
        totals.fees += toBase(costs, tx.currency, tx);
        break;
      }
    }
  }

  return {
    asOf: options.asOf,
    positions: [...positions.values()].filter(
      (p) => Math.abs(p.quantity) > EPS || p.realizedPnl !== 0 || p.dividends !== 0,
    ),
    cash: [...cash.values()].filter((c) => Math.abs(c.amount) > EPS),
    bucketCash: [...bucketCash.values()].filter((c) => Math.abs(c.amount) > EPS),
    loans: [...loans.values()],
    totals,
    warnings,
  };
}

/** FIFO-match a trade against open lots. Returns realized P&L before fees. */
function applyTrade(
  pos: Position,
  inst: Instrument,
  signedQty: number,
  price: number,
  date: ISODate,
): number {
  let remaining = signedQty;
  let realized = 0;
  while (Math.abs(remaining) > EPS && pos.lots.length) {
    const lot = pos.lots[0];
    if (Math.sign(lot.quantity) === Math.sign(remaining)) break;
    const matched = Math.min(Math.abs(lot.quantity), Math.abs(remaining));
    const side = Math.sign(lot.quantity);
    realized += (price - lot.price) * matched * side * inst.multiplier;
    lot.quantity -= side * matched;
    remaining += side * matched;
    if (Math.abs(lot.quantity) <= EPS) pos.lots.shift();
  }
  if (Math.abs(remaining) > EPS) pos.lots.push({ date, quantity: remaining, price });

  pos.quantity = pos.lots.reduce((s, l) => s + l.quantity, 0);
  if (Math.abs(pos.quantity) <= EPS) pos.quantity = 0;
  pos.avgCost =
    pos.quantity === 0
      ? 0
      : pos.lots.reduce((s, l) => s + l.quantity * l.price, 0) / pos.quantity;
  return realized;
}
