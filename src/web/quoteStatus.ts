// How the header words the state of market quotes. Kept apart from the
// component so the wording can be tested.

export interface QuoteFailure {
  /** Instrument symbol or currency pair. */
  name: string;
  reason: string;
}

export interface QuoteStatusInput {
  refreshing: boolean;
  /** Quotes asked for in the last refresh. */
  requested: number;
  failures: QuoteFailure[];
  /** Time of the last refresh that brought at least one price, formatted. */
  lastSuccess?: string;
  /** Public edition: when the published snapshot was generated, formatted. */
  snapshot?: string;
}

export interface QuoteStatus {
  tone: 'ok' | 'info' | 'warn';
  text: string;
  /** Failures grouped by reason, most common first, for the details list. */
  groups: Array<{ reason: string; names: string[] }>;
}

export function quoteStatus(s: QuoteStatusInput): QuoteStatus {
  const byReason = new Map<string, string[]>();
  for (const f of s.failures) byReason.set(f.reason, [...(byReason.get(f.reason) ?? []), f.name]);
  const groups = [...byReason]
    .map(([reason, names]) => ({ reason, names }))
    .sort((a, b) => b.names.length - a.names.length);
  const source = s.snapshot
    ? `報價快照 ${s.snapshot}`
    : s.lastSuccess
      ? `報價 ${s.lastSuccess}`
      : '';
  if (s.refreshing) return { tone: 'info', text: '更新報價中…', groups };
  const failed = s.failures.length;
  if (s.requested > 0 && failed >= s.requested)
    return {
      tone: 'warn',
      text: source ? `${source} · 這次更新失敗` : '無法取得報價',
      groups,
    };
  if (failed > 0) return { tone: 'info', text: `${source || '報價'} · ${failed} 項未更新`, groups };
  if (!source) return { tone: 'info', text: '尚未更新報價', groups };
  return { tone: 'ok', text: source, groups };
}
