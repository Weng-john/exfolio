import { collateralStatus } from './loans';
import { computePortfolio, UNCLASSIFIED_INDEX, type Portfolio, type Valuation } from './valuation';
import {
  isDerivative,
  type AppData,
  type Currency,
  type FxRate,
  type ID,
  type PriceQuote,
} from './types';
import { FxTable } from './fx';

// Static Stress Test: one instantaneous shock applied to prices and FX, then
// the portfolio is re-valued by the normal valuation code (the accounting
// rules live in one place). Informational only: nothing here blocks an action
// or caps leverage.

const EPS = 1e-9;
const ZERO_PRICE = 1e-12;

export interface StressShocks {
  /** Fractional move per underlying index id: -0.2 means -20%. */
  indexMoves: Record<ID, number>;
  /** Fractional move of a currency against the base currency (+0.05 = it buys 5% more base). */
  currencyMoves: Record<Currency, number>;
  /** Move for every index not listed in `indexMoves` (also unclassified instruments). */
  defaultIndexMove?: number;
  /** Interest-rate shift in percentage points: 1 means +1.00pp on every loan. */
  rateShift?: number;
}

export interface StressPreset {
  id: string;
  name: string;
  description: string;
  shocks: StressShocks;
}

/** Illustrative shock sets. They are round numbers, not forecasts or historical replays. */
export const STRESS_PRESETS: StressPreset[] = [
  {
    id: 'all_m10',
    name: '全面 −10%',
    description: '示意情境：所有指數同步下跌 10%。',
    shocks: { indexMoves: {}, currencyMoves: {}, defaultIndexMove: -0.1 },
  },
  {
    id: 'all_m20',
    name: '全面 −20%',
    description: '示意情境：所有指數同步下跌 20%。',
    shocks: { indexMoves: {}, currencyMoves: {}, defaultIndexMove: -0.2 },
  },
  {
    id: 'all_m35',
    name: '全面 −35%',
    description: '示意情境：所有指數同步下跌 35%。',
    shocks: { indexMoves: {}, currencyMoves: {}, defaultIndexMove: -0.35 },
  },
  {
    id: 'usd_up5',
    name: '美元升值 5%',
    description: '示意情境：USD、USDT 對本位幣升值 5%，指數不動。',
    shocks: { indexMoves: {}, currencyMoves: { USD: 0.05, USDT: 0.05 } },
  },
  {
    id: 'usd_down5',
    name: '美元貶值 5%',
    description: '示意情境：USD、USDT 對本位幣貶值 5%，指數不動。',
    shocks: { indexMoves: {}, currencyMoves: { USD: -0.05, USDT: -0.05 } },
  },
  {
    id: 'btc_m50',
    name: 'BTC −50%',
    description: '示意情境：Bitcoin 下跌 50%，其他不動。',
    shocks: { indexMoves: { btc: -0.5 }, currencyMoves: {} },
  },
  {
    id: 'rate_up2',
    name: '升息 +2pp',
    description: '示意情境：所有借款利率上升 2 個百分點（浮動利率假設）。',
    shocks: { indexMoves: {}, currencyMoves: {}, rateShift: 2 },
  },
];

export const STRESS_CAVEATS: string[] = [
  '這是瞬間衝擊的近似：所有價格與匯率在同一刻變動，沒有時間路徑，也沒有流動性或滑價。',
  '槓桿 ETF 的多日路徑依賴無法以固定倍數模擬；此處把單日目標槓桿乘上指數漲跌，只適用於一次性衝擊。',
  '利率衝擊以浮動利率假設估算，固定利率借款實際不受影響。',
  '期貨保證金以輸入的維持保證金規格計算；規格缺漏的帳戶會標示，不當作 0。',
  '本結果僅供資訊與提醒，系統不會因此限制任何操作或槓桿。',
];

// ------------------------------------------------------------ shocking

/** Index move that applies to `indexId` under `shocks`. */
export function indexMoveOf(shocks: StressShocks, indexId: ID | undefined): number {
  const id = indexId ?? UNCLASSIFIED_INDEX;
  return shocks.indexMoves[id] ?? shocks.defaultIndexMove ?? 0;
}

/** Price move of an instrument with daily target `leverage`, floored at -100%. */
export function instrumentMove(indexMove: number, leverage: number): number {
  return Math.max(-1, indexMove * leverage);
}

/**
 * Scale FX pairs so each currency moves by `moves[currency]` against the base
 * currency (currencies not listed, and the base itself, do not move). Applied
 * to every pair with rate x (1 + move[from]) / (1 + move[to]) so chained
 * conversions (USDT -> USD -> TWD) stay consistent.
 */
export function scaleFxRates(rates: FxRate[], moves: Record<Currency, number>): FxRate[] {
  const factor = (c: Currency) => Math.max(1e-6, 1 + (moves[c] ?? 0));
  return rates.map((r) => ({ ...r, rate: (r.rate * factor(r.from)) / factor(r.to) }));
}

/** Copy of `data` with shocked prices and FX. Transactions are untouched. */
export function applyShocks(
  data: AppData,
  valuation: Valuation,
  shocks: StressShocks,
  now?: Date,
): AppData {
  const instruments = new Map(data.instruments.map((i) => [i.id, i]));
  const quotes = new Map(data.prices.map((p) => [p.id, p]));
  const held = new Map<ID, number>(); // price the valuation actually used
  for (const p of valuation.positions) held.set(p.instrumentId, p.price);

  const prices: PriceQuote[] = [];
  const ids = new Set<ID>([...quotes.keys(), ...held.keys()]);
  for (const id of [...ids].sort()) {
    const inst = instruments.get(id);
    if (!inst) continue;
    const quote = quotes.get(id);
    const base = quote && quote.price > 0 ? quote.price : held.get(id);
    if (base === undefined) continue;
    const move = instrumentMove(indexMoveOf(shocks, inst.indexId), inst.leverage);
    prices.push({
      id,
      // Valuation treats a price of 0 as "no quote" and falls back to cost, so a
      // wiped-out instrument is held at a negligible positive price instead.
      price: Math.max(base * (1 + move), ZERO_PRICE),
      currency: quote?.currency ?? inst.currency,
      asOf: quote?.asOf ?? now?.toISOString() ?? '',
      source: quote?.source ?? 'manual',
      status: quote?.status ?? 'manual',
    });
  }
  return { ...data, prices, fxRates: scaleFxRates(data.fxRates, shocks.currencyMoves) };
}

// -------------------------------------------------------------- result

export interface StressSnapshot {
  nav: number;
  totalAssets: number;
  liabilities: number;
  cashValue: number;
  grossExposure: number;
  netExposure: number;
  grossLeverage?: number;
  netLeverage?: number;
  debtToNav?: number;
}

export interface StressIndexRow {
  indexId: ID;
  /** Move applied to the index (not the instruments on it). */
  move: number;
  netBefore: number;
  netAfter: number;
  grossBefore: number;
  grossAfter: number;
  /** Net exposure / NAV; undefined when NAV is not positive. */
  weightBefore?: number;
  weightAfter?: number;
}

export interface StressPositionRow {
  key: string;
  accountId: ID;
  instrumentId: ID;
  symbol: string;
  indexId: ID;
  quantity: number;
  /** Move of the underlying index. */
  indexMove: number;
  /** Move of the instrument price: index move x leverage, floored at -100%. */
  priceMove: number;
  /** True when the floor at -100% applied. */
  floored: boolean;
  priceBefore: number;
  priceAfter: number;
  /** Market value (securities) or 0 (derivatives), base currency. */
  valueBefore: number;
  valueAfter: number;
  exposureBefore: number;
  exposureAfter: number;
  /** Change in market value (securities) or unrealized P&L (derivatives), base currency, FX included. */
  pnl: number;
  derivative: boolean;
}

export interface StressLoanRow {
  loanId: ID;
  name: string;
  currency: Currency;
  balance: number;
  ratioBefore?: number;
  ratioAfter?: number;
  callRatio?: number;
  belowCallBefore: boolean;
  belowCallAfter: boolean;
  /** Repayment (loan currency) that restores the ratio to callRatio. */
  cureRepayment?: number;
  /** Extra collateral value (loan currency) that restores the ratio. */
  cureCollateral?: number;
  /** Uniform collateral fall from the shocked state to the call. */
  triggerDropPctAfter?: number;
}

export interface StressMarginRow {
  accountId: ID;
  currency: Currency;
  hasPerpetual: boolean;
  cash: number;
  /** Unrealized P&L of the derivatives, instrument currency. */
  unrealizedBefore: number;
  unrealizedAfter: number;
  equityBefore: number;
  /** Cash + unrealized after the shock (variation margin settled against cash). */
  equityAfter: number;
  /** Sum of maintenanceMargin x contracts over instruments with a spec. */
  required: number;
  headroomBefore: number;
  headroomAfter: number;
  /** Shortfall to the maintenance requirement after the shock; 0 when none. */
  shortfall: number;
  /** Shortfall in base currency at the shocked FX rate. */
  shortfallBase: number;
  /** Instruments with a position but no (positive) maintenanceMargin. */
  missingSpecs: ID[];
  /**
   * Uniform underlying move, from current prices, at which equity falls to the
   * maintenance requirement (the liquidation estimate). Undefined when specs
   * are missing, positions net out, or the requirement cannot be reached.
   */
  liquidationMove?: number;
}

export interface StressInterest {
  /** Projected monthly interest, base currency, current rates. */
  before: number;
  /** Same with the rate shift applied (floating-rate assumption), floored at 0%. */
  after: number;
  delta: number;
  byLoan: Array<{
    loanId: ID;
    name: string;
    currency: Currency;
    balance: number;
    before: number;
    after: number;
  }>;
}

export interface StressResult {
  shocks: StressShocks;
  before: StressSnapshot;
  after: StressSnapshot;
  /** NAV after - NAV before. */
  pnl: number;
  /** Portion of `pnl` not explained by positions: FX on cash and loan balances. */
  otherPnl: number;
  /** NAV after / NAV before. Undefined when NAV before is not positive. */
  remainingNavRatio?: number;
  byIndex: StressIndexRow[];
  positions: StressPositionRow[];
  loans: StressLoanRow[];
  margins: StressMarginRow[];
  interest: StressInterest;
  warnings: string[];
  caveats: string[];
}

const snapshot = (v: Valuation): StressSnapshot => ({
  nav: v.nav,
  totalAssets: v.totalAssets,
  liabilities: v.liabilities,
  cashValue: v.cashValue,
  grossExposure: v.grossExposure,
  netExposure: v.netExposure,
  grossLeverage: v.grossLeverage,
  netLeverage: v.netLeverage,
  debtToNav: v.debtToNav,
});

export interface StressOptions {
  /** Reference time for quote staleness only. */
  now?: Date;
}

/**
 * Apply `shocks` to `data` and compare the re-valued portfolio with
 * `portfolio` (the current state). Pure.
 */
export function runStressTest(
  data: AppData,
  portfolio: Portfolio,
  shocks: StressShocks,
  options: StressOptions = {},
): StressResult {
  const before = portfolio.valuation;
  const shockedData = applyShocks(data, before, shocks, options.now);
  const shocked = computePortfolio(shockedData, { now: options.now });
  const after = shocked.valuation;
  const warnings: string[] = [];

  // ---- positions
  const afterByKey = new Map(after.positions.map((p) => [p.key, p]));
  const positions: StressPositionRow[] = [];
  for (const b of before.positions) {
    const a = afterByKey.get(b.key);
    if (!a) continue;
    const derivative = isDerivative(b.instrument.type);
    const indexMove = indexMoveOf(shocks, b.instrument.indexId);
    const raw = indexMove * b.instrument.leverage;
    const priceMove = instrumentMove(indexMove, b.instrument.leverage);
    const floored = raw < -1;
    positions.push({
      key: b.key,
      accountId: b.accountId,
      instrumentId: b.instrumentId,
      symbol: b.instrument.symbol,
      indexId: b.indexId,
      quantity: b.quantity,
      indexMove,
      priceMove,
      floored,
      priceBefore: b.price,
      priceAfter: b.price * (1 + priceMove),
      valueBefore: b.marketValue,
      valueAfter: a.marketValue,
      exposureBefore: b.exposure,
      exposureAfter: a.exposure,
      pnl: derivative ? a.unrealizedPnl - b.unrealizedPnl : a.marketValue - b.marketValue,
      derivative,
    });
    if (floored && b.quantity !== 0) {
      warnings.push(
        `${b.instrument.symbol} 的槓桿 ${b.instrument.leverage}× 使跌幅超過 100%，已以 −100% 為下限（價值歸零）`,
      );
    }
  }
  const positionPnl = positions.reduce((s, p) => s + p.pnl, 0);
  const pnl = after.nav - before.nav;

  // ---- indices
  const afterIdx = new Map(after.byIndex.map((i) => [i.indexId, i]));
  const beforeIdx = new Map(before.byIndex.map((i) => [i.indexId, i]));
  const byIndex: StressIndexRow[] = [...new Set([...beforeIdx.keys(), ...afterIdx.keys()])].map(
    (id) => {
      const b = beforeIdx.get(id);
      const a = afterIdx.get(id);
      return {
        indexId: id,
        move: indexMoveOf(shocks, id),
        netBefore: b?.net ?? 0,
        netAfter: a?.net ?? 0,
        grossBefore: b?.gross ?? 0,
        grossAfter: a?.gross ?? 0,
        weightBefore: b?.weight,
        weightAfter: a?.weight,
      };
    },
  );
  byIndex.sort((x, y) => y.grossBefore - x.grossBefore);

  // ---- pledged loans
  const loans: StressLoanRow[] = [];
  const fxAfter = new FxTable(shockedData.fxRates);
  const fxBefore = new FxTable(data.fxRates);
  for (const loan of data.loans) {
    if (!loan.active || !loan.collateral?.length) continue;
    const balance = portfolio.ledger.loans.find((l) => l.loanId === loan.id)?.balance ?? 0;
    if (balance <= EPS) continue;
    const b = collateralStatus(data, before, loan, balance);
    const a = collateralStatus(shockedData, after, loan, balance);
    loans.push({
      loanId: loan.id,
      name: loan.name,
      currency: loan.currency,
      balance,
      ratioBefore: b.maintenanceRatio,
      ratioAfter: a.maintenanceRatio,
      callRatio: loan.callRatio,
      belowCallBefore: b.belowCall,
      belowCallAfter: a.belowCall,
      cureRepayment: a.cureRepayment,
      cureCollateral: a.cureCollateral,
      triggerDropPctAfter: a.triggerDropPct,
    });
    if (a.belowCall) {
      warnings.push(
        `「${loan.name}」維持率跌破追繳門檻，需還款約 ${(a.cureRepayment ?? 0).toFixed(0)} ${loan.currency} 或補足擔保品`,
      );
    }
  }

  // ---- futures / perpetual margin
  const margins = marginRows(data, portfolio, before, after, fxAfter, warnings);

  // ---- interest
  const shift = (shocks.rateShift ?? 0) / 100;
  const interest: StressInterest = { before: 0, after: 0, delta: 0, byLoan: [] };
  for (const loan of data.loans) {
    if (!loan.active) continue;
    const balance = portfolio.ledger.loans.find((l) => l.loanId === loan.id)?.balance ?? 0;
    if (balance <= EPS) continue;
    const rate = fxBefore.rate(loan.currency, before.baseCurrency) ?? 0;
    const b = (balance * loan.annualRate) / 12;
    const a = (balance * Math.max(0, loan.annualRate + shift)) / 12;
    interest.byLoan.push({
      loanId: loan.id,
      name: loan.name,
      currency: loan.currency,
      balance,
      before: b,
      after: a,
    });
    interest.before += b * rate;
    interest.after += a * rate;
  }
  interest.delta = interest.after - interest.before;

  if (after.nav <= 0) warnings.push('衝擊後 NAV 不為正：槓桿與權重比率無法計算');
  const seen = new Set(before.warnings);
  for (const w of after.warnings) if (!seen.has(w)) warnings.push(w);
  for (const w of before.warnings) warnings.push(w);

  return {
    shocks,
    before: snapshot(before),
    after: snapshot(after),
    pnl,
    otherPnl: pnl - positionPnl,
    remainingNavRatio: before.nav > 0 ? after.nav / before.nav : undefined,
    byIndex,
    positions,
    loans,
    margins,
    interest,
    warnings: [...new Set(warnings)],
    caveats: STRESS_CAVEATS,
  };
}

function marginRows(
  data: AppData,
  portfolio: Portfolio,
  before: Valuation,
  after: Valuation,
  fxAfter: FxTable,
  warnings: string[],
): StressMarginRow[] {
  const afterByKey = new Map(after.positions.map((p) => [p.key, p]));
  const groups = new Map<string, StressMarginRow & { notional: number }>();
  for (const b of before.positions) {
    const inst = b.instrument;
    if (!isDerivative(inst.type) || b.quantity === 0) continue;
    const a = afterByKey.get(b.key);
    if (!a) continue;
    const key = `${b.accountId}|${inst.currency}`;
    let g = groups.get(key);
    if (!g) {
      const cash = portfolio.ledger.cash.find(
        (c) => c.accountId === b.accountId && c.currency === inst.currency,
      );
      g = {
        accountId: b.accountId,
        currency: inst.currency,
        hasPerpetual: false,
        cash: cash?.amount ?? 0,
        unrealizedBefore: 0,
        unrealizedAfter: 0,
        equityBefore: 0,
        equityAfter: 0,
        required: 0,
        headroomBefore: 0,
        headroomAfter: 0,
        shortfall: 0,
        shortfallBase: 0,
        missingSpecs: [],
        notional: 0,
      };
      groups.set(key, g);
    }
    if (inst.type === 'perpetual') g.hasPerpetual = true;
    g.unrealizedBefore += b.quantity * (b.price - b.avgCost) * inst.multiplier;
    g.unrealizedAfter += a.quantity * (a.price - a.avgCost) * inst.multiplier;
    g.notional += b.quantity * b.price * inst.multiplier * inst.leverage;
    const spec = inst.maintenanceMargin;
    if (spec !== undefined && spec > 0) g.required += Math.abs(b.quantity) * spec;
    else if (!g.missingSpecs.includes(inst.id)) g.missingSpecs.push(inst.id);
  }

  const rows: StressMarginRow[] = [];
  for (const g of groups.values()) {
    const { notional, ...row } = g;
    row.equityBefore = row.cash + row.unrealizedBefore;
    row.equityAfter = row.cash + row.unrealizedAfter;
    row.headroomBefore = row.equityBefore - row.required;
    row.headroomAfter = row.equityAfter - row.required;
    row.shortfall = Math.max(0, row.required - row.equityAfter);
    row.shortfallBase = row.shortfall * (fxAfter.rate(row.currency, after.baseCurrency) ?? 0);
    if (!row.missingSpecs.length && Math.abs(notional) > EPS) {
      const move =
        row.equityBefore <= row.required ? 0 : (row.required - row.equityBefore) / notional;
      if (move >= -1) row.liquidationMove = move;
    }
    const name = data.accounts.find((a) => a.id === row.accountId)?.name ?? row.accountId;
    if (row.missingSpecs.length) {
      const syms = row.missingSpecs
        .map((id) => data.instruments.find((i) => i.id === id)?.symbol ?? id)
        .join('、');
      warnings.push(`帳戶「${name}」的 ${syms} 缺少維持保證金規格，保證金需求可能低估`);
    }
    if (row.shortfall > 0) {
      warnings.push(
        `帳戶「${name}」衝擊後權益低於維持保證金，缺口 ${row.shortfall.toFixed(0)} ${row.currency}`,
      );
    }
    rows.push(row);
  }
  return rows.sort((a, b) => (a.accountId + a.currency < b.accountId + b.currency ? -1 : 1));
}
