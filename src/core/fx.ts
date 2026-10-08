import type { Currency, FxRate } from './types';

/**
 * Currency converter over the known FX pairs. Uses a direct or inverse pair
 * when one exists, otherwise the shortest chain of pairs (e.g. USDT→USD→TWD).
 */
export class FxTable {
  private readonly edges = new Map<Currency, Map<Currency, number>>();

  constructor(rates: FxRate[]) {
    for (const r of rates) {
      if (!(r.rate > 0)) continue;
      this.link(r.from, r.to, r.rate);
      this.link(r.to, r.from, 1 / r.rate);
    }
  }

  private link(from: Currency, to: Currency, rate: number) {
    let m = this.edges.get(from);
    if (!m) this.edges.set(from, (m = new Map()));
    // A quoted pair wins over an inverse derived from the opposite pair.
    if (!m.has(to)) m.set(to, rate);
  }

  /** Units of `to` per 1 unit of `from`, or undefined when no path exists. */
  rate(from: Currency, to: Currency): number | undefined {
    if (from === to) return 1;
    const seen = new Set<Currency>([from]);
    let frontier: Array<[Currency, number]> = [[from, 1]];
    while (frontier.length) {
      const next: Array<[Currency, number]> = [];
      for (const [cur, acc] of frontier) {
        for (const [n, r] of this.edges.get(cur) ?? []) {
          if (n === to) return acc * r;
          if (!seen.has(n)) {
            seen.add(n);
            next.push([n, acc * r]);
          }
        }
      }
      frontier = next;
    }
    return undefined;
  }

  convert(amount: number, from: Currency, to: Currency): number | undefined {
    const r = this.rate(from, to);
    return r === undefined ? undefined : amount * r;
  }
}
