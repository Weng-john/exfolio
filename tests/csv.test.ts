import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  parseCsvRecords,
  parseTransactionsCsv,
  splitExisting,
  transactionsToCsv,
  type Transaction,
} from '@core/index';
import { fresh, tx } from './helpers';

const data = () => {
  const d = fresh();
  d.strategies.push({ id: 'st1', name: '策略一', status: 'active' });
  d.loans.push({
    id: 'credit1', name: '信貸', kind: 'credit', lender: '銀行', currency: 'TWD',
    principal: 100_000, annualRate: 0.03, method: 'annuity', startDate: '2026-01-01', active: true,
  });
  return d;
};

describe('parseCsvRecords', () => {
  it('handles quotes, embedded commas, newlines and CRLF', () => {
    const rows = parseCsvRecords('a,b\r\n"x,1","he said ""hi""\nline2"\r\n\r\nlast,');
    expect(rows).toEqual([['a', 'b'], ['x,1', 'he said "hi"\nline2'], ['last', '']]);
  });

  it('strips a UTF-8 BOM', () => {
    expect(parseCsvRecords('﻿date,type\n1,2')[0]).toEqual(['date', 'type']);
  });
});

describe('transaction CSV round trip', () => {
  it('exports and re-imports every field', () => {
    const d = data();
    const txs: Transaction[] = [
      tx({ id: 'a', type: 'buy', date: '2026-01-02', currency: 'TWD', instrumentId: 'tw_0050', quantity: 100, price: 50, fee: 20, tax: 0, note: '含逗號, "引號"\n換行', tags: ['x', 'y'] }),
      tx({ id: 'b', type: 'transfer', date: '2026-01-03', currency: 'TWD', amount: 3200, toAccountId: 'sinopac_us', toCurrency: 'USD', toAmount: 100, fxRate: 1, toBucket: 'st1' }),
      tx({ id: 'c', type: 'loan_repay', date: '2026-01-04', amount: 1000, loanId: 'credit1', principal: 900, interest: 100, source: 'external' }),
      tx({ id: 'd', type: 'adjust', date: '2026-01-05', amount: -12.5, bucket: 'st1' }),
    ];
    const res = parseTransactionsCsv(transactionsToCsv(txs), d);
    expect(res.errors).toEqual([]);
    // buy / sell amount is normalised to 0
    expect(res.transactions).toEqual(txs.map((t) => ({ ...t, amount: t.type === 'buy' ? 0 : t.amount })));
  });

  it('accepts a BOM and resolves accounts by name and instruments by symbol', () => {
    const csv = '﻿' + readFileSync(new URL('./fixtures/transactions.sample.csv', import.meta.url), 'utf8');
    const res = parseTransactionsCsv(csv, data());
    expect(res.transactions.map((t) => t.id)).toEqual(['fx1', 'fx2']);
    expect(res.transactions[0].accountId).toBe('kgi_tw');
    expect(res.transactions[1]).toMatchObject({ instrumentId: 'tw_0050', currency: 'TWD', amount: 0 });
    expect(res.transactions[1].note).toBe('含逗號, 與"引號"');
  });
});

describe('validation', () => {
  it('reports row numbers and reasons instead of throwing', () => {
    const csv = readFileSync(new URL('./fixtures/transactions.sample.csv', import.meta.url), 'utf8');
    const res = parseTransactionsCsv(csv, data());
    expect(res.errors.map((e) => e.row)).toEqual([4, 5]);
    expect(res.errors[0].message).toContain('date');
    expect(res.errors[1].message).toContain('找不到帳戶');
  });

  it('rejects missing columns, bad numbers, unknown refs and duplicate ids', () => {
    const d = data();
    expect(parseTransactionsCsv('foo\n1', d).errors[0].message).toContain('缺少必要欄位');
    expect(parseTransactionsCsv('', d).errors).toHaveLength(1);
    const head = 'id,date,type,account,currency,amount,instrument,quantity,price,toAccount,loanId,source,bucket\n';
    const rows = [
      'e1,2026-01-01,deposit,kgi_tw,TWD,abc,,,,,,,', // bad number
      'e2,2026-01-01,deposit,kgi_tw,TWD,-5,,,,,,,', // negative amount
      'e3,2026-01-01,buy,kgi_tw,,,0050,0,50,,,,', // zero quantity
      'e4,2026-01-01,transfer,kgi_tw,TWD,10,,,,,,,', // no toAccount
      'e5,2026-01-01,loan_repay,kgi_tw,TWD,10,,,,,credit1,,', // no source
      'e6,2026-01-01,loan_draw,kgi_tw,TWD,10,,,,,nope,,', // unknown loan
      'e7,2026-01-01,deposit,kgi_tw,TWD,10,,,,,,,zzz', // unknown strategy
      'e8,2026-01-01,foo,kgi_tw,TWD,10,,,,,,,', // bad type
      'ok,2026-01-01,deposit,kgi_tw,TWD,10,,,,,,,',
      'ok,2026-01-01,deposit,kgi_tw,TWD,10,,,,,,,', // duplicate
    ];
    const res = parseTransactionsCsv(head + rows.join('\n'), d);
    expect(res.transactions).toHaveLength(1);
    expect(res.errors.map((e) => e.row)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 11]);
  });

  it('allows signed amounts for adjust and funding_fee', () => {
    const csv = 'date,type,account,currency,amount\n2026-01-01,adjust,kgi_tw,TWD,-5\n2026-01-01,funding_fee,binance_main,USDT,-0.2';
    const res = parseTransactionsCsv(csv, data());
    expect(res.errors).toEqual([]);
    expect(res.transactions.map((t) => t.amount)).toEqual([-5, -0.2]);
    expect(res.transactions[0].id).toMatch(/^tx_/);
  });
});

describe('splitExisting', () => {
  it('separates rows whose id already exists', () => {
    const a = tx({ id: 'a', type: 'deposit', date: '2026-01-01' });
    const b = tx({ id: 'b', type: 'deposit', date: '2026-01-01' });
    const { fresh: f, skipped } = splitExisting([a, b], [a]);
    expect(f).toEqual([b]);
    expect(skipped).toEqual([a]);
  });
});
