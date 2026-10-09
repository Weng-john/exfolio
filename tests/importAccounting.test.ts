import { describe, expect, it } from 'vitest';
import {
  buildLedger,
  computePortfolio,
  externalFlows,
  loanStatus,
  parseTransactionsCsv,
  replayTrades,
  strategySummaries,
  transactionsToCsv,
  pnlBreakdown,
} from '@core/index';
import { fresh, NOW, setPrice, tx } from './helpers';

function securities() {
  const data = fresh();
  setPrice(data, 'tw_0050', 30);
  data.transactions.push(
    tx({ type: 'deposit', date: '2026-01-01', amount: 1000 }),
    tx({
      type: 'buy',
      date: '2026-01-02',
      instrumentId: 'tw_0050',
      quantity: 10,
      price: 10,
      fee: 10,
    }),
    tx({
      type: 'buy',
      date: '2026-01-03',
      instrumentId: 'tw_0050',
      quantity: 10,
      price: 20,
      fee: 10,
    }),
  );
  return data;
}
const move = () =>
  tx({
    type: 'position_transfer',
    date: '2026-01-04',
    instrumentId: 'tw_0050',
    quantity: 15,
    toAccountId: 'sinopac_tw',
  });

describe('security transfers', () => {
  it('retains FIFO dates and cost while cash, NAV, contributions and realized P&L stay constant', () => {
    const data = securities();
    const before = computePortfolio(data, { now: NOW });
    data.transactions.push(move());
    const after = computePortfolio(data, { now: NOW });
    expect(after.ledger.warnings).toEqual([]);
    expect(after.ledger.cash).toEqual(before.ledger.cash);
    expect(after.ledger.totals).toEqual(before.ledger.totals);
    expect(after.valuation.nav).toBe(before.valuation.nav);
    expect(after.valuation.grossExposure).toBe(before.valuation.grossExposure);
    expect(after.ledger.positions.find((p) => p.accountId === 'sinopac_tw')?.lots).toEqual([
      { date: '2026-01-02', quantity: 10, price: 10 },
      { date: '2026-01-03', quantity: 5, price: 20 },
    ]);
    data.transactions.push(
      tx({
        type: 'sell',
        date: '2026-01-05',
        accountId: 'sinopac_tw',
        instrumentId: 'tw_0050',
        quantity: 12,
        price: 30,
      }),
    );
    const ledger = buildLedger(data);
    const journal = replayTrades(data);
    expect(ledger.totals.realizedPnl).toBe(220);
    expect(journal.entries).toHaveLength(3);
    expect(journal.entries.at(-1)?.realizedPnl).toBe(220);
    expect(journal.roundTrips.map((r) => r.entryDate)).toEqual(['2026-01-02', '2026-01-03']);
    expect(journal.roundTrips.reduce((s, r) => s + r.costs, 0)).toBe(12);
    expect(journal.entries.slice(0, 2).map((e) => e.openQuantity)).toEqual([0, 8]);
  });
  it.each([
    { quantity: 21 },
    { quantity: -1 },
    { toAccountId: 'kgi_tw' },
    { toAccountId: 'missing' },
    { toBucket: 'other' },
    { fee: 1 },
  ])('rejects invalid transfers atomically: %j', (patch) => {
    const data = securities();
    const before = buildLedger(data);
    data.transactions.push({ ...move(), ...patch });
    const after = buildLedger(data);
    expect(after.warnings).toHaveLength(1);
    expect(after.cash).toEqual(before.cash);
    expect(after.positions.filter((p) => p.quantity)).toEqual(before.positions);
    expect(replayTrades(data).warnings).toHaveLength(1);
  });
  it('accounts for transfer value as capital only within each position scope', () => {
    const data = securities();
    data.transactions.push(move());
    data.priceHistory.push({ id: 'close', instrumentId: 'tw_0050', date: '2026-01-04', close: 30 });
    expect(externalFlows(data, 'total', '2026-01-04', '2026-01-04')).toEqual([]);
    expect(
      externalFlows(data, { positionKey: 'kgi_tw|tw_0050|core' }, '2026-01-04', '2026-01-04'),
    ).toEqual([{ date: '2026-01-04', amount: -450 }]);
    expect(
      externalFlows(data, { positionKey: 'sinopac_tw|tw_0050|core' }, '2026-01-04', '2026-01-04'),
    ).toEqual([{ date: '2026-01-04', amount: 450 }]);
  });
});

function debt() {
  const data = fresh();
  data.loans.push({
    id: 'loan',
    name: '示範貸款',
    kind: 'pledge',
    lender: '示範券商甲',
    currency: 'TWD',
    principal: 1000,
    annualRate: 0.12,
    method: 'revolving',
    startDate: '2026-01-01',
    active: true,
  });
  data.transactions.push(
    tx({ type: 'loan_draw', date: '2026-01-01', loanId: 'loan', amount: 1000 }),
    tx({ type: 'loan_accrual', date: '2026-01-02', loanId: 'loan', amount: 20 }),
  );
  return data;
}

describe('unpaid loan interest', () => {
  it('adds debt and funding cost without cash, contributed capital or paid interest', () => {
    const data = debt();
    const portfolio = computePortfolio(data, { now: NOW });
    expect(portfolio.ledger.cash[0].amount).toBe(1000);
    expect(portfolio.ledger.loans[0]).toMatchObject({
      balance: 1020,
      accruedInterest: 20,
      interestPaid: 0,
    });
    expect(portfolio.ledger.totals).toMatchObject({ contributedCapital: 0, fundingCost: 20 });
    expect(portfolio.valuation.nav).toBe(-20);
    const status = loanStatus(data, portfolio.ledger, data.loans[0], '2026-01-03');
    expect(status.projectedMonthlyInterest).toBe(10);
    expect(status.nextPayment?.interest).toBe(30);
    const core = strategySummaries(data, portfolio).core;
    expect(core?.fundingCost).toBe(20);
  });
  it.each(['portfolio', 'external'] as const)(
    'settles accrued interest once with %s money',
    (source) => {
      const data = debt();
      data.transactions.push(
        tx({
          type: 'loan_repay',
          date: '2026-01-03',
          loanId: 'loan',
          principal: 100,
          interest: 25,
          amount: 125,
          source,
        }),
      );
      const portfolio = computePortfolio(data, { now: NOW });
      expect(portfolio.ledger.loans[0]).toMatchObject({
        balance: 900,
        accruedInterest: 0,
        interestPaid: 25,
      });
      expect(portfolio.ledger.totals.fundingCost).toBe(25);
      expect(portfolio.ledger.cash[0].amount).toBe(source === 'portfolio' ? 875 : 1000);
      expect(portfolio.ledger.totals.contributedCapital).toBe(source === 'external' ? 125 : 0);
      const summaries = strategySummaries(data, portfolio);
      expect(summaries.core.fundingCost).toBe(25);
      expect(summaries.core.netEquity).toBe(portfolio.valuation.nav);
      expect(
        pnlBreakdown(data, 'total', '2026-01-01', '2026-01-03', '2026-01-03').fundingCost,
      ).toBe(25);
      expect(
        pnlBreakdown(data, 'total', '2026-01-03', '2026-01-03', '2026-01-03').fundingCost,
      ).toBe(5);
    },
  );
  it('round-trips both accounting types through CSV', () => {
    const data = debt();
    const rows = [move(), data.transactions[1]];
    const parsed = parseTransactionsCsv(transactionsToCsv(rows), data);
    expect(parsed.errors).toEqual([]);
    expect(parsed.transactions).toEqual(rows);
  });
  it('retains unconfirmed repayments and extension limits without posting either to the ledger', () => {
    const data = debt();
    const before = computePortfolio(data, { now: NOW });
    const rows = [
      tx({
        type: 'loan_repay',
        date: '2026-01-03',
        loanId: 'loan',
        amount: 25,
        principal: 0,
        interest: 25,
        source: 'unconfirmed',
      }),
      tx({
        type: 'loan_extension',
        date: '2026-01-03',
        loanId: 'loan',
        amount: 5000,
        note: '示範展延額度；不代表借入本金。',
      }),
    ];
    data.transactions.push(...rows);
    const after = computePortfolio(data, { now: NOW });
    expect(after.ledger.cash).toEqual(before.ledger.cash);
    expect(after.ledger.loans).toEqual(before.ledger.loans);
    expect(after.ledger.totals).toEqual(before.ledger.totals);
    expect(after.ledger.warnings[0]).toContain('待核對');
    expect(strategySummaries(data, after).core.netEquity).toBe(before.valuation.nav);
    expect(externalFlows(data, 'total', '2026-01-03', '2026-01-03')).toEqual([]);
    expect(pnlBreakdown(data, 'total', '2026-01-03', '2026-01-03', '2026-01-03').fundingCost).toBe(
      0,
    );
    const parsed = parseTransactionsCsv(transactionsToCsv(rows), data);
    expect(parsed.errors).toEqual([]);
    expect(parsed.transactions).toEqual(rows);
  });
});
