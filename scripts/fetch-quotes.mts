// Writes a snapshot of public market quotes for the static site, which has
// no backend to ask. Covers the seed instruments and FX pairs only: nothing
// here depends on, or reveals, anyone's holdings.
//
// Usage: tsx scripts/fetch-quotes.mts [output path, default dist/quotes.json]

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fetchQuotes } from '../server/quotes';
import type { QuoteRequestItem } from '../src/core/api';
import { SEED_FX_PAIRS, SEED_INSTRUMENTS } from '../src/core/seed';

const output = path.resolve(process.argv[2] ?? 'dist/quotes.json');

const items = new Map<string, QuoteRequestItem>();
for (const instrument of SEED_INSTRUMENTS) {
  if (instrument.quoteSource === 'manual' || !instrument.quoteSymbol) continue;
  items.set(`${instrument.quoteSource}:${instrument.quoteSymbol}`, {
    source: instrument.quoteSource,
    symbol: instrument.quoteSymbol,
  });
}
for (const [, , source, symbol] of SEED_FX_PAIRS) items.set(`${source}:${symbol}`, { source, symbol });

const quotes = await fetchQuotes([...items.values()]);
const failed = quotes.filter((q) => q.error);
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({ generatedAt: new Date().toISOString(), quotes }, null, 1));

console.log(`quotes: ${quotes.length - failed.length} ok, ${failed.length} failed → ${output}`);
for (const q of failed) console.log(`  ${q.source}:${q.symbol} — ${q.error}`);
// A partial snapshot is still useful; only a total failure is an error.
if (failed.length === quotes.length) process.exit(1);
