import { FxTable } from './fx';
import { effectiveSecuritiesRate } from './fees';
import {
  UNCLASSIFIED_INDEX,
  type Valuation,
  type ValuedPosition,
} from './valuation';
import {
  CORE_BUCKET,
  getSettings,
  isDerivative,
  type AppData,
  type Currency,
  type ID,
  type Instrument,
  type Market,
} from './types';

// Passive target allocation and the new-money allocator. Everything here is
// advisory: functions return numbers and suggested trades, never transactions.
// Weights are signed fractions of NAV; nothing is clamped and no leverage cap
// is applied.

const EPS = 1e-9;
/** Residual gap (fraction of NAV) above which lot rounding is worth a warning. */
const ROUNDING_WARN_WEIGHT = 0.001;

/** Default fee estimate for securities, as a fraction of traded value. */
export const DEFAULT_FEE_RATE = 0.001;

// ---------------------------------------------------------------- compare

export interface InstrumentBreakdown {
  instrumentId: ID;
  symbol: string;
  bucket: ID;
  quantity: number;
  /** Signed exposure in base currency. */
  exposure: number;
  /** Exposure / net exposure of the whole index (all buckets). */
  share?: number;
}

export interface AllocationRow {
  indexId: ID;
  name: string;
  market: Market;
  hasTarget: boolean;
  /** Signed fraction of NAV. 0 when there is no target. */
  targetWeight: number;
  /** Absolute band, as a fraction of NAV. */
  tolerance: number;
  preferredInstrumentId?: ID;
  note?: string;
  /** targetWeight x NAV. */
  targetExposure: number;
  /** Net exposure of core-bucket positions only. */
  coreExposure: number;
  coreWeight: number;
  /** Net exposure of every non-core bucket, reported beside the core. */
  strategyExposure: number;
  strategyWeight: number;
  totalExposure: number;
  totalWeight: number;
  /** targetExposure - coreExposure, base currency. Positive = under-weight. */
  gap: number;
  /** targetWeight - coreWeight as a fraction (0.02 = 2 percentage points). */
  gapWeight: number;
  /** True when a target exists and |gapWeight| exceeds the tolerance. */
  outOfBand: boolean;
  instruments: InstrumentBreakdown[];
}

export interface MarketGroup {
  market: Market;
  rows: AllocationRow[];
  targetWeight: number;
  coreExposure: number;
  coreWeight: number;
  strategyExposure: number;
  totalExposure: number;
}

export interface AllocationTotals {
  nav: number;
  /** Sum of target weights. */
  targetNet: number;
  /** Sum of |target weights|. */
  targetGross: number;
  coreNet: number;
  coreGross: number;
  strategyNet: number;
  strategyGross: number;
  totalNet: number;
  totalGross: number;
}

export interface AllocationComparison {
  baseCurrency: Currency;
  nav: number;
  /** False when NAV is not positive: weights are then reported as 0. */
  navValid: boolean;
  rows: AllocationRow[];
  groups: MarketGroup[];
  totals: AllocationTotals;
  warnings: string[];
}

const MARKET_ORDER: Market[] = ['TW', 'US', 'GLOBAL', 'CRYPTO', 'OTHER'];

/** Target vs actual core exposure for every index with a target or exposure. */
export function compareAllocation(data: AppData, valuation: Valuation): AllocationComparison {
  const nav = valuation.nav;
  const navValid = nav > 0;
  const w = (x: number) => (navValid ? x / nav : 0);
  const warnings: string[] = [];
  if (!navValid) warnings.push('NAV 不為正，權重無法計算');

  // Merge duplicate target rows of one index: weights add, the tightest band wins.
  const targets = new Map<ID, { weight: number; tolerance: number; preferred?: ID; note?: string }>();
  for (const t of data.targets) {
    const cur = targets.get(t.indexId);
    if (cur) {
      cur.weight += t.targetWeight;
      cur.tolerance = Math.min(cur.tolerance, t.tolerance);
    } else {
      targets.set(t.indexId, {
        weight: t.targetWeight,
        tolerance: t.tolerance,
        preferred: t.preferredInstrumentId,
        note: t.note,
      });
    }
  }

  const ids = new Set<ID>(targets.keys());
  for (const p of valuation.positions) if (p.quantity !== 0) ids.add(p.indexId);
  const indexById = new Map(data.indices.map((i) => [i.id, i]));

  const rows: AllocationRow[] = [];
  for (const indexId of ids) {
    const idx = indexById.get(indexId);
    const target = targets.get(indexId);
    const positions = valuation.positions.filter((p) => p.indexId === indexId && p.quantity !== 0);
    const core = positions.filter((p) => p.bucket === CORE_BUCKET).reduce((s, p) => s + p.exposure, 0);
    const total = positions.reduce((s, p) => s + p.exposure, 0);
    const strategy = total - core;
    const targetWeight = target?.weight ?? 0;
    const tolerance = target?.tolerance ?? 0;
    const targetExposure = targetWeight * nav;
    const gapWeight = targetWeight - w(core);
    if (target && !idx) warnings.push(`目標引用了不存在的指數 ${indexId}`);
    rows.push({
      indexId,
      name: idx?.name ?? (indexId === UNCLASSIFIED_INDEX ? '未分類' : indexId),
      market: idx?.market ?? 'OTHER',
      hasTarget: !!target,
      targetWeight,
      tolerance,
      preferredInstrumentId: target?.preferred,
      note: target?.note,
      targetExposure,
      coreExposure: core,
      coreWeight: w(core),
      strategyExposure: strategy,
      strategyWeight: w(strategy),
      totalExposure: total,
      totalWeight: w(total),
      gap: targetExposure - core,
      gapWeight,
      outOfBand: !!target && navValid && Math.abs(gapWeight) > tolerance + EPS,
      instruments: breakdown(positions, total),
    });
  }
  rows.sort((a, b) => Math.abs(b.targetExposure) + Math.abs(b.totalExposure) - Math.abs(a.targetExposure) - Math.abs(a.totalExposure));

  const groups: MarketGroup[] = [];
  for (const market of MARKET_ORDER) {
    const mrows = rows.filter((r) => r.market === market);
    if (!mrows.length) continue;
    const sum = (f: (r: AllocationRow) => number) => mrows.reduce((s, r) => s + f(r), 0);
    groups.push({
      market,
      rows: mrows,
      targetWeight: sum((r) => r.targetWeight),
      coreExposure: sum((r) => r.coreExposure),
      coreWeight: sum((r) => r.coreWeight),
      strategyExposure: sum((r) => r.strategyExposure),
      totalExposure: sum((r) => r.totalExposure),
    });
  }

  const core = valuation.byBucket.find((b) => b.bucket === CORE_BUCKET);
  const coreNet = core?.net ?? 0;
  const coreGross = core?.gross ?? 0;
  const totals: AllocationTotals = {
    nav,
    targetNet: [...targets.values()].reduce((s, t) => s + t.weight, 0),
    targetGross: [...targets.values()].reduce((s, t) => s + Math.abs(t.weight), 0),
    coreNet,
    coreGross,
    strategyNet: valuation.netExposure - coreNet,
    strategyGross: valuation.grossExposure - coreGross,
    totalNet: valuation.netExposure,
    totalGross: valuation.grossExposure,
  };
  return { baseCurrency: valuation.baseCurrency, nav, navValid, rows, groups, totals, warnings };
}

function breakdown(positions: ValuedPosition[], indexNet: number): InstrumentBreakdown[] {
  return positions
    .map((p) => ({
      instrumentId: p.instrumentId,
      symbol: p.instrument.symbol,
      bucket: p.bucket,
      quantity: p.quantity,
      exposure: p.exposure,
      share: Math.abs(indexNet) > EPS ? p.exposure / indexNet : undefined,
    }))
    .sort((a, b) => Math.abs(b.exposure) - Math.abs(a.exposure));
}

// ------------------------------------------------------------------ helpers

/** Round a quantity toward zero to a multiple of `lot`. */
export function roundToLot(quantity: number, lot: number): number {
  const step = lot > 0 ? lot : 1;
  const n = Math.trunc(quantity / step + (quantity >= 0 ? EPS : -EPS));
  return Number((n * step).toFixed(10));
}

/** Base-currency exposure of one unit: price x multiplier x leverage x fx. */
export function unitExposure(i: Instrument, price: number, fx: number): number {
  return price * i.multiplier * i.leverage * fx;
}

function quoteOf(data: AppData, id: ID): number | undefined {
  const q = data.prices.find((p) => p.id === id);
  return q && q.price > 0 ? q.price : undefined;
}

// ---------------------------------------------------------- instrument cost

interface Cost {
  /** Cash tied up in the instrument currency: purchase cost + fee, or margin. */
  cash: number;
  fee: number;
  margin: boolean;
  /** Margin was needed but the instrument has no initialMargin. */
  marginMissing: boolean;
}

function costOf(i: Instrument, quantity: number, price: number, feeRate: number): Cost {
  const q = Math.abs(quantity);
  if (isDerivative(i.type)) {
    const m = i.initialMargin;
    return { cash: m && m > 0 ? q * m : 0, fee: 0, margin: true, marginMissing: !(m && m > 0) };
  }
  const value = q * price * i.multiplier;
  const fee = value * feeRate;
  return { cash: value + fee, fee, margin: false, marginMissing: false };
}

// ---------------------------------------------------------- instrument compare

export interface InstrumentComparison {
  instrumentId: ID;
  symbol: string;
  name: string;
  type: Instrument['type'];
  leverage: number;
  currency: Currency;
  price?: number;
  fxRate?: number;
  /** Quantity (contracts for futures) reaching the exposure, rounded toward zero to the lot. */
  quantity?: number;
  /** Cash for a security, or initial margin for a future (instrument currency). */
  cash?: number;
  cashBase?: number;
  /** True when `cash` is margin rather than purchase cost. */
  isMargin: boolean;
  /** Exposure actually reached after rounding, base currency. */
  exposure?: number;
  /** cashBase / exposure. */
  cashRatio?: number;
  notes: string[];
}

/** Ways to reach `exposureAmount` (base currency) of an index, per active instrument. */
export function compareInstruments(
  data: AppData,
  indexId: ID,
  exposureAmount: number,
  feeRate = DEFAULT_FEE_RATE,
): InstrumentComparison[] {
  const base = getSettings(data).baseCurrency;
  const fx = new FxTable(data.fxRates);
  return data.instruments
    .filter((i) => i.active && i.indexId === indexId)
    .map((i): InstrumentComparison => {
      const notes: string[] = [];
      const derivative = isDerivative(i.type);
      if (i.leverage !== 1) {
        notes.push(`${i.leverage}× 每日重設槓桿：長期報酬具路徑相依性（波動耗損），不等於指數 ${i.leverage} 倍的長期報酬；另有較高內扣費用`);
      }
      if (i.type === 'future') {
        notes.push('期貨需定期換月（roll）並承擔轉倉價差；保證金為占用資金而非曝險或負債；未動用資金的機會成本／融資成本需自行評估');
      }
      if (i.type === 'perpetual') notes.push('永續合約不需換月，但需支付／收取資金費率（funding）；保證金為占用資金');
      if (derivative && !(i.initialMargin && i.initialMargin > 0)) notes.push('缺少原始保證金設定，無法估算資金占用');

      const price = quoteOf(data, i.id);
      const rate = fx.rate(i.currency, base);
      const out: InstrumentComparison = {
        instrumentId: i.id,
        symbol: i.symbol,
        name: i.name,
        type: i.type,
        leverage: i.leverage,
        currency: i.currency,
        price,
        fxRate: rate,
        isMargin: derivative,
        notes,
      };
      if (price === undefined) notes.push('沒有報價，無法估算數量');
      if (rate === undefined) notes.push(`缺少 ${i.currency}/${base} 匯率，無法換算`);
      if (price === undefined || rate === undefined) return out;
      const unit = unitExposure(i, price, rate);
      if (!(unit > 0)) {
        notes.push('商品槓桿不為正，無法用於建立多方曝險');
        return out;
      }
      const quantity = roundToLot(exposureAmount / unit, i.lotSize);
      const cost = costOf(i, quantity, price, feeRate);
      out.quantity = quantity;
      out.cash = cost.cash;
      out.cashBase = cost.cash * rate;
      out.exposure = quantity * unit;
      out.cashRatio = out.exposure ? out.cashBase! / Math.abs(out.exposure) : undefined;
      return out;
    });
}

// ------------------------------------------------------------------ planner

export type FundingKind = 'external' | 'loan' | 'dividend' | 'internal';

export interface AllocationRequest {
  amount: number;
  currency: Currency;
  /**
   * external: outside deposit, raises NAV. loan: borrowed money, raises cash
   * and debt, NAV unchanged. dividend / internal: money already in the
   * portfolio as cash, NAV unchanged.
   */
  source: FundingKind;
  loanId?: ID;
  accountId: ID;
  /** false = new-money mode (buy only); true = rebalance mode (buys and sells). */
  allowSell: boolean;
  /** Also spend free cash already sitting in the receiving account. */
  useExistingCash?: boolean;
  /** indexId -> instrumentId, wins over the target's preferred instrument. */
  overrides?: Record<ID, ID>;
  /** Fee estimate for securities as a fraction of traded value. Defaults to the receiving institution's rate. */
  feeRate?: number;
}

export interface TradeSuggestion {
  indexId: ID;
  instrumentId: ID;
  symbol: string;
  side: 'buy' | 'sell';
  /** Always positive; `side` carries the direction. */
  quantity: number;
  price: number;
  currency: Currency;
  fxRate: number;
  /** Purchase cost + fee, or initial margin (instrument currency). Sells: proceeds are not counted here. */
  cashRequired: number;
  cashRequiredBase: number;
  fee: number;
  /** cashRequired is margin, not purchase cost. */
  isMargin: boolean;
  /** Signed change of index exposure, base currency. */
  exposureAdded: number;
  targetWeight: number;
  /** Core weight of the index after this trade (post-trade NAV). */
  postTradeWeight: number;
}

export interface ResidualGap {
  indexId: ID;
  name: string;
  targetWeight: number;
  postTradeWeight: number;
  /** target - post-trade core exposure at post-funding NAV, base currency. */
  gap: number;
  gapWeight: number;
}

export interface AllocationPlan {
  baseCurrency: Currency;
  source: FundingKind;
  amountBase: number;
  navBefore: number;
  /** NAV after the funding event, before trades: gaps are measured at this NAV. */
  postFundingNav: number;
  /** New money + optional free cash + sell proceeds, base currency. */
  availableCash: number;
  sellProceeds: number;
  suggestions: TradeSuggestion[];
  /** Cash and margin tied up by the buys. */
  cashUsed: number;
  leftoverCash: number;
  totalFees: number;
  /** Sum of positive gaps that could not be filled (base currency). */
  unfunded: number;
  postTrade: {
    nav: number;
    grossExposure: number;
    netExposure: number;
    grossLeverage?: number;
    netLeverage?: number;
  };
  residualGaps: ResidualGap[];
  warnings: string[];
}

interface Candidate {
  indexId: ID;
  instrument: Instrument;
  price: number;
  fx: number;
  unit: number;
  gap: number;
  /** Desired quantity before any shortfall scaling (lot-rounded). */
  quantity: number;
}

/** Choose the instrument for an index: override, then preferred, then the plain active one. */
export function pickInstrument(
  data: AppData,
  indexId: ID,
  preferred?: ID,
  override?: ID,
): Instrument | undefined {
  const byId = (id?: ID) => (id ? data.instruments.find((i) => i.id === id) : undefined);
  const explicit = byId(override) ?? byId(preferred);
  if (explicit) return explicit;
  const plain = data.instruments.filter((i) => i.active && i.indexId === indexId && i.leverage === 1);
  const cash = plain.filter((i) => !isDerivative(i.type));
  const pool = cash.length ? cash : plain;
  return pool.find((i) => quoteOf(data, i.id) !== undefined) ?? pool[0];
}

/**
 * Suggest trades that move the core toward its targets. The order matters
 * (spec section 5): post-funding NAV first, then the gap at that NAV, then
 * cash, lots, margin and fees. Returns advice only, never transactions.
 */
export function planAllocation(
  data: AppData,
  valuation: Valuation,
  request: AllocationRequest,
): AllocationPlan {
  const base = valuation.baseCurrency;
  const fx = new FxTable(data.fxRates);
  // Explicit request rate, else the receiving institution's rate, else the default.
  const receiving = data.accounts.find((a) => a.id === request.accountId);
  const feeRate =
    request.feeRate ??
    effectiveSecuritiesRate(data.brokers.find((b) => b.id === receiving?.brokerId)) ??
    DEFAULT_FEE_RATE;
  const warnings: string[] = [];
  const empty = (): AllocationPlan => ({
    baseCurrency: base,
    source: request.source,
    amountBase: 0,
    navBefore: valuation.nav,
    postFundingNav: valuation.nav,
    availableCash: 0,
    sellProceeds: 0,
    suggestions: [],
    cashUsed: 0,
    leftoverCash: 0,
    totalFees: 0,
    unfunded: 0,
    postTrade: {
      nav: valuation.nav,
      grossExposure: valuation.grossExposure,
      netExposure: valuation.netExposure,
      grossLeverage: valuation.grossLeverage,
      netLeverage: valuation.netLeverage,
    },
    residualGaps: [],
    warnings,
  });

  // 1. Funding and post-funding NAV.
  const amount = Math.max(0, request.amount);
  const amountRate = fx.rate(request.currency, base);
  if (amountRate === undefined) {
    warnings.push(`缺少 ${request.currency}/${base} 匯率，無法換算新資金`);
    return empty();
  }
  const amountBase = amount * amountRate;
  if (request.source === 'loan') {
    const loan = request.loanId ? data.loans.find((l) => l.id === request.loanId) : undefined;
    if (!loan) warnings.push('資金來源為借款，但找不到指定的借款');
  }
  // Only an outside deposit raises NAV. Loan proceeds add cash and debt in
  // equal parts; dividends and internal moves are already part of NAV.
  const postFundingNav = valuation.nav + (request.source === 'external' ? amountBase : 0);
  if (!(postFundingNav > 0)) {
    warnings.push('交易後 NAV 不為正，無法評估目標缺口');
    const p = empty();
    p.amountBase = amountBase;
    p.postFundingNav = postFundingNav;
    return p;
  }

  let pool = amountBase;
  if (request.useExistingCash) {
    const free = valuation.cash
      .filter((c) => c.accountId === request.accountId && c.value > 0)
      .reduce((s, c) => s + c.value, 0);
    // Dividend / internal money is already inside that cash: do not count it twice.
    const inCash = request.source === 'dividend' || request.source === 'internal' ? amountBase : 0;
    pool += Math.max(0, free - inCash);
  }

  const account = data.accounts.find((a) => a.id === request.accountId);
  if (!account) warnings.push('找不到指定的帳戶');

  // 2. Gaps at post-funding NAV.
  const cmp = compareAllocation(data, valuation);
  const coreExposure = new Map<ID, number>(cmp.rows.map((r) => [r.indexId, r.coreExposure]));
  const targetRows = cmp.rows.filter((r) => r.hasTarget);
  const gapOf = (r: AllocationRow) => r.targetWeight * postFundingNav - r.coreExposure;

  const sells: TradeSuggestion[] = [];
  const buys: Candidate[] = [];
  let sellProceeds = 0;
  let sellFees = 0;

  for (const row of targetRows) {
    const gap = gapOf(row);
    const gapWeight = gap / postFundingNav;
    if (Math.abs(gap) < EPS) continue;
    // Rebalance mode only acts on indices outside their band; new-money mode
    // buys every under-weight.
    if (request.allowSell && Math.abs(gapWeight) <= row.tolerance + EPS) continue;
    if (gap < 0 && !request.allowSell) continue;

    if (gap < 0) {
      let remaining = -gap;
      const held = valuation.positions
        .filter((p) => p.indexId === row.indexId && p.bucket === CORE_BUCKET && p.quantity > 0 && p.exposure > 0)
        .sort((a, b) => b.exposure - a.exposure);
      for (const p of held) {
        if (remaining <= EPS) break;
        if (p.priceStatus === 'missing') {
          warnings.push(`${p.instrument.symbol} 沒有報價，略過賣出建議`);
          continue;
        }
        if (!(p.fxRate > 0)) {
          warnings.push(`缺少 ${p.instrument.currency}/${base} 匯率，略過 ${p.instrument.symbol}`);
          continue;
        }
        const unit = unitExposure(p.instrument, p.price, p.fxRate);
        const qty = Math.min(p.quantity, roundToLot(remaining / unit, p.instrument.lotSize));
        if (!(qty > 0)) continue;
        const cost = costOf(p.instrument, qty, p.price, feeRate);
        if (!cost.margin) {
          sellProceeds += (qty * p.price * p.instrument.multiplier - cost.fee) * p.fxRate;
          sellFees += cost.fee * p.fxRate;
        }
        sells.push({
          indexId: row.indexId,
          instrumentId: p.instrumentId,
          symbol: p.instrument.symbol,
          side: 'sell',
          quantity: qty,
          price: p.price,
          currency: p.instrument.currency,
          fxRate: p.fxRate,
          cashRequired: 0,
          cashRequiredBase: 0,
          fee: cost.fee,
          isMargin: cost.margin,
          exposureAdded: -qty * unit,
          targetWeight: row.targetWeight,
          postTradeWeight: 0,
        });
        remaining -= qty * unit;
        coreExposure.set(row.indexId, (coreExposure.get(row.indexId) ?? 0) - qty * unit);
      }
      if (remaining > EPS && remaining / postFundingNav > row.tolerance + EPS) {
        warnings.push(`${row.name} 目標低於持有部位且無足夠持倉可賣；被動核心的建議不建立空頭部位。短期避險可自行以期貨建立並歸入主動策略，其曝險會計入整體 Gross / Net 槓桿`);
      }
      continue;
    }

    // Under-weight: pick an instrument and size the buy.
    const inst = pickInstrument(data, row.indexId, row.preferredInstrumentId, request.overrides?.[row.indexId]);
    if (!inst) {
      warnings.push(`${row.name} 沒有可用的商品`);
      continue;
    }
    const price = quoteOf(data, inst.id);
    if (price === undefined) {
      warnings.push(`${inst.symbol} 沒有報價，無法建議 ${row.name} 的交易`);
      continue;
    }
    const rate = fx.rate(inst.currency, base);
    if (rate === undefined) {
      warnings.push(`缺少 ${inst.currency}/${base} 匯率，無法建議 ${inst.symbol}`);
      continue;
    }
    const unit = unitExposure(inst, price, rate);
    if (!(unit > 0)) {
      warnings.push(`${inst.symbol} 槓桿不為正，無法用來補足 ${row.name} 的多方缺口`);
      continue;
    }
    if (account && inst.brokerIds?.length && !inst.brokerIds.includes(account.brokerId)) {
      warnings.push(`${inst.symbol} 不在帳戶「${account.name}」的券商可交易清單內`);
    }
    buys.push({
      indexId: row.indexId,
      instrument: inst,
      price,
      fx: rate,
      unit,
      gap,
      quantity: roundToLot(gap / unit, inst.lotSize),
    });
  }

  // 3. Fund the buys; scale proportionally to the gaps when cash is short.
  const available = pool + sellProceeds;
  const costBase = (c: Candidate, q: number) => costOf(c.instrument, q, c.price, feeRate).cash * c.fx;
  const need = buys.reduce((s, c) => s + costBase(c, c.quantity), 0);
  const factor = need > available + EPS ? available / need : 1;
  if (factor < 1) warnings.push('可用資金不足以補足所有缺口，已依缺口比例分配');

  const buySuggestions: TradeSuggestion[] = [];
  const marginWarned = new Set<ID>();
  let cashUsed = 0;
  let buyFees = 0;
  for (const c of buys) {
    const scalable = costBase(c, c.quantity) > 0;
    const quantity = factor < 1 && scalable ? roundToLot(c.quantity * factor, c.instrument.lotSize) : c.quantity;
    if (!(quantity > 0)) {
      if (!scalable || factor === 1) {
        warnings.push(`${c.instrument.symbol} 最小交易單位大於缺口，湊整後無法下單`);
      }
      continue;
    }
    const cost = costOf(c.instrument, quantity, c.price, feeRate);
    if (cost.marginMissing && !marginWarned.has(c.instrument.id)) {
      marginWarned.add(c.instrument.id);
      warnings.push(`${c.instrument.symbol} 缺少原始保證金設定，資金占用以 0 估算`);
    }
    cashUsed += cost.cash * c.fx;
    buyFees += cost.fee * c.fx;
    buySuggestions.push({
      indexId: c.indexId,
      instrumentId: c.instrument.id,
      symbol: c.instrument.symbol,
      side: 'buy',
      quantity,
      price: c.price,
      currency: c.instrument.currency,
      fxRate: c.fx,
      cashRequired: cost.cash,
      cashRequiredBase: cost.cash * c.fx,
      fee: cost.fee,
      isMargin: cost.margin,
      exposureAdded: quantity * c.unit,
      targetWeight: 0,
      postTradeWeight: 0,
    });
  }

  const suggestions = [...sells, ...buySuggestions];
  const totalFees = sellFees + buyFees;

  // 4. Post-trade state.
  const exposureByKey = new Map<string, number>();
  for (const p of valuation.positions) {
    exposureByKey.set(`${p.instrumentId}|${p.bucket}`, p.exposure);
  }
  const added = new Map<ID, number>();
  for (const s of suggestions) {
    const key = `${s.instrumentId}|${CORE_BUCKET}`;
    exposureByKey.set(key, (exposureByKey.get(key) ?? 0) + s.exposureAdded);
    added.set(s.indexId, (added.get(s.indexId) ?? 0) + s.exposureAdded);
  }
  let gross = 0;
  let net = 0;
  for (const e of exposureByKey.values()) {
    gross += Math.abs(e);
    net += e;
  }
  const postNav = postFundingNav - totalFees;

  const residualGaps: ResidualGap[] = [];
  let unfunded = 0;
  for (const row of targetRows) {
    const post = row.coreExposure + (added.get(row.indexId) ?? 0);
    const gap = row.targetWeight * postFundingNav - post;
    residualGaps.push({
      indexId: row.indexId,
      name: row.name,
      targetWeight: row.targetWeight,
      postTradeWeight: post / postNav,
      gap,
      gapWeight: gap / postFundingNav,
    });
    if (gap > EPS) unfunded += gap;
  }
  for (const s of suggestions) {
    s.targetWeight = targetRows.find((r) => r.indexId === s.indexId)?.targetWeight ?? 0;
    s.postTradeWeight = residualGaps.find((r) => r.indexId === s.indexId)?.postTradeWeight ?? 0;
  }
  if (factor === 1) {
    for (const b of buys) {
      const left = residualGaps.find((r) => r.indexId === b.indexId);
      if (left && left.gapWeight > ROUNDING_WARN_WEIGHT && buySuggestions.some((s) => s.indexId === b.indexId)) {
        warnings.push(`${b.instrument.symbol} 受最小交易單位／整數口數限制，仍有 ${left.gap.toFixed(0)} ${base} 的缺口`);
      }
    }
  }

  return {
    baseCurrency: base,
    source: request.source,
    amountBase,
    navBefore: valuation.nav,
    postFundingNav,
    availableCash: available,
    sellProceeds,
    suggestions,
    cashUsed,
    leftoverCash: available - cashUsed,
    totalFees,
    unfunded,
    postTrade: {
      nav: postNav,
      grossExposure: gross,
      netExposure: net,
      grossLeverage: postNav > 0 ? gross / postNav : undefined,
      netLeverage: postNav > 0 ? net / postNav : undefined,
    },
    residualGaps,
    warnings,
  };
}
