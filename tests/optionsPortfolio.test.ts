import { describe, expect, it } from 'vitest';
import {
  bsGreeks,
  bsPrice,
  computePortfolio,
  pickInstrument,
  runStressTest,
  runSurvival,
  yearsToExpiry,
  type AppData,
  type Instrument,
} from '@core/index';
import { fresh, NOW, setPrice, tx } from './helpers';

const D = '2026-09-01';
const TODAY = NOW.toISOString().slice(0, 10);
const EXPIRY = '2026-12-16';
const opts = { now: NOW };

/** A fictional 0050 call: strike 100, multiplier 1000, on the 台灣 50 index via 0050. */
function call(over: Partial<Instrument> = {}): Instrument {
  return {
    id: 'opt_c100',
    symbol: '0050C100',
    name: '示範 0050 買權 100',
    type: 'option',
    exchange: 'TAIFEX',
    currency: 'TWD',
    leverage: 1,
    multiplier: 1000,
    lotSize: 1,
    quoteSource: 'manual',
    optionRight: 'call',
    strike: 100,
    expiry: EXPIRY,
    underlyingId: 'tw_0050',
    active: true,
    ...over,
  };
}

/** Cash 1,000,000; option bought or sold at `premium`; 0050 quoted at 105. */
function book(quantity: number, premium: number, inst = call()): AppData {
  const data = fresh();
  data.instruments.push(inst);
  setPrice(data, 'tw_0050', 105);
  setPrice(data, inst.id, premium);
  data.transactions.push(
    tx({ type: 'deposit', date: D, amount: 1_000_000 }),
    tx({
      type: quantity > 0 ? 'buy' : 'sell',
      date: D,
      instrumentId: inst.id,
      quantity: Math.abs(quantity),
      price: premium,
    }),
  );
  return data;
}

const years = yearsToExpiry(TODAY, EXPIRY);
const base = { right: 'call' as const, spot: 105, strike: 100, years };

describe('options in the portfolio', () => {
  it('a bought call is an asset at its premium and exposure is delta-adjusted', () => {
    const premium = bsPrice({ ...base, vol: 0.2 })!;
    const { valuation } = computePortfolio(book(2, premium), opts);
    const p = valuation.positions.find((x) => x.instrumentId === 'opt_c100')!;
    // Buying at the quoted price leaves NAV equal to the deposit.
    expect(valuation.nav).toBeCloseTo(1_000_000, 4);
    expect(p.marketValue).toBeCloseTo(2 * premium * 1000, 6);
    expect(p.option).toMatchObject({ ok: true, volSource: 'implied' });
    expect(p.option!.ok && p.option!.vol).toBeCloseTo(0.2, 5);
    const delta = bsGreeks({ ...base, vol: 0.2 })!.delta;
    expect(p.exposure).toBeCloseTo(delta * 2 * 105 * 1000, 0);
    expect(p.indexId).toBe('tw50'); // taken from the underlying
    expect(valuation.byIndex.find((i) => i.indexId === 'tw50')!.net).toBeCloseTo(p.exposure, 6);
  });

  it('a sold call is a liability and short exposure', () => {
    const premium = bsPrice({ ...base, vol: 0.25 })!;
    const { valuation } = computePortfolio(book(-1, premium), opts);
    const p = valuation.positions.find((x) => x.instrumentId === 'opt_c100')!;
    expect(p.marketValue).toBeCloseTo(-premium * 1000, 6);
    expect(valuation.nav).toBeCloseTo(1_000_000, 4); // premium received offsets the liability
    expect(p.exposure).toBeLessThan(0);
  });

  it('uses the instrument volatility when there is no quote', () => {
    const data = book(1, 7, call({ impliedVol: 0.3 }));
    data.prices = data.prices.filter((q) => q.id !== 'opt_c100');
    const { valuation } = computePortfolio(data, opts);
    const p = valuation.positions.find((x) => x.instrumentId === 'opt_c100')!;
    expect(p.option).toMatchObject({ ok: true, volSource: 'instrument', vol: 0.3 });
  });

  it('counts no exposure rather than guessing when delta cannot be computed', () => {
    const data = book(1, 7, call({ underlyingId: undefined }));
    const { valuation } = computePortfolio(data, opts);
    const p = valuation.positions.find((x) => x.instrumentId === 'opt_c100')!;
    expect(p.exposure).toBe(0);
    expect(p.option).toMatchObject({ ok: false });
    expect(valuation.warnings.join()).toContain('無法計算 Delta');
  });

  it('flags an option past its expiry', () => {
    const data = book(1, 5, call({ expiry: '2026-10-01' }));
    const { valuation } = computePortfolio(data, opts);
    const p = valuation.positions.find((x) => x.instrumentId === 'opt_c100')!;
    expect(p.option).toMatchObject({ ok: true, expired: true });
    expect(p.option!.ok && p.option!.greeks.delta).toBe(1); // in the money
    expect(valuation.warnings.join()).toContain('已到期');
  });

  it('is never picked as an allocation tool, even on the index with leverage 1', () => {
    const data = book(1, 7, call({ indexId: 'tw50' }));
    data.instruments = data.instruments.filter((i) => i.indexId !== 'tw50' || i.type === 'option');
    expect(pickInstrument(data, 'tw50')).toBeUndefined();
  });
});

describe('options under stress', () => {
  it('reprices a call from the shocked underlying', () => {
    const premium = bsPrice({ ...base, vol: 0.2 })!;
    const data = book(1, premium);
    const portfolio = computePortfolio(data, opts);
    const r = runStressTest(
      data,
      portfolio,
      { indexMoves: { tw50: -0.2 }, currencyMoves: {} },
      { now: NOW },
    );
    const row = r.positions.find((x) => x.instrumentId === 'opt_c100')!;
    const expected = bsPrice({ ...base, spot: 84, vol: 0.2 })!;
    expect(row.priceAfter).toBeCloseTo(expected, 6);
    // A call loses far more than 20% of its premium when the underlying falls 20%,
    // but never more than the premium.
    expect(row.priceMove).toBeLessThan(-0.2);
    expect(row.priceMove).toBeGreaterThan(-1);
    expect(row.pnl).toBeCloseTo((expected - premium) * 1000, 2);
  });
});

describe('options in the survival simulation', () => {
  it('starts from the valuation exposure and decays toward expiry', () => {
    const premium = bsPrice({ ...base, vol: 0.2 })!;
    const data = book(1, premium);
    const portfolio = computePortfolio(data, opts);
    const r = runSurvival(data, portfolio, {
      today: TODAY,
      horizonDays: 30,
      useCashflowItems: false,
    });
    const day0 = r.series[0];
    expect(day0.netExposure).toBeCloseTo(portfolio.valuation.netExposure, 4);
    // With no market move the option only loses time value.
    const last = r.series[r.series.length - 1];
    expect(last.nav).toBeLessThan(day0.nav);
    expect(last.nav).toBeGreaterThan(day0.nav - premium * 1000);
  });
});
