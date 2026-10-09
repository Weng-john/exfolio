// Rebuilding a table from the words a text-recognition engine found in a
// statement screenshot. Pure geometry: no recognition happens here.

export interface OcrWord {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** 0..100 as reported by the engine. */
  confidence?: number;
}

export interface OcrCell {
  text: string;
  x0: number;
  x1: number;
  /** Lowest confidence among the words merged into this cell. */
  confidence?: number;
}

export interface OcrTable {
  rows: string[][];
  /** Row and column of cells the engine was unsure about, for the user to check. */
  uncertain: Array<{ row: number; column: number }>;
}

/** Confidence under which a cell is flagged for review. */
export const OCR_REVIEW_CONFIDENCE = 70;

const median = (values: number[]): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const CJK = /[　-〿㐀-鿿＀-￯]/;

/** Group words into text lines by vertical overlap, top to bottom. */
export function groupLines(words: OcrWord[]): OcrWord[][] {
  const usable = words.filter((w) => w.text.trim() !== '' && w.x1 > w.x0 && w.y1 > w.y0);
  const height = median(usable.map((w) => w.y1 - w.y0));
  const lines: Array<{ center: number; words: OcrWord[] }> = [];
  for (const word of [...usable].sort((a, b) => a.y0 + a.y1 - (b.y0 + b.y1))) {
    const center = (word.y0 + word.y1) / 2;
    const line = lines.find((l) => Math.abs(l.center - center) <= height * 0.5);
    if (line) {
      line.words.push(word);
      line.center = line.words.reduce((s, w) => s + (w.y0 + w.y1) / 2, 0) / line.words.length;
    } else {
      lines.push({ center, words: [word] });
    }
  }
  return lines.sort((a, b) => a.center - b.center).map((l) => l.words.sort((a, b) => a.x0 - b.x0));
}

/**
 * Merge neighbouring words of a line into cells. Engines split Chinese text
 * into single characters and numbers at their separators, so words closer
 * than a fraction of the line height belong to the same cell.
 */
export function lineToCells(line: OcrWord[]): OcrCell[] {
  const height = median(line.map((w) => w.y1 - w.y0));
  const cells: OcrCell[] = [];
  for (const word of line) {
    const last = cells[cells.length - 1];
    const gap = last ? word.x0 - last.x1 : Infinity;
    if (last && gap <= height * 0.6) {
      // Latin words keep the space that separated them; CJK characters do not.
      const joiner =
        gap > height * 0.15 && !CJK.test(last.text.slice(-1)) && !CJK.test(word.text[0]) ? ' ' : '';
      last.text += joiner + word.text;
      last.x1 = Math.max(last.x1, word.x1);
      if (word.confidence !== undefined) {
        last.confidence = Math.min(last.confidence ?? 100, word.confidence);
      }
    } else {
      cells.push({ text: word.text, x0: word.x0, x1: word.x1, confidence: word.confidence });
    }
  }
  return cells;
}

/**
 * Lay recognised words out as a table. Column boundaries are the vertical
 * strips that stay empty on nearly every table line, which works for
 * left-aligned text and right-aligned numbers alike. Lines that are not
 * part of the table (titles, footers) come back as a single cell.
 */
export function wordsToTable(words: OcrWord[]): OcrTable {
  const lines = groupLines(words).map(lineToCells);
  const widest = Math.max(0, ...lines.map((l) => l.length));
  if (widest < 2) {
    return { rows: lines.map((l) => [l.map((c) => c.text).join(' ')]), uncertain: [] };
  }
  // Table lines: those with at least half as many cells as the widest line.
  const isTableLine = (cells: OcrCell[]) => cells.length >= Math.max(2, Math.ceil(widest / 2));
  const tableLines = lines.filter(isTableLine);

  const minX = Math.min(...tableLines.flatMap((l) => l.map((c) => c.x0)));
  const maxX = Math.max(...tableLines.flatMap((l) => l.map((c) => c.x1)));
  const step = Math.max(1, (maxX - minX) / 2000);
  const needed = Math.ceil(tableLines.length * 0.9);
  // Walk across the page; a column separator is a run of positions that
  // almost no table line has text at.
  const separators: number[] = [];
  let runStart: number | undefined;
  for (let x = minX; x <= maxX + step; x += step) {
    const free = tableLines.filter((l) => !l.some((c) => c.x0 <= x && x <= c.x1)).length;
    const isGap = free >= needed && x <= maxX;
    if (isGap && runStart === undefined) runStart = x;
    if (!isGap && runStart !== undefined) {
      separators.push((runStart + x - step) / 2);
      runStart = undefined;
    }
  }
  const columnOf = (cell: OcrCell) => {
    const center = (cell.x0 + cell.x1) / 2;
    let column = 0;
    while (column < separators.length && center > separators[column]) column += 1;
    return column;
  };

  const rows: string[][] = [];
  const uncertain: OcrTable['uncertain'] = [];
  for (const cells of lines) {
    if (!isTableLine(cells)) {
      rows.push([cells.map((c) => c.text).join(' ')]);
      continue;
    }
    const row = Array.from({ length: separators.length + 1 }, () => '');
    for (const cell of cells) {
      const column = columnOf(cell);
      row[column] = row[column] ? `${row[column]} ${cell.text}` : cell.text;
      if (cell.confidence !== undefined && cell.confidence < OCR_REVIEW_CONFIDENCE) {
        uncertain.push({ row: rows.length, column });
      }
    }
    rows.push(row);
  }
  return { rows, uncertain };
}

/** Tab-separated text of a table, the form the statement importer reads. */
export function tableToTsv(rows: string[][]): string {
  return rows
    .map((row) => row.map((cell) => cell.replace(/[\t\r\n]+/g, ' ').trim()).join('\t'))
    .join('\n');
}
