import { describe, expect, it } from 'vitest';
import { buildLedger, computePortfolio, FxTable } from '@core/index';
import { fresh, NOW, setFx, setPrice, tx } from './helpers';

const opts = { now: NOW };

describe('FxTable', () => {
  it('uses direct, inverse and chained pairs', () => {
    const data = fresh();
    setFx(data, 'USD', 'TWD', 32);
    setFx(data, 'USDT', 'USD', 1);
    const fx = new FxTable(data.fxRates);
    expect(fx.rate('USD', 'TWD')).toBe(32);
    expect(fx.rate('TWD', 'USD')).toBeCloseTo(1 / 32);
    expect(fx.rate('USDT', 'TWD')).toBe(32);
    expect(fx.rate('TWD', 'TWD')).toBe(1);
    expect(fx.rate('JPY', 'TWD')).toBeUndefined();
  });
});

describe('spec 4.2: leverage moves with gains and external repayment', () => {
  const build = () => {
    const data = fresh();
    data.loans.push({
      id: 'credit1', name: '信貸', kind: 'credit', lender: '銀行', currency: 'TWD',
      principal: 100_000, annualRate: 0.03, method: 'annuity', startDate: '2026-01-01', active: true,
    });
    data.transactions.push(
      tx({ type: 'deposit', date: '2026-01-01', amount: 100_000 }),
      tx({ type: 'loan_draw', date: '2026-01-01', amount: 100_000, loanId: 'credit1' }),
      tx({ type: 'buy', date: '2026-01-02', instrumentId: 'tw_0050', quantity: 2000, price: 100 }),
    );
    return data;
  };

  it('own 100k + borrowed 100k gives 2.00x', () => {
    const data = build();
    setPrice(data, 'tw_0050', 100);
    const v = computePortfolio(data, opts).valuation;
    expect(v.securitiesValue).toBe(200_000);
    expect(v.liabilities).toBe(100_000);
    expect(v.nav).toBe(100_000);
    expect(v.grossLeverage).toBeCloseTo(2);
    expect(v.debtToNav).toBeCloseTo(1);
  });

  it('a 50k gain lowers leverage to 1.67x', () => {
    const data = build();
    setPrice(data, 'tw_0050', 125);
    const v = computePortfolio(data, opts).valuation;
    expect(v.nav).toBe(150_000);
    expect(v.netLeverage).toBeCloseTo(250 / 150);
    expect(v.totalPnl).toBe(50_000);
  });

  it('repaying 50k with outside money raises NAV and gives 1.25x', () => {
    const data = build();
    setPrice(data, 'tw_0050', 125);
    data.transactions.push(
      tx({ type: 'loan_repay', date: '2026-06-01', amount: 50_000, loanId: 'credit1', source: 'external' }),
    );
    const { ledger, valuation: v } = computePortfolio(data, opts);
    expect(v.liabilities).toBe(50_000);
    expect(v.nav).toBe(200_000);
    expect(v.grossLeverage).toBeCloseTo(1.25);
    expect(ledger.totals.contributedCapital).toBe(150_000);
    expect(v.totalPnl).toBe(50_000);
  });

  it('repaying from portfolio cash leaves NAV and exposure/NAV unchanged', () => {
    const data = build();
    setPrice(data, 'tw_0050', 125);
    data.transactions.push(tx({ type: 'deposit', date: '2026-03-01', amount: 50_000 }));
    const before = computePortfolio(data, opts).valuation;
    data.transactions.push(
      tx({ type: 'loan_repay', date: '2026-06-01', amount: 50_000, loanId: 'credit1', source: 'portfolio' }),
    );
    const after = computePortfolio(data, opts).valuation;
    expect(after.nav).toBe(before.nav);
    expect(after.liabilities).toBe(50_000);
    expect(after.netLeverage).toBeCloseTo(before.netLeverage!);
  });
});

describe('trades', () => {
  it('matches sells FIFO and keeps fees out of realized P&L', () => {
    const data = fresh();
    data.transactions.push(
      tx({ type: 'deposit', date: '2026-01-01', amount: 100_000 }),
      tx({ type: 'buy', date: '2026-01-02', instrumentId: 'tw_0050', quantity: 100, price: 100, fee: 10 }),
      tx({ type: 'buy', date: '2026-01-03', instrumentId: 'tw_0050', quantity: 100, price: 120, fee: 10 }),
      tx({ type: 'sell', date: '2026-01-04', instrumentId: 'tw_0050', quantity: 150, price: 130, fee: 10, tax: 20 }),
    );
    const ledger = buildLedger(data);
    const pos = ledger.positions[0];
    expect(pos.quantity).toBe(50);
    expect(pos.avgCost).toBe(120);
    expect(pos.realizedPnl).toBe(100 * 30 + 50 * 10);
    expect(ledger.totals.fees).toBe(50);
    expect(ledger.cash[0].amount).toBe(100_000 - 10_000 - 12_000 + 19_500 - 50);
  });

  it('counts leveraged ETF exposure as market value x daily leverage', () => {
    const data = fresh();
    data.transactions.push(
      tx({ type: 'deposit', date: '2026-01-01', amount: 100_000 }),
      tx({ type: 'buy', date: '2026-01-02', instrumentId: 'tw_00631L', quantity: 500, price: 200 }),
    );
    setPrice(data, 'tw_00631L', 200);
    const v = computePortfolio(data, opts).valuation;
    expect(v.nav).toBe(100_000);
    expect(v.netExposure).toBe(200_000);
    expect(v.byIndex.find((i) => i.indexId === 'tw50')?.weight).toBeCloseTo(2);
  });

  it('respects asOf', () => {
    const data = fresh();
    data.transactions.push(
      tx({ type: 'deposit', date: '2026-01-01', amount: 1000 }),
      tx({ type: 'deposit', date: '2026-02-01', amount: 500 }),
    );
    expect(buildLedger(data, { asOf: '2026-01-15' }).cash[0].amount).toBe(1000);
  });
});

describe('futures', () => {
  const build = () => {
    const data = fresh();
    data.transactions.push(
      tx({ type: 'deposit', date: '2026-01-01', accountId: 'kgi_fut', amount: 500_000 }),
      tx({ type: 'buy', date: '2026-01-02', accountId: 'kgi_fut', instrumentId: 'fut_MTX', quantity: 2, price: 20_000, fee: 40 }),
    );
    return data;
  };

  it('carries notional exposure without consuming cash or adding debt', () => {
    const data = build();
    setPrice(data, 'fut_MTX', 20_000);
    const v = computePortfolio(data, opts).valuation;
    expect(v.securitiesValue).toBe(0);
    expect(v.cashValue).toBe(499_960);
    expect(v.liabilities).toBe(0);
    expect(v.nav).toBe(499_960);
    expect(v.netExposure).toBe(2 * 20_000 * 50);
  });

  it('counts unrealized P&L once, as derivative equity', () => {
    const data = build();
    setPrice(data, 'fut_MTX', 20_500);
    const v = computePortfolio(data, opts).valuation;
    expect(v.derivativesEquity).toBe(2 * 500 * 50);
    expect(v.nav).toBe(499_960 + 50_000);
  });

  it('settles realized P&L to cash and nets long against short', () => {
    const data = build();
    data.transactions.push(
      tx({ type: 'sell', date: '2026-01-05', accountId: 'kgi_fut', instrumentId: 'fut_MTX', quantity: 3, price: 20_500 }),
    );
    setPrice(data, 'fut_MTX', 20_500);
    const { ledger, valuation: v } = computePortfolio(data, opts);
    expect(ledger.positions[0].quantity).toBe(-1);
    expect(ledger.cash[0].amount).toBe(499_960 + 50_000);
    expect(v.netExposure).toBe(-20_500 * 50);
    expect(v.grossExposure).toBe(20_500 * 50);
    expect(v.nav).toBe(549_960);
  });

  it('shows gross and net separately when long and short offset', () => {
    const data = build();
    data.transactions.push(
      tx({ type: 'sell', date: '2026-01-05', accountId: 'kgi_fut', instrumentId: 'fut_TMF', quantity: 10, price: 20_000 }),
    );
    setPrice(data, 'fut_MTX', 20_000);
    setPrice(data, 'fut_TMF', 20_000);
    const v = computePortfolio(data, opts).valuation;
    expect(v.netExposure).toBe(0);
    expect(v.grossExposure).toBe(4_000_000);
    const ix = v.byIndex.find((i) => i.indexId === 'taiex')!;
    expect(ix.long).toBe(2_000_000);
    expect(ix.short).toBe(-2_000_000);
  });
});

describe('multi-currency and transfers', () => {
  it('treats an FX transfer as internal: no contribution, no P&L', () => {
    const data = fresh();
    setFx(data, 'USD', 'TWD', 32);
    data.transactions.push(
      tx({ type: 'deposit', date: '2026-01-01', accountId: 'sinopac_tw', amount: 320_000 }),
      tx({
        type: 'transfer', date: '2026-01-02', accountId: 'sinopac_tw', amount: 320_000,
        toAccountId: 'sinopac_us', toCurrency: 'USD', toAmount: 10_000,
      }),
      tx({ type: 'buy', date: '2026-01-03', accountId: 'sinopac_us', currency: 'USD', instrumentId: 'us_SSO', quantity: 100, price: 90 }),
    );
    setPrice(data, 'us_SSO', 90, 'USD');
    const { ledger, valuation: v } = computePortfolio(data, opts);
    expect(ledger.totals.contributedCapital).toBe(320_000);
    expect(v.nav).toBeCloseTo(320_000);
    expect(v.totalPnl).toBeCloseTo(0);
    expect(v.netExposure).toBeCloseTo(100 * 90 * 2 * 32);
  });

  it('warns and values at cost when a price is missing', () => {
    const data = fresh();
    data.transactions.push(
      tx({ type: 'deposit', date: '2026-01-01', amount: 10_000 }),
      tx({ type: 'buy', date: '2026-01-02', instrumentId: 'tw_0050', quantity: 10, price: 100 }),
    );
    const v = computePortfolio(data, opts).valuation;
    expect(v.positions[0].priceStatus).toBe('missing');
    expect(v.nav).toBe(10_000);
    expect(v.warnings.some((w) => w.includes('0050'))).toBe(true);
  });

  it('counts overdrawn cash as a liability', () => {
    const data = fresh();
    data.transactions.push(
      tx({ type: 'deposit', date: '2026-01-01', amount: 10_000 }),
      tx({ type: 'buy', date: '2026-01-02', instrumentId: 'tw_0050', quantity: 150, price: 100 }),
    );
    setPrice(data, 'tw_0050', 100);
    const v = computePortfolio(data, opts).valuation;
    expect(v.liabilities).toBe(5_000);
    expect(v.nav).toBe(10_000);
    expect(v.debtToNav).toBeCloseTo(0.5);
  });
});
