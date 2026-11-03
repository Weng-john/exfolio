// Writes a snapshot of public market quotes for the static site, which has
// no backend to ask. Covers the seed instruments and FX pairs only: nothing
// here depends on, or reveals, anyone's holdings.
//
// Usage: tsx scripts/fetch-quotes.mts [output path, default dist/quotes.json]

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fetchQuotes } from '../server/quotes';
import type { QuoteRequestItem } from '../src/core/api';
import { reviewSnapshot } from '../src/core/quoteFreshness';
import { SEED_FX_PAIRS, SEED_INSTRUMENTS } from '../src/core/seed';

/** Share of quotes that must come back with a price (fresh or stale) to publish. */
const MIN_USABLE_SHARE = 0.8;

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

const now = new Date();
const review = reviewSnapshot(await fetchQuotes([...items.values()]), now, MIN_USABLE_SHARE);
await mkdir(path.dirname(output), { recursive: true });
await writeFile(
  output,
  JSON.stringify({ generatedAt: now.toISOString(), quotes: review.quotes }, null, 1),
);

console.log(
  `quotes: ${review.fresh} fresh, ${review.stale.length} stale, ${review.failed.length} failed → ${output}`,
);
for (const q of review.stale)
  console.log(`  stale ${q.source}:${q.symbol} — ${q.ageHours.toFixed(1)} h old (limit ${q.limitHours} h)`);
for (const q of review.failed) console.log(`  failed ${q.source}:${q.symbol} — ${q.reason}`);
// A mostly-empty snapshot would replace a good one on the published site.
// Failing here stops the deployment, so the previous snapshot stays up.
// Stale quotes are published but labelled, so visitors see their age.
if (!review.publish) {
  console.error(
    `quotes: fewer than ${MIN_USABLE_SHARE * 100}% came back with a price; not publishing this snapshot`,
  );
  process.exit(1);
}
