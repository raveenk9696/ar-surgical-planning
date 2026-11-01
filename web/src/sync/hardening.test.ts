import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FakeHub } from '../test/fakehub';
import { identity, noteBy, peer, settle } from '../test/signed';
import { createEngine } from './engine';
import type { Note } from '../types';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

function setup(storage?: Storage) {
  const end = new FakeHub().end('A');
  const engine = createEngine({ token: 'ABCDEFGHIJKLMNOPQRST', identity: identity('A'), transport: end, now: Date.now, storage });
  return { engine, end };
}
const snapshot = (notes: Note[]) => ({ v: 2, k: 'snapshot', from: peer('B').id, notes });

it('verifies at most 20 unknown records and skips a replayed 300-record snapshot', async () => {
  const { engine, end } = setup();
  await engine.start();
  const notes = Array.from({ length: 300 }, (_, i) => noteBy('B', i + 1, { deleted: true }));
  const verify = vi.spyOn(crypto.subtle, 'verify');
  end.inject(snapshot(notes), 'nostr:one');
  for (let i = 0; i < 10; i++) await settle();
  expect(verify.mock.calls.length).toBeLessThanOrEqual(40);
  expect(engine.state.notes.size).toBe(20);
  for (let group = 1; group < 15; group++) {
    end.inject(snapshot(notes.slice(group * 20, (group + 1) * 20)), `nostr:${group}`);
    await settle();
  }
  expect(engine.state.notes.size).toBe(300);
  verify.mockClear();
  end.inject(snapshot(notes), 'nostr:replay');
  await settle();
  expect(verify).not.toHaveBeenCalled();
  engine.stop();
});

it('erases deleted content from state, cache and outgoing wire records', async () => {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) } as Storage;
  const { engine, end } = setup(storage);
  await engine.start();
  const added = await engine.addNote({ pos: [12, 34, 56], nrm: [0, 0, 1], mesh: 'bone', text: 'patient MRN 123456' });
  if (!added.ok) throw new Error('add failed');
  end.sent.length = 0;
  await engine.deleteNote(added.id);
  const dead = engine.state.notes.get(added.id)!;
  expect(dead).not.toHaveProperty('text');
  expect(dead).not.toHaveProperty('pos');
  expect(dead).not.toHaveProperty('nrm');
  expect(dead).not.toHaveProperty('mesh');
  engine.stop();
  expect(JSON.stringify([...data.values()])).not.toContain('patient MRN');
  expect(JSON.stringify(end.sent)).not.toContain('patient MRN');
  const reloaded = setup(storage);
  await reloaded.engine.start();
  expect(reloaded.engine.state.notes.get(added.id)).toEqual(dead);
  reloaded.engine.stop();
});
