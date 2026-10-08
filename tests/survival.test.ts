import { describe, expect, it } from 'vitest';
import {
  addDays,
  cashflowOccurrences,
  collateralStatus,
  computePortfolio,
  monthsToDays,
  runSurvival,
  type AppData,
  type CashflowItem,
  type Instrument,
  type SurvivalParams,
} from '@core/index';
import { fresh, NOW, setFx, setPrice, tx } from './helpers';

const opts = { now: NOW };
const TODAY = '2026-10-09';
const D = '2026-09-01';

function patch(data: AppData, id: string, p: Partial<Instrument>) {
  data.instruments = data.instruments.map((i) => (i.id === id ? { ...i, ...p } : i));
}

const sim = (data: AppData, params: Partial<SurvivalParams> = {}) =>
  runSurvival(data, computePortfolio(data, opts), { today: TODAY, horizonDays: 30, ...params });

const expense = (p: Partial<CashflowItem> = {}): CashflowItem => ({
  id: 'cf1',
  name: '生活費',
  kind: 'expense',
  amount: 30_000,
  currency: 'TWD',
  frequency: 'monthly',
  startDate: '2026-11-01',
  affectsPortfolio: true,
  ...p,
});

/** NAV 500,000: 0050 x4000 @100 plus 100,000 cash. */
function squeezed(): AppData {
  const data = fresh();
  setPrice(data, 'tw_0050', 100);
  data.transactions.push(
    tx({ type: 'deposit', date: D, amount: 500_000 }),
    tx({ type: 'buy', date: D, instrumentId: 'tw_0050', quantity: 4000, price: 100 }),
  );
  data.cashflowItems.push(expense());
  return data;
}

describe('cashflowOccurrences', () => {
  it('steps by the frequency from the start date and stops at endDate', () => {
    const m = expense({ startDate: '2026-01-31', endDate: '2026-04-30' });
    expect(cashflowOccurrences(m, '2026-01-31', '2026-12-31')).toEqual([
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
    const q = expense({ frequency: 'quarterly', startDate: '2026-11-01' });
    expect(cashflowOccurrences(q, TODAY, '2027-06-30')).toEqual([
      '2026-11-01',
      '2027-02-01',
      '2027-05-01',
    ]);
    expect(
      cashflowOccurrences(
        expense({ frequency: 'once', startDate: '2026-12-25' }),
        TODAY,
        '2026-12-31',
      ),
    ).toEqual(['2026-12-25']);
    expect(
      cashflowOccurrences(expense({ frequency: 'once', startDate: TODAY }), TODAY, '2026-12-31'),
    ).toEqual([]);
  });
  it('converts months to days', () => {
    expect(monthsToDays(6, TODAY)).toBe(182);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('cash runs out while NAV stays positive', () => {
  const r = sim(squeezed(), { horizonDays: monthsToDays(6, TODAY) });

  it('records the first shortfall on a known date', () => {
    // cash 100,000: 11-01 -> 70k, 12-01 -> 40k, 01-01 -> 10k, 02-01 short 20k
    const s = r.summary;
    expect(s.firstShortfallDate).toBe('2027-02-01');
    expect(s.firstShortfall!.amount).toBeCloseTo(20_000);
    expect(s.shortfallCount).toBe(3);
    expect(r.events.map((e) => [e.date, Math.round(e.amount)])).toEqual([
      ['2027-02-01', 20_000],
      ['2027-03-01', 30_000],
      ['2027-04-01', 30_000],
    ]);
    expect(s.navPositiveThroughout).toBe(true);
    expect(s.cashEnough).toBe(false);
    expect(s.navPositiveButCashShort).toBe(true);
  });

  it('reports minimum cash, outside money needed and ending NAV', () => {
    const s = r.summary;
    expect(s.minCash.value).toBeCloseTo(-80_000);
    expect(s.minCash.date).toBe('2027-04-01');
    expect(s.externalNeeded.cash).toBeCloseTo(80_000);
    expect(s.externalNeeded.total).toBeCloseTo(80_000);
    expect(s.endingNav).toBeCloseTo(500_000 - 180_000);
    expect(s.minNav.value).toBeCloseTo(320_000);
  });

  it('starts from the valuation NAV and exposes the caveats', () => {
    expect(r.series[0].nav).toBeCloseTo(500_000);
    expect(r.series[0].day).toBe(0);
    expect(r.caveats.some((c) => c.includes('每日目標槓桿'))).toBe(true);
  });

  it('income that does not affect the portfolio never enters its cash', () => {
    const data = squeezed();
    data.cashflowItems.push(
      expense({ id: 'cf2', name: '薪資', kind: 'income', amount: 50_000, affectsPortfolio: false }),
    );
    const out = sim(data, { horizonDays: monthsToDays(6, TODAY) });
    expect(out.summary.minCash.value).toBeCloseTo(-80_000);
    expect(out.summary.shortfallCount).toBe(3);
    // the same income landing in the portfolio removes every shortfall
    const inData = squeezed();
    inData.cashflowItems.push(
      expense({ id: 'cf2', name: '薪資', kind: 'income', amount: 50_000, affectsPortfolio: true }),
    );
    const ok = sim(inData, { horizonDays: monthsToDays(6, TODAY) });
    expect(ok.summary.shortfallCount).toBe(0);
    expect(ok.summary.cashEnough).toBe(true);
    expect(ok.summary.endingNav).toBeCloseTo(500_000 + 6 * (50_000 - 30_000), 6);
  });

  it('with sell_core, sells pro rata and keeps cash non-negative', () => {
    const out = sim(squeezed(), {
      horizonDays: monthsToDays(6, TODAY),
      shortfallPolicy: 'sell_core',
    });
    const sale = out.events.find((e) => e.type === 'forced_reduction')!;
    expect(sale.date).toBe('2027-02-01');
    expect(sale.amount).toBeCloseTo(20_000);
    expect(sale.sold![0].instrumentId).toBe('tw_0050');
    expect(sale.sold![0].quantity).toBeCloseTo(200); // 20,000 / 100
    expect(out.summary.minCash.value).toBeGreaterThanOrEqual(-1e-6);
    expect(out.summary.cashEnough).toBe(false);
    expect(out.summary.externalNeeded.cash).toBeCloseTo(80_000); // still sized without the sales
  });
});

describe('loan payments', () => {
  function loanBook(): AppData {
    const data = fresh();
    data.loans.push({
      id: 'L1',
      name: '信貸',
      kind: 'credit',
      lender: '示範銀行',
      currency: 'TWD',
      principal: 120_000,
      annualRate: 0.12,
      method: 'interest_only',
      startDate: '2026-09-15',
      termMonths: 12,
      payDay: 15,
      active: true,
    });
    data.transactions.push(
      tx({ type: 'deposit', date: D, amount: 50_000 }),
      tx({ type: 'loan_draw', date: D, amount: 120_000, loanId: 'L1' }),
    );
    return data;
  }

  it('hits portfolio cash on the due dates', () => {
    const r = sim(loanBook(), { horizonDays: 40 });
    const cash = (date: string) => r.series.find((d) => d.date === date)!.cashByKey['kgi_tw|TWD'];
    expect(cash('2026-10-14')).toBeCloseTo(170_000);
    expect(cash('2026-10-15')).toBeCloseTo(168_800); // 120,000 x 1%
    expect(cash('2026-11-14')).toBeCloseTo(168_800);
    expect(cash('2026-11-15')).toBeCloseTo(167_600);
    expect(r.series.find((d) => d.date === '2026-11-15')!.debt).toBeCloseTo(120_000);
    expect(r.summary.cashEnough).toBe(true);
  });

  it('leaves portfolio cash alone when outside income covers the payments', () => {
    const r = sim(loanBook(), { horizonDays: 40, loanPaymentsFromOutside: true });
    expect(r.series[40].cashByKey['kgi_tw|TWD']).toBeCloseTo(170_000);
  });

  it('applies a rate shift from day 1', () => {
    const r = sim(loanBook(), { horizonDays: 20, rateShift: 6 }); // 18% -> 1,800
    expect(r.series.find((d) => d.date === '2026-10-15')!.cashByKey['kgi_tw|TWD']).toBeCloseTo(
      168_200,
    );
  });

  it('records a shortfall when the payment cannot be met in that currency', () => {
    const data = loanBook();
    data.transactions.push(tx({ type: 'withdraw', date: D, amount: 169_000 }));
    const r = sim(data, { horizonDays: 20 });
    expect(r.events.filter((e) => e.type === 'cash_shortfall')).toHaveLength(1);
    const ev = r.events.find((e) => e.type === 'cash_shortfall')!;
    expect(ev).toMatchObject({ date: '2026-10-15', currency: 'TWD' });
    expect(ev.amount).toBeCloseTo(200); // 1,000 cash vs 1,200 due
    expect(r.series.find((d) => d.date === '2026-10-15')!.cashByKey['kgi_tw|TWD']).toBeCloseTo(
      -200,
    );
  });
});

describe('futures and perpetual carry', () => {
  function futBook(): AppData {
    const data = fresh();
    setFx(data, 'USDT', 'TWD', 30);
    patch(data, 'fut_MTX', { maintenanceMargin: 15_000 });
    setPrice(data, 'fut_MTX', 20_000);
    setPrice(data, 'perp_BTCUSDT', 60_000, 'USDT');
    data.transactions.push(
      tx({ type: 'deposit', date: D, accountId: 'kgi_fut', amount: 100_000 }),
      tx({
        type: 'buy',
        date: D,
        accountId: 'kgi_fut',
        instrumentId: 'fut_MTX',
        quantity: 1,
        price: 20_000,
      }),
      tx({
        type: 'deposit',
        date: D,
        accountId: 'binance_main',
        currency: 'USDT',
        amount: 10_000,
        fxRate: 30,
      }),
      tx({
        type: 'buy',
        date: D,
        accountId: 'binance_main',
        currency: 'USDT',
        instrumentId: 'perp_BTCUSDT',
        quantity: 1,
        price: 60_000,
      }),
    );
    return data;
  }

  it('settles futures mark-to-market into cash and reports a margin shortfall', () => {
    const r = sim(futBook(), { horizonDays: 10, indexMoves: { taiex: -0.1 } });
    const cash = (d: number) => r.series[d].cashByKey['kgi_fut|TWD'];
    expect(cash(0)).toBeCloseTo(100_000);
    expect(cash(3)).toBeCloseTo(70_000); // -200 points x 50 a day
    expect(cash(10)).toBeCloseTo(0);
    const ev = r.events.find((e) => e.type === 'margin_shortfall')!;
    expect(ev.day).toBe(9);
    expect(ev.date).toBe('2026-10-18');
    expect(ev.amount).toBeCloseTo(5_000); // equity 10,000 vs 15,000 required
    expect(r.series[8].marginHeadroom).toBeCloseTo(5_000);
    expect(r.summary.minMarginHeadroom!.value).toBeCloseTo(-15_000);
    expect(r.summary.externalNeeded.margin).toBeCloseTo(15_000);
    expect(r.summary.cashEnough).toBe(false);
  });

  it('charges funding on notional each day and accumulates mark-to-market', () => {
    // funding 36.5% a year = 0.1% a day; BTC falls 1% of its start a day
    const r = sim(futBook(), {
      horizonDays: 10,
      indexMoves: { btc: -0.1 },
      fundingRateAnnual: 0.365,
    });
    const flat = sim(futBook(), { horizonDays: 10, fundingRateAnnual: 0.365 });
    expect(flat.series[10].cashByKey['binance_main|USDT']).toBeCloseTo(10_000 - 600);
    // funding = 60 x sum(1 - 0.01 d) = 567 ; MTM = -6,000
    expect(r.series[10].cashByKey['binance_main|USDT']).toBeCloseTo(10_000 - 6_000 - 567);
    // shorts receive
    const s = futBook();
    s.transactions.push(
      tx({
        type: 'sell',
        date: D,
        accountId: 'binance_main',
        currency: 'USDT',
        instrumentId: 'perp_BTCUSDT',
        quantity: 2,
        price: 60_000,
      }),
    );
    expect(
      sim(s, { horizonDays: 10, fundingRateAnnual: 0.365 }).series[10].cashByKey[
        'binance_main|USDT'
      ],
    ).toBeCloseTo(10_000 + 600);
  });

  it('charges the monthly roll cost per futures contract', () => {
    const r = sim(futBook(), { horizonDays: 40, rollCostPerContract: 100 });
    expect(r.series.find((d) => d.date === '2026-11-08')!.cashByKey['kgi_fut|TWD']).toBeCloseTo(
      100_000,
    );
    expect(r.series.find((d) => d.date === '2026-11-09')!.cashByKey['kgi_fut|TWD']).toBeCloseTo(
      99_900,
    );
  });

  it('flags derivative accounts without a margin spec', () => {
    const r = sim(futBook(), { horizonDays: 5 });
    expect(r.summary.missingMarginSpecs).toEqual(['binance_main']);
    expect(r.warnings.some((w) => w.includes('缺少維持保證金'))).toBe(true);
  });

  it('does not let futures cash pay the bills', () => {
    const data = futBook();
    data.cashflowItems.push(expense({ startDate: '2026-10-20' }));
    const r = sim(data, { horizonDays: 20 });
    expect(r.events.find((e) => e.type === 'cash_shortfall')!.amount).toBeCloseTo(30_000);
  });
});

describe('pledged loans in the simulation', () => {
  function pledgeBook(): AppData {
    const data = fresh();
    setPrice(data, 'tw_0050', 100);
    data.loans.push({
      id: 'L1',
      name: '質押借款',
      kind: 'pledge',
      lender: '示範銀行',
      currency: 'TWD',
      principal: 300_000,
      annualRate: 0.03,
      method: 'interest_only',
      startDate: '2026-10-01',
      termMonths: 12,
      payDay: 1,
      collateral: [
        { instrumentId: 'tw_0050', accountId: 'kgi_tw', quantity: 5000, loanableRatio: 0.6 },
      ],
      callRatio: 1.4,
      active: true,
    });
    data.transactions.push(
      tx({ type: 'deposit', date: D, amount: 500_000 }),
      tx({ type: 'buy', date: D, instrumentId: 'tw_0050', quantity: 5000, price: 100 }),
      tx({ type: 'loan_draw', date: D, amount: 300_000, loanId: 'L1' }),
    );
    return data;
  }

  it('day 0 equals the loans.ts collateral status and the valuation NAV', () => {
    const data = pledgeBook();
    const pf = computePortfolio(data, opts);
    const r = runSurvival(data, pf, { today: TODAY, horizonDays: 20 });
    const cs = collateralStatus(data, pf.valuation, data.loans[0], 300_000);
    expect(r.series[0].minMaintenanceRatio).toBeCloseTo(cs.maintenanceRatio!, 9);
    expect(r.series[0].nav).toBeCloseTo(pf.valuation.nav, 6);
    expect(r.series[0].grossLeverage).toBeCloseTo(pf.valuation.grossLeverage!, 9);
  });

  it('flags the margin call on the day the ratio crosses callRatio, with the cure amount', () => {
    // index -20% over 20 days: collateral 500,000 x (1 - 0.01 d); call below 420,000 -> day 17
    const r = sim(pledgeBook(), { horizonDays: 20, indexMoves: { tw50: -0.2 } });
    const call = r.events.find((e) => e.type === 'pledge_call')!;
    expect(call.day).toBe(17);
    expect(call.date).toBe('2026-10-26');
    expect(call.amount).toBeCloseTo(300_000 - 415_000 / 1.4, 4);
    expect(call.loanId).toBe('L1');
    expect(r.series[16].minMaintenanceRatio!).toBeGreaterThan(1.4);
    expect(r.summary.minMaintenanceRatio!.value).toBeCloseTo(400_000 / 300_000, 9);
    expect(r.summary.minMaintenanceRatio!.date).toBe('2026-10-29');
    expect(r.summary.firstPledgeCallDate).toBe('2026-10-26');
    expect(r.summary.externalNeeded.pledge).toBeCloseTo(300_000 - 400_000 / 1.4, 4);
  });

  it('applies dated shocks on their day', () => {
    const r = sim(pledgeBook(), {
      horizonDays: 20,
      shocks: [{ day: 10, kind: 'index', id: 'tw50', move: -0.3 }],
    });
    expect(r.series[9].minMaintenanceRatio).toBeCloseTo(500_000 / 300_000, 9);
    expect(r.series[10].minMaintenanceRatio).toBeCloseTo(350_000 / 300_000, 9);
    expect(r.events.find((e) => e.type === 'pledge_call')!.day).toBe(10);
  });

  it('compounds a 2x ETF daily and floors it at -100%', () => {
    const data = fresh();
    setPrice(data, 'tw_00631L', 100);
    data.transactions.push(
      tx({ type: 'deposit', date: D, amount: 100_000 }),
      tx({ type: 'buy', date: D, instrumentId: 'tw_00631L', quantity: 1000, price: 100 }),
    );
    // a one-day -30% index shock hits the 2x ETF by -60%
    const a = sim(data, {
      horizonDays: 3,
      shocks: [{ day: 1, kind: 'index', id: '*', move: -0.3 }],
    });
    expect(a.series[1].nav).toBeCloseTo(40_000, 6);
    expect(a.series[1].grossLeverage).toBeCloseTo(2, 9);
    // -60% would be -120% for the ETF: floored at -100%, NAV 0, ratios undefined
    const b = sim(data, {
      horizonDays: 3,
      shocks: [{ day: 1, kind: 'index', id: 'tw50', move: -0.6 }],
    });
    expect(b.series[1].nav).toBeCloseTo(0, 6);
    expect(b.series[1].grossLeverage).toBeUndefined();
    expect(b.events.some((e) => e.type === 'nav_nonpositive' && e.day === 1)).toBe(true);
    // daily compounding differs from a fixed multiple: index 0.9 then 0.8 (-11.1%) -> 0.8 x 0.7778
    const c = sim(data, { horizonDays: 2, indexMoves: { tw50: -0.2 } });
    expect(c.series[2].nav).toBeCloseTo(100_000 * 0.8 * (1 - (2 * 0.1) / 0.9), 4);
  });
});

describe('determinism and sampling', () => {
  it('returns identical output for identical inputs', () => {
    const data = squeezed();
    const params: Partial<SurvivalParams> = {
      horizonDays: 200,
      indexMoves: { tw50: -0.2 },
      shortfallPolicy: 'sell_core',
    };
    expect(JSON.stringify(sim(data, params))).toBe(JSON.stringify(sim(data, params)));
  });

  it('samples a long series but keeps day 0 and the last day', () => {
    const r = sim(squeezed(), { horizonDays: 1000, maxPoints: 100 });
    expect(r.series.length).toBeLessThanOrEqual(101);
    expect(r.series[0].day).toBe(0);
    expect(r.series[r.series.length - 1].day).toBe(1000);
    expect(r.summary.endingNav).toBeCloseTo(r.series[r.series.length - 1].nav);
  });
});
