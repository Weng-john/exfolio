import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyProfile,
  balancingDeposits,
  buildLedger,
  buildStatementTransactions,
  classifySide,
  decodeStatement,
  detectDelimiter,
  detectStatementTable,
  importImpact,
  matchInstrument,
  parseDate,
  parseNumber,
  parseStatementRows,
  pickProfile,
  profileFromImport,
  suggestDateOptions,
  suggestMapping,
  suggestQuantityUnit,
  type AppData,
  type StatementMapping,
  type StatementOptions,
} from '@core/index';
import { fresh } from './helpers';

const load = (name: string) =>
  readFileSync(new URL(`./fixtures/statements/${name}`, import.meta.url), 'utf-8');

/** Encode text as Big5 by inverting the platform decoder (TextEncoder cannot do Big5). */
function encodeBig5(text: string): Uint8Array {
  const dec = new TextDecoder('big5');
  const rev = new Map<string, number[]>();
  for (let lead = 0xa1; lead <= 0xf9; lead++) {
    for (let trail = 0x40; trail <= 0xfe; trail++) {
      if (trail > 0x7e && trail < 0xa1) continue;
      const ch = dec.decode(new Uint8Array([lead, trail]));
      if (ch.length === 1 && ch !== '�' && !rev.has(ch)) rev.set(ch, [lead, trail]);
    }
  }
  const bytes: number[] = [];
  for (const ch of text) {
    if (ch.charCodeAt(0) < 0x80) bytes.push(ch.charCodeAt(0));
    else {
      const b = rev.get(ch);
      if (!b) throw new Error(`no Big5 code for ${ch}`);
      bytes.push(...b);
    }
  }
  return Uint8Array.from(bytes);
}

function base(accountId: string, extra: Partial<StatementOptions> = {}): StatementOptions {
  return {
    accountId,
    bucket: 'core',
    dateOrder: 'ymd',
    roc: 'auto',
    quantityUnit: 'share',
    estimateMissingFees: false,
    ...extra,
  };
}

function run(text: string, data: AppData, options: StatementOptions, mapping?: StatementMapping) {
  const table = detectStatementTable(text);
  const map = mapping ?? suggestMapping(table.headers).mapping;
  const rows = parseStatementRows(table, map, options);
  const result = buildStatementTransactions(rows, map, options, data);
  return { table, mapping: map, rows, result };
}

describe('decodeStatement', () => {
  const text = load('tw_securities.csv');

  it('reads UTF-8, with and without BOM', () => {
    const bytes = new TextEncoder().encode(text);
    expect(decodeStatement(bytes)).toMatchObject({ encoding: 'utf-8', text });
    const bom = Uint8Array.from([0xef, 0xbb, 0xbf, ...bytes]);
    expect(decodeStatement(bom).text).toBe(text);
  });

  it('falls back to Big5 for non-UTF-8 bytes', () => {
    const big5 = encodeBig5(text);
    const res = decodeStatement(big5);
    expect(res.encoding).toBe('big5');
    expect(res.text).toBe(text);
  });

  it('honours a forced encoding and reads UTF-16 by BOM', () => {
    expect(decodeStatement(encodeBig5('買進'), { encoding: 'big5' }).text).toBe('買進');
    const u16 = new Uint8Array([
      0xff,
      0xfe,
      ...new Uint8Array(new Uint16Array([...'買進,1'].map((c) => c.charCodeAt(0))).buffer),
    ]);
    expect(decodeStatement(u16)).toMatchObject({ encoding: 'utf-16le', text: '買進,1' });
  });

  it('accepts an injected decoder when the runtime lacks Big5', () => {
    const calls: string[] = [];
    const res = decodeStatement(Uint8Array.from([0xa4, 0x40]), {
      decoderFactory: (label, fatal) => ({
        decode: () => {
          calls.push(`${label}:${fatal}`);
          if (label === 'utf-8') throw new Error('invalid');
          return '一';
        },
      }),
    });
    expect(res).toMatchObject({ encoding: 'big5', text: '一' });
    expect(calls).toEqual(['utf-8:true', 'big5:false']);
  });
});

describe('table detection', () => {
  it('skips the title preamble, finds the header and drops the 合計 footer', () => {
    const t = detectStatementTable(load('tw_securities.csv'));
    expect(t.delimiter).toBe(',');
    expect(t.headerRow).toBe(3);
    expect(t.headers[0]).toBe('成交日期');
    expect(t.preamble).toHaveLength(3);
    expect(t.rows).toHaveLength(3);
    expect(t.summaryRows).toBe(1);
  });

  it('detects tab and semicolon delimiters', () => {
    expect(detectStatementTable(load('futures.tsv')).delimiter).toBe('\t');
    const semi = 'Date;Symbol;Quantity;Price\n2026-01-05;VOO;1;500,5\n2026-01-06;VOO;1;501,5\n';
    expect(detectDelimiter(semi)).toBe(';');
    expect(detectStatementTable(semi).rows[0]).toEqual(['2026-01-05', 'VOO', '1', '500,5']);
  });

  it('allows overriding delimiter and header row', () => {
    const t = detectStatementTable(load('tw_securities.csv'), { headerRow: 0 });
    expect(t.headerRow).toBe(0);
    expect(t.headers).toEqual(['示範券商甲 成交明細表']);
  });

  it('drops trailing rows without a parseable date but keeps middle ones as errors', () => {
    const text =
      'Date,Symbol,Quantity,Price,Side\n2026-01-05,VOO,1,500,Buy\nnot a date,VOO,1,500,Buy\n2026-01-07,VOO,1,500,Buy\n本表僅供參考,,,,\n';
    const t = detectStatementTable(text);
    const rows = parseStatementRows(t, suggestMapping(t.headers).mapping);
    expect(rows).toHaveLength(3);
    expect(rows[1].errors[0]).toContain('日期');
  });
});

describe('suggestMapping', () => {
  it('maps Taiwanese securities headers with full confidence', () => {
    const { mapping, confidence } = suggestMapping(
      detectStatementTable(load('tw_securities.csv')).headers,
    );
    expect(mapping).toEqual({
      date: '成交日期',
      symbol: '股票代號',
      name: '股票名稱',
      side: '買賣別',
      quantity: '成交股數',
      price: '成交價',
      amount: '成交金額',
      fee: '手續費',
      tax: '交易稅',
      orderId: '成交序號',
    });
    expect(confidence.date).toBe(1);
  });

  it('maps futures, US and exchange headers', () => {
    expect(suggestMapping(detectStatementTable(load('futures.tsv')).headers).mapping).toMatchObject(
      {
        quantity: '口數',
        symbol: '商品代碼',
        tax: '期交稅',
      },
    );
    expect(suggestMapping(detectStatementTable(load('us.csv')).headers).mapping).toMatchObject({
      date: 'Trade Date',
      name: 'Description',
      fee: 'Fees',
      amount: 'Amount',
    });
    expect(
      suggestMapping(detectStatementTable(load('exchange.csv')).headers).mapping,
    ).toMatchObject({
      date: 'Date(UTC)',
      symbol: 'Pair',
      side: 'Side',
      quantity: 'Executed',
      amount: 'Amount',
    });
  });

  it('reads Amount as quantity when a separate Total holds the money', () => {
    const { mapping } = suggestMapping(['Date', 'Symbol', 'Side', 'Price', 'Amount', 'Total']);
    expect(mapping.quantity).toBe('Amount');
    expect(mapping.amount).toBe('Total');
  });

  it('understands simplified Chinese and bracketed units, with lower confidence for fuzzy matches', () => {
    const { mapping } = suggestMapping([
      '成交日期',
      '证券代码',
      '买卖',
      '成交数量',
      '成交价(元)',
      '手续费',
      '莫名欄位',
    ]);
    expect(mapping).toMatchObject({
      symbol: '证券代码',
      side: '买卖',
      quantity: '成交数量',
      price: '成交价(元)',
      fee: '手续费',
    });
    expect(Object.values(mapping)).not.toContain('莫名欄位');
    const fuzzy = suggestMapping(['買進股數']);
    expect(fuzzy.mapping.quantity).toBe('買進股數');
    expect(fuzzy.confidence.quantity).toBeLessThan(0.8);
  });

  it('leaves unknown columns unmapped and never reuses a column', () => {
    const { mapping } = suggestMapping(['foo', 'bar', 'Date']);
    expect(mapping).toEqual({ date: 'Date' });
  });
});

describe('parseNumber', () => {
  it.each([
    ['1,234.50', 1234.5],
    ['１２３４', 1234],
    ['（1,200）', -1200],
    ['(1,200.5)', -1200.5],
    ['1200-', -1200],
    ['-1,200', -1200],
    ['−5', -5],
    ['+7', 7],
    ['$1,200', 1200],
    ['NT$1,200', 1200],
    ['¥ 99', 99],
    ['1.234,56', 1234.56],
    ['12,5', 12.5],
    ['1e-8', 1e-8],
  ])('%s -> %s', (raw, expected) => {
    expect(parseNumber(raw).value).toBeCloseTo(expected, 10);
  });

  it('handles percent, units, blanks and garbage', () => {
    expect(parseNumber('12.5%')).toMatchObject({ value: 0.125, percent: true });
    expect(parseNumber('0.1BTC')).toMatchObject({ value: 0.1, unit: 'BTC' });
    expect(parseNumber('12.5 USDT')).toMatchObject({ value: 12.5, unit: 'USDT' });
    expect(parseNumber('')).toMatchObject({ empty: true });
    expect(parseNumber(' - ')).toMatchObject({ empty: true });
    expect(parseNumber('abc').error).toBeDefined();
    expect(parseNumber('1,23,4,5').error).toBeDefined();
  });
});

describe('parseDate', () => {
  it.each([
    ['2026-01-05', '2026-01-05'],
    ['2026/1/5', '2026-01-05'],
    ['20260105', '2026-01-05'],
    ['2026-01-05 09:30:12', '2026-01-05'],
    ['2026-01-05T09:30:12Z', '2026-01-05'],
    ['2026/01/05 09:30', '2026-01-05'],
    ['115/01/05', '2026-01-05'],
    ['1150105', '2026-01-05'],
    ['115年01月05日', '2026-01-05'],
    ['99/01/05', '2010-01-05'],
    ['１１５／０１／０５', '2026-01-05'],
    ['1767571200000', '2026-01-05'],
  ])('%s -> %s', (raw, expected) => {
    expect(parseDate(raw).date).toBe(expected);
  });

  it('marks ROC conversion and lets the user turn it off or force it', () => {
    expect(parseDate('115/01/05').rocUsed).toBe(true);
    expect(parseDate('115/01/05', { roc: 'no' }).error).toBeDefined();
    expect(parseDate('1150105', { roc: 'no' }).error).toBeDefined();
    expect(parseDate('2026/01/05').rocUsed).toBeUndefined();
  });

  it('never guesses between MM/DD/YYYY and DD/MM/YYYY', () => {
    expect(parseDate('01/05/2026').error).toContain('順序');
    expect(parseDate('01/05/2026', { dateOrder: 'mdy' }).date).toBe('2026-01-05');
    expect(parseDate('01/05/2026', { dateOrder: 'dmy' }).date).toBe('2026-05-01');
    expect(parseDate('13/05/2026', { dateOrder: 'mdy' }).error).toBeDefined();
  });

  it('rejects impossible dates', () => {
    expect(parseDate('2026-02-30').error).toBeDefined();
    expect(parseDate('2026-13-01').error).toBeDefined();
    expect(parseDate('hello').error).toBeDefined();
    expect(parseDate('').error).toBeDefined();
  });

  it('suggests the order only when the samples settle it', () => {
    expect(suggestDateOptions(['01/05/2026', '01/20/2026'])).toMatchObject({ dateOrder: 'mdy' });
    expect(suggestDateOptions(['20/01/2026', '05/01/2026'])).toMatchObject({ dateOrder: 'dmy' });
    expect(suggestDateOptions(['01/05/2026'])).toMatchObject({ ambiguous: true });
    expect(suggestDateOptions(['115/01/05'])).toMatchObject({ roc: true, ambiguous: false });
  });
});

describe('classifySide', () => {
  it.each([
    ['買', 'buy'],
    ['買進', 'buy'],
    ['現買', 'buy'],
    ['融資買進', 'buy'],
    ['買入', 'buy'],
    ['Buy', 'buy'],
    ['B', 'buy'],
    ['賣', 'sell'],
    ['賣出', 'sell'],
    ['現賣', 'sell'],
    ['融券賣出', 'sell'],
    ['Sell', 'sell'],
    ['S', 'sell'],
  ])('%s -> %s', (raw, kind) => {
    expect(classifySide(raw).kind).toBe(kind);
  });

  it.each([
    ['股息', 'dividend'],
    ['配息', 'dividend'],
    ['Dividend', 'dividend'],
    ['入金', 'deposit'],
    ['Deposit', 'deposit'],
    ['出金', 'withdraw'],
    ['Withdraw', 'withdraw'],
    ['手續費', 'fee'],
    ['Fee', 'fee'],
    ['利息', 'interest'],
    ['Interest', 'interest'],
    ['Funding Fee', 'funding_fee'],
  ])('%s is the non-trade type %s', (raw, type) => {
    expect(classifySide(raw)).toEqual({ kind: 'other', type });
  });

  it('reports what it cannot classify', () => {
    expect(classifySide('配股').kind).toBe('unknown');
    expect(classifySide('bonus').kind).toBe('unknown');
  });
});

describe('Taiwan securities statement', () => {
  const opts = base('kgi_tw');

  it('parses ROC dates, thousands separators and fees', () => {
    const { rows } = run(load('tw_securities.csv'), fresh(), opts);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      date: '2026-01-05',
      type: 'buy',
      symbol: '0050',
      quantity: 1000,
      price: 150.5,
      fee: 214,
      tax: 0,
      orderId: 'A0001',
    });
    expect(rows[1]).toMatchObject({ type: 'sell', date: '2026-01-20', tax: 77 });
  });

  it('builds ledger-compatible transactions; the unknown symbol becomes a proposal', () => {
    const data = fresh();
    const { result } = run(load('tw_securities.csv'), data, opts);
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]).toMatchObject({
      type: 'buy',
      accountId: 'kgi_tw',
      bucket: 'core',
      currency: 'TWD',
      amount: 0,
      instrumentId: 'tw_0050',
      quantity: 1000,
      price: 150.5,
      fee: 214,
    });
    expect(result.newInstruments).toHaveLength(1);
    expect(result.newInstruments[0]).toMatchObject({ key: '2330', rows: 1, confirmed: false });
    expect(result.newInstruments[0].instrument).toMatchObject({
      symbol: '2330',
      name: '示範半導體',
      type: 'stock',
      currency: 'TWD',
      quoteSource: 'manual',
    });
    // Nothing created silently.
    expect(data.instruments.some((i) => i.symbol === '2330')).toBe(false);
    expect(result.outcomes.map((o) => o.status)).toEqual(['ok', 'ok', 'needs_instrument']);
  });

  it('imports the row once the proposal is confirmed (and edits are honoured)', () => {
    const data = fresh();
    const first = run(load('tw_securities.csv'), data, opts);
    const draft = {
      ...first.result.newInstruments[0].instrument,
      type: 'stock' as const,
      name: '示範半導體（改）',
    };
    const { result } = run(load('tw_securities.csv'), data, {
      ...opts,
      confirmedInstruments: { '2330': draft },
    });
    expect(result.transactions).toHaveLength(3);
    expect(result.transactions[2].instrumentId).toBe(draft.id);
    expect(result.newInstruments[0]).toMatchObject({ confirmed: true, rows: 1 });
  });

  it('works after Big5 decoding end to end', () => {
    const decoded = decodeStatement(encodeBig5(load('tw_securities.csv')));
    expect(decoded.encoding).toBe('big5');
    const { rows } = run(decoded.text, fresh(), opts);
    expect(rows[0].type).toBe('buy');
    expect(rows[0].date).toBe('2026-01-05');
  });
});

describe('futures statement (tab separated)', () => {
  it('keeps contract quantities and builds long then short', () => {
    const data = fresh();
    const { result, rows } = run(load('futures.tsv'), data, base('kgi_fut'));
    expect(rows[0]).toMatchObject({ quantity: 2, price: 22000, fee: 40, tax: 9 });
    expect(result.transactions.map((t) => [t.type, t.quantity, t.instrumentId])).toEqual([
      ['buy', 2, 'fut_MTX'],
      ['sell', 3, 'fut_MTX'],
    ]);
    const impact = importImpact(data, result.transactions);
    const pos = impact.positions[0];
    expect(pos).toMatchObject({ quantityBefore: 0, quantityAfter: -1 });
    // Closed 2 long contracts at +100 points x 50 = 10,000, before fees.
    expect(impact.realizedPnl).toEqual([{ currency: 'TWD', amount: 10000 }]);
    const w = impact.warnings.find((x) => x.code === 'short_position');
    expect(w?.level).toBe('info');
  });

  it('does not scale futures by the lot option', () => {
    const { result } = run(load('futures.tsv'), fresh(), base('kgi_fut', { quantityUnit: 'lot' }));
    expect(result.transactions[0].quantity).toBe(2);
  });
});

describe('US statement without a side column', () => {
  const data = () => {
    const d = fresh();
    d.fxRates = [];
    return d;
  };

  it('needs the date order to be chosen explicitly', () => {
    const { rows } = run(load('us.csv'), data(), base('sinopac_us'));
    expect(rows[0].errors.join()).toContain('順序');
  });

  it('derives side from the signed quantity and uses the instrument currency', () => {
    const table = detectStatementTable(load('us.csv'));
    const samples = table.rows.map((r) => r[0]);
    expect(suggestDateOptions(samples).dateOrder).toBe('mdy');
    const { rows, result } = run(load('us.csv'), data(), base('sinopac_us', { dateOrder: 'mdy' }));
    expect(rows.map((r) => [r.type, r.sideSource])).toEqual([
      ['buy', 'quantity-sign'],
      ['sell', 'quantity-sign'],
    ]);
    expect(result.transactions).toMatchObject([
      {
        type: 'buy',
        date: '2026-01-05',
        quantity: 10,
        price: 500,
        currency: 'USD',
        instrumentId: 'us_VOO',
      },
      { type: 'sell', date: '2026-01-20', quantity: 4, price: 510 },
    ]);
  });

  it('derives side from the amount sign when quantities are unsigned', () => {
    const text =
      'Date,Symbol,Quantity,Price,Amount\n2026-01-05,VOO,10,500,-5000\n2026-01-06,VOO,4,510,2040\n';
    const { rows } = run(text, data(), base('sinopac_us'));
    expect(rows.map((r) => r.type)).toEqual(['buy', 'sell']);
    expect(rows[0].sideSource).toBe('amount-sign');
  });

  it('reports rows whose direction cannot be derived', () => {
    const text = 'Date,Symbol,Quantity,Price\n2026-01-05,VOO,10,500\n';
    const { rows, result } = run(text, data(), base('sinopac_us'));
    expect(rows[0].errors[0]).toContain('方向');
    expect(result.errors).toHaveLength(1);
    expect(result.transactions).toHaveLength(0);
  });
});

describe('exchange statement', () => {
  it('maps BTCUSDT to the BTC spot instrument and keeps fees in the quote currency', () => {
    const data = fresh();
    const { result, rows } = run(load('exchange.csv'), data, base('binance_main'));
    expect(rows[0]).toMatchObject({
      date: '2026-01-05',
      quantity: 0.1,
      price: 40000.5,
      fee: 4.00005,
      feeUnit: 'USDT',
    });
    expect(result.transactions).toMatchObject([
      {
        type: 'buy',
        instrumentId: 'crypto_BTC',
        currency: 'USDT',
        quantity: 0.1,
        price: 40000.5,
        fee: 4.00005,
      },
      { type: 'sell', instrumentId: 'crypto_BTC', quantity: 0.05, fee: 2.05 },
    ]);
    expect(result.newInstruments).toHaveLength(0);
  });

  it('converts a fee paid in the base asset and ignores an unrelated fee currency', () => {
    const text =
      'Date(UTC),Pair,Side,Price,Executed,Fee\n2026-01-05 08:00:00,BTCUSDT,BUY,40000,0.1,0.0001BTC\n2026-01-06 08:00:00,BTCUSDT,BUY,40000,0.1,0.5BNB\n';
    const { result } = run(text, fresh(), base('binance_main'));
    expect(result.transactions[0].fee).toBeCloseTo(4);
    expect(result.transactions[1].fee).toBeUndefined();
    expect(result.warnings.join()).toContain('BNB');
  });

  it('proposes a new instrument when the quote currency does not match', () => {
    const text = 'Date,Pair,Side,Price,Quantity\n2026-01-05,ETHUSDT,BUY,3000,1\n';
    const { result } = run(text, fresh(), base('binance_main'));
    expect(result.transactions).toHaveLength(0);
    expect(result.newInstruments[0].instrument).toMatchObject({
      symbol: 'ETH',
      type: 'crypto',
      currency: 'USDT',
    });
  });
});

describe('instrument matching', () => {
  const inst = fresh().instruments;
  it.each([
    ['tw_0050', 'id'],
    ['0050', 'symbol'],
    ['voo', 'symbol'],
    ['0050.TW', 'stripped'],
    ['TW:0050', 'stripped'],
    ['0050 元大台灣50', 'stripped'],
    ['BTCUSDT', 'pair'],
    ['BTC/USDT', 'pair'],
  ])('%s matches by %s', (symbol, how) => {
    expect(matchInstrument(symbol, undefined, inst)?.how).toBe(how);
  });

  it('uses names only as a flagged weak fallback', () => {
    const m = matchInstrument('9999', '元大台灣50', inst);
    expect(m).toMatchObject({ how: 'name', needsReview: true });
    expect(matchInstrument('ZZZZ', '完全不同', inst)).toBeUndefined();
    expect(matchInstrument('BTCEUR', undefined, inst)).toBeUndefined();
  });

  it('does not import a name-only match until the user confirms it', () => {
    const text =
      '成交日期,股票代號,股票名稱,買賣別,成交股數,成交價\n2026/01/05,9999,元大台灣50,買進,100,150\n';
    const data = fresh();
    const unconfirmed = run(text, data, base('kgi_tw'));
    expect(unconfirmed.result.transactions).toHaveLength(0);
    expect(unconfirmed.result.outcomes[0].status).toBe('needs_review');
    const confirmed = run(text, data, base('kgi_tw', { instrumentChoices: { '9999': 'tw_0050' } }));
    expect(confirmed.result.transactions[0].instrumentId).toBe('tw_0050');
  });
});

describe('quantity unit', () => {
  const text =
    '成交日期,股票代號,買賣別,成交數量,成交價,成交金額\n2026/01/05,0050,買進,2,150,300000\n';
  it('converts lots (張) to shares when asked', () => {
    const { result } = run(text, fresh(), base('kgi_tw', { quantityUnit: 'lot' }));
    expect(result.transactions[0].quantity).toBe(2000);
    expect(result.transactions[0].note).toContain('張');
  });

  it('hints lots from amount = quantity x price x 1000 and warns on a unit mismatch', () => {
    const table = detectStatementTable(text);
    const mapping = suggestMapping(table.headers).mapping;
    expect(suggestQuantityUnit(table, mapping).unit).toBe('lot');
    const { result } = run(text, fresh(), base('kgi_tw'));
    expect(result.warnings.join()).toContain('單位');
  });

  it('hints lots from a 張 header', () => {
    const t = detectStatementTable('日期,代號,買賣,張數,價格\n2026/01/05,0050,買,2,150\n');
    expect(suggestQuantityUnit(t, suggestMapping(t.headers).mapping).unit).toBe('lot');
  });
});

describe('derived values and fee estimation', () => {
  it('derives price from amount and quantity and says so', () => {
    const text = '成交日期,股票代號,買賣別,成交股數,成交金額\n2026/01/05,0050,買進,100,15000\n';
    const { result } = run(text, fresh(), base('kgi_tw'));
    expect(result.transactions[0].price).toBe(150);
    expect(result.transactions[0].note).toContain('推算');
  });

  it('estimates missing fees only when asked, and marks the note', () => {
    const data = fresh();
    data.brokers[0].fees = { etf: { rate: 0.001425, discount: 1, minFee: 20, sellTaxRate: 0.001 } };
    const text = '成交日期,股票代號,買賣別,成交股數,成交價\n2026/01/05,0050,賣出,1000,150\n';
    const off = run(text, data, base('kgi_tw'));
    expect(off.result.transactions[0].fee).toBeUndefined();
    const on = run(text, data, base('kgi_tw', { estimateMissingFees: true }));
    expect(on.result.transactions[0].fee).toBeCloseTo(213.75);
    expect(on.result.transactions[0].tax).toBeCloseTo(150);
    expect(on.result.transactions[0].note).toContain('估算');
  });

  it('does not override fees that the file provides', () => {
    const data = fresh();
    data.brokers[0].fees = { etf: { rate: 0.001425, minFee: 20 } };
    const text =
      '成交日期,股票代號,買賣別,成交股數,成交價,手續費\n2026/01/05,0050,買進,1000,150,100\n';
    const { result } = run(text, data, base('kgi_tw', { estimateMissingFees: true }));
    expect(result.transactions[0].fee).toBe(100);
  });
});

describe('non-trade rows', () => {
  const text = [
    'Date,Symbol,Type,Amount,Currency',
    '2026-01-02,,Deposit,"10,000",USD',
    '2026-01-10,VOO,Dividend,12.5,USD',
    '2026-01-11,,Withdraw,-500,USD',
    '2026-01-12,,Funding Fee,-1.5,USD',
    '2026-01-13,,配股,5,USD',
  ].join('\n');

  it('maps them to matching types and reports unclassifiable rows', () => {
    const { result } = run(text, fresh(), base('sinopac_us'));
    expect(result.transactions.map((t) => [t.type, t.amount, t.currency])).toEqual([
      ['deposit', 10000, 'USD'],
      ['dividend', 12.5, 'USD'],
      ['withdraw', 500, 'USD'],
      ['funding_fee', 1.5, 'USD'],
    ]);
    expect(result.transactions[1].instrumentId).toBe('us_VOO');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('配股');
  });
});

describe('duplicate protection', () => {
  const opts = base('kgi_tw', { confirmedInstruments: {} });

  it('gives deterministic ids and imports nothing the second time', () => {
    const data = fresh();
    const first = run(load('tw_securities.csv'), data, opts);
    const again = run(load('tw_securities.csv'), data, opts);
    expect(again.result.transactions.map((t) => t.id)).toEqual(
      first.result.transactions.map((t) => t.id),
    );
    data.transactions.push(...first.result.transactions);
    const third = run(load('tw_securities.csv'), data, opts);
    expect(third.result.transactions).toHaveLength(0);
    expect(third.result.duplicates).toBe(2);
    expect(third.result.outcomes.filter((o) => o.status === 'duplicate')).toHaveLength(2);
  });

  it('adds only the new rows of an overlapping range', () => {
    const data = fresh();
    const a =
      'Date,Symbol,Quantity,Price,Side\n2026-01-05,VOO,1,500,Buy\n2026-01-06,VOO,1,501,Buy\n';
    const b =
      'Date,Symbol,Quantity,Price,Side\n2026-01-06,VOO,1,501,Buy\n2026-01-07,VOO,1,502,Buy\n';
    data.transactions.push(...run(a, data, base('sinopac_us')).result.transactions);
    const second = run(b, data, base('sinopac_us'));
    expect(second.result.duplicates).toBe(1);
    expect(second.result.transactions).toHaveLength(1);
    expect(second.result.transactions[0].date).toBe('2026-01-07');
  });

  it('keeps two genuinely identical fills on the same day and still dedupes them on re-import', () => {
    const data = fresh();
    const text =
      'Date,Symbol,Quantity,Price,Side\n2026-01-05,VOO,1,500,Buy\n2026-01-05,VOO,1,500,Buy\n';
    const first = run(text, data, base('sinopac_us'));
    expect(first.result.transactions).toHaveLength(2);
    expect(new Set(first.result.transactions.map((t) => t.id)).size).toBe(2);
    data.transactions.push(...first.result.transactions);
    const again = run(text, data, base('sinopac_us'));
    expect(again.result.transactions).toHaveLength(0);
    expect(again.result.duplicates).toBe(2);
  });

  it('separates fills that differ only by the statement order id', () => {
    const text =
      'Date,Symbol,Quantity,Price,Side,Order ID\n2026-01-05,VOO,1,500,Buy,X1\n2026-01-05,VOO,1,500,Buy,X2\n';
    const { result } = run(text, fresh(), base('sinopac_us'));
    expect(new Set(result.transactions.map((t) => t.id)).size).toBe(2);
  });

  it('does not collide across accounts', () => {
    const text = 'Date,Symbol,Quantity,Price,Side\n2026-01-05,VOO,1,500,Buy\n';
    const a = run(text, fresh(), base('sinopac_us')).result.transactions[0].id;
    const b = run(text, fresh(), base('binance_main', { confirmedInstruments: {} })).result
      .transactions[0]?.id;
    expect(a).not.toBe(b);
  });
});

describe('importImpact', () => {
  const setup = () => {
    const data = fresh();
    const { result } = run(load('tw_securities.csv'), data, base('kgi_tw'));
    return { data, txs: result.transactions };
  };

  it('matches the ledger replay', () => {
    const { data, txs } = setup();
    const impact = importImpact(data, txs);
    const ledger = buildLedger({ ...data, transactions: [...data.transactions, ...txs] });
    const p = ledger.positions.find((x) => x.instrumentId === 'tw_0050')!;
    const change = impact.positions.find((x) => x.instrumentId === 'tw_0050')!;
    expect(change).toMatchObject({
      quantityBefore: 0,
      quantityAfter: 500,
      avgCostAfter: p.avgCost,
    });
    expect(change.avgCostAfter).toBe(150.5);
    expect(change.realizedPnlDelta).toBeCloseTo(p.realizedPnl);
    expect(change.realizedPnlDelta).toBeCloseTo(500 * (155 - 150.5));
    const cash = impact.cash.find((c) => c.accountId === 'kgi_tw' && c.currency === 'TWD')!;
    expect(cash.before).toBe(0);
    expect(cash.after).toBeCloseTo(ledger.cash.find((c) => c.accountId === 'kgi_tw')!.amount);
    expect(cash.after).toBeCloseTo(-150500 - 214 + 77500 - 110 - 77);
    expect(impact.totalsDelta.realizedPnl).toBeCloseTo(ledger.totals.realizedPnl);
    expect(impact.totalsDelta.fees).toBeCloseTo(214 + 110 + 77);
    expect(impact.realizedPnl).toEqual([{ currency: 'TWD', amount: expect.closeTo(2250, 6) }]);
  });

  it('warns about negative cash caused by a trade-only statement', () => {
    const { data, txs } = setup();
    const impact = importImpact(data, txs);
    const w = impact.warnings.find((x) => x.code === 'negative_cash');
    expect(w?.level).toBe('warn');
    expect(w?.message).toContain('入金');
    expect(impact.cash[0].minAfter).toBeCloseTo(-150714);
    expect(impact.cash[0].minDate).toBe('2026-01-05');
  });

  it('does not warn about cash when deposits already cover the trades', () => {
    const { data, txs } = setup();
    data.transactions.push({
      id: 'dep',
      date: '2025-12-31',
      type: 'deposit',
      accountId: 'kgi_tw',
      bucket: 'core',
      currency: 'TWD',
      amount: 1_000_000,
    });
    expect(importImpact(data, txs).warnings).toEqual([]);
  });

  it('warns when a stock sale exceeds the holding', () => {
    const data = fresh();
    const text = 'Date,Symbol,Quantity,Price,Side\n2026-01-05,VOO,5,500,Sell\n';
    const { result } = run(text, data, base('sinopac_us'));
    const impact = importImpact(data, result.transactions);
    const w = impact.warnings.find((x) => x.code === 'short_position');
    expect(w?.level).toBe('warn');
    expect(impact.positions[0].quantityAfter).toBe(-5);
  });

  it('is empty for no transactions', () => {
    expect(importImpact(fresh(), [])).toMatchObject({ positions: [], cash: [], warnings: [] });
  });
});

describe('balancingDeposits', () => {
  const setup = () => {
    const data = fresh();
    const { result } = run(load('tw_securities.csv'), data, base('kgi_tw'));
    return { data, txs: result.transactions };
  };

  it('does nothing by default', () => {
    const { data, txs } = setup();
    expect(balancingDeposits(data, txs, 'none')).toEqual([]);
  });

  it('adds one deposit the day before the first trade, keeping cash non-negative', () => {
    const { data, txs } = setup();
    const deps = balancingDeposits(data, txs, 'opening');
    expect(deps).toHaveLength(1);
    expect(deps[0]).toMatchObject({
      type: 'deposit',
      date: '2026-01-04',
      accountId: 'kgi_tw',
      currency: 'TWD',
      amount: 150714,
      tags: ['statement-balancing'],
    });
    expect(deps[0].note).toContain('假設');
    const withDeps = { ...data, transactions: [...deps, ...txs] };
    const impact = importImpact(data, [...deps, ...txs]);
    expect(impact.warnings.filter((w) => w.code === 'negative_cash')).toEqual([]);
    expect(impact.cash[0].minAfter).toBeGreaterThanOrEqual(0);
    expect(buildLedger(withDeps).totals.contributedCapital).toBe(150714);
  });

  it('adds nothing when cash never goes negative, and is deterministic', () => {
    const { data, txs } = setup();
    const a = balancingDeposits(data, txs, 'opening');
    const b = balancingDeposits(data, txs, 'opening');
    expect(a.map((t) => t.id)).toEqual(b.map((t) => t.id));
    const funded = { ...data, transactions: [...a] };
    expect(balancingDeposits(funded, txs, 'opening')).toEqual([]);
  });
});

describe('profiles', () => {
  const table = detectStatementTable(load('tw_securities.csv'));
  const { mapping } = suggestMapping(table.headers);

  it('turns a mapping and options into an importProfiles row', () => {
    const p = profileFromImport(
      '示範券商甲 成交明細',
      table.headers,
      mapping,
      base('kgi_tw', { quantityUnit: 'lot' }),
      { brokerId: 'kgi' },
    );
    expect(p).toMatchObject({ name: '示範券商甲 成交明細', brokerId: 'kgi' });
    expect(p.mapping.date).toBe('成交日期');
    expect(p.options).toMatchObject({ quantityUnit: 'lot', roc: 'auto' });
    expect(p.options).not.toHaveProperty('accountId');
  });

  it('picks the profile with the most similar headers', () => {
    const tw = profileFromImport('tw', table.headers, mapping, {});
    const usTable = detectStatementTable(load('us.csv'));
    const us = profileFromImport(
      'us',
      usTable.headers,
      suggestMapping(usTable.headers).mapping,
      {},
    );
    expect(pickProfile(table.headers, [us, tw])?.profile.name).toBe('tw');
    expect(pickProfile(usTable.headers, [tw, us])?.profile.name).toBe('us');
    expect(pickProfile(['a', 'b', 'c'], [tw, us])).toBeUndefined();
    // a file with one extra column still matches
    expect(pickProfile([...table.headers, '額外欄位'], [tw])?.score).toBeGreaterThan(0.8);
  });

  it('applies a profile, dropping mapped columns that the file lacks', () => {
    const p = profileFromImport('tw', table.headers, mapping, { quantityUnit: 'lot', roc: 'yes' });
    const applied = applyProfile(
      p,
      table.headers.filter((h) => h !== '交易稅'),
    );
    expect(applied.mapping.tax).toBeUndefined();
    expect(applied.mapping.fee).toBe('手續費');
    expect(applied.options).toMatchObject({ quantityUnit: 'lot', roc: 'yes' });
  });
});
