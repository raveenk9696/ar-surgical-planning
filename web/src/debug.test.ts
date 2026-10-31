import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseFlags } from './debug';

describe('parseFlags', () => {
  it('reads every flag', () => {
    expect(parseFlags('?debug=1&transport=net&quality=lite&hero=together&relays=wss://a.example,wss://b.example')).toEqual({
      debug: true,
      relays: ['wss://a.example', 'wss://b.example'],
      transport: 'net',
      quality: 'lite',
      hero: 'together',
    });
  });

  it('ignores relays unless debug is on, and drops junk values', () => {
    expect(parseFlags('?relays=wss://a.example').relays).toBeNull();
    expect(parseFlags('?debug=1&relays=javascript:alert(1),http://x').relays).toBeNull();
    expect(parseFlags('?transport=both&quality=ultra&hero=1')).toMatchObject({ transport: null, quality: null, hero: null });
    expect(parseFlags('')).toEqual({ debug: false, relays: null, transport: null, quality: null, hero: null });
  });
});


afterEach(() => vi.unstubAllEnvs());
it('ignores debug and relay overrides in production', () => {
  vi.stubEnv('DEV', false);
  expect(parseFlags('?debug=1&relays=wss://attacker.example&transport=tabs')).toMatchObject({ debug: false, relays: null, transport: 'tabs' });
});
