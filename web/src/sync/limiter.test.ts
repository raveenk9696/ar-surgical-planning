import { describe, expect, it } from 'vitest';
import { createLimiter } from './limiter';

describe('createLimiter', () => {
  it('allows a burst, then one per refill period, per key', () => {
    let t = 0;
    const l = createLimiter({ burst: 3, refillMs: 1000 }, () => t);
    expect([l.take('a'), l.take('a'), l.take('a'), l.take('a')]).toEqual([true, true, true, false]);
    expect(l.take('b')).toBe(true);
    t = 999;
    expect(l.take('a')).toBe(false);
    t = 1000;
    expect(l.take('a')).toBe(true);
    expect(l.take('a')).toBe(false);
  });

  it('never refills past the burst', () => {
    let t = 0;
    const l = createLimiter({ burst: 2, refillMs: 10 }, () => t);
    t = 1_000_000;
    expect([l.take('a'), l.take('a'), l.take('a')]).toEqual([true, true, false]);
  });

  it('forgets idle keys instead of growing without bound', () => {
    let t = 0;
    const l = createLimiter({ burst: 1, refillMs: 1 }, () => t);
    for (let i = 0; i < 2000; i++) {
      t += 5;
      l.take(`k${i}`);
    }
    expect(l.take('k0')).toBe(true);
  });
});
