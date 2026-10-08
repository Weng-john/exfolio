import { describe, expect, it } from 'vitest';
import {
  computePortfolio,
  makePriceLookup,
  rotationCycleReport,
  strategiesAllowingInstrument,
  strategyCapitalFlows,
  strategyReferences,
  strategySummaries,
  summarizeRotationCycles,
  type AppData,
  type RotationCycle,
  type RotationCycleReport,
} from '@core/index';
import { fresh, NOW, setFx, setPrice, tx } from './helpers';

const opts = { now: NOW };

function withStrategy(): AppData {
  const data = fresh();
  data.strategies.push({ id: 's1', name: '示範輪動策略', status: 'active' });
  return data;
}

/** core 1,000,000; 200,000 moved to s1; 0050 held in both buckets. */
function twoBuckets(): AppData {
  const data = withStrategy();
  data.transactions.push(
    tx({ type: 'deposit', date: '2026-01-01', amount: 1_000_000 }),
    tx({ type: 'transfer', date: '2026-01-02', amount: 200_000, toBucket: 's1' }),
    tx({ type: 'buy', date: '2026-01-03', instrumentId: 'tw_0050', quantity: 1000, price: 100 }),
    tx({ type: 'buy', date: '2026-01-03', instrumentId: 'tw_0050', quantity: 500, price: 100, fee: 20, bucket: 's1' }),
  );
  setPrice(data, 'tw_0050', 110);
  return data;
}

const summaries = (data: AppData) => strategySummaries(data, computePortfolio(data, opts));

describe('strategySummaries', () => {
  it('keeps the same ticker in core and in a strategy separate', () => {
    const s = summaries(twoBuckets());
    expect(s.core.securitiesValue).toBe(110_000);
    expect(s.core.cashValue).toBe(700_000);
    expect(s.core.equity).toBe(810_000);
    expect(s.core.capital).toBe(800_000);
    expect(s.core.totalPnl).toBe(10_000);
    const s1 = s.strategies[0];
    expect(s1.securitiesValue).toBe(55_000);
    expect(s1.cashValue).toBe(149_980);
    expect(s1.capital).toBe(200_000);
    expect(s1.unrealizedPnl).toBe(5_000);
    expect(s1.fees).toBe(20);
    expect(s1.totalPnl).toBe(4_980);
    expect(s1.positionCount).toBe(1);
    expect(s1.grossToEquity).toBeCloseTo(55_000 / 204_980);
    expect(s1.grossToNav).toBeCloseTo(55_000 / 1_014_980);
  });

  it('bucket equities add up to total NAV', () => {
    const data = twoBuckets();
    const s = summaries(data);
    const v = computePortfolio(data, opts).valuation;
    expect(s.total.netEquity).toBeCloseTo(v.nav);
    expect(s.core.equity + s.allStrategies.equity).toBeCloseTo(v.nav);
    expect(s.total.capital).toBeCloseTo(v.contributedCapital);
    expect(s.total.totalPnl).toBeCloseTo(v.totalPnl);
    expect(s.allStrategies.shareOfNav! + s.core.shareOfNav!).toBeCloseTo(1);
  });

  it('reconciles with loans attributed to the bucket of the draw', () => {
    const data = twoBuckets();
    data.loans.push({
      id: 'credit1', name: '信貸', kind: 'credit', lender: '示範銀行', currency: 'TWD',
      principal: 300_000, annualRate: 0.03, method: 'annuity', startDate: '2026-02-01', active: true,
    });
    data.transactions.push(
      tx({ type: 'loan_draw', date: '2026-02-01', amount: 300_000, loanId: 'credit1' }),
      tx({ type: 'transfer', date: '2026-02-02', amount: 100_000, toBucket: 's1' }),
      tx({ type: 'loan_repay', date: '2026-03-01', amount: 50_000, interest: 1_000, principal: 49_000, loanId: 'credit1', source: 'portfolio', bucket: 's1' }),
      tx({ type: 'loan_repay', date: '2026-03-02', amount: 20_000, principal: 20_000, interest: 0, loanId: 'credit1', source: 'external' }),
    );
    const s = summaries(data);
    const v = computePortfolio(data, opts).valuation;
    expect(v.liabilities).toBe(300_000 - 49_000 - 20_000);
    // Draw and external repayment sit in core; the s1 repayment lowers s1's share.
    expect(s.core.loanLiability).toBe(300_000 - 20_000);
    expect(s.strategies[0].loanLiability).toBe(-49_000);
    expect(s.total.loanLiability).toBe(v.liabilities);
    expect(s.total.equity - s.total.loanLiability).toBeCloseTo(v.nav);
    expect(s.core.netEquity + s.allStrategies.netEquity).toBeCloseTo(v.nav);
    expect(s.total.totalPnl).toBeCloseTo(v.totalPnl);
    expect(s.strategies[0].fundingCost).toBe(1_000);
  });

  it('internal transfers change neither NAV nor any P&L figure', () => {
    const data = twoBuckets();
    const before = summaries(data);
    const navBefore = computePortfolio(data, opts).valuation.nav;
    data.transactions.push(
      tx({ type: 'transfer', date: '2026-02-01', amount: 50_000, toBucket: 's1' }),
      tx({ type: 'transfer', date: '2026-02-02', amount: 20_000, bucket: 's1', toBucket: 'core' }),
      tx({ type: 'transfer', date: '2026-02-03', amount: 10_000, accountId: 'kgi_tw', toAccountId: 'sinopac_tw', bucket: 's1', toBucket: 's1' }),
    );
    const after = summaries(data);
    expect(computePortfolio(data, opts).valuation.nav).toBe(navBefore);
    expect(after.total.totalPnl).toBe(before.total.totalPnl);
    expect(after.total.capital).toBe(before.total.capital);
    expect(after.core.totalPnl).toBe(before.core.totalPnl);
    expect(after.strategies[0].totalPnl).toBe(before.strategies[0].totalPnl);
    expect(after.strategies[0].realizedPnl).toBe(before.strategies[0].realizedPnl);
    expect(after.strategies[0].capital).toBe(200_000 + 50_000 - 20_000);
    expect(after.core.capital).toBe(800_000 - 50_000 + 20_000);
  });

  it('books realized P&L, dividends and funding cost per bucket', () => {
    const data = twoBuckets();
    data.transactions.push(
      tx({ type: 'sell', date: '2026-02-01', instrumentId: 'tw_0050', quantity: 200, price: 120, bucket: 's1' }),
      tx({ type: 'dividend', date: '2026-02-02', instrumentId: 'tw_0050', amount: 300, bucket: 's1' }),
      tx({ type: 'interest', date: '2026-02-03', amount: 50, bucket: 's1' }),
    );
    const s1 = summaries(data).strategies[0];
    expect(s1.realizedPnl).toBe(4_000);
    expect(s1.dividends).toBe(300);
    expect(s1.fundingCost).toBe(50);
    // realized 4,000 + unrealized 300*10 + dividends 300 - fees 20 - funding 50
    expect(s1.totalPnl).toBe(4_000 + 3_000 + 300 - 20 - 50);
  });

  it('values derivative equity into strategy equity', () => {
    const data = withStrategy();
    data.transactions.push(
      tx({ type: 'deposit', date: '2026-01-01', amount: 500_000, accountId: 'kgi_fut', bucket: 's1' }),
      tx({ type: 'buy', date: '2026-01-02', instrumentId: 'fut_MTX', quantity: 2, price: 20_000, accountId: 'kgi_fut', bucket: 's1' }),
    );
    setPrice(data, 'fut_MTX', 20_100);
    const s1 = summaries(data).strategies[0];
    expect(s1.derivativesEquity).toBe(2 * 100 * 50);
    expect(s1.securitiesValue).toBe(0);
    expect(s1.equity).toBe(510_000);
    expect(s1.totalPnl).toBe(10_000);
    expect(s1.grossExposure).toBe(2 * 20_100 * 50);
  });
});

describe('strategyCapitalFlows', () => {
  it('lists movements chronologically with running capital, transfers never profit', () => {
    const data = withStrategy();
    data.transactions.push(
      tx({ type: 'deposit', date: '2026-01-01', amount: 100_000 }),
      tx({ type: 'transfer', date: '2026-01-05', amount: 40_000, toBucket: 's1' }),
      tx({ type: 'deposit', date: '2026-01-10', amount: 10_000, bucket: 's1' }),
      tx({ type: 'transfer', date: '2026-01-20', amount: 15_000, bucket: 's1', toBucket: 'core' }),
      tx({ type: 'withdraw', date: '2026-01-25', amount: 5_000, bucket: 's1' }),
      tx({ type: 'buy', date: '2026-01-26', instrumentId: 'tw_0050', quantity: 10, price: 100, bucket: 's1' }),
    );
    const flows = strategyCapitalFlows(data, 's1');
    expect(flows.map((f) => f.kind)).toEqual(['transfer_in', 'external_deposit', 'transfer_out', 'external_withdrawal']);
    expect(flows.map((f) => f.runningCapital)).toEqual([40_000, 50_000, 35_000, 30_000]);
    expect(flows[0].counterparty).toBe('core');
    expect(flows[2].counterparty).toBe('core');
    expect(flows[2].baseAmount).toBe(-15_000);
    const s1 = summaries(data).strategies[0];
    expect(s1.capital).toBe(30_000);
    expect(s1.totalPnl).toBe(0);
    // core is the mirror image
    const coreFlows = strategyCapitalFlows(data, 'core');
    expect(coreFlows.map((f) => f.kind)).toEqual(['external_deposit', 'transfer_out', 'transfer_in']);
    expect(coreFlows[2].runningCapital).toBe(100_000 - 40_000 + 15_000);
  });

  it('values a cross-currency transfer at the source amount on both sides', () => {
    const data = withStrategy();
    setFx(data, 'USD', 'TWD', 30);
    data.transactions.push(
      tx({ type: 'deposit', date: '2026-01-01', amount: 3_000, currency: 'USD', accountId: 'sinopac_us', fxRate: 30 }),
      tx({ type: 'transfer', date: '2026-01-02', amount: 1_000, currency: 'USD', accountId: 'sinopac_us', toBucket: 's1', fxRate: 30 }),
    );
    const f = strategyCapitalFlows(data, 's1');
    expect(f[0].baseAmount).toBe(30_000);
    expect(f[0].currency).toBe('USD');
    const s = summaries(data);
    expect(s.strategies[0].equity).toBe(30_000);
    expect(s.core.equity).toBe(60_000);
    expect(s.total.totalPnl).toBe(0);
  });
});

describe('validation helpers', () => {
  it('treats an empty allowed list as unrestricted', () => {
    const data = withStrategy();
    data.strategies.push({ id: 's2', name: '只做美股', status: 'active', allowedInstrumentIds: ['us_SSO'] });
    expect(strategiesAllowingInstrument(data, 'us_SSO').map((s) => s.id)).toEqual(['s1', 's2']);
    expect(strategiesAllowingInstrument(data, 'tw_0050').map((s) => s.id)).toEqual(['s1']);
  });

  it('counts references so a used strategy is closed rather than deleted', () => {
    const data = withStrategy();
    expect(strategyReferences(data, 's1').total).toBe(0);
    data.transactions.push(tx({ type: 'deposit', date: '2026-01-01', amount: 1, bucket: 's1' }));
    data.transactions.push(tx({ type: 'transfer', date: '2026-01-01', amount: 1, toBucket: 's1' }));
    data.tradeGroups.push({ id: 'g1', strategyId: 's1', name: 'g', status: 'open' });
    data.rotationCycles.push({
      id: 'c1', strategyId: 's1', name: 'c', fromInstrumentId: 'us_SSO', toInstrumentId: 'us_QLD',
      benchmarkInstrumentId: 'us_SSO', status: 'open', openedAt: '2026-01-01',
    });
    expect(strategyReferences(data, 's1')).toEqual({ transactions: 2, tradeGroups: 1, rotationCycles: 1, total: 4 });
  });
});

describe('rotation cycle SSO -> QLD -> SSO', () => {
  // Hand computation (TWD-denominated fictional instruments, base currency TWD):
  //  hold 100 SSO bought at 50 before the cycle
  //  2026-03-02 sell 100 SSO @60 = 6,000 (fee 6); buy 60 QLD @100 = 6,000 (fee 6)
  //  2026-04-01 sell 60 QLD @110 = 6,600 (fee 7); buy 100 SSO @65 = 6,500 (fee 6)
  //  costs 25; cash left 100 - 25 = 75; holdings 100 x 65 = 6,500
  //  end value 6,575 on 6,000 -> pnl 575, return 9.5833%
  //  benchmark: SSO adj 60 -> 65 gives 100 units -> 6,500, pnl 500, 8.3333%
  //  excess 75 / 6,000 = 1.25 pp
  const cycle: RotationCycle = {
    id: 'rc1', strategyId: 's1', name: '示範輪動', fromInstrumentId: 'us_SSO', toInstrumentId: 'us_QLD',
    benchmarkInstrumentId: 'us_SSO', status: 'closed', openedAt: '2026-03-02', closedAt: '2026-04-01',
  };

  const build = (withHistory: boolean): AppData => {
    const data = withStrategy();
    for (const id of ['us_SSO', 'us_QLD']) {
      const inst = data.instruments.find((i) => i.id === id)!;
      inst.currency = 'TWD';
    }
    data.rotationCycles.push(cycle);
    const c = { bucket: 's1', rotationCycleId: 'rc1' };
    data.transactions.push(
      tx({ type: 'deposit', date: '2026-01-01', amount: 100_000, bucket: 's1' }),
      tx({ type: 'buy', date: '2026-01-02', instrumentId: 'us_SSO', quantity: 100, price: 50, bucket: 's1' }),
      tx({ type: 'sell', date: '2026-03-02', instrumentId: 'us_SSO', quantity: 100, price: 60, fee: 6, ...c, reason: '大盤急跌，切到 QLD' }),
      tx({ type: 'buy', date: '2026-03-02', instrumentId: 'us_QLD', quantity: 60, price: 100, fee: 6, ...c }),
      tx({ type: 'sell', date: '2026-04-01', instrumentId: 'us_QLD', quantity: 60, price: 110, fee: 7, ...c }),
      tx({ type: 'buy', date: '2026-04-01', instrumentId: 'us_SSO', quantity: 100, price: 65, fee: 6, ...c }),
    );
    if (withHistory) {
      data.priceHistory.push(
        // Start day has no row: the nearest earlier date (Fri 02-27) is used.
        { id: 'us_SSO|2026-02-27', instrumentId: 'us_SSO', date: '2026-02-27', close: 61, adjClose: 60 },
        { id: 'us_SSO|2026-04-01', instrumentId: 'us_SSO', date: '2026-04-01', close: 65, adjClose: 65 },
      );
    }
    return data;
  };

  it('matches the hand-computed actual and counterfactual', () => {
    const data = build(true);
    const r = rotationCycleReport(data, cycle, makePriceLookup(data));
    expect(r.missing).toEqual([]);
    expect(r.startDate).toBe('2026-03-02');
    expect(r.endDate).toBe('2026-04-01');
    expect(r.holdingDays).toBe(30);
    expect(r.startCapital).toBe(6_000);
    expect(r.tradingCosts).toBe(25);
    expect(r.endValue).toBeCloseTo(6_575);
    expect(r.pnl).toBeCloseTo(575);
    expect(r.pnlBeforeCosts).toBeCloseTo(600);
    expect(r.returnPct).toBeCloseTo(575 / 6000);
    expect(r.benchmarkEndValue).toBeCloseTo(6_500);
    expect(r.benchmarkReturnPct).toBeCloseTo(500 / 6000);
    expect(r.excessPp).toBeCloseTo(1.25);
    expect(r.beatBenchmark).toBe(true);
  });

  it('applies the same external flow to both sides', () => {
    const data = build(true);
    // 1,300 deposited on 04-01 and kept as cash by the cycle; benchmark buys 20 SSO units at 65.
    data.transactions.push(tx({ type: 'deposit', date: '2026-04-01', amount: 1_300, bucket: 's1', rotationCycleId: 'rc1' }));
    const r = rotationCycleReport(data, cycle, makePriceLookup(data));
    expect(r.netFlows).toBe(1_300);
    expect(r.investedCapital).toBe(7_300);
    expect(r.pnl).toBeCloseTo(575); // the cash earns nothing
    expect(r.benchmarkPnl).toBeCloseTo(500); // 20 units bought and valued at 65
    expect(r.excessPp).toBeCloseTo((75 / 7300) * 100);
  });

  it('lists missing prices instead of guessing', () => {
    const data = build(false);
    const r = rotationCycleReport(data, cycle, makePriceLookup(data));
    expect(r.missing.map((m) => `${m.instrumentId}@${m.date}`)).toEqual([
      'us_SSO@2026-04-01',
      'us_SSO@2026-03-02',
    ]);
    expect(r.pnl).toBeUndefined();
    expect(r.benchmarkReturnPct).toBeUndefined();
    expect(r.excessPp).toBeUndefined();
    expect(r.tradingCosts).toBe(25);
  });

  it('does not use a price older than the allowed gap', () => {
    const data = build(true);
    data.priceHistory[0] = { id: 'us_SSO|2026-02-01', instrumentId: 'us_SSO', date: '2026-02-01', close: 61, adjClose: 60 };
    const r = rotationCycleReport(data, cycle, makePriceLookup(data));
    expect(r.missing.map((m) => m.date)).toEqual(['2026-03-02']);
    expect(r.excessPp).toBeUndefined();
  });

  it('marks an open cycle with the current quote when history stops', () => {
    const data = build(true);
    const open: RotationCycle = { ...cycle, status: 'open', closedAt: undefined };
    data.transactions = data.transactions.filter((t) => !(t.date === '2026-04-01'));
    setPrice(data, 'us_QLD', 120);
    setPrice(data, 'us_SSO', 70);
    const r = rotationCycleReport(data, open, makePriceLookup(data), { asOf: '2026-09-01' });
    expect(r.open).toBe(true);
    // 60 QLD @120 = 7,200, cash -12 (fees) -> 7,188 on 6,000
    expect(r.endValue).toBeCloseTo(7_188);
    expect(r.pnl).toBeCloseTo(1_188);
    // history ends 2026-04-01, > 10 days before asOf, so SSO benchmark falls back to the quote 70
    expect(r.benchmarkEndValue).toBeCloseTo(100 * 70);
  });

  it('summarises cycles: cumulative result, beat share, drawdown', () => {
    const mk = (id: string, start: string, ret: number, bench: number): RotationCycleReport => ({
      cycleId: id, strategyId: 's1', open: false, hasTrades: true, startDate: start,
      startCapital: 1000, netFlows: 0, investedCapital: 1000, tradingCosts: 0,
      pnl: 1000 * ret, returnPct: ret, benchmarkInstrumentId: 'us_SSO',
      benchmarkReturnPct: bench, excessPp: (ret - bench) * 100, beatBenchmark: ret > bench,
      missing: [], notes: [],
    });
    const s = summarizeRotationCycles([
      mk('c3', '2026-03-01', 0.1, 0.05),
      mk('c1', '2026-01-01', 0.1, 0.02),
      mk('c2', '2026-02-01', -0.2, -0.1),
    ]);
    expect(s.cycles).toBe(3);
    expect(s.cumulativePnl).toBeCloseTo(0);
    expect(s.cumulativeReturn).toBeCloseTo(1.1 * 0.8 * 1.1 - 1);
    expect(s.beatShare).toBeCloseTo(2 / 3);
    // order c1, c2, c3: equity 1.1 -> 0.88 -> 0.968, drawdown 20%
    expect(s.maxDrawdown).toBeCloseTo(0.2);
    expect(summarizeRotationCycles([]).beatShare).toBeUndefined();
  });
});
