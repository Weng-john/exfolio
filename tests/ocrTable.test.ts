import { describe, expect, it } from 'vitest';
import {
  buildStatementTransactions,
  DEFAULT_STATEMENT_OPTIONS,
  detectStatementTable,
  groupLines,
  lineToCells,
  parseStatementRows,
  repairHeaderTypo,
  suggestMapping,
  tableToTsv,
  wordsToTable,
  type OcrWord,
} from '@core/index';
import { fresh } from './helpers';

// Synthetic word boxes standing in for a recognised screenshot.

const H = 20;
/** One word whose width follows its length, at a given left or right edge. */
function word(
  text: string,
  y: number,
  at: { left?: number; right?: number },
  confidence = 95,
): OcrWord {
  const width = text.length * 11;
  const x0 = at.left ?? at.right! - width;
  return { text, x0, y0: y, x1: x0 + width, y1: y + H, confidence };
}

/** A statement with left-aligned text columns and right-aligned numbers. */
function screenshot(): OcrWord[] {
  const row = (
    y: number,
    date: string,
    symbol: string,
    side: string,
    qty: string,
    price: string,
  ) => [
    word(date, y, { left: 20 }),
    word(symbol, y, { left: 180 }),
    word(side, y, { left: 300 }),
    word(qty, y, { right: 520 }),
    word(price, y, { right: 660 }),
  ];
  return [
    word('示範券商甲', 10, { left: 20 }),
    word('成交明細', 10, { left: 140 }),
    ...row(50, '成交日期', '股票代號', '買賣別', '成交股數', '成交價'),
    ...row(80, '2026/01/05', '0050', '買進', '1,000', '100.5'),
    ...row(110, '2026/01/06', '00631L', '賣出', '200', '210'),
  ];
}

describe('groupLines and lineToCells', () => {
  it('orders words into lines even when they arrive shuffled and slightly skewed', () => {
    const words = [
      word('b', 52, { left: 100 }),
      word('c', 90, { left: 10 }),
      word('a', 50, { left: 10 }),
    ];
    expect(groupLines(words).map((l) => l.map((w) => w.text))).toEqual([['a', 'b'], ['c']]);
  });

  it('joins split Chinese characters without spaces and Latin words with one', () => {
    const cjk = [
      word('成', 0, { left: 0 }),
      word('交', 0, { left: 12 }),
      word('價', 0, { left: 24 }),
    ];
    expect(lineToCells(cjk).map((c) => c.text)).toEqual(['成交價']);
    const latin = [word('Trade', 0, { left: 0 }), word('Date', 0, { left: 62 })];
    expect(lineToCells(latin).map((c) => c.text)).toEqual(['Trade Date']);
    const apart = [word('買進', 0, { left: 0 }), word('1,000', 0, { left: 200 })];
    expect(lineToCells(apart)).toHaveLength(2);
  });
});

describe('wordsToTable', () => {
  it('rebuilds columns from left- and right-aligned cells and keeps the title apart', () => {
    const table = wordsToTable(screenshot());
    expect(table.rows).toEqual([
      ['示範券商甲 成交明細'],
      ['成交日期', '股票代號', '買賣別', '成交股數', '成交價'],
      ['2026/01/05', '0050', '買進', '1,000', '100.5'],
      ['2026/01/06', '00631L', '賣出', '200', '210'],
    ]);
  });

  it('leaves a cell empty when a row has nothing in that column', () => {
    const words = screenshot().filter((w) => !(w.text === '210'));
    expect(wordsToTable(words).rows[3]).toEqual(['2026/01/06', '00631L', '賣出', '200', '']);
  });

  it('flags cells the engine was unsure about', () => {
    const words = screenshot().map((w) => (w.text === '1,000' ? { ...w, confidence: 40 } : w));
    expect(wordsToTable(words).uncertain).toEqual([{ row: 2, column: 3 }]);
  });

  it('copes with a page that has no table', () => {
    expect(wordsToTable([word('只有一行文字', 0, { left: 0 })]).rows).toEqual([['只有一行文字']]);
    expect(wordsToTable([])).toEqual({ rows: [], uncertain: [] });
  });
});

describe('screenshot to transactions', () => {
  it('feeds the statement importer like a file would', () => {
    const data = fresh();
    const table = detectStatementTable(tableToTsv(wordsToTable(screenshot()).rows), {
      delimiter: '\t',
    });
    expect(table.headers).toEqual(['成交日期', '股票代號', '買賣別', '成交股數', '成交價']);
    const { mapping } = suggestMapping(table.headers);
    const rows = parseStatementRows(table, mapping, DEFAULT_STATEMENT_OPTIONS);
    const built = buildStatementTransactions(
      rows,
      mapping,
      { ...DEFAULT_STATEMENT_OPTIONS, accountId: 'kgi_tw', bucket: 'core' },
      data,
    );
    expect(built.errors).toEqual([]);
    expect(
      built.transactions.map((t) => [t.date, t.type, t.instrumentId, t.quantity, t.price]),
    ).toEqual([
      ['2026-01-05', 'buy', 'tw_0050', 1000, 100.5],
      ['2026-01-06', 'sell', 'tw_00631L', 200, 210],
    ]);
  });
});

describe('repairHeaderTypo', () => {
  it('mends a header one character off a known one', () => {
    expect(repairHeaderTypo('成交曰期')).toBe('成交日期');
    expect(repairHeaderTypo('交易曰期')).toBe('交易日期');
  });

  it('leaves recognised headers, data and far-off text alone', () => {
    for (const cell of [
      '股票代號',
      '買進',
      '0050',
      '2026/03/02',
      '示範券商甲',
      'Symbol',
      '隨便亂寫',
    ]) {
      expect(repairHeaderTypo(cell)).toBe(cell);
    }
  });
});
