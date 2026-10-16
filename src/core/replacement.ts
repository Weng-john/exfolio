// Instrument replacement comparison (phase P2). Decision support only: every
// figure is an estimate under explicit assumptions, history is never turned
// into a forecast, and nothing here creates a transaction.

import { estimateFees } from './fees';
import { FxTable } from './fx';
import { roundToLot, unitExposure } from './allocation';
import type { Portfolio, Valuation } from './valuation';
import {
  getSettings,
  isDerivative,
  type AppData,
  type Broker,
  type Currency,
  type ID,
  type ISODate,
  type Instrument,
} from './types';

const EPS = 1e-9;
const TRADING_DAYS = 252;

// --------------------------------------------------------------- assumptions

/** Every input the cost model uses. Nothing is hidden in a constant. */
export interface ReplacementAssumptions {
  /** Annual rate paid on borrowed exposure (leveraged-ETF swaps, futures basis). */
  financingRate: number;
  /** Annual rate earned on cash not needed as margin / capital. */
  cashRate: number;
  /** Annualised volatility of the index, for the daily-reset drag estimate. */
  volatility: number;
  /** Contract rolls per year for a futures position. */
  rollsPerYear: number;
  /** One-way spread / slippage as a fraction of traded value. */
  slippage: number;
}

export const DEFAULT_ASSUMPTIONS: ReplacementAssumptions = {
  financingRate: 0.05,
  cashRate: 0.02,
  volatility: 0.18,
  rollsPerYear: 4,
  slippage: 0.0005,
};

// --------------------------------------------------------------- holding cost

export type CostKey =
  | 'expense'
  | 'embeddedFinancing'
  | 'volatilityDrag'
  | 'impliedFinancing'
  | 'rollCost'
  | 'cashOffset';

export interface CostComponent {
  key: CostKey;
  label: string;
  /** Annual amount in base currency. Positive = cost, negative = offset. */
  annual: number;
  /** False when an input was missing: the amount is then 0 and flagged. */
  known: boolean;
  /** The assumption or formula behind the number, in plain language. */
  assumption: string;
}

export interface PricingContext {
  /** Quote in the instrument currency. */
  price?: number;
  /** Base currency per 1 unit of the instrument currency. */
  fxRate?: number;
  /** Institution whose fee rule applies. */
  broker?: Broker;
}

export interface HoldingCost {
  instrumentId: ID;
  /** Index exposure the cost is quoted for, base currency. */
  exposure: number;
  /** Capital tied up while carrying that exposure, base currency. */
  capital?: number;
  components: CostComponent[];
  /** Sum of costs only (offsets excluded). */
  grossAnnual: number;
  /** Costs minus offsets: the figure instruments are compared on. */
  totalAnnual: number;
  /** Things that were unknown or not modelled for this instrument. */
  flags: string[];
}

/** Annual cost of carrying `exposure` (base currency) of an index through `instrument`. */
export function holdingCost(
  instrument: Instrument,
  exposure: number,
  assumptions: ReplacementAssumptions,
  ctx: PricingContext = {},
): HoldingCost {
  const a = assumptions;
  const flags: string[] = [];
  const components: CostComponent[] = [];
  const L = instrument.leverage;
  const fxRate = ctx.fxRate ?? 1;
  const out = (capital?: number): HoldingCost => {
    const grossAnnual = components.filter((c) => c.annual > 0).reduce((s, c) => s + c.annual, 0);
    const totalAnnual = components.reduce((s, c) => s + c.annual, 0);
    return {
      instrumentId: instrument.id,
      exposure,
      capital,
      components,
      grossAnnual,
      totalAnnual,
      flags,
    };
  };

  if (!(exposure > 0)) {
    flags.push('曝險金額必須大於 0');
    return out(undefined);
  }
  if (!(L > 0)) {
    flags.push('商品槓桿不為正，成本模型只處理多方曝險');
    return out(undefined);
  }

  const cashOffset = (capital: number, label: string) => {
    const free = Math.max(0, exposure - capital);
    components.push({
      key: 'cashOffset',
      label,
      annual: -free * a.cashRate,
      known: true,
      assumption: `未占用資金 ${fmt(free)} × 現金利率 ${pct(a.cashRate)}（抵減項，非成本）`,
    });
  };

  if (isDerivative(instrument.type)) {
    // Futures / perpetuals: margin is cash, not exposure or debt.
    const margin = instrument.initialMargin;
    components.push({
      key: 'impliedFinancing',
      label: '隱含融資（期貨基差）',
      annual: exposure * a.financingRate,
      known: true,
      assumption: `名目 ${fmt(exposure)} × 融資利率 ${pct(a.financingRate)}；實際基差隨市場變動，此為假設而非由資料估算`,
    });

    const unit = ctx.price !== undefined ? unitExposure(instrument, ctx.price, fxRate) : undefined;
    const contracts = unit && unit > 0 ? exposure / unit : undefined;
    if (instrument.type === 'future') {
      if (contracts === undefined) {
        flags.push('缺少報價，無法估算換月成本');
        components.push({
          key: 'rollCost',
          label: '換月成本',
          annual: 0,
          known: false,
          assumption: '缺少報價',
        });
      } else {
        const price = ctx.price!;
        const buy = estimateFees(ctx.broker, instrument, 'buy', contracts, price);
        const sell = estimateFees(ctx.broker, instrument, 'sell', contracts, price);
        const feeKnown = buy.known && sell.known;
        if (!feeKnown) flags.push('機構沒有此類商品的手續費規則，換月費用以 0 計');
        const feePerRoll = (buy.fee + buy.tax + sell.fee + sell.tax) * fxRate;
        const slipPerRoll = a.slippage * exposure;
        components.push({
          key: 'rollCost',
          label: '換月成本',
          annual: a.rollsPerYear * (feePerRoll + slipPerRoll),
          known: feeKnown,
          assumption: `每年 ${a.rollsPerYear} 次 × (平倉＋開倉手續費與稅 ${fmt(feePerRoll)} ＋ 價差滑價 ${pct(a.slippage, 3)} × 名目 = ${fmt(slipPerRoll)})`,
        });
      }
    } else {
      flags.push('永續合約的資金費率（funding）未建模，隱含融資僅為假設');
    }

    if (margin && margin > 0 && contracts !== undefined) {
      const capital = contracts * margin * fxRate;
      cashOffset(capital, '未占用保證金的現金收益（抵減）');
      return out(capital);
    }
    flags.push('缺少原始保證金設定，無法估算資金占用與現金收益抵減');
    return out(undefined);
  }

  // Securities: capital held is exposure / leverage.
  const capital = exposure / L;
  if (instrument.type === 'etf') {
    if (instrument.expenseRatio === undefined) {
      flags.push('未設定內扣費用率（expenseRatio），不以 0 假設');
      components.push({
        key: 'expense',
        label: '內扣費用',
        annual: 0,
        known: false,
        assumption: '費用率未知',
      });
    } else {
      components.push({
        key: 'expense',
        label: '內扣費用',
        annual: capital * instrument.expenseRatio,
        known: true,
        assumption: `持有資金 ${fmt(capital)} × 費用率 ${pct(instrument.expenseRatio, 3)}`,
      });
    }
  }
  if (L > 1) {
    components.push({
      key: 'embeddedFinancing',
      label: '內含融資（借入部分）',
      annual: (L - 1) * capital * a.financingRate,
      known: true,
      assumption: `(${L} − 1) × 資金 ${fmt(capital)} × 融資利率 ${pct(a.financingRate)}`,
    });
    components.push({
      key: 'volatilityDrag',
      label: '每日重設波動耗損（近似）',
      annual: 0.5 * L * (L - 1) * a.volatility ** 2 * capital,
      known: true,
      assumption: `近似式 ½ × ${L} × (${L} − 1) × σ² (σ = ${pct(a.volatility)}) × 資金；取決於波動度假設與實際路徑，並非預測`,
    });
  }
  if (L !== 1) cashOffset(capital, '未占用資金的現金收益（抵減）');
  return out(capital);
}

// -------------------------------------------------------- capital efficiency

export interface CapitalEfficiency {
  instrumentId: ID;
  /** Exposure asked for, base currency. */
  targetExposure: number;
  /** Quantity (contracts for futures) after lot rounding toward zero. */
  quantity?: number;
  /** Exposure actually reached after rounding. */
  exposure?: number;
  /** exposure − target: negative when rounding falls short. */
  exposureError?: number;
  errorPct?: number;
  /** Capital tied up: purchase cost for a security, initial margin for a derivative. */
  capital?: number;
  isMargin: boolean;
  /** Capital / exposure reached. */
  capitalRatio?: number;
  /** Cash freed versus buying the target exposure in an unleveraged ETF. */
  freeCashVsUnleveraged?: number;
  flags: string[];
}

export function capitalEfficiency(
  instrument: Instrument,
  targetExposure: number,
  ctx: PricingContext = {},
): CapitalEfficiency {
  const derivative = isDerivative(instrument.type);
  const out: CapitalEfficiency = {
    instrumentId: instrument.id,
    targetExposure,
    isMargin: derivative,
    flags: [],
  };
  if (ctx.price === undefined) out.flags.push('沒有報價，無法估算數量');
  if (ctx.fxRate === undefined) out.flags.push('缺少匯率，無法換算');
  if (ctx.price === undefined || ctx.fxRate === undefined) return out;
  const unit = unitExposure(instrument, ctx.price, ctx.fxRate);
  if (!(unit > 0)) {
    out.flags.push('商品槓桿不為正，無法用於建立多方曝險');
    return out;
  }
  const quantity = roundToLot(targetExposure / unit, instrument.lotSize);
  out.quantity = quantity;
  out.exposure = quantity * unit;
  out.exposureError = out.exposure - targetExposure;
  out.errorPct = targetExposure ? out.exposureError / targetExposure : undefined;
  if (derivative) {
    const m = instrument.initialMargin;
    if (m && m > 0) out.capital = quantity * m * ctx.fxRate;
    else out.flags.push('缺少原始保證金設定，無法估算資金占用');
  } else {
    out.capital = quantity * ctx.price * instrument.multiplier * ctx.fxRate;
  }
  if (out.capital !== undefined) {
    out.capitalRatio = out.exposure ? out.capital / out.exposure : undefined;
    out.freeCashVsUnleveraged = targetExposure - out.capital;
  }
  return out;
}

// ------------------------------------------------------------ switching cost

export interface SwitchingCost {
  fromInstrumentId: ID;
  toInstrumentId: ID;
  /** Fees to sell the current instrument, base currency. */
  sellFee: number;
  sellTax: number;
  buyFee: number;
  buyTax: number;
  slippage: number;
  total: number;
  flags: string[];
}

export interface SwitchLeg {
  instrument: Instrument;
  ctx: PricingContext;
}

/** Cost of selling `exposure` of the current instrument and buying the candidate. */
export function switchingCost(
  from: SwitchLeg,
  to: SwitchLeg,
  exposure: number,
  assumptions: ReplacementAssumptions,
  heldQuantity?: number,
): SwitchingCost {
  const flags: string[] = [];
  const leg = (l: SwitchLeg, side: 'buy' | 'sell', cap?: number) => {
    const { price, fxRate } = l.ctx;
    if (price === undefined || fxRate === undefined) {
      flags.push(`${l.instrument.symbol} 缺少報價或匯率，轉換成本以 0 計`);
      return { fee: 0, tax: 0, value: 0 };
    }
    const unit = unitExposure(l.instrument, price, fxRate);
    if (!(unit > 0)) return { fee: 0, tax: 0, value: 0 };
    let qty = roundToLot(exposure / unit, l.instrument.lotSize);
    if (cap !== undefined) qty = Math.min(qty, Math.abs(cap));
    const est = estimateFees(l.ctx.broker, l.instrument, side, qty, price);
    if (!est.known) flags.push(`機構沒有 ${l.instrument.symbol} 這類商品的手續費規則，費用以 0 計`);
    return {
      fee: est.fee * fxRate,
      tax: est.tax * fxRate,
      value: qty * price * l.instrument.multiplier * fxRate,
    };
  };
  const s = leg(from, 'sell', heldQuantity);
  const b = leg(to, 'buy');
  const slippage = assumptions.slippage * (s.value + b.value);
  return {
    fromInstrumentId: from.instrument.id,
    toInstrumentId: to.instrument.id,
    sellFee: s.fee,
    sellTax: s.tax,
    buyFee: b.fee,
    buyTax: b.tax,
    slippage,
    total: s.fee + s.tax + b.fee + b.tax + slippage,
    flags,
  };
}

// ------------------------------------------------------ historical comparison

export interface MissingPoint {
  instrumentId: ID;
  /** Absent when the instrument has no data in the window at all. */
  date?: ISODate;
  reason: string;
}

export interface SeriesStats {
  instrumentId: ID;
  /** Realised total return over the window (last / first − 1). */
  totalReturn: number;
  /** Annualised from daily returns (sample stdev × √252). */
  volatility?: number;
  /** Largest peak-to-trough fall of the price path, as a negative fraction. */
  maxDrawdown: number;
}

export interface NaiveLeverage {
  /** Candidate leverage ÷ base leverage. */
  ratio: number;
  /** ratio × base window return: what "L × index" would have given. */
  naiveReturn: number;
  /** Realised candidate return − naive return: tracking + decay + costs. */
  realisedGap: number;
}

export interface ReplacementHistoryPoint {
  date: ISODate;
  /** Cumulative return since the first common date. */
  base: number;
  candidate: number;
  /** 1 + ratio × base cumulative return, minus 1 (only when ratio ≠ 1). */
  naive?: number;
}

export interface HistoricalComparison {
  baseInstrumentId: ID;
  candidateInstrumentId: ID;
  from: ISODate;
  to: ISODate;
  /** Common price dates used. */
  daysUsed: number;
  firstDate?: ISODate;
  lastDate?: ISODate;
  base?: SeriesStats;
  candidate?: SeriesStats;
  /** Correlation of daily returns on common dates. */
  correlation?: number;
  naive?: NaiveLeverage;
  series: ReplacementHistoryPoint[];
  /** Dates present for one instrument but not the other; nothing is interpolated. */
  missing: MissingPoint[];
  warnings: string[];
}

function priceSeries(data: AppData, id: ID, from: ISODate, to: ISODate): Map<ISODate, number> {
  const m = new Map<ISODate, number>();
  for (const p of data.priceHistory) {
    if (p.instrumentId !== id || p.date < from || p.date > to) continue;
    const v = p.adjClose ?? p.close;
    if (v > 0) m.set(p.date, v);
  }
  return m;
}

function stats(id: ID, prices: number[]): SeriesStats {
  const rets = dailyReturns(prices);
  let peak = prices[0];
  let dd = 0;
  for (const p of prices) {
    peak = Math.max(peak, p);
    dd = Math.min(dd, p / peak - 1);
  }
  const mean = rets.reduce((s, r) => s + r, 0) / (rets.length || 1);
  const variance =
    rets.length > 1 ? rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1) : undefined;
  return {
    instrumentId: id,
    totalReturn: prices[prices.length - 1] / prices[0] - 1,
    volatility: variance === undefined ? undefined : Math.sqrt(variance * TRADING_DAYS),
    maxDrawdown: dd,
  };
}

function dailyReturns(prices: number[]): number[] {
  return prices.slice(1).map((p, i) => p / prices[i] - 1);
}

function correlation(x: number[], y: number[]): number | undefined {
  const n = Math.min(x.length, y.length);
  if (n < 2) return undefined;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  if (sxx < EPS || syy < EPS) return undefined;
  return sxy / Math.sqrt(sxx * syy);
}

/**
 * Compare two instruments' realised history over [from, to] on the dates
 * both have a price. Uses adjClose when present. Describes the past only.
 */
export function historicalComparison(
  data: AppData,
  baseInstrumentId: ID,
  candidateInstrumentId: ID,
  from: ISODate,
  to: ISODate,
): HistoricalComparison {
  const out: HistoricalComparison = {
    baseInstrumentId,
    candidateInstrumentId,
    from,
    to,
    daysUsed: 0,
    series: [],
    missing: [],
    warnings: [],
  };
  const A = priceSeries(data, baseInstrumentId, from, to);
  const B = priceSeries(data, candidateInstrumentId, from, to);
  for (const [id, s] of [
    [baseInstrumentId, A],
    [candidateInstrumentId, B],
  ] as const) {
    if (!s.size)
      out.missing.push({ instrumentId: id, reason: '此區間沒有歷史價格，請先下載或匯入' });
  }
  for (const [id, s, other] of [
    [baseInstrumentId, A, B],
    [candidateInstrumentId, B, A],
  ] as const) {
    if (!s.size || !other.size) continue;
    for (const date of other.keys())
      if (!s.has(date))
        out.missing.push({ instrumentId: id, date, reason: '缺少當日價格，未內插' });
  }
  out.missing.sort((x, y) => (x.date ?? '').localeCompare(y.date ?? ''));
  const dates = [...A.keys()].filter((d) => B.has(d)).sort();
  out.daysUsed = dates.length;
  if (dates.length < 2) {
    out.warnings.push('共同日期不足 2 天，無法計算報酬');
    return out;
  }
  out.firstDate = dates[0];
  out.lastDate = dates[dates.length - 1];
  const pa = dates.map((d) => A.get(d)!);
  const pb = dates.map((d) => B.get(d)!);
  out.base = stats(baseInstrumentId, pa);
  out.candidate = stats(candidateInstrumentId, pb);
  out.correlation = correlation(dailyReturns(pa), dailyReturns(pb));

  const lb = data.instruments.find((i) => i.id === baseInstrumentId)?.leverage;
  const lc = data.instruments.find((i) => i.id === candidateInstrumentId)?.leverage;
  const ratio = lb && lc && Math.abs(lb) > EPS ? lc / lb : undefined;
  if (ratio !== undefined && Math.abs(ratio - 1) > EPS) {
    const naiveReturn = ratio * out.base.totalReturn;
    out.naive = {
      ratio,
      naiveReturn,
      realisedGap: out.candidate.totalReturn - naiveReturn,
    };
  }
  out.series = dates.map((date, i) => {
    const base = pa[i] / pa[0] - 1;
    const pt: ReplacementHistoryPoint = { date, base, candidate: pb[i] / pb[0] - 1 };
    if (out.naive) pt.naive = out.naive.ratio * base;
    return pt;
  });
  if (dates.length < 60) out.warnings.push('樣本少於 60 天，統計意義有限');
  out.warnings.push('歷史結果只描述過去，不是預測');
  return out;
}

// ------------------------------------------------------- replacement analysis

export interface ReplacementRequest {
  indexId: ID;
  /** Instrument being replaced (a holding). Switching cost and break-even need it. */
  fromInstrumentId?: ID;
  /** Exposure to carry, base currency. Defaults to the current core exposure of the index. */
  exposure?: number;
  assumptions?: ReplacementAssumptions;
  /** Account whose institution fee rules apply. */
  accountId?: ID;
}

export interface ReplacementRow {
  instrumentId: ID;
  symbol: string;
  name: string;
  type: Instrument['type'];
  leverage: number;
  currency: Currency;
  isCurrent: boolean;
  holding: HoldingCost;
  efficiency: CapitalEfficiency;
  /** Absent for the current instrument itself. */
  switching?: SwitchingCost;
  /** Current total annual cost − this row's, when positive. */
  annualSaving?: number;
  /** Years to recover the switching cost from the saving. Undefined without a saving. */
  breakEvenYears?: number;
  notes: string[];
}

export interface ReplacementAnalysis {
  indexId: ID;
  baseCurrency: Currency;
  exposure: number;
  assumptions: ReplacementAssumptions;
  fromInstrumentId?: ID;
  /** Sorted by total annual cost, lowest first. Not a recommendation. */
  rows: ReplacementRow[];
  warnings: string[];
}

function quote(data: AppData, id: ID): number | undefined {
  const q = data.prices.find((p) => p.id === id);
  return q && q.price > 0 ? q.price : undefined;
}

function ctxFor(
  data: AppData,
  fx: FxTable,
  base: Currency,
  i: Instrument,
  accountId?: ID,
): PricingContext {
  const account = accountId ? data.accounts.find((a) => a.id === accountId) : undefined;
  return {
    price: quote(data, i.id),
    fxRate: fx.rate(i.currency, base),
    broker: account ? data.brokers.find((b) => b.id === account.brokerId) : undefined,
  };
}

/** Current core exposure (signed net) of one index, base currency. */
export function coreExposureOf(valuation: Valuation, indexId: ID): number {
  return valuation.positions
    .filter((p) => p.indexId === indexId && p.bucket === 'core')
    .reduce((s, p) => s + p.exposure, 0);
}

/** Per-instrument caveats that apply regardless of the numbers. */
function notesFor(i: Instrument, base: Currency, flags: string[]): string[] {
  const notes: string[] = [];
  if (i.leverage > 1)
    notes.push(
      `${i.leverage}× 每日重設：持有數年的報酬不等於指數 ${i.leverage} 倍，盤整震盪時耗損明顯（路徑相依）`,
    );
  if (i.type === 'future')
    notes.push('期貨須定期換月，並有追繳保證金與被強制平倉的風險；保證金不足時需補錢');
  if (i.type === 'perpetual') notes.push('永續合約有資金費率與強制平倉風險');
  if (i.currency !== base)
    notes.push(`以 ${i.currency} 計價，帶有 ${i.currency}/${base} 匯率風險，成本以目前匯率換算`);
  notes.push('稅負與股利處理（扣稅、再投資、期貨稅等）的差異未納入模型');
  notes.push(...flags);
  return notes;
}

export function replacementAnalysis(
  data: AppData,
  valuation: Valuation,
  req: ReplacementRequest,
): ReplacementAnalysis {
  const base = getSettings(data).baseCurrency;
  const fx = new FxTable(data.fxRates);
  const assumptions = req.assumptions ?? DEFAULT_ASSUMPTIONS;
  const warnings: string[] = [];
  const exposure = req.exposure ?? coreExposureOf(valuation, req.indexId);
  const analysis: ReplacementAnalysis = {
    indexId: req.indexId,
    baseCurrency: base,
    exposure,
    assumptions,
    fromInstrumentId: req.fromInstrumentId,
    rows: [],
    warnings,
  };
  if (!(exposure > 0)) {
    warnings.push('曝險金額為 0 或負值，請輸入要比較的曝險金額');
    return analysis;
  }
  const from = req.fromInstrumentId
    ? data.instruments.find((i) => i.id === req.fromInstrumentId)
    : undefined;
  const candidates = data.instruments.filter(
    // An inverse fund cannot stand in for long exposure, so it is no candidate.
    (i) => i.indexId === req.indexId && i.leverage > 0 && (i.active || i.id === from?.id),
  );
  const fromCtx = from ? ctxFor(data, fx, base, from, req.accountId) : undefined;
  const heldQty = from
    ? valuation.positions
        .filter(
          (p) =>
            p.instrumentId === from.id &&
            (!req.accountId || p.accountId === req.accountId) &&
            p.bucket === 'core',
        )
        .reduce((s, p) => s + p.quantity, 0)
    : undefined;

  const rows = candidates.map((i): ReplacementRow => {
    const ctx = ctxFor(data, fx, base, i, req.accountId);
    const holding = holdingCost(i, exposure, assumptions, ctx);
    const efficiency = capitalEfficiency(i, exposure, ctx);
    const flags = [...holding.flags, ...efficiency.flags.filter((f) => !holding.flags.includes(f))];
    if (ctx.fxRate === undefined)
      flags.push(`缺少 ${i.currency}/${base} 匯率，金額以 1:1 暫代，不可採信`);
    const isCurrent = i.id === from?.id;
    const row: ReplacementRow = {
      instrumentId: i.id,
      symbol: i.symbol,
      name: i.name,
      type: i.type,
      leverage: i.leverage,
      currency: i.currency,
      isCurrent,
      holding,
      efficiency,
      notes: notesFor(i, base, flags),
    };
    if (from && fromCtx && !isCurrent) {
      row.switching = switchingCost(
        { instrument: from, ctx: fromCtx },
        { instrument: i, ctx },
        exposure,
        assumptions,
        heldQty,
      );
      row.notes.push(...row.switching.flags);
    }
    return row;
  });

  const current = rows.find((r) => r.isCurrent);
  if (current) {
    for (const r of rows) {
      if (r.isCurrent || !r.switching) continue;
      const saving = current.holding.totalAnnual - r.holding.totalAnnual;
      r.annualSaving = saving;
      if (saving > EPS) r.breakEvenYears = r.switching.total / saving;
    }
  } else if (from) {
    warnings.push(`${from.symbol} 不在此指數的商品清單，無法計算回本期`);
  }
  rows.sort((a, b) => a.holding.totalAnnual - b.holding.totalAnnual);
  analysis.rows = rows;
  warnings.push('數字為在所示假設下的估計，不構成預測或建議；網站不會下單');
  return analysis;
}

// ------------------------------------------------------- substitution effect

export interface SubstitutionRequest {
  fromPositionKey: string;
  toInstrumentId: ID;
  /** Share of the position to replace, 0 to 1. */
  fraction: number;
  assumptions?: ReplacementAssumptions;
}

export interface SubstitutionTrade {
  side: 'buy' | 'sell';
  instrumentId: ID;
  symbol: string;
  /** Positive quantity after lot rounding. */
  quantity: number;
  /** Signed index exposure moved, base currency. */
  exposure: number;
}

export interface SubstitutionEffect {
  feasible: boolean;
  problems: string[];
  baseCurrency: Currency;
  trades: SubstitutionTrade[];
  /** Exposure the old leg gave up and the new leg adds (signed, base). */
  exposureRemoved: number;
  exposureAdded: number;
  /** added − removed: rounding residual, ≈ 0 by construction. */
  exposureResidual: number;
  /** Cash from the sale less cost of the purchase and fees, securities only. */
  tradeCashChange: number;
  /** Margin requirement after − before (positive = more margin needed). */
  marginChange: number;
  /** Change in free cash overall = tradeCashChange − marginChange (positive = released). */
  freeCashChange: number;
  switching?: SwitchingCost;
  grossExposureBefore: number;
  grossExposureAfter: number;
  netExposureBefore: number;
  netExposureAfter: number;
  grossLeverageBefore?: number;
  grossLeverageAfter?: number;
  netLeverageBefore?: number;
  netLeverageAfter?: number;
}

/** What replacing part or all of one position would do. Advisory: creates nothing. */
export function substitutionEffect(
  data: AppData,
  portfolio: Portfolio,
  req: SubstitutionRequest,
): SubstitutionEffect {
  const { valuation } = portfolio;
  const base = valuation.baseCurrency;
  const problems: string[] = [];
  const assumptions = req.assumptions ?? DEFAULT_ASSUMPTIONS;
  const gross0 = valuation.grossExposure;
  const net0 = valuation.netExposure;
  const out: SubstitutionEffect = {
    feasible: false,
    problems,
    baseCurrency: base,
    trades: [],
    exposureRemoved: 0,
    exposureAdded: 0,
    exposureResidual: 0,
    tradeCashChange: 0,
    marginChange: 0,
    freeCashChange: 0,
    grossExposureBefore: gross0,
    grossExposureAfter: gross0,
    netExposureBefore: net0,
    netExposureAfter: net0,
  };
  const lev = (v: number) => (valuation.nav > 0 ? v / valuation.nav : undefined);
  out.grossLeverageBefore = lev(gross0);
  out.netLeverageBefore = lev(net0);

  const pos = valuation.positions.find((p) => p.key === req.fromPositionKey);
  const to = data.instruments.find((i) => i.id === req.toInstrumentId);
  if (!pos) problems.push('找不到要替換的部位');
  if (!to) problems.push('找不到目標商品');
  if (!pos || !to) return out;
  const from = pos.instrument;
  const f = Math.min(1, Math.max(0, req.fraction));
  if (!(f > 0)) problems.push('替換比例必須大於 0');
  if (from.id === to.id) problems.push('目標商品與原商品相同');
  if (from.indexId !== to.indexId || !from.indexId)
    problems.push('兩個商品不是同一指數，替換會改變曝險標的');
  if (!(to.leverage > 0)) problems.push('目標商品槓桿不為正');

  const fx = new FxTable(data.fxRates);
  const toPrice = quote(data, to.id);
  const toFx = fx.rate(to.currency, base);
  if (toPrice === undefined) problems.push(`${to.symbol} 沒有報價`);
  if (toFx === undefined) problems.push(`缺少 ${to.currency}/${base} 匯率`);
  const fromUnit = unitExposure(from, pos.price, pos.fxRate);
  if (!(fromUnit > 0)) problems.push('原商品槓桿不為正');
  if (problems.length || toPrice === undefined || toFx === undefined) return out;

  const sign = pos.quantity >= 0 ? 1 : -1;
  const sellQty = Math.min(
    Math.abs(pos.quantity),
    roundToLot(Math.abs(pos.quantity) * f, from.lotSize),
  );
  const removed = sign * sellQty * fromUnit;
  const toUnit = unitExposure(to, toPrice, toFx);
  const buyQty = roundToLot(Math.abs(removed) / toUnit, to.lotSize);
  const added = sign * buyQty * toUnit;
  if (sellQty <= 0) {
    problems.push('依最小單位取整後沒有可賣出的數量');
    return out;
  }
  if (buyQty <= 0) problems.push('依最小單位取整後買不到任何目標商品；曝險將減少');

  const account = data.accounts.find((a) => a.id === pos.accountId);
  const broker = account ? data.brokers.find((b) => b.id === account.brokerId) : undefined;
  const sw = switchingCost(
    { instrument: from, ctx: { price: pos.price, fxRate: pos.fxRate, broker } },
    { instrument: to, ctx: { price: toPrice, fxRate: toFx, broker } },
    Math.abs(removed),
    assumptions,
    sellQty,
  );
  // Switching cost sizes the sell leg itself; align it to the lot-rounded trade.
  const secValue = (i: Instrument, qty: number, price: number, rate: number) =>
    isDerivative(i.type) ? 0 : qty * price * i.multiplier * rate;
  const tradeCash =
    sign * secValue(from, sellQty, pos.price, pos.fxRate) -
    sign * secValue(to, buyQty, toPrice, toFx) -
    sw.sellFee -
    sw.sellTax -
    sw.buyFee -
    sw.buyTax;
  const marginOf = (i: Instrument, qty: number, rate: number) =>
    isDerivative(i.type) ? qty * (i.initialMargin ?? 0) * rate : 0;
  for (const i of [from, to])
    if (isDerivative(i.type) && !(i.initialMargin && i.initialMargin > 0))
      problems.push(`${i.symbol} 缺少原始保證金設定，保證金變動不完整`);
  const marginChange = marginOf(to, buyQty, toFx) - marginOf(from, sellQty, pos.fxRate);

  out.trades = [
    {
      side: sign > 0 ? 'sell' : 'buy',
      instrumentId: from.id,
      symbol: from.symbol,
      quantity: sellQty,
      exposure: removed,
    },
    {
      side: sign > 0 ? 'buy' : 'sell',
      instrumentId: to.id,
      symbol: to.symbol,
      quantity: buyQty,
      exposure: added,
    },
  ];
  out.exposureRemoved = removed;
  out.exposureAdded = added;
  out.exposureResidual = added - removed;
  out.tradeCashChange = tradeCash;
  out.marginChange = marginChange;
  out.freeCashChange = tradeCash - marginChange;
  out.switching = sw;
  out.grossExposureAfter = gross0 - Math.abs(removed) + Math.abs(added);
  out.netExposureAfter = net0 - removed + added;
  // Costs leave the portfolio, so NAV after the switch is lower by that amount.
  const nav1 = valuation.nav - sw.total;
  const lev1 = (v: number) => (nav1 > 0 ? v / nav1 : undefined);
  out.grossLeverageAfter = lev1(out.grossExposureAfter);
  out.netLeverageAfter = lev1(out.netExposureAfter);
  out.feasible = true;
  return out;
}

// ----------------------------------------------------------------- formatting

function fmt(v: number): string {
  return Math.round(v).toLocaleString('en-US');
}

function pct(v: number, digits = 2): string {
  return `${(v * 100).toFixed(digits)}%`;
}
