import { newId, today } from './ids';
import {
  CORE_BUCKET,
  isDerivative,
  type Account,
  type AppData,
  type Broker,
  type Currency,
  type ID,
  type Instrument,
  type ISODate,
  type Transaction,
} from './types';

// Entering a holding as it stands today, without its trade history. The
// ledger only knows transactions, so a holding becomes an opening trade
// (plus, for securities, the deposit that paid for it) dated when it was
// bought — enough for NAV, exposure, leverage and risk to be right.

export interface QuickPositionInput {
  /** Existing account, or a name for a new one. */
  accountId?: ID;
  newAccountName?: string;
  instrumentId: ID;
  /** Positive. */
  quantity: number;
  side: 'long' | 'short';
  /** Average entry price in the instrument currency. */
  averageCost: number;
  date?: ISODate;
  bucket?: ID;
  /**
   * Record the money that paid for a securities holding as an outside
   * deposit, so cash does not turn negative. Not used for futures and
   * perpetuals, whose margin is cash already in the account.
   */
  fundFromOutside: boolean;
}

export interface QuickPositionResult {
  transactions: Transaction[];
  /** Created when the data had no institution to hang a new account on. */
  broker?: Broker;
  account?: Account;
  errors: string[];
}

/** Institution used for accounts created on the fly. */
export const UNSPECIFIED_BROKER: Broker = {
  id: 'inst_unspecified',
  name: '未指定機構',
  kind: 'broker',
};

/** Positive and finite: rejects 0, negatives, NaN, Infinity and 1e309. */
function positiveFinite(n: number): boolean {
  return Number.isFinite(n) && n > 0;
}

export function quickPosition(data: AppData, input: QuickPositionInput): QuickPositionResult {
  const errors: string[] = [];
  const instrument = data.instruments.find((i) => i.id === input.instrumentId);
  if (!instrument) errors.push('請選擇商品');
  if (!positiveFinite(input.quantity)) errors.push('數量必須是大於 0 的有限數字');
  if (!positiveFinite(input.averageCost)) errors.push('均價必須是大於 0 的有限數字');
  if (instrument && input.side === 'short' && !isDerivative(instrument.type)) {
    errors.push('只有期貨與永續合約可以直接建立空單；放空股票請用交易紀錄');
  }
  let account = data.accounts.find((a) => a.id === input.accountId);
  let broker: Broker | undefined;
  let created: Account | undefined;
  if (!account) {
    const name = (input.newAccountName ?? '').trim();
    if (!name) errors.push('請選擇帳戶，或輸入新帳戶的名稱');
    else if (instrument) {
      broker = data.brokers[0] ? undefined : { ...UNSPECIFIED_BROKER };
      created = {
        id: newId('acct'),
        brokerId: data.brokers[0]?.id ?? UNSPECIFIED_BROKER.id,
        name,
        type: accountTypeFor(instrument),
        baseCurrency: instrument.currency,
        active: true,
      };
      account = created;
    }
  }
  if (errors.length || !instrument || !account) return { transactions: [], errors };
  if (!positiveFinite(input.quantity * input.averageCost * instrument.multiplier)) {
    return { transactions: [], errors: ['數量與均價太大，無法計算成本'] };
  }

  const date = input.date || today();
  const bucket = input.bucket || CORE_BUCKET;
  const note = '期初持倉（快速輸入）';
  const transactions: Transaction[] = [];
  const cost = input.quantity * input.averageCost * instrument.multiplier;
  if (input.fundFromOutside && !isDerivative(instrument.type)) {
    transactions.push({
      id: newId('tx'),
      date,
      type: 'deposit',
      accountId: account.id,
      bucket,
      currency: instrument.currency,
      amount: cost,
      note,
    });
  }
  transactions.push({
    id: newId('tx'),
    date,
    type: input.side === 'long' ? 'buy' : 'sell',
    accountId: account.id,
    bucket,
    currency: instrument.currency,
    amount: 0,
    instrumentId: instrument.id,
    quantity: input.quantity,
    price: input.averageCost,
    note,
  });
  return { transactions, broker, account: created, errors };
}

function accountTypeFor(instrument: Instrument): Account['type'] {
  if (instrument.type === 'future') return 'futures';
  if (instrument.type === 'crypto' || instrument.type === 'perpetual') return 'crypto';
  return 'securities';
}

export interface CustomInstrumentInput {
  symbol: string;
  name: string;
  type: Instrument['type'];
  indexId?: ID;
  leverage: number;
  multiplier: number;
  currency: Currency;
  exchange?: string;
  quoteSource: Instrument['quoteSource'];
  quoteSymbol?: string;
}

/** A user-defined instrument, checked for the mistakes that would skew exposure. */
export function customInstrument(
  data: AppData,
  input: CustomInstrumentInput,
): { instrument?: Instrument; errors: string[] } {
  const errors: string[] = [];
  const symbol = input.symbol.trim();
  const currency = input.currency.trim().toUpperCase();
  if (!symbol) errors.push('代號為必填');
  if (!input.name.trim()) errors.push('名稱為必填');
  if (!/^[A-Z]{3,5}$/.test(currency)) errors.push('幣別請用代碼，例如 USD、TWD、USDT');
  if (!Number.isFinite(input.leverage) || input.leverage === 0) {
    errors.push('槓桿倍數不可為 0；反向商品請填負數，例如 -1、-2');
  }
  if (!positiveFinite(input.multiplier)) errors.push('契約乘數必須大於 0（股票與 ETF 填 1）');
  if (input.indexId && !data.indices.some((i) => i.id === input.indexId)) {
    errors.push('找不到這個標的指數');
  }
  if (input.quoteSource !== 'manual' && !input.quoteSymbol?.trim()) {
    errors.push('自動報價需要報價代號');
  }
  if (errors.length) return { errors };
  const derivative = input.type === 'future' || input.type === 'perpetual';
  return {
    errors,
    instrument: {
      id: newId('inst'),
      symbol,
      name: input.name.trim(),
      type: input.type,
      exchange: input.exchange?.trim() || '自訂',
      currency,
      ...(input.indexId ? { indexId: input.indexId } : {}),
      leverage: input.leverage,
      multiplier: input.multiplier,
      lotSize: derivative || input.type === 'crypto' ? 0.0001 : 1,
      quoteSource: input.quoteSource,
      ...(input.quoteSource !== 'manual' ? { quoteSymbol: input.quoteSymbol!.trim() } : {}),
      ...(derivative ? { settlement: 'cash' as const } : {}),
      active: true,
    },
  };
}

/** Catalogue search: symbol, name, index name or quote symbol, best matches first. */
export function searchInstruments(data: AppData, query: string, limit = 30): Instrument[] {
  const q = query.trim().toLowerCase();
  const indexName = new Map(data.indices.map((i) => [i.id, i.name.toLowerCase()]));
  const active = data.instruments.filter((i) => i.active);
  if (!q) return active.slice(0, limit);
  const score = (i: Instrument): number => {
    const symbol = i.symbol.toLowerCase();
    if (symbol === q) return 0;
    if (symbol.startsWith(q)) return 1;
    if ((i.quoteSymbol ?? '').toLowerCase().startsWith(q)) return 2;
    if (i.name.toLowerCase().includes(q)) return 3;
    if ((indexName.get(i.indexId ?? '') ?? '').includes(q)) return 4;
    return 9;
  };
  return active
    .map((i) => ({ i, s: score(i) }))
    .filter((x) => x.s < 9)
    .sort((a, b) => a.s - b.s || a.i.symbol.localeCompare(b.i.symbol))
    .slice(0, limit)
    .map((x) => x.i);
}
