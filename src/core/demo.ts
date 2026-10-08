import { seedData } from './seed';
import type { AppData, Transaction } from './types';

// A made-up portfolio for visitors who are not signed in. Every name and
// number here is fictional; nothing describes a real person's holdings.

/** Demo dataset priced as of `now`, so no quote shows as stale. */
export function demoData(now: Date = new Date()): AppData {
  const data = seedData();
  const asOf = now.toISOString();

  data.brokers = [
    {
      id: 'demo_broker_a',
      name: '示範券商甲',
      kind: 'broker',
      fees: {
        stock: { rate: 0.001425, discount: 0.28, minFee: 20, sellTaxRate: 0.003 },
        etf: { rate: 0.001425, discount: 0.28, minFee: 20, sellTaxRate: 0.001 },
        future: { perUnit: 15, taxRate: 0.00002 },
      },
    },
    {
      id: 'demo_broker_b',
      name: '示範券商乙',
      kind: 'broker',
      fees: { etf: { rate: 0.001, minFee: 3 } },
    },
    { id: 'demo_bank', name: '示範銀行', kind: 'bank' },
  ];
  data.accounts = [
    {
      id: 'demo_tw',
      brokerId: 'demo_broker_a',
      name: '甲 台股',
      type: 'securities',
      baseCurrency: 'TWD',
      active: true,
    },
    {
      id: 'demo_fut',
      brokerId: 'demo_broker_a',
      name: '甲 期貨',
      type: 'futures',
      baseCurrency: 'TWD',
      active: true,
    },
    {
      id: 'demo_us',
      brokerId: 'demo_broker_b',
      name: '乙 美股',
      type: 'securities',
      baseCurrency: 'USD',
      active: true,
    },
  ];
  data.instruments = data.instruments.map((i) =>
    i.id === 'fut_TMF' ? { ...i, initialMargin: 16_000, maintenanceMargin: 12_250 } : i,
  );
  data.strategies = [
    {
      id: 'demo_rotation',
      name: '示範輪動策略',
      category: '輪動',
      status: 'active',
      description: '示範用：依主觀判斷在兩檔槓桿 ETF 間切換。',
      benchmarkInstrumentId: 'us_SSO',
      createdAt: '2026-03-10',
    },
  ];
  data.loans = [
    {
      id: 'demo_credit',
      name: '示範信貸',
      kind: 'credit',
      lender: '示範銀行',
      currency: 'TWD',
      principal: 500_000,
      annualRate: 0.03,
      method: 'annuity',
      startDate: '2026-01-05',
      termMonths: 60,
      payDay: 5,
      active: true,
    },
    {
      id: 'demo_pledge',
      name: '示範股票質押',
      kind: 'pledge',
      lender: '示範券商甲',
      currency: 'TWD',
      principal: 300_000,
      annualRate: 0.025,
      method: 'revolving',
      startDate: '2026-02-02',
      collateral: [
        { instrumentId: 'tw_0050', accountId: 'demo_tw', quantity: 6000, loanableRatio: 0.6 },
      ],
      callRatio: 1.3,
      active: true,
    },
  ];

  let seq = 0;
  const tx = (t: Partial<Transaction> & Pick<Transaction, 'type' | 'date'>): Transaction => ({
    id: `demo_tx_${++seq}`,
    accountId: 'demo_tw',
    bucket: 'core',
    currency: 'TWD',
    amount: 0,
    ...t,
  });
  data.transactions = [
    tx({ type: 'deposit', date: '2026-01-05', amount: 1_000_000 }),
    tx({ type: 'loan_draw', date: '2026-01-05', amount: 500_000, loanId: 'demo_credit' }),
    tx({
      type: 'buy',
      date: '2026-01-06',
      instrumentId: 'tw_0050',
      quantity: 8000,
      price: 100,
      fee: 319,
    }),
    tx({
      type: 'buy',
      date: '2026-01-06',
      instrumentId: 'tw_00631L',
      quantity: 1000,
      price: 200,
      fee: 80,
    }),
    tx({ type: 'loan_draw', date: '2026-02-02', amount: 300_000, loanId: 'demo_pledge' }),
    tx({
      type: 'transfer',
      date: '2026-02-03',
      amount: 480_000,
      toAccountId: 'demo_us',
      toCurrency: 'USD',
      toAmount: 15_000,
    }),
    tx({
      type: 'buy',
      date: '2026-02-04',
      accountId: 'demo_us',
      currency: 'USD',
      instrumentId: 'us_VOO',
      quantity: 12,
      price: 600,
      fee: 7.2,
    }),
    tx({
      type: 'buy',
      date: '2026-02-04',
      accountId: 'demo_us',
      currency: 'USD',
      instrumentId: 'us_VXUS',
      quantity: 40,
      price: 70,
      fee: 3,
    }),
    tx({ type: 'deposit', date: '2026-02-10', accountId: 'demo_fut', amount: 150_000 }),
    tx({
      type: 'buy',
      date: '2026-02-11',
      accountId: 'demo_fut',
      instrumentId: 'fut_TMF',
      quantity: 2,
      price: 22_000,
      fee: 39,
    }),
    tx({
      type: 'transfer',
      date: '2026-03-10',
      accountId: 'demo_us',
      currency: 'USD',
      amount: 4_000,
      toBucket: 'demo_rotation',
    }),
    tx({
      type: 'buy',
      date: '2026-03-11',
      accountId: 'demo_us',
      currency: 'USD',
      bucket: 'demo_rotation',
      instrumentId: 'us_SSO',
      quantity: 40,
      price: 70,
      fee: 3,
      reason: '示範進場',
    }),
    tx({
      type: 'sell',
      date: '2026-05-20',
      accountId: 'demo_us',
      currency: 'USD',
      bucket: 'demo_rotation',
      instrumentId: 'us_SSO',
      quantity: 40,
      price: 76,
      fee: 3,
      reason: '示範：切換到 QLD',
    }),
    tx({
      type: 'buy',
      date: '2026-05-20',
      accountId: 'demo_us',
      currency: 'USD',
      bucket: 'demo_rotation',
      instrumentId: 'us_QLD',
      quantity: 30,
      price: 95,
      fee: 3,
      reason: '示範：切換到 QLD',
    }),
    tx({ type: 'dividend', date: '2026-07-20', instrumentId: 'tw_0050', amount: 8_000 }),
  ];
  // One instalment of the credit loan for every due date already past, so
  // the demo never shows an overdue payment whenever it is opened.
  const today = now.toISOString().slice(0, 10);
  for (let n = 1; n <= 60; n++) {
    const month = n % 12; // loan starts in January: instalment n falls due n months later
    const date = `${2026 + Math.floor(n / 12)}-${String(month + 1).padStart(2, '0')}-05`;
    if (date >= today) break;
    data.transactions.push(
      tx({
        type: 'loan_repay',
        date,
        amount: 8_984,
        principal: 7_734 + n * 19,
        interest: 1_250 - n * 19,
        loanId: 'demo_credit',
        source: n % 2 ? 'external' : 'portfolio',
      }),
    );
  }

  const prices: Array<[string, number, string]> = [
    ['tw_0050', 112, 'TWD'],
    ['tw_00631L', 236, 'TWD'],
    ['us_VOO', 640, 'USD'],
    ['us_VXUS', 73, 'USD'],
    ['us_SSO', 78, 'USD'],
    ['us_QLD', 101, 'USD'],
    ['fut_TMF', 22_600, 'TWD'],
  ];
  data.prices = prices.map(([id, price, currency]) => ({
    id,
    price,
    currency,
    asOf,
    source: 'manual',
    status: 'manual',
  }));
  data.fxRates = [
    { id: 'USD/TWD', from: 'USD', to: 'TWD', rate: 32, asOf, source: 'manual' },
    { id: 'USDT/USD', from: 'USDT', to: 'USD', rate: 1, asOf, source: 'manual' },
  ];
  data.targets = [
    { id: 'demo_target_tw50', indexId: 'tw50', targetWeight: 0.9, tolerance: 0.05 },
    {
      id: 'demo_target_sp500',
      indexId: 'sp500',
      targetWeight: 0.4,
      tolerance: 0.05,
      preferredInstrumentId: 'us_VOO',
    },
    { id: 'demo_target_exus', indexId: 'global_ex_us', targetWeight: 0.15, tolerance: 0.03 },
    {
      id: 'demo_target_taiex',
      indexId: 'taiex',
      targetWeight: 0.3,
      tolerance: 0.05,
      preferredInstrumentId: 'fut_TMF',
    },
  ];
  data.cashflowItems = [
    {
      id: 'demo_cf_salary',
      name: '示範薪資',
      kind: 'income',
      amount: 60_000,
      currency: 'TWD',
      frequency: 'monthly',
      startDate: '2026-01-05',
      affectsPortfolio: false,
    },
    {
      id: 'demo_cf_invest',
      name: '示範每月投入',
      kind: 'income',
      amount: 20_000,
      currency: 'TWD',
      frequency: 'monthly',
      startDate: '2026-11-05',
      affectsPortfolio: true,
    },
  ];
  data.settings[0].alerts = {
    ...data.settings[0].alerts,
    grossLeverage: 2.5,
    rollNoticeDays: 7,
    loanDueNoticeDays: 7,
  };
  return data;
}
