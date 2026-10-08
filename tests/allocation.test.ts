import { describe, expect, it } from 'vitest';
import {
  compareAllocation,
  compareInstruments,
  computePortfolio,
  planAllocation,
  roundToLot,
  type AllocationRequest,
  type AppData,
} from '@core/index';
import { fresh, NOW, setFx, setPrice, setTarget, tx } from './helpers';

const opts = { now: NOW };

/** NAV 1,000,000 TWD: 500,000 cash + 5,000 x 0050 @ 100 in the core. */
function base(): AppData {
  const data = fresh();
  data.transactions.push(
    tx({ type: 'deposit', date: '2026-01-01', amount: 1_000_000 }),
    tx({ type: 'buy', date: '2026-01-02', instrumentId: 'tw_0050', quantity: 5000, price: 100 }),
  );
  setPrice(data, 'tw_0050', 100);
  return data;
}

const val = (d: AppData) => computePortfolio(d, opts).valuation;
const req = (r: Partial<AllocationRequest> = {}): AllocationRequest => ({
  amount: 500_000,
  currency: 'TWD',
  source: 'external',
  accountId: 'kgi_tw',
  allowSell: false,
  feeRate: 0,
  ...r,
});

describe('compareAllocation', () => {
  it('keeps weights above 100% and negative targets unclamped', () => {
    const data = base();
    setTarget(data, 'tw50', 1.5);
    setTarget(data, 'sp500', -0.2);
    const c = compareAllocation(data, val(data));
    const tw = c.rows.find((r) => r.indexId === 'tw50')!;
    expect(tw.targetWeight).toBe(1.5);
    expect(tw.targetExposure).toBe(1_500_000);
    expect(tw.coreExposure).toBe(500_000);
    expect(tw.gap).toBe(1_000_000);
    expect(tw.gapWeight).toBeCloseTo(1);
    expect(tw.outOfBand).toBe(true);
    const sp = c.rows.find((r) => r.indexId === 'sp500')!;
    expect(sp.targetExposure).toBe(-200_000);
    expect(sp.gap).toBe(-200_000);
    expect(c.totals.targetNet).toBeCloseTo(1.3);
    expect(c.totals.targetGross).toBeCloseTo(1.7);
  });

  it('reports strategy exposure separately and does not count it against the core target', () => {
    const data = base();
    data.transactions.push(
      tx({
        type: 'buy',
        date: '2026-01-03',
        bucket: 'strat1',
        instrumentId: 'tw_0050',
        quantity: 1000,
        price: 100,
      }),
    );
    setTarget(data, 'tw50', 0.5);
    const c = compareAllocation(data, val(data));
    const tw = c.rows.find((r) => r.indexId === 'tw50')!;
    expect(tw.coreExposure).toBe(500_000);
    expect(tw.strategyExposure).toBe(100_000);
    expect(tw.totalExposure).toBe(600_000);
    expect(tw.gap).toBeCloseTo(c.nav * 0.5 - 500_000);
    expect(tw.instruments.map((i) => i.bucket).sort()).toEqual(['core', 'strat1']);
    expect(tw.instruments.find((i) => i.bucket === 'core')!.share).toBeCloseTo(500 / 600);
    expect(c.totals.coreNet).toBe(500_000);
    expect(c.totals.strategyNet).toBe(100_000);
    expect(c.totals.totalNet).toBe(600_000);
  });

  it('groups rows by market and flags the tolerance band', () => {
    const data = base();
    setTarget(data, 'tw50', 0.5, { tolerance: 0.05 });
    setTarget(data, 'sp500', 0.1);
    const c = compareAllocation(data, val(data));
    expect(c.groups.map((g) => g.market)).toEqual(['TW', 'US']);
    expect(c.rows.find((r) => r.indexId === 'tw50')!.outOfBand).toBe(false);
    expect(c.rows.find((r) => r.indexId === 'sp500')!.outOfBand).toBe(true);
  });
});

describe('planAllocation: post-funding NAV comes first', () => {
  const data = base();
  setTarget(data, 'tw50', 0.6);
  const v = val(data);

  it('external money raises NAV before the gap is measured', () => {
    const p = planAllocation(data, v, req({ source: 'external' }));
    expect(p.postFundingNav).toBe(1_500_000);
    // target 900,000 - actual 500,000 = 400,000 -> 4,000 shares
    expect(p.suggestions).toHaveLength(1);
    expect(p.suggestions[0]).toMatchObject({ symbol: '0050', side: 'buy', quantity: 4000 });
    expect(p.cashUsed).toBe(400_000);
    expect(p.leftoverCash).toBe(100_000);
    expect(p.postTrade.nav).toBe(1_500_000);
    expect(p.suggestions[0].postTradeWeight).toBeCloseTo(0.6);
  });

  it('loan proceeds raise cash and debt but not NAV', () => {
    data.loans.push({
      id: 'l1',
      name: '信貸',
      kind: 'credit',
      lender: '銀行',
      currency: 'TWD',
      principal: 500_000,
      annualRate: 0.03,
      method: 'annuity',
      startDate: '2026-01-01',
      active: true,
    });
    const p = planAllocation(data, v, req({ source: 'loan', loanId: 'l1' }));
    data.loans.pop();
    expect(p.postFundingNav).toBe(1_000_000);
    expect(p.suggestions[0].quantity).toBe(1000); // 600,000 - 500,000
    expect(p.availableCash).toBe(500_000);
  });

  it('dividend and internal money are already in NAV and in cash', () => {
    for (const source of ['dividend', 'internal'] as const) {
      const p = planAllocation(data, v, req({ source, amount: 100_000, useExistingCash: true }));
      expect(p.postFundingNav).toBe(1_000_000);
      expect(p.suggestions[0].quantity).toBe(1000);
      // 100,000 is part of the 500,000 account cash: not counted twice.
      expect(p.availableCash).toBe(500_000);
    }
  });

  it('external money plus existing cash adds both', () => {
    const p = planAllocation(data, v, req({ useExistingCash: true }));
    expect(p.availableCash).toBe(1_000_000);
  });
});

describe('planAllocation: instruments, lots and cash need', () => {
  it('rounds toward zero to the lot size', () => {
    expect(roundToLot(813.9, 1)).toBe(813);
    expect(roundToLot(-813.9, 1)).toBe(-813);
    expect(roundToLot(12.3456, 0.01)).toBe(12.34);
    const data = base();
    setPrice(data, 'tw_0050', 123);
    setTarget(data, 'tw50', 0.6);
    const p = planAllocation(data, val(data), req({ source: 'dividend', amount: 100_000 }));
    // post NAV differs from 1M because 0050 is marked at 123: just check rounding
    const s = p.suggestions[0];
    expect(Number.isInteger(s.quantity)).toBe(true);
    expect(s.exposureAdded).toBeLessThanOrEqual(p.residualGaps[0].gap + s.exposureAdded + 1e-6);
    expect(p.residualGaps[0].gap).toBeLessThan(123);
  });

  it('a leveraged ETF needs less cash than its exposure', () => {
    const data = base();
    setPrice(data, 'tw_00631L', 200);
    setTarget(data, 'tw50', 1.2, { preferredInstrumentId: 'tw_00631L' });
    // NAV 1M, target 1.2M, core 0.5M: gap 700k, unit = 200 x 2 = 400
    const p = planAllocation(data, val(data), req({ source: 'internal', amount: 500_000 }));
    expect(p.suggestions[0]).toMatchObject({ symbol: '00631L', quantity: 1750 });
    expect(p.suggestions[0].exposureAdded).toBe(700_000);
    expect(p.cashUsed).toBe(350_000);
  });

  it('a future needs whole contracts and only margin', () => {
    const data = base();
    const mtx = data.instruments.find((i) => i.id === 'fut_MTX')!;
    mtx.initialMargin = 100_000;
    setPrice(data, 'fut_MTX', 20_000); // 1,000,000 per contract
    setTarget(data, 'taiex', 2.5, { preferredInstrumentId: 'fut_MTX' });
    // NAV 1M, target 2.5M: 2.5 contracts -> 2
    const p = planAllocation(data, val(data), req({ source: 'internal', amount: 500_000 }));
    const s = p.suggestions[0];
    expect(s).toMatchObject({ symbol: 'MTX', quantity: 2, isMargin: true, cashRequired: 200_000 });
    expect(s.exposureAdded).toBe(2_000_000);
    expect(p.cashUsed).toBe(200_000);
    expect(p.postTrade.grossLeverage).toBeCloseTo(2.5); // (0.5M + 2M) / 1M
    expect(p.warnings.some((w) => w.includes('整數口數'))).toBe(true);
  });

  it('warns when the margin is unknown', () => {
    const data = base();
    setPrice(data, 'fut_MTX', 20_000);
    setTarget(data, 'taiex', 2, { preferredInstrumentId: 'fut_MTX' });
    const p = planAllocation(data, val(data), req({ source: 'internal', amount: 1 }));
    expect(p.suggestions[0].quantity).toBe(2);
    expect(p.suggestions[0].cashRequired).toBe(0);
    expect(p.warnings.some((w) => w.includes('保證金'))).toBe(true);
  });

  it('converts a USD instrument to the TWD base', () => {
    const data = base();
    setPrice(data, 'us_VOO', 400, 'USD');
    setFx(data, 'USD', 'TWD', 32);
    setTarget(data, 'sp500', 0.64);
    // NAV 1M, gap 640,000 TWD; one share = 400 x 32 = 12,800 -> 50 shares
    const p = planAllocation(
      data,
      val(data),
      req({ source: 'internal', amount: 700_000, feeRate: 0.001 }),
    );
    const s = p.suggestions[0];
    expect(s).toMatchObject({ symbol: 'VOO', quantity: 50, currency: 'USD', fxRate: 32 });
    expect(s.cashRequired).toBeCloseTo(20_000 * 1.001);
    expect(s.cashRequiredBase).toBeCloseTo(640_000 * 1.001);
    expect(s.exposureAdded).toBe(640_000);
  });

  it('an override beats the preferred instrument', () => {
    const data = base();
    setPrice(data, 'us_VOO', 400, 'USD');
    setPrice(data, 'us_SSO', 100, 'USD');
    setFx(data, 'USD', 'TWD', 32);
    setTarget(data, 'sp500', 0.32, { preferredInstrumentId: 'us_VOO' });
    const p = planAllocation(
      data,
      val(data),
      req({ source: 'internal', amount: 320_000, overrides: { sp500: 'us_SSO' } }),
    );
    expect(p.suggestions[0]).toMatchObject({ symbol: 'SSO', quantity: 50 }); // 320,000 / (100 x 2 x 32)
  });
});

describe('planAllocation: shortfall, sells, warnings', () => {
  it('allocates proportionally to the gaps when cash is short', () => {
    const data = base();
    setPrice(data, 'us_VOO', 100, 'USD');
    setFx(data, 'USD', 'TWD', 10);
    setTarget(data, 'tw50', 0.7); // gap 200,000 at NAV 1M
    setTarget(data, 'sp500', 0.2); // gap 200,000... made unequal below
    setTarget(data, 'ndx', 0); // no gap
    data.targets.find((t) => t.indexId === 'sp500')!.targetWeight = 0.4; // gap 400,000
    const p = planAllocation(data, val(data), req({ source: 'internal', amount: 300_000 }));
    const tw = p.suggestions.find((s) => s.indexId === 'tw50')!;
    const sp = p.suggestions.find((s) => s.indexId === 'sp500')!;
    expect(tw.exposureAdded).toBe(100_000); // 200k x (300k / 600k)
    expect(sp.exposureAdded).toBe(200_000);
    expect(p.cashUsed).toBeLessThanOrEqual(300_000);
    expect(p.unfunded).toBeCloseTo(300_000);
    expect(p.warnings.some((w) => w.includes('比例'))).toBe(true);
  });

  it('new-money mode never sells an over-weight index', () => {
    const data = base();
    setTarget(data, 'tw50', 0.2);
    const p = planAllocation(
      data,
      val(data),
      req({ source: 'internal', amount: 100_000, allowSell: false }),
    );
    expect(p.suggestions).toHaveLength(0);
    expect(p.leftoverCash).toBe(100_000);
  });

  it('rebalance mode sells out-of-band holdings and reuses the proceeds', () => {
    const data = base();
    setPrice(data, 'us_VOO', 100, 'USD');
    setFx(data, 'USD', 'TWD', 10);
    setTarget(data, 'tw50', 0.3); // core 500k vs 300k: sell 200k
    setTarget(data, 'sp500', 0.2);
    const p = planAllocation(
      data,
      val(data),
      req({ source: 'internal', amount: 0, allowSell: true }),
    );
    const sell = p.suggestions.find((s) => s.side === 'sell')!;
    expect(sell).toMatchObject({ symbol: '0050', quantity: 2000, exposureAdded: -200_000 });
    expect(p.sellProceeds).toBe(200_000);
    expect(p.suggestions.find((s) => s.side === 'buy')!.exposureAdded).toBe(200_000);
    expect(p.postTrade.netExposure).toBe(500_000);
  });

  it('rebalance mode leaves in-band indices alone', () => {
    const data = base();
    setTarget(data, 'tw50', 0.48, { tolerance: 0.05 });
    const p = planAllocation(
      data,
      val(data),
      req({ source: 'internal', amount: 0, allowSell: true }),
    );
    expect(p.suggestions).toHaveLength(0);
  });

  it('warns about a missing price, a missing FX rate and an index without instruments', () => {
    const data = base();
    setTarget(data, 'sp500', 0.1); // VOO has no price
    let p = planAllocation(data, val(data), req({ source: 'internal', amount: 100_000 }));
    expect(p.suggestions).toHaveLength(0);
    expect(p.warnings.some((w) => w.includes('沒有報價'))).toBe(true);

    setPrice(data, 'us_VOO', 100, 'USD'); // still no USD/TWD
    p = planAllocation(data, val(data), req({ source: 'internal', amount: 100_000 }));
    expect(p.warnings.some((w) => w.includes('USD/TWD'))).toBe(true);

    setTarget(data, 'tw_elec', 0.1);
    p = planAllocation(data, val(data), req({ source: 'internal', amount: 100_000 }));
    expect(p.warnings.some((w) => w.includes('沒有可用的商品'))).toBe(true);

    p = planAllocation(data, val(data), req({ currency: 'JPY' }));
    expect(p.suggestions).toHaveLength(0);
    expect(p.warnings.some((w) => w.includes('JPY/TWD'))).toBe(true);
  });

  it('deducts estimated fees from post-trade NAV', () => {
    const data = base();
    setTarget(data, 'tw50', 0.6);
    const p = planAllocation(data, val(data), req({ feeRate: 0.01 }));
    expect(p.totalFees).toBeGreaterThan(0);
    expect(p.postTrade.nav).toBeCloseTo(1_500_000 - p.totalFees);
  });

  it('returns suggestions only: the dataset is untouched', () => {
    const data = base();
    setTarget(data, 'tw50', 0.6);
    const n = data.transactions.length;
    planAllocation(data, val(data), req());
    expect(data.transactions).toHaveLength(n);
  });
});

describe('compareInstruments', () => {
  it('compares VOO / SSO / UPRO / ES / MES for the same exposure', () => {
    const data = fresh();
    setFx(data, 'USD', 'TWD', 30);
    setPrice(data, 'us_VOO', 500, 'USD');
    setPrice(data, 'us_SSO', 100, 'USD');
    setPrice(data, 'us_UPRO', 50, 'USD');
    setPrice(data, 'fut_ES', 6000, 'USD'); // 300,000 USD notional
    setPrice(data, 'fut_MES', 6000, 'USD'); // 30,000 USD
    data.instruments.find((i) => i.id === 'fut_ES')!.initialMargin = 20_000;
    data.instruments.find((i) => i.id === 'fut_MES')!.initialMargin = 2_000;
    const exposure = 3_000_000; // TWD = 100,000 USD
    const rows = compareInstruments(data, 'sp500', exposure, 0);
    const by = (sym: string) => rows.find((r) => r.symbol === sym)!;
    expect(by('VOO')).toMatchObject({ quantity: 200, cash: 100_000, isMargin: false });
    expect(by('SSO')).toMatchObject({ quantity: 500, cash: 50_000 });
    expect(by('UPRO')).toMatchObject({ quantity: 666, exposure: 666 * 150 * 30 });
    expect(by('MES')).toMatchObject({
      quantity: 3,
      cash: 6_000,
      cashBase: 180_000,
      isMargin: true,
    });
    expect(by('ES').quantity).toBe(0);
    expect(by('SSO').notes.join()).toContain('路徑相依');
    expect(by('MES').notes.join()).toContain('換月');
    expect(by('SPY').quantity).toBeUndefined(); // no quote
  });
});
