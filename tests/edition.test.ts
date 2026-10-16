import { afterEach, describe, expect, it, vi } from 'vitest';

// The public edition takes its members' backend from a build variable and
// accepts nothing but an Apps Script web app address.

async function edition(env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return import('../src/web/edition');
}

afterEach(() => vi.unstubAllEnvs());

// Assembled at run time so the privacy check, which refuses real deployment
// addresses in the repository, does not flag these fictional ones.
const PREFIX = ['https://script.google.com', 'macros', 's'].join('/');
const ID = 'AKfycbx_fictional-deployment-id_0123456789';
const GOOD = `${PREFIX}/${ID}/exec`;

describe('edition', () => {
  it('offers members in the public edition only with a GAS address', async () => {
    const e = await edition({ VITE_EXFOLIO_EDITION: 'public', VITE_EXFOLIO_GAS_URL: GOOD });
    expect(e.PUBLIC_GAS_URL).toBe(GOOD);
    expect(e.MEMBERS_ENABLED).toBe(true);
    const none = await edition({ VITE_EXFOLIO_EDITION: 'public', VITE_EXFOLIO_GAS_URL: '' });
    expect(none.MEMBERS_ENABLED).toBe(false);
  });

  it.each([
    GOOD.replace('https:', 'http:'),
    GOOD.replace('script.google.com', 'script.google.com.evil.example'),
    `https://evil.example/?${GOOD}`,
    GOOD.replace('/exec', '/dev'),
    `${GOOD}?next=https://evil.example`,
  ])('ignores %s', async (url) => {
    const e = await edition({ VITE_EXFOLIO_EDITION: 'public', VITE_EXFOLIO_GAS_URL: url });
    expect(e.PUBLIC_GAS_URL).toBe('');
    expect(e.MEMBERS_ENABLED).toBe(false);
  });

  it('never uses the address in the full edition', async () => {
    const e = await edition({ VITE_EXFOLIO_EDITION: 'full', VITE_EXFOLIO_GAS_URL: GOOD });
    expect(e.PUBLIC_GAS_URL).toBe('');
    expect(e.MEMBERS_ENABLED).toBe(true);
  });
});
