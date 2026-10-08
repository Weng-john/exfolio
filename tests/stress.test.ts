import { describe, expect, it } from 'vitest';
import {
  computePortfolio,
  runStressTest,
  scaleFxRates,
  FxTable,
  STRESS_PRESETS,
  type AppData,
  type Instrument,
} from '@core/index';
import { fresh, NOW, setFx, setPrice, tx } from './helpers';

const opts = { now: NOW };
const D = '2026-09-01';

function patch(data: AppData, id: string, p: Partial<Instrument>) {
  data.instruments = data.instruments.map((i) => (i.id === id ? { ...i, ...p } : i));
}

/**
 * Fictional book (base TWD, USD/TWD 30):
 *  kgi_tw : cash 700,000 (incl. 300,000 loan), 0050 x5000 @100, 00631L (2x) x2000 @50
 *  kgi_fut: cash 300,000, 2 MTX @20,000 (multiplier 50), no unrealized P&L
 *  sinopac_us: VOO x10 @500 USD, cash 5,000 USD
 *  loan L1: 300,000 TWD pledged by 5,000 x 0050, call ratio 1.4
 * NAV 1,600,000; gross exposure 2,850,000 (1.78125x).
 */
function book(): AppData {
  const data = fresh();
  setFx(data, 'USD', 'TWD', 30);
  setPrice(data, 'tw_0050', 100);
  setPrice(data, 'tw_00631L', 50);
  setPrice(data, 'fut_MTX', 20_000);
  setPrice(data, 'us_VOO', 500, 'USD');
  patch(data, 'fut_MTX', { maintenanceMargin: 40_000 });
  data.loans.push({
    id: 'L1',
    name: '質押借款',
    kind: 'pledge',
    lender: '示範銀行',
    currency: 'TWD',
    principal: 300_000,
    annualRate: 0.03,
    method: 'interest_only',
    startDate: '2026-08-01',
    termMonths: 12,
    payDay: 1,
    collateral: [
      { instrumentId: 'tw_0050', accountId: 'kgi_tw', quantity: 5000, loanableRatio: 0.6 },
    ],
    callRatio: 1.4,
    active: true,
  });
  data.transactions.push(
    tx({ type: 'deposit', date: D, amount: 1_000_000 }),
    tx({ type: 'loan_draw', date: D, amount: 300_000, loanId: 'L1' }),
    tx({ type: 'buy', date: D, instrumentId: 'tw_0050', quantity: 5000, price: 100 }),
    tx({ type: 'buy', date: D, instrumentId: 'tw_00631L', quantity: 2000, price: 50 }),
    tx({ type: 'deposit', date: D, accountId: 'kgi_fut', amount: 300_000 }),
    tx({
      type: 'buy',
      date: D,
      accountId: 'kgi_fut',
      instrumentId: 'fut_MTX',
      quantity: 2,
      price: 20_000,
    }),
    tx({
      type: 'deposit',
      date: D,
      accountId: 'sinopac_us',
      currency: 'USD',
      amount: 10_000,
      fxRate: 30,
    }),
    tx({
      type: 'buy',
      date: D,
      accountId: 'sinopac_us',
      currency: 'USD',
      instrumentId: 'us_VOO',
      quantity: 10,
      price: 500,
    }),
  );
  return data;
}

const run = (data: AppData, shocks: Parameters<typeof runStressTest>[2]) =>
  runStressTest(data, computePortfolio(data, opts), shocks, opts);

const SHOCKS = {
  indexMoves: { tw50: -0.2, taiex: -0.1, sp500: -0.15 },
  currencyMoves: { USD: -0.05 },
};

describe('runStressTest: hand-computed case', () => {
  const r = run(book(), SHOCKS);

  it('matches the baseline valuation before the shock', () => {
    expect(r.before.nav).toBeCloseTo(1_600_000, 6);
    expect(r.before.grossExposure).toBeCloseTo(2_850_000, 6);
    expect(r.before.grossLeverage).toBeCloseTo(1.78125, 6);
    expect(r.before.debtToNav).toBeCloseTo(300_000 / 1_600_000, 9);
  });

  it('revalues every leg: unleveraged, 2x ETF, futures and a USD holding', () => {
    const pos = (s: string) => r.positions.find((p) => p.symbol === s)!;
    expect(pos('0050').priceAfter).toBeCloseTo(80);
    expect(pos('0050').pnl).toBeCloseTo(-100_000);
    // 2x ETF: -20% index -> -40% price
    expect(pos('00631L').priceMove).toBeCloseTo(-0.4);
    expect(pos('00631L').priceAfter).toBeCloseTo(30);
    expect(pos('00631L').pnl).toBeCloseTo(-40_000);
    // futures: 2 x (18,000 - 20,000) x 50, settled against cash
    expect(pos('MTX').priceAfter).toBeCloseTo(18_000);
    expect(pos('MTX').pnl).toBeCloseTo(-200_000);
    // VOO 425 USD x 10 at 28.5
    expect(pos('VOO').priceAfter).toBeCloseTo(425);
    expect(pos('VOO').valueAfter).toBeCloseTo(121_125);
    expect(pos('VOO').pnl).toBeCloseTo(-28_875);
  });

  it('gives NAV, P&L, remaining ratio and the cash FX loss', () => {
    // 1,600,000 - 100,000 - 40,000 - 200,000 - 28,875 - 7,500 (USD cash)
    expect(r.after.nav).toBeCloseTo(1_223_625, 6);
    expect(r.pnl).toBeCloseTo(-376_375, 6);
    expect(r.otherPnl).toBeCloseTo(-7_500, 6);
    expect(r.remainingNavRatio).toBeCloseTo(1_223_625 / 1_600_000, 9);
  });

  it('leverage rises after a loss because NAV shrinks faster than exposure', () => {
    expect(r.after.grossExposure).toBeCloseTo(2_441_125, 6);
    expect(r.after.grossLeverage).toBeCloseTo(2_441_125 / 1_223_625, 9);
    expect(r.after.grossLeverage!).toBeGreaterThan(r.before.grossLeverage!);
    expect(r.after.debtToNav!).toBeGreaterThan(r.before.debtToNav!);
    const tw50 = r.byIndex.find((i) => i.indexId === 'tw50')!;
    expect(tw50.netBefore).toBeCloseTo(700_000);
    expect(tw50.netAfter).toBeCloseTo(520_000);
  });

  it('always carries the caveats and no leverage cap', () => {
    expect(r.caveats.some((c) => c.includes('瞬間'))).toBe(true);
    expect(r.caveats.some((c) => c.includes('路徑依賴'))).toBe(true);
  });
});

describe('floor, uniform default and presets', () => {
  it('floors a 3x ETF at -100% instead of going negative', () => {
    const data = fresh();
    setFx(data, 'USD', 'TWD', 30);
    setPrice(data, 'us_UPRO', 100, 'USD');
    data.transactions.push(
      tx({
        type: 'deposit',
        date: D,
        accountId: 'sinopac_us',
        currency: 'USD',
        amount: 1000,
        fxRate: 30,
      }),
      tx({
        type: 'buy',
        date: D,
        accountId: 'sinopac_us',
        currency: 'USD',
        instrumentId: 'us_UPRO',
        quantity: 5,
        price: 100,
      }),
    );
    const r = run(data, { indexMoves: { sp500: -0.4 }, currencyMoves: {} });
    const p = r.positions[0];
    expect(p.floored).toBe(true);
    expect(p.priceMove).toBe(-1);
    expect(p.priceAfter).toBe(0);
    expect(p.valueAfter).toBeCloseTo(0, 6);
    expect(r.warnings.some((w) => w.includes('UPRO'))).toBe(true);
    // the 500 USD cash is untouched: NAV never falls below it
    expect(r.after.nav).toBeCloseTo(500 * 30, 6);
  });

  it('applies the uniform default to indices not listed', () => {
    const data = book();
    const r = run(data, { indexMoves: { sp500: 0 }, currencyMoves: {}, defaultIndexMove: -0.1 });
    expect(r.positions.find((p) => p.symbol === '0050')!.priceAfter).toBeCloseTo(90);
    expect(r.positions.find((p) => p.symbol === 'VOO')!.priceAfter).toBeCloseTo(500);
  });

  it('ships labelled preset shock sets', () => {
    expect(STRESS_PRESETS.length).toBeGreaterThanOrEqual(6);
    for (const p of STRESS_PRESETS) expect(p.description).toContain('示意');
    expect(STRESS_PRESETS.find((p) => p.id === 'btc_m50')!.shocks.indexMoves.btc).toBe(-0.5);
  });
});

describe('FX scaling', () => {
  it('keeps chained pairs consistent', () => {
    const data = fresh();
    setFx(data, 'USD', 'TWD', 30);
    setFx(data, 'USDT', 'USD', 1);
    const fx = new FxTable(scaleFxRates(data.fxRates, { USD: 0.1, USDT: 0.1 }));
    expect(fx.rate('USD', 'TWD')).toBeCloseTo(33);
    expect(fx.rate('USDT', 'TWD')).toBeCloseTo(33);
    const only = new FxTable(scaleFxRates(data.fxRates, { USD: 0.1 }));
    expect(only.rate('USDT', 'TWD')).toBeCloseTo(30); // USDT flat against TWD
  });
});

describe('pledged loans', () => {
  it('detects the maintenance ratio crossing callRatio and the cure amount', () => {
    const r = run(book(), SHOCKS);
    const l = r.loans[0];
    expect(l.ratioBefore).toBeCloseTo(500_000 / 300_000, 9);
    expect(l.belowCallBefore).toBe(false);
    expect(l.ratioAfter).toBeCloseTo(400_000 / 300_000, 9);
    expect(l.belowCallAfter).toBe(true);
    // repay: 300,000 - 400,000 / 1.4 ; collateral: 1.4 x 300,000 - 400,000
    expect(l.cureRepayment).toBeCloseTo(300_000 - 400_000 / 1.4, 6);
    expect(l.cureCollateral).toBeCloseTo(20_000, 6);
    expect(r.warnings.some((w) => w.includes('質押借款'))).toBe(true);
  });

  it('stays above the call under a milder shock', () => {
    const r = run(book(), { indexMoves: { tw50: -0.1 }, currencyMoves: {} });
    expect(r.loans[0].belowCallAfter).toBe(false);
    expect(r.loans[0].cureRepayment).toBeUndefined();
  });
});

describe('futures margin', () => {
  it('reports equity, requirement and the liquidation move', () => {
    const r = run(book(), SHOCKS);
    const m = r.margins.find((x) => x.accountId === 'kgi_fut')!;
    expect(m.equityBefore).toBeCloseTo(300_000);
    expect(m.equityAfter).toBeCloseTo(100_000);
    expect(m.required).toBeCloseTo(80_000);
    expect(m.shortfall).toBe(0);
    // (80,000 - 300,000) / (2 x 20,000 x 50)
    expect(m.liquidationMove).toBeCloseTo(-0.11, 9);
  });

  it('reports the shortfall when equity falls below the requirement', () => {
    const data = book();
    patch(data, 'fut_MTX', { maintenanceMargin: 60_000 });
    const r = run(data, SHOCKS);
    const m = r.margins.find((x) => x.accountId === 'kgi_fut')!;
    expect(m.required).toBeCloseTo(120_000);
    expect(m.shortfall).toBeCloseTo(20_000);
    expect(m.shortfallBase).toBeCloseTo(20_000);
    expect(r.warnings.some((w) => w.includes('缺口'))).toBe(true);
  });

  it('flags a missing margin spec instead of assuming zero', () => {
    const data = book();
    patch(data, 'fut_MTX', { maintenanceMargin: undefined });
    const r = run(data, SHOCKS);
    const m = r.margins.find((x) => x.accountId === 'kgi_fut')!;
    expect(m.missingSpecs).toEqual(['fut_MTX']);
    expect(m.liquidationMove).toBeUndefined();
    expect(r.warnings.some((w) => w.includes('缺少維持保證金'))).toBe(true);
  });
});

describe('interest', () => {
  it('shifts projected monthly interest under a floating-rate assumption', () => {
    const r = run(book(), { indexMoves: {}, currencyMoves: {}, rateShift: 2 });
    expect(r.interest.before).toBeCloseTo(750); // 300,000 x 3% / 12
    expect(r.interest.after).toBeCloseTo(1250); // 5%
    expect(r.interest.delta).toBeCloseTo(500);
  });

  it('never lets the shifted rate go below zero', () => {
    const r = run(book(), { indexMoves: {}, currencyMoves: {}, rateShift: -10 });
    expect(r.interest.after).toBe(0);
  });
});
