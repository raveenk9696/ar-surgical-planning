import { describe, expect, it } from 'vitest';
import { newToken, readToken, shareUrl, split } from './roomId';

describe('roomId', () => {
  it('round trips a token through the hash', () => {
    const t = newToken();
    expect(t).toMatch(/^[A-Z2-7]{20}$/);
    expect(readToken(`#r=${t}`)).toBe(t);
  });

  it('carries 100 bits: 20 base32 characters, and fresh tokens differ', () => {
    const tokens = new Set(Array.from({ length: 200 }, newToken));
    expect(tokens.size).toBe(200);
    expect(newToken().length * 5).toBe(100);
  });

  it.each(['', '#', '#r=', '#r=short', '#r=abcdefghijklmnopqrst', '#x=AAAAAAAAAAAAAAAAAAAA', '#r=AAAAAAAAAAAAAAAAAAAA1', '#r=AAAAAAAAAAAAAAAAAAAA&debug=1', '#r=AAAAAAAAAAAAAAAAAAA0'])('rejects the junk hash %j', (h) => {
    expect(readToken(h)).toBeNull();
  });

  it('splits the topic from the secret', () => {
    expect(split('ABCDEFGHIJKLMNOPQRST')).toEqual({ roomId: 'ABCDEFGHIJ', secret: 'KLMNOPQRST' });
  });

  it('builds a share link from origin, path and hash only', () => {
    expect(shareUrl('ABCDEFGHIJKLMNOPQRST', { origin: 'https://x.github.io', pathname: '/ar-surgical-planning/' })).toBe('https://x.github.io/ar-surgical-planning/#r=ABCDEFGHIJKLMNOPQRST');
  });
});
