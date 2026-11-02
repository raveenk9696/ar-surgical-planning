import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Wire } from '../types';
import { FakeHub } from './fakehub';

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

it('does not drop the same slot of a repeating message cycle every time', () => {
  const hub = new FakeHub();
  hub.dropOneIn = 3;
  const a = hub.end('A');
  const b = hub.end('B');
  a.open();
  b.open();
  const delivered = [0, 0, 0];
  b.onMessage((raw) => void delivered[(raw as { seq: number }).seq % 3]!++);
  for (let seq = 0; seq < 300; seq++) a.send({ seq } as unknown as Wire);
  vi.runAllTimers();
  expect(delivered.every((n) => n > 0)).toBe(true);
  expect(delivered.reduce((sum, n) => sum + n)).toBeGreaterThan(150);
  expect(delivered.reduce((sum, n) => sum + n)).toBeLessThan(250);
});
