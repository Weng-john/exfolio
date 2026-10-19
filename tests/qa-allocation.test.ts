import { describe, expect, it } from 'vitest';
import { compareInstruments, planAllocation, type AllocationRequest } from '@core/index';
import { fresh, NOW, setFx, setPrice, setTarget } from './helpers';
import { computePortfolio } from '@core/index';

const opts = { now: NOW };

describe('QA: signed allocation targets', () => {
  it('buys a long inverse ETF for a negative target instead of treating it as an over-weight', () => {
    const data = fresh();
    setPrice(data, 'us_SPXS', 40, 'USD');
    data.fxRates.push({
      id: 'USD/TWD',
      from: 'USD',
      to: 'TWD',
      rate: 32,
      asOf: NOW.toISOString(),
      source: 'manual',
    });
    data.transactions.push({
      id: 'qa-deposit',
      date: '2026-01-01',
      type: 'deposit',
      accountId: 'kgi_tw',
      bucket: 'core',
      currency: 'TWD',
      amount: 1_000_000,
    });
    setTarget(data, 'sp500', -0.2, { preferredInstrumentId: 'us_SPXS' });
    const valuation = computePortfolio(data, opts).valuation;
    const request: AllocationRequest = {
      amount: 200_000,
      currency: 'TWD',
      source: 'internal',
      accountId: 'kgi_tw',
      allowSell: false,
      feeRate: 0,
      useExistingCash: true,
    };

    const plan = planAllocation(data, valuation, request);

    expect(plan.suggestions).toMatchObject([
      {
        instrumentId: 'us_SPXS',
        side: 'buy',
        quantity: 52,
        exposureAdded: -199_680,
      },
    ]);
    expect(plan.warnings).not.toContain('SPXS 槓桿不為正，無法用來補足 S&P 500 的多方缺口');
    expect(plan.residualGaps).toContainEqual(
      expect.objectContaining({ indexId: 'sp500', gap: -320 }),
    );
  });

  it('accounts for the exposure removed by a rebalance sale', () => {
    const data = fresh();
    setPrice(data, 'us_SPXS', 40, 'USD');
    setPrice(data, 'us_SPY', 500, 'USD');
    setFx(data, 'USD', 'TWD', 32);
    data.transactions.push(
      {
        id: 'qa-core-deposit',
        date: '2026-01-01',
        type: 'deposit',
        accountId: 'kgi_tw',
        bucket: 'core',
        currency: 'TWD',
        amount: 1_000_000,
      },
      {
        id: 'qa-core-buy',
        date: '2026-01-02',
        type: 'buy',
        accountId: 'kgi_tw',
        bucket: 'core',
        currency: 'TWD',
        amount: 0,
        instrumentId: 'us_SPXS',
        quantity: 100,
        price: 40,
      },
    );
    setTarget(data, 'sp500', 0.2);
    const valuation = computePortfolio(data, opts).valuation;
    const plan = planAllocation(data, valuation, {
      amount: 0,
      currency: 'TWD',
      source: 'internal',
      accountId: 'kgi_tw',
      allowSell: true,
      feeRate: 0,
      useExistingCash: true,
    });

    expect(plan.suggestions).toHaveLength(2);
    expect(plan.suggestions[0]).toMatchObject({
      instrumentId: 'us_SPXS',
      side: 'sell',
      quantity: 100,
      exposureAdded: 384_000,
    });
    expect(plan.suggestions[1]).toMatchObject({
      instrumentId: 'us_SPY',
      side: 'buy',
      quantity: 12,
      exposureAdded: 192_000,
    });
    expect(plan.residualGaps).toContainEqual(
      expect.objectContaining({ indexId: 'sp500', gap: 8_000 }),
    );
    expect(plan.unfunded).toBe(8_000);
  });

  it('keeps same-instrument holdings in separate accounts in post-trade totals', () => {
    const data = fresh();
    setPrice(data, 'tw_0050', 100);
    data.transactions.push(
      {
        id: 'qa-first-deposit',
        date: '2026-01-01',
        type: 'deposit',
        accountId: 'kgi_tw',
        bucket: 'core',
        currency: 'TWD',
        amount: 1_000_000,
      },
      {
        id: 'qa-first-buy',
        date: '2026-01-02',
        type: 'buy',
        accountId: 'kgi_tw',
        bucket: 'core',
        currency: 'TWD',
        amount: 0,
        instrumentId: 'tw_0050',
        quantity: 5_000,
        price: 100,
      },
      {
        id: 'qa-second-deposit',
        date: '2026-01-03',
        type: 'deposit',
        accountId: 'sinopac_tw',
        bucket: 'core',
        currency: 'TWD',
        amount: 100_000,
      },
      {
        id: 'qa-second-buy',
        date: '2026-01-04',
        type: 'buy',
        accountId: 'sinopac_tw',
        bucket: 'core',
        currency: 'TWD',
        amount: 0,
        instrumentId: 'tw_0050',
        quantity: 1_000,
        price: 100,
      },
    );
    setTarget(data, 'tw50', 0.5);

    const valuation = computePortfolio(data, opts).valuation;
    const plan = planAllocation(data, valuation, {
      amount: 0,
      currency: 'TWD',
      source: 'internal',
      accountId: 'kgi_tw',
      allowSell: true,
      feeRate: 0,
    });

    expect(valuation.netExposure).toBe(600_000);
    expect(plan.postTrade.netExposure).toBe(550_000);
    expect(plan.postTrade.grossExposure).toBe(550_000);
  });

  it('uses a long inverse ETF to compare a negative exposure without inventing ETF shorts', () => {
    const data = fresh();
    setPrice(data, 'us_SPXS', 40, 'USD');
    setPrice(data, 'us_VOO', 500, 'USD');
    setFx(data, 'USD', 'TWD', 32);

    const comparison = compareInstruments(data, 'sp500', -200_000);
    const inverse = comparison.find((row) => row.instrumentId === 'us_SPXS');
    const longOnly = comparison.find((row) => row.instrumentId === 'us_VOO');

    expect(inverse).toMatchObject({ quantity: 52, exposure: -199_680 });
    expect(longOnly?.quantity).toBeUndefined();
    expect(longOnly?.notes.join(' ')).toContain('方向');
  });

  it('does not plan trades for a deleted or inactive receiving account', () => {
    const data = fresh();
    data.accounts = data.accounts.filter((account) => account.id !== 'kgi_tw');
    setPrice(data, 'tw_0050', 100);
    setTarget(data, 'tw50', 0.1);
    const valuation = computePortfolio(data, opts).valuation;

    const plan = planAllocation(data, valuation, {
      amount: 100_000,
      currency: 'TWD',
      source: 'external',
      accountId: 'kgi_tw',
      allowSell: false,
      feeRate: 0,
    });

    expect(plan.suggestions).toEqual([]);
    expect(plan.warnings).toContain('找不到指定的有效帳戶');
  });

  it('does not plan trades when the selected loan has been deleted or disabled', () => {
    const data = fresh();
    setPrice(data, 'tw_0050', 100);
    setTarget(data, 'tw50', 0.1);
    const valuation = computePortfolio(data, opts).valuation;

    const plan = planAllocation(data, valuation, {
      amount: 100_000,
      currency: 'TWD',
      source: 'loan',
      loanId: 'missing-loan',
      accountId: 'kgi_tw',
      allowSell: false,
      feeRate: 0,
    });

    expect(plan.suggestions).toEqual([]);
    expect(plan.warnings).toContain('找不到指定的有效借款');
  });

  it('does not use a stale preferred instrument assigned to another index', () => {
    const data = fresh();
    setPrice(data, 'us_VOO', 100, 'USD');
    setFx(data, 'USD', 'TWD', 1);
    setTarget(data, 'sp500', 0.1, { preferredInstrumentId: 'tw_0050' });
    const valuation = computePortfolio(data, opts).valuation;

    const plan = planAllocation(data, valuation, {
      amount: 100_000,
      currency: 'TWD',
      source: 'external',
      accountId: 'kgi_tw',
      allowSell: false,
      feeRate: 0,
    });

    expect(plan.suggestions[0]).toMatchObject({ instrumentId: 'us_VOO', quantity: 100 });
  });

  it('rejects non-finite or negative funding amounts instead of planning from zero', () => {
    const data = fresh();
    data.transactions.push({
      id: 'qa-funding-deposit',
      date: '2026-01-01',
      type: 'deposit',
      accountId: 'kgi_tw',
      bucket: 'core',
      currency: 'TWD',
      amount: 1_000_000,
    });
    setPrice(data, 'tw_0050', 100);
    setTarget(data, 'tw50', 0.5);
    const valuation = computePortfolio(data, opts).valuation;

    for (const amount of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const plan = planAllocation(data, valuation, {
        amount,
        currency: 'TWD',
        source: 'internal',
        accountId: 'kgi_tw',
        allowSell: false,
        useExistingCash: true,
        feeRate: 0,
      });
      expect(plan.suggestions).toEqual([]);
      expect(plan.warnings).toContain('新資金金額必須是大於或等於 0 的有限數字');
    }
  });

  it('does not spend sale proceeds from an account other than the receiving account', () => {
    const data = fresh();
    setPrice(data, 'tw_0050', 100);
    data.transactions.push(
      {
        id: 'qa-other-account-deposit',
        date: '2026-01-01',
        type: 'deposit',
        accountId: 'sinopac_tw',
        bucket: 'core',
        currency: 'TWD',
        amount: 100_000,
      },
      {
        id: 'qa-other-account-buy',
        date: '2026-01-02',
        type: 'buy',
        accountId: 'sinopac_tw',
        bucket: 'core',
        currency: 'TWD',
        amount: 0,
        instrumentId: 'tw_0050',
        quantity: 1_000,
        price: 100,
      },
    );
    setTarget(data, 'tw50', 0);
    const valuation = computePortfolio(data, opts).valuation;

    const plan = planAllocation(data, valuation, {
      amount: 0,
      currency: 'TWD',
      source: 'internal',
      accountId: 'kgi_tw',
      allowSell: true,
      feeRate: 0,
    });

    expect(plan.suggestions).toEqual([]);
    expect(plan.sellProceeds).toBe(0);
    expect(plan.availableCash).toBe(0);
    expect(plan.warnings.some((warning) => warning.includes('無足夠持倉可賣'))).toBe(true);
  });
});
