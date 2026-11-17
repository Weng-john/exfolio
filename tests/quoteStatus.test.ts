import { describe, expect, it } from 'vitest';
import { quoteStatus } from '../src/web/quoteStatus';

const base = { refreshing: false, requested: 10, failures: [] };

describe('quote status wording', () => {
  it('shows the time of the last good refresh', () => {
    expect(quoteStatus({ ...base, lastSuccess: '14:32' })).toMatchObject({
      tone: 'ok',
      text: '報價 14:32',
    });
    expect(quoteStatus({ ...base, snapshot: '14:00' }).text).toBe('報價快照 14:00');
  });

  it('counts the quotes that did not update', () => {
    const s = quoteStatus({
      ...base,
      lastSuccess: '14:32',
      failures: [
        { name: 'TX', reason: 'HTTP 520' },
        { name: 'MTX', reason: 'HTTP 520' },
        { name: 'VOO', reason: 'timeout' },
      ],
    });
    expect(s).toMatchObject({ tone: 'info', text: '報價 14:32 · 3 項未更新' });
    expect(s.groups).toEqual([
      { reason: 'HTTP 520', names: ['TX', 'MTX'] },
      { reason: 'timeout', names: ['VOO'] },
    ]);
  });

  it('says plainly when nothing could be fetched', () => {
    const failures = Array.from({ length: 10 }, (_, i) => ({ name: `S${i}`, reason: 'offline' }));
    expect(quoteStatus({ ...base, failures })).toMatchObject({
      tone: 'warn',
      text: '無法取得報價',
    });
    expect(quoteStatus({ ...base, failures, lastSuccess: '09:10' }).text).toBe(
      '報價 09:10 · 這次更新失敗',
    );
  });

  it('covers refreshing and never refreshed', () => {
    expect(quoteStatus({ ...base, refreshing: true }).text).toBe('更新報價中…');
    expect(quoteStatus({ ...base, requested: 0 }).text).toBe('尚未更新報價');
  });
});
