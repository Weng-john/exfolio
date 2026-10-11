import { afterEach, describe, expect, it } from 'vitest';
import { refusal } from '../server/handler';

afterEach(() => {
  delete process.env.EXFOLIO_ALLOWED_HOSTS;
});

describe('which requests the local backend answers', () => {
  it('accepts its own pages and non-browser clients on loopback', () => {
    expect(refusal({ host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173' })).toBe('');
    expect(refusal({ host: 'localhost:8787', origin: 'http://localhost:8787' })).toBe('');
    expect(refusal({ host: '127.0.0.1:8787' })).toBe('');
  });

  it('refuses a page from another site, even one on the same machine', () => {
    expect(refusal({ host: '127.0.0.1:5173', origin: 'https://evil.example' })).toBe(
      'Origin not allowed',
    );
    expect(refusal({ host: '127.0.0.1:5173', origin: 'http://127.0.0.1:9999' })).toBe(
      'Origin not allowed',
    );
    expect(refusal({ host: 'localhost:5173', origin: 'http://127.0.0.1:5173' })).toBe(
      'Origin not allowed',
    );
    expect(refusal({ host: '127.0.0.1:5173', origin: 'null' })).toBe('Origin not allowed');
  });

  it('refuses a hostile name pointed at this machine (DNS rebinding)', () => {
    expect(refusal({ host: 'evil.example:5173', origin: 'http://evil.example:5173' })).toBe(
      'Host not allowed',
    );
    expect(refusal({ host: 'evil.example:5173' })).toBe('Host not allowed');
    expect(refusal({})).toBe('Host not allowed');
  });

  it('answers to extra names only when the operator lists them', () => {
    const headers = { host: 'exfolio.lan:8787', origin: 'http://exfolio.lan:8787' };
    expect(refusal(headers)).toBe('Host not allowed');
    process.env.EXFOLIO_ALLOWED_HOSTS = 'exfolio.lan, other.lan';
    expect(refusal(headers)).toBe('');
    expect(refusal({ host: 'exfolio.lan:8787', origin: 'https://evil.example' })).toBe(
      'Origin not allowed',
    );
  });
});

describe('requests the browser itself labels as cross-site', () => {
  it('are refused whatever their Origin says', () => {
    expect(refusal({ host: '127.0.0.1:5173', 'sec-fetch-site': 'cross-site' })).toBe(
      'Origin not allowed',
    );
    expect(refusal({ host: '127.0.0.1:5173', 'sec-fetch-site': 'same-site' })).toBe(
      'Origin not allowed',
    );
    expect(
      refusal({
        host: '127.0.0.1:5173',
        origin: 'http://127.0.0.1:5173',
        'sec-fetch-site': 'same-origin',
      }),
    ).toBe('');
    expect(refusal({ host: '127.0.0.1:5173', 'sec-fetch-site': 'none' })).toBe('');
  });
});
