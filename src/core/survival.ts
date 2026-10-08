import { FxTable } from './fx';
import { addMonths, amortizationSchedule, loanStatus } from './loans';
import { scaleFxRates } from './stress';
import { UNCLASSIFIED_INDEX, type Portfolio } from './valuation';
import {
  CORE_BUCKET,
  isDerivative,
  type AppData,
  type CashflowItem,
  type Currency,
  type ID,
  type ISODate,
  type Loan,
} from './types';

// Cash Flow Survival Simulation: day by day from `today`, does the portfolio
// have the cash to keep its positions? Pure and deterministic: `today` is a
// parameter, nothing reads the clock. Informational only: nothing here blocks
// an action or caps leverage, and shortfalls are recorded, never silently
// borrowed.

const EPS = 1e-9;
const DAY_MS = 86_400_000;
const UNASSIGNED = 'unassigned';

// ---------------------------------------------------------------- dates

const utc = (d: ISODate): number => {
  const [y, m, day] = d.split('-').map(Number);
  return Date.UTC(y, m - 1, day);
};

export function addDays(date: ISODate, days: number): ISODate {
  const t = new Date(utc(date) + days * DAY_MS);
  const y = t.getUTCFullYear();
  const m = String(t.getUTCMonth() + 1).padStart(2, '0');
  const d = String(t.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Whole days from `from` to `to`. */
function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((utc(to) - utc(from)) / DAY_MS);
}

/** Calendar days covered by `months` months starting at `today`. */
export function monthsToDays(months: number, today: ISODate): number {
  return daysBetween(today, addMonths(today, months));
}

// --------------------------------------------------------------- params

/** A one-off market move on a date: `kind` 'index' (id '*' = every index) or 'fx'. */
export interface MarketShock {
  /** Calendar date; or give `day`, counted from today. */
  date?: ISODate;
  day?: number;
  kind: 'index' | 'fx';
  id: string;
  /** Fractional move: -0.2 is -20%. */
  move: number;
}

/** Extra money in (positive) or out (negative) of the portfolio. */
export interface ExtraFlow {
  date: ISODate;
  amount: number;
  currency: Currency;
  label?: string;
}

export type ShortfallPolicy = 'record' | 'sell_core';

export interface SurvivalParams {
  /** Start of the simulation (day 0). */
  today: ISODate;
  horizonDays: number;
  /** Total move over the horizon per index id, applied linearly per day. */
  indexMoves?: Record<ID, number>;
  /** Total move over the horizon for indices not listed. */
  defaultIndexMove?: number;
  /** Total move over the horizon of a currency against the base currency, linear. */
  currencyMoves?: Record<Currency, number>;
  shocks?: MarketShock[];
  /** Percentage points added to every loan rate from day 1 (floating-rate assumption). */
  rateShift?: number;
  extraFlows?: ExtraFlow[];
  /** Use the recurring items in `data.cashflowItems`. Default true. */
  useCashflowItems?: boolean;
  /** Loan payments are covered by outside income: balances fall, portfolio cash does not. */
  loanPaymentsFromOutside?: boolean;
  /** Cost per futures contract per monthly roll, in the instrument currency. */
  rollCostPerContract?: number;
  /** Annual perpetual funding rate on notional: positive = longs pay, shorts receive. */
  fundingRateAnnual?: number;
  /**
   * 'record' (default): the shortfall is recorded and cash goes negative.
   * 'sell_core': also sell core securities pro rata to cover it.
   */
  shortfallPolicy?: ShortfallPolicy;
  /** Longest daily series returned; longer runs are sampled. Default 400. */
  maxPoints?: number;
}

export const SURVIVAL_CAVEATS: string[] = [
  '市場路徑假設為線性或所列的單日衝擊，真實市場不會這樣走；這是情境，不是預測。',
  '槓桿 ETF 以每日目標槓桿逐日複利（單日報酬 = 指數日報酬 × 槓桿，下限 −100%），這是模型，不是預測。',
  '現金只依幣別與帳戶累計，不會自動換匯或借款；期貨／永續合約帳戶的現金只用於保證金，不支付生活支出與還款。',
  '利率衝擊以浮動利率假設，從第 1 天起套用於剩餘期數重新計算的還款表。',
  '當日（含 today）已發生的收支視為已入帳；當日到期、尚未還款的貸款會計入第 0 天。',
  '同一天先處理收入與投入，再處理還款與支出。強制減碼不計手續費與稅，也不會賣出已質押的部位。',
  '本結果僅供資訊與提醒，系統不會因此限制任何操作或槓桿。',
];

// --------------------------------------------------------------- result

export type SurvivalEventType =
  | 'cash_shortfall'
  | 'pledge_call'
  | 'margin_shortfall'
  | 'forced_reduction'
  | 'nav_nonpositive';

export interface SoldItem {
  instrumentId: ID;
  accountId: ID;
  quantity: number;
  /** Proceeds in base currency. */
  valueBase: number;
}

export interface SurvivalEvent {
  date: ISODate;
  day: number;
  type: SurvivalEventType;
  /** Shortfall, cure amount or sale proceeds in `currency`. */
  amount: number;
  currency: Currency;
  amountBase: number;
  label: string;
  loanId?: ID;
  accountId?: ID;
  /** For shortfalls: the part covered by selling (policy sell_core). */
  coveredBySale?: number;
  sold?: SoldItem[];
}

export interface SurvivalDay {
  day: number;
  date: ISODate;
  nav: number;
  /** All cash (negative balances included), base currency. */
  cash: number;
  /** Cash in accounts that pay bills (not futures / perpetual accounts), base currency. */
  freeCash: number;
  debt: number;
  grossExposure: number;
  netExposure: number;
  grossLeverage?: number;
  netLeverage?: number;
  /** Lowest pledged-loan maintenance ratio that day. */
  minMaintenanceRatio?: number;
  /** Lowest equity minus maintenance margin across derivative accounts, base currency. */
  marginHeadroom?: number;
  /** Cash per `${accountId}|${currency}` in that currency. */
  cashByKey: Record<string, number>;
}

interface Extreme {
  value: number;
  date: ISODate;
  /** Loan id or account id the extreme belongs to, when relevant. */
  ref?: ID;
}

export interface SurvivalSummary {
  /** First cash or margin shortfall; undefined when none. */
  firstShortfallDate?: ISODate;
  firstShortfall?: SurvivalEvent;
  firstPledgeCallDate?: ISODate;
  shortfallCount: number;
  /** Book NAV stayed above 0 on every day. */
  navPositiveThroughout: boolean;
  /** No cash / margin shortfall and no forced sale: the positions were kept. */
  cashEnough: boolean;
  /** NAV positive throughout but cash not enough: the question the simulation exists to answer. */
  navPositiveButCashShort: boolean;
  minNav: Extreme;
  /** Lowest total cash (all accounts, base currency). */
  minCash: Extreme;
  minMaintenanceRatio?: Extreme;
  minMarginHeadroom?: Extreme;
  /**
   * Outside money that would have avoided every shortfall, base currency:
   * cash = deepest dip of free cash per currency, margin = largest margin gap
   * per derivative account, pledge = largest repayment to cure each call.
   * Components are added, so the total is conservative.
   */
  externalNeeded: { cash: number; margin: number; pledge: number; total: number };
  endingNav: number;
  endingGrossLeverage?: number;
  endingNetLeverage?: number;
  /** Derivative accounts whose instruments lack a maintenance margin spec. */
  missingMarginSpecs: ID[];
}

export interface SurvivalResult {
  params: SurvivalParams;
  endDate: ISODate;
  /** Sampled when the run is longer than `maxPoints`; day 0 and the last day are always kept. */
  series: SurvivalDay[];
  events: SurvivalEvent[];
  summary: SurvivalSummary;
  warnings: string[];
  caveats: string[];
}

// ------------------------------------------------------- cash-flow dates

/** Dates of `item` strictly after `after` and not after `to`. */
export function cashflowOccurrences(item: CashflowItem, after: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  const last = item.endDate && item.endDate < to ? item.endDate : to;
  if (item.frequency === 'once') {
    if (item.startDate > after && item.startDate <= last) out.push(item.startDate);
    return out;
  }
  const step = item.frequency === 'monthly' ? 1 : item.frequency === 'quarterly' ? 3 : 12;
  for (let k = 0; k < 2400; k++) {
    const d = addMonths(item.startDate, k * step);
    if (d > last) break;
    if (d > after) out.push(d);
  }
  return out;
}

// ------------------------------------------------------------ simulation

interface PosState {
  key: string;
  accountId: ID;
  instrumentId: ID;
  bucket: ID;
  qty: number;
  mult: number;
  lev: number;
  currency: Currency;
  indexId: ID;
  type: string;
  derivative: boolean;
  maint?: number;
}

interface Flow {
  order: number;
  currency: Currency;
  amount: number;
  /** 'in' adds to free cash; 'out' pays from it. */
  dir: 'in' | 'out';
  label: string;
  loan?: { loanId: ID; principal: number; fromOutside: boolean };
}

interface MarginGroup {
  key: string;
  accountId: ID;
  currency: Currency;
  /** Unrealized P&L carried from before day 0, instrument currency. */
  u0: number;
  positions: PosState[];
  missing: boolean;
  inShort: boolean;
}

interface PledgeState {
  loan: Loan;
  inCall: boolean;
}

/**
 * Simulate the portfolio from `params.today` for `params.horizonDays` days.
 * `portfolio` is the current ledger and valuation; `data` supplies loans,
 * cash-flow items, instruments and FX.
 */
export function runSurvival(data: AppData, portfolio: Portfolio, params: SurvivalParams): SurvivalResult {
  const { ledger, valuation } = portfolio;
  const base = valuation.baseCurrency;
  const today = params.today;
  const H = Math.max(1, Math.floor(params.horizonDays));
  const end = addDays(today, H);
  const policy: ShortfallPolicy = params.shortfallPolicy ?? 'record';
  const shift = (params.rateShift ?? 0) / 100;
  const indexMoves = params.indexMoves ?? {};
  const currencyMoves = params.currencyMoves ?? {};
  const maxPoints = Math.max(2, params.maxPoints ?? 400);
  const warnings: string[] = [];
  const events: SurvivalEvent[] = [];

  const instruments = new Map(data.instruments.map((i) => [i.id, i]));
  const accounts = new Map(data.accounts.map((a) => [a.id, a]));

  // ---- state: positions and prices
  const pos: PosState[] = [];
  const price = new Map<ID, number>();
  for (const v of valuation.positions) {
    if (v.quantity === 0) continue;
    const inst = v.instrument;
    pos.push({
      key: v.key,
      accountId: v.accountId,
      instrumentId: v.instrumentId,
      bucket: v.bucket,
      qty: v.quantity,
      mult: inst.multiplier,
      lev: inst.leverage,
      currency: inst.currency,
      indexId: inst.indexId ?? UNCLASSIFIED_INDEX,
      type: inst.type,
      derivative: isDerivative(inst.type),
      maint: inst.maintenanceMargin,
    });
    price.set(v.instrumentId, v.price);
  }
  const quoteOf = new Map(data.prices.map((p) => [p.id, p.price]));
  for (const loan of data.loans) {
    for (const c of loan.collateral ?? []) {
      if (price.has(c.instrumentId)) continue;
      const q = quoteOf.get(c.instrumentId);
      if (q && q > 0) price.set(c.instrumentId, q);
    }
  }
  const indexOfInstrument = (id: ID) => instruments.get(id)?.indexId ?? UNCLASSIFIED_INDEX;

  // ---- state: cash
  interface Cash {
    accountId: ID;
    currency: Currency;
    amount: number;
  }
  const cash = new Map<string, Cash>();
  const cashKey = (a: ID, c: Currency) => `${a}|${c}`;
  const cashAt = (a: ID, c: Currency): Cash => {
    const k = cashKey(a, c);
    let e = cash.get(k);
    if (!e) cash.set(k, (e = { accountId: a, currency: c, amount: 0 }));
    return e;
  };
  for (const c of ledger.cash) cashAt(c.accountId, c.currency).amount = c.amount;

  // ---- margin groups
  const marginAccounts = new Set<ID>();
  for (const a of data.accounts) if (a.type === 'futures') marginAccounts.add(a.id);
  for (const p of pos) if (p.derivative) marginAccounts.add(p.accountId);
  const groups = new Map<string, MarginGroup>();
  for (const v of valuation.positions) {
    const p = pos.find((x) => x.key === v.key);
    if (!p || !p.derivative) continue;
    const k = cashKey(p.accountId, p.currency);
    let g = groups.get(k);
    if (!g) {
      g = { key: k, accountId: p.accountId, currency: p.currency, u0: 0, positions: [], missing: false, inShort: false };
      groups.set(k, g);
      cashAt(p.accountId, p.currency);
    }
    g.u0 += v.quantity * (v.price - v.avgCost) * p.mult;
    g.positions.push(p);
    if (!(p.maint !== undefined && p.maint > 0)) g.missing = true;
  }
  const missingMarginSpecs = [...new Set([...groups.values()].filter((g) => g.missing).map((g) => g.accountId))].sort();
  for (const a of missingMarginSpecs) {
    warnings.push(`帳戶「${accounts.get(a)?.name ?? a}」有合約缺少維持保證金規格，保證金需求可能低估`);
  }

  // ---- state: loans and pledges
  const loanBalance = new Map<ID, number>();
  for (const l of ledger.loans) loanBalance.set(l.loanId, l.balance);
  const loanById = new Map(data.loans.map((l) => [l.id, l]));
  const pledges: PledgeState[] = data.loans
    .filter((l) => l.active && l.collateral?.length && l.callRatio && l.callRatio > 0)
    .map((loan) => ({ loan, inCall: false }));
  const pledgedQty = (accountId: ID, instrumentId: ID) =>
    data.loans
      .filter((l) => l.active)
      .flatMap((l) => l.collateral ?? [])
      .filter((c) => c.accountId === accountId && c.instrumentId === instrumentId)
      .reduce((s, c) => s + c.quantity, 0);

  // ---- scheduled flows by date
  const flows = new Map<ISODate, Flow[]>();
  const addFlow = (date: ISODate, f: Flow) => {
    if (date < today || date > end) return;
    const list = flows.get(date) ?? [];
    list.push(f);
    flows.set(date, list);
  };

  for (const loan of data.loans) {
    if (!loan.active) continue;
    const st = loanStatus(data, ledger, loan, today);
    if (st.balance <= EPS) continue;
    const rate = Math.max(0, loan.annualRate + shift);
    const fromOutside = !!params.loanPaymentsFromOutside;
    if (st.remainingSchedule.length) {
      const rows =
        shift === 0
          ? st.remainingSchedule
          : amortizationSchedule(
              { ...loan, annualRate: rate },
              { balance: st.balance, periods: st.remainingPeriods, firstDueDate: st.remainingSchedule[0].dueDate },
            );
      for (const r of rows) {
        addFlow(r.dueDate, {
          order: 1,
          currency: loan.currency,
          amount: r.payment,
          dir: 'out',
          label: `還款：${loan.name}`,
          loan: { loanId: loan.id, principal: r.principal, fromOutside },
        });
      }
    } else if (st.nextDueDate) {
      const day = loan.payDay ?? Number(loan.startDate.slice(8, 10));
      const interest = (st.balance * rate) / 12;
      for (let k = 0; k < 2400; k++) {
        const due = addMonths(st.nextDueDate, k, day);
        if (due > end) break;
        addFlow(due, {
          order: 1,
          currency: loan.currency,
          amount: interest,
          dir: 'out',
          label: `利息：${loan.name}`,
          loan: { loanId: loan.id, principal: 0, fromOutside },
        });
      }
    }
  }

  if (params.useCashflowItems !== false) {
    for (const item of data.cashflowItems) {
      if (!item.affectsPortfolio) continue;
      for (const d of cashflowOccurrences(item, today, end)) {
        addFlow(d, {
          order: item.kind === 'income' ? 0 : 2,
          currency: item.currency,
          amount: item.amount,
          dir: item.kind === 'income' ? 'in' : 'out',
          label: `${item.kind === 'income' ? '收入' : '支出'}：${item.name}`,
        });
      }
    }
  }
  for (const e of params.extraFlows ?? []) {
    if (!e.amount) continue;
    addFlow(e.date, {
      order: e.amount > 0 ? 0 : 3,
      currency: e.currency,
      amount: Math.abs(e.amount),
      dir: e.amount > 0 ? 'in' : 'out',
      label: e.label ?? (e.amount > 0 ? '額外投入' : '額外提領'),
    });
  }

  // ---- market shocks by date
  const shocksByDate = new Map<ISODate, MarketShock[]>();
  for (const s of params.shocks ?? []) {
    const date = s.date ?? addDays(today, s.day ?? 0);
    if (date <= today || date > end) {
      warnings.push(`衝擊 ${s.kind}:${s.id} 的日期 ${date} 不在模擬期間內，已略過`);
      continue;
    }
    const list = shocksByDate.get(date) ?? [];
    list.push(s);
    shocksByDate.set(date, list);
  }

  const rollDates = new Set<ISODate>();
  if (params.rollCostPerContract) {
    for (let k = 1; k < 2400; k++) {
      const d = addMonths(today, k);
      if (d > end) break;
      rollDates.add(d);
    }
  }

  // ---- per-day market state
  const fxLevel: Record<Currency, number> = {};
  const fxShockMul: Record<Currency, number> = {};
  let fx = new FxTable(data.fxRates);
  let rateCache = new Map<Currency, number>();
  const rateTo = (c: Currency): number => {
    let r = rateCache.get(c);
    if (r === undefined) {
      r = fx.rate(c, base) ?? 0;
      rateCache.set(c, r);
    }
    return r;
  };

  const indexTotal = (id: ID) => indexMoves[id] ?? params.defaultIndexMove ?? 0;
  const pathLevel = (total: number, d: number) => Math.max(0, 1 + (total * d) / H);
  const pathReturn = (total: number, d: number) => {
    const prev = pathLevel(total, d - 1);
    return prev > EPS ? pathLevel(total, d) / prev - 1 : 0;
  };

  // ---- free cash / pool helpers
  const poolKeys = (currency: Currency): string[] =>
    [...cash.values()]
      .filter((c) => c.currency === currency && !marginAccounts.has(c.accountId))
      .map((c) => cashKey(c.accountId, c.currency))
      .sort();
  const primaryKey = (currency: Currency): string => {
    const keys = poolKeys(currency);
    if (keys.length) {
      return keys.reduce((best, k) => (cash.get(k)!.amount > cash.get(best)!.amount + EPS ? k : best), keys[0]);
    }
    const acct = data.accounts
      .filter((a) => a.baseCurrency === currency && !marginAccounts.has(a.id))
      .map((a) => a.id)
      .sort()[0];
    const k = cashKey(acct ?? UNASSIGNED, currency);
    cashAt(acct ?? UNASSIGNED, currency);
    return k;
  };
  const available = (currency: Currency): number =>
    poolKeys(currency).reduce((s, k) => s + Math.max(0, cash.get(k)!.amount), 0);

  // Shadow free cash per currency: the same flows without sale proceeds, to
  // size the outside money needed even when the policy sells securities.
  const shadow = new Map<Currency, number>();
  const shadowMin = new Map<Currency, { value: number; rate: number }>();
  const noteShadow = (c: Currency) => {
    const v = shadow.get(c) ?? 0;
    const m = shadowMin.get(c);
    if (!m || v < m.value) shadowMin.set(c, { value: v, rate: rateTo(c) });
  };
  for (const c of cash.values()) {
    if (marginAccounts.has(c.accountId)) continue;
    shadow.set(c.currency, (shadow.get(c.currency) ?? 0) + c.amount);
  }

  let curDay = 0;
  let curDate = today;
  const record = (e: Omit<SurvivalEvent, 'date' | 'day' | 'amountBase'>): SurvivalEvent => {
    const ev: SurvivalEvent = { ...e, date: curDate, day: curDay, amountBase: e.amount * rateTo(e.currency) };
    events.push(ev);
    return ev;
  };

  /** Sell core securities pro rata, up to `amount` of `currency`. Credits nothing. */
  const sellCore = (currency: Currency, amount: number): { proceeds: number; sold: SoldItem[] } => {
    const rate = rateTo(currency);
    if (!(rate > 0) || amount <= EPS) return { proceeds: 0, sold: [] };
    const eligible = pos
      .filter((p) => !p.derivative && p.bucket === CORE_BUCKET && p.qty > EPS)
      .map((p) => {
        const free = p.qty - pledgedQty(p.accountId, p.instrumentId);
        const value = free > EPS ? free * (price.get(p.instrumentId) ?? 0) * p.mult * rateTo(p.currency) : 0;
        return { p, free, value };
      })
      .filter((e) => e.value > EPS);
    const total = eligible.reduce((s, e) => s + e.value, 0);
    if (total <= EPS) return { proceeds: 0, sold: [] };
    const f = Math.min(1, (amount * rate) / total);
    const sold: SoldItem[] = [];
    for (const e of eligible) {
      const q = e.free * f;
      e.p.qty -= q;
      sold.push({ instrumentId: e.p.instrumentId, accountId: e.p.accountId, quantity: q, valueBase: e.value * f });
    }
    return { proceeds: (total * f) / rate, sold };
  };

  const draw = (currency: Currency, amount: number) => {
    let left = amount;
    const keys = poolKeys(currency).sort(
      (a, b) => cash.get(b)!.amount - cash.get(a)!.amount || (a < b ? -1 : 1),
    );
    for (const k of keys) {
      if (left <= EPS) break;
      const c = cash.get(k)!;
      if (c.amount <= 0) continue;
      const take = Math.min(c.amount, left);
      c.amount -= take;
      left -= take;
    }
  };

  const receive = (currency: Currency, amount: number) => {
    cash.get(primaryKey(currency))!.amount += amount;
    shadow.set(currency, (shadow.get(currency) ?? 0) + amount);
  };

  const pay = (currency: Currency, amount: number, label: string) => {
    if (amount <= EPS) return;
    shadow.set(currency, (shadow.get(currency) ?? 0) - amount);
    noteShadow(currency);
    const avail = available(currency);
    if (amount <= avail + EPS) {
      draw(currency, amount);
      return;
    }
    const short = amount - avail;
    const ev = record({ type: 'cash_shortfall', amount: short, currency, label, coveredBySale: 0 });
    if (policy === 'sell_core') {
      const sale = sellCore(currency, short);
      if (sale.proceeds > 0) {
        cash.get(primaryKey(currency))!.amount += sale.proceeds;
        ev.coveredBySale = sale.proceeds;
        record({
          type: 'forced_reduction',
          amount: sale.proceeds,
          currency,
          label: `強制減碼以支付：${label}`,
          sold: sale.sold,
        });
      }
    }
    const drawn = Math.min(amount, available(currency));
    draw(currency, drawn);
    const rest = amount - drawn;
    if (rest > EPS) cash.get(primaryKey(currency))!.amount -= rest;
  };

  // ---- evaluation of one day
  const idxRet = new Map<ID, number>(); // daily index return of the current day
  const marginNeed = new Map<string, { value: number; rate: number }>();
  const pledgeNeed = new Map<ID, { value: number; rate: number }>();
  let minNav: Extreme | undefined;
  let minCash: Extreme | undefined;
  let minRatio: Extreme | undefined;
  let minHead: Extreme | undefined;
  let navWasPositive = true;

  const requiredOf = (g: MarginGroup) =>
    g.positions.reduce((s, p) => s + (p.maint !== undefined && p.maint > 0 ? Math.abs(p.qty) * p.maint : 0), 0);

  const pledgeValue = (loan: Loan): number => {
    let v = 0;
    for (const c of loan.collateral ?? []) {
      const inst = instruments.get(c.instrumentId);
      const p = price.get(c.instrumentId);
      if (!inst || p === undefined) continue;
      v += c.quantity * p * inst.multiplier * (fx.rate(inst.currency, loan.currency) ?? 0);
    }
    return v;
  };

  const evaluate = (day: number, date: ISODate): SurvivalDay => {
    curDay = day;
    curDate = date;

    // futures / perpetual margin
    let headroom: number | undefined;
    let headRef: ID | undefined;
    for (const g of [...groups.values()].sort((a, b) => (a.key < b.key ? -1 : 1))) {
      const c = cashAt(g.accountId, g.currency);
      let req = requiredOf(g);
      let equity = c.amount + g.u0;
      const raw = req - equity;
      if (raw > EPS) {
        const rate = rateTo(g.currency);
        const prev = marginNeed.get(g.key);
        if (!prev || raw * rate > prev.value * prev.rate) marginNeed.set(g.key, { value: raw, rate });
        if (!g.inShort) {
          const ev = record({
            type: 'margin_shortfall',
            amount: raw,
            currency: g.currency,
            label: `期貨／永續合約保證金不足：${accounts.get(g.accountId)?.name ?? g.accountId}`,
            accountId: g.accountId,
            coveredBySale: 0,
          });
          if (policy === 'sell_core') {
            const sale = sellCore(g.currency, raw);
            if (sale.proceeds > 0) {
              c.amount += sale.proceeds;
              ev.coveredBySale = sale.proceeds;
              record({
                type: 'forced_reduction',
                amount: sale.proceeds,
                currency: g.currency,
                label: `強制減碼補保證金：${accounts.get(g.accountId)?.name ?? g.accountId}`,
                accountId: g.accountId,
                sold: sale.sold,
              });
              equity = c.amount + g.u0;
            }
          }
        }
      }
      g.inShort = req - equity > EPS;
      req = requiredOf(g);
      const room = (equity - req) * rateTo(g.currency);
      if (headroom === undefined || room < headroom) {
        headroom = room;
        headRef = g.accountId;
      }
    }

    // pledged loans
    let ratio: number | undefined;
    let ratioRef: ID | undefined;
    for (const pl of pledges) {
      const bal = loanBalance.get(pl.loan.id) ?? 0;
      if (bal <= EPS) {
        pl.inCall = false;
        continue;
      }
      const value = pledgeValue(pl.loan);
      const r = value / bal;
      if (ratio === undefined || r < ratio) {
        ratio = r;
        ratioRef = pl.loan.id;
      }
      const call = pl.loan.callRatio!;
      if (value < call * bal - EPS) {
        const cure = bal - value / call;
        const rate = rateTo(pl.loan.currency);
        const prev = pledgeNeed.get(pl.loan.id);
        if (!prev || cure * rate > prev.value * prev.rate) pledgeNeed.set(pl.loan.id, { value: cure, rate });
        if (!pl.inCall) {
          record({
            type: 'pledge_call',
            amount: cure,
            currency: pl.loan.currency,
            label: `質押追繳：${pl.loan.name}（維持率 ${(r * 100).toFixed(1)}% < ${(call * 100).toFixed(0)}%）`,
            loanId: pl.loan.id,
          });
        }
        pl.inCall = true;
      } else {
        pl.inCall = false;
      }
    }

    // totals
    let securities = 0;
    let gross = 0;
    let net = 0;
    let u0Base = 0;
    for (const p of pos) {
      const px = price.get(p.instrumentId) ?? 0;
      const notional = p.qty * px * p.mult * rateTo(p.currency);
      if (!p.derivative) securities += notional;
      gross += Math.abs(notional * p.lev);
      net += notional * p.lev;
    }
    for (const g of groups.values()) u0Base += g.u0 * rateTo(g.currency);
    let cashBase = 0;
    let freeCash = 0;
    const cashByKey: Record<string, number> = {};
    for (const [k, c] of [...cash.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const v = c.amount * rateTo(c.currency);
      cashBase += v;
      if (!marginAccounts.has(c.accountId)) freeCash += v;
      cashByKey[k] = c.amount;
    }
    let debt = 0;
    for (const [id, bal] of loanBalance) debt += bal * rateTo(loanById.get(id)?.currency ?? base);
    const nav = securities + cashBase + u0Base - debt;

    if (nav <= 0 && navWasPositive) {
      record({ type: 'nav_nonpositive', amount: nav, currency: base, label: 'NAV 降至 0 或以下' });
    }
    navWasPositive = nav > 0;

    if (!minNav || nav < minNav.value) minNav = { value: nav, date };
    if (!minCash || cashBase < minCash.value) minCash = { value: cashBase, date };
    if (ratio !== undefined && (!minRatio || ratio < minRatio.value)) minRatio = { value: ratio, date, ref: ratioRef };
    if (headroom !== undefined && (!minHead || headroom < minHead.value)) {
      minHead = { value: headroom, date, ref: headRef };
    }
    for (const c of shadow.keys()) noteShadow(c);

    return {
      day,
      date,
      nav,
      cash: cashBase,
      freeCash,
      debt,
      grossExposure: gross,
      netExposure: net,
      grossLeverage: nav > 0 ? gross / nav : undefined,
      netLeverage: nav > 0 ? net / nav : undefined,
      minMaintenanceRatio: ratio,
      marginHeadroom: headroom,
      cashByKey,
    };
  };

  // ---- day loop
  for (const c of shadow.keys()) noteShadow(c);
  const days: SurvivalDay[] = [];
  for (let d = 0; d <= H; d++) {
    const date = addDays(today, d);
    if (d >= 1) {
      // market
      const todays = shocksByDate.get(date) ?? [];
      idxRet.clear();
      const retOf = (indexId: ID): number => {
        let r = idxRet.get(indexId);
        if (r === undefined) {
          let f = 1 + pathReturn(indexTotal(indexId), d);
          for (const s of todays) {
            if (s.kind === 'index' && (s.id === '*' || s.id === indexId)) f *= 1 + s.move;
          }
          r = Math.max(-1, f - 1);
          idxRet.set(indexId, r);
        }
        return r;
      };
      const before = new Map(price);
      for (const [instrumentId, px] of price) {
        const inst = instruments.get(instrumentId);
        if (!inst) continue;
        const move = Math.max(-1, retOf(indexOfInstrument(instrumentId)) * inst.leverage);
        price.set(instrumentId, px * (1 + move));
      }
      // FX
      const fxCurrencies = new Set<Currency>([
        ...Object.keys(currencyMoves),
        ...todays.filter((s) => s.kind === 'fx').map((s) => s.id),
      ]);
      const moves: Record<Currency, number> = {};
      for (const c of [...fxCurrencies].sort()) {
        let mul = fxShockMul[c] ?? 1;
        for (const s of todays) if (s.kind === 'fx' && s.id === c) mul *= 1 + s.move;
        fxShockMul[c] = mul;
        fxLevel[c] = pathLevel(currencyMoves[c] ?? 0, d) * mul;
        moves[c] = fxLevel[c] - 1;
      }
      fx = new FxTable(scaleFxRates(data.fxRates, moves));
      rateCache = new Map();

      // futures settlement, perpetual funding, roll cost
      const annual = params.fundingRateAnnual ?? 0;
      for (const p of pos) {
        if (!p.derivative) continue;
        const px = price.get(p.instrumentId) ?? 0;
        const prev = before.get(p.instrumentId) ?? px;
        const c = cashAt(p.accountId, p.currency);
        c.amount += p.qty * p.mult * (px - prev);
        if (p.type === 'perpetual' && annual) c.amount -= (p.qty * px * p.mult * annual) / 365;
        if (p.type === 'future' && rollDates.has(date)) c.amount -= Math.abs(p.qty) * (params.rollCostPerContract ?? 0);
      }
    }

    curDay = d;
    curDate = date;
    for (const f of (flows.get(date) ?? []).slice().sort((a, b) => a.order - b.order)) {
      if (f.loan) {
        loanBalance.set(f.loan.loanId, Math.max(0, (loanBalance.get(f.loan.loanId) ?? 0) - f.loan.principal));
        if (f.loan.fromOutside) continue;
      }
      if (f.dir === 'in') receive(f.currency, f.amount);
      else pay(f.currency, f.amount, f.label);
    }

    days.push(evaluate(d, date));
  }

  // ---- summary
  const shortfalls = events.filter((e) => e.type === 'cash_shortfall' || e.type === 'margin_shortfall');
  const first = shortfalls[0];
  const cashNeed = [...shadowMin.values()].reduce((s, m) => s + Math.max(0, -m.value) * m.rate, 0);
  const marginNeedBase = [...marginNeed.values()].reduce((s, m) => s + m.value * m.rate, 0);
  const pledgeNeedBase = [...pledgeNeed.values()].reduce((s, m) => s + m.value * m.rate, 0);
  const last = days[days.length - 1];
  const cashEnough = !events.some(
    (e) => e.type === 'cash_shortfall' || e.type === 'margin_shortfall' || e.type === 'forced_reduction',
  );
  const navPositiveThroughout = (minNav?.value ?? 0) > 0;

  const summary: SurvivalSummary = {
    firstShortfallDate: first?.date,
    firstShortfall: first,
    firstPledgeCallDate: events.find((e) => e.type === 'pledge_call')?.date,
    shortfallCount: shortfalls.length,
    navPositiveThroughout,
    cashEnough,
    navPositiveButCashShort: navPositiveThroughout && !cashEnough,
    minNav: minNav!,
    minCash: minCash!,
    minMaintenanceRatio: minRatio,
    minMarginHeadroom: minHead,
    externalNeeded: {
      cash: cashNeed,
      margin: marginNeedBase,
      pledge: pledgeNeedBase,
      total: cashNeed + marginNeedBase + pledgeNeedBase,
    },
    endingNav: last.nav,
    endingGrossLeverage: last.grossLeverage,
    endingNetLeverage: last.netLeverage,
    missingMarginSpecs,
  };

  // ---- sampling
  const step = Math.max(1, Math.ceil(days.length / maxPoints));
  const sampled = days.filter((_, i) => i % step === 0 || i === days.length - 1);

  for (const w of valuation.warnings) warnings.push(w);
  return {
    params,
    endDate: end,
    series: sampled,
    events,
    summary,
    warnings: [...new Set(warnings)],
    caveats: SURVIVAL_CAVEATS,
  };
}
