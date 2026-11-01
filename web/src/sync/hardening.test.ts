import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FakeHub } from '../test/fakehub';
import { identity, noteBy, peer, settle, run } from '../test/signed';
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

it('C5 keeps local notes and permits another add after five Sybil links fill the room', async () => {
  const { engine, end } = setup();
  await engine.start();
  const add = (text: string) => engine.addNote({ pos: [1, 2, 3] as const, nrm: [0, 0, 1] as const, mesh: 'bone', text });
  const first = await add('mine 1');
  await add('mine 2');
  for (const c of 'BCDEF') {
    end.inject(snapshot(Array.from({ length: 20 }, (_, i) => noteBy(c, i + 1, { created: Date.now() - 24 * 3600_000 + 1000 }))), `nostr:${c}`);
    await settle();
  }
  expect(first.ok && engine.state.notes.has(first.id)).toBe(true);
  expect((await add('mine 3')).ok).toBe(true);
  expect(engine.state.notes.size).toBeLessThanOrEqual(100);
  engine.stop();
});

const presence = (c: string, seq = 1) => ({ v: 2, k: 'presence', from: peer(c), seq, ptr: null, away: false, digest: { n: 0, h: 0 } });

it('C9 serves an honest note after 70 links spend their presence bursts', async () => {
  const { engine, end } = setup();
  await engine.start();
  for (let link = 0; link < 70; link++) for (let seq = 1; seq <= 30; seq++) end.inject(presence('M', seq), `nostr:sybil${link}`);
  const note = noteBy('V', 1);
  end.inject({ v: 2, k: 'note', from: note.author.id, note }, 'nostr:honest');
  await settle();
  expect(engine.state.notes.has(note.id)).toBe(true);
  engine.stop();
});

it('C11 lets a new peer enter a roster occupied by eight ghosts', async () => {
  const { engine, end } = setup();
  await engine.start();
  for (const c of 'BCDEFGHI') end.inject(presence(c), `nostr:${c}`);
  end.inject(presence('V'), 'nostr:v');
  expect(engine.state.peers.has(peer('V').id)).toBe(true);
  expect(engine.state.peers.size).toBe(8);
  engine.stop();
});

it('C12 allows a newer link after two quiet heartbeats and ignores signed replay keepalives', async () => {
  const { engine, end } = setup();
  await engine.start();
  end.inject(presence('V', 99), 'nostr:old');
  vi.advanceTimersByTime(4000);
  const note = noteBy('V', 1);
  end.inject({ v: 2, k: 'note', from: note.author.id, note }, 'nostr:relay');
  await settle();
  expect(engine.state.peers.get(peer('V').id)?.seenAt).toBeLessThan(Date.now());
  end.inject({ ...presence('V'), from: { ...peer('V'), name: 'New link' } }, 'nostr:new');
  expect(engine.state.peers.get(peer('V').id)?.peer.name).toBe('New link');
  expect(engine.state.peers.get(peer('V').id)?.seq).toBe(1);
  engine.stop();
});

it('F3a isolates subscriber failures from later subscribers and cache writes', async () => {
  const write = vi.fn();
  const { engine } = setup({ getItem: () => null, setItem: write } as unknown as Storage);
  await engine.start();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  engine.subscribe(() => { throw new Error('subscriber failed'); });
  const next = vi.fn();
  engine.subscribe(next);
  await expect(engine.addNote({ pos: [1, 2, 3], nrm: [0, 0, 1], mesh: 'bone', text: 'survives' })).resolves.toMatchObject({ ok: true });
  vi.advanceTimersByTime(600);
  expect(next).toHaveBeenCalled();
  expect(write).toHaveBeenCalled();
  engine.stop();
});

it('C12 authenticated presence displaces a continuously refreshed spoof and rejects later spoofing', async () => {
  const { signPresence } = await import('./identity');
  const { engine, end } = setup();
  await engine.start();
  end.inject({ ...presence('V'), from: { ...peer('V'), name: 'Fake V' } }, 'nostr:m');
  for (let i = 0; i < 20; i++) {
    vi.advanceTimersByTime(1000);
    end.inject({ ...presence('V', 2 + i), from: { ...peer('V'), name: 'Fake V' } }, 'nostr:m');
    const real = await signPresence({ v: 2, k: 'presence', from: { ...peer('V'), name: 'Real V' }, seq: 100 + i, ptr: null, away: false, digest: { n: 0, h: 0 } }, identity('V'), 'ABCDEFGHIJ');
    end.inject(real, 'nostr:v');
    await settle();
  }
  expect(engine.state.peers.get(peer('V').id)?.peer.name).toBe('Real V');
  end.inject({ ...presence('V', 9999), from: { ...peer('V'), name: 'Fake V' } }, 'nostr:m');
  expect(engine.state.peers.get(peer('V').id)?.peer.name).toBe('Real V');
  engine.stop();
});

it('authenticates the first presence on a shared tab link despite an unsigned high sequence', async () => {
  const { signPresence } = await import('./identity');
  const { engine, end } = setup();
  await engine.start();
  end.inject(presence('V', 9999), 'tab');
  const signed = await signPresence({ v: 2, k: 'presence', from: peer('V'), seq: 1, ptr: [1, 2, 3], away: false, digest: { n: 0, h: 0 } }, identity('V'), 'ABCDEFGHIJ');
  end.inject(signed, 'tab');
  await settle();
  expect(engine.state.peers.get(peer('V').id)?.seq).toBe(1);
  const seen = engine.state.peers.get(peer('V').id)?.seenAt;
  vi.advanceTimersByTime(1000);
  end.inject(signed, 'tab');
  await settle();
  expect(engine.state.peers.get(peer('V').id)?.seenAt).toBe(seen);
  engine.stop();
});


it.each([21, 35])('E5/E6 syncs %i records from one honest link, including deletions', async (total) => {
  const { engine, end } = setup();
  await engine.start();
  const notes = Array.from({ length: total }, (_, i) => noteBy('B', i + 1, { deleted: i < total - 20 }));
  for (let i = 0; i < 4; i++) {
    end.inject(snapshot(notes), 'nostr:honest');
    await settle();
    vi.advanceTimersByTime(2100);
  }
  expect(engine.state.notes.size).toBe(total);
  expect([...engine.state.notes.values()].filter((n) => !n.deleted)).toHaveLength(20);
  engine.stop();
});


it.each([21, 35])('E5/E6 late joiner converges on %i records through one relay peer', async (total) => {
  const hub = new FakeHub();
  const a = createEngine({ token: 'ABCDEFGHIJKLMNOPQRST', identity: identity('A'), transport: hub.end('A'), now: Date.now });
  const b = createEngine({ token: 'ABCDEFGHIJKLMNOPQRST', identity: identity('B'), transport: hub.end('B'), now: Date.now });
  await a.start();
  for (let i = 0; i < total; i++) {
    const added = await a.addNote({ pos: [1, 2, 3], nrm: [0, 0, 1], mesh: 'bone', text: `note ${i}` });
    if (!added.ok) throw new Error('add failed');
    if (i < total - 20) await a.deleteNote(added.id);
    await run(1100);
  }
  await b.start();
  await run(10000);
  expect(b.state.notes).toEqual(a.state.notes);
  expect(b.state.notes.size).toBe(total);
  a.stop();
  b.stop();
});

it('does not reuse note ids after a reload without a cache, even at the same time', async () => {
  const first = setup();
  await first.engine.start();
  const input = { pos: [1, 2, 3] as const, nrm: [0, 0, 1] as const, mesh: 'bone' as const, text: 'old' };
  const old = await first.engine.addNote(input);
  if (!old.ok) throw new Error('add failed');
  await first.engine.deleteNote(old.id);
  const held = [...first.engine.state.notes.values()];
  first.engine.stop();
  const reloaded = setup();
  await reloaded.engine.start();
  reloaded.end.inject(snapshot(held), 'nostr:peer');
  await settle();
  const added = await reloaded.engine.addNote({ ...input, text: 'new' });
  if (!added.ok) throw new Error('add failed');
  expect(added.id).not.toBe(old.id);
  expect(reloaded.engine.state.notes.get(added.id)?.text).toBe('new');
  reloaded.engine.stop();
});

it('G5 rejects captured signed presence more than 30 seconds after bye', async () => {
  const { signPresence } = await import('./identity');
  const { engine, end } = setup();
  await engine.start();
  const captured = await signPresence({ ...presence('V', 3000), v: 2, k: 'presence' }, identity('V'), 'ABCDEFGHIJ');
  end.inject(captured, 'nostr:v');
  await settle();
  end.inject({ v: 2, k: 'bye', from: peer('V').id }, 'nostr:v');
  vi.advanceTimersByTime(31000);
  end.inject(captured, 'nostr:replay');
  await settle();
  expect(engine.state.peers.has(peer('V').id)).toBe(false);
  engine.stop();
});

it('G6 lets a newer signed presence after reload supersede captured high sequences', async () => {
  const { signPresence } = await import('./identity');
  const { engine, end } = setup();
  await engine.start();
  const captured = await signPresence({ ...presence('V', 3000), v: 2, k: 'presence', ptr: [1, 1, 1] }, identity('V'), 'ABCDEFGHIJ');
  end.inject(captured, 'nostr:old');
  await settle();
  vi.advanceTimersByTime(1000);
  const fresh = await signPresence({ ...presence('V', 1), v: 2, k: 'presence', ptr: [50, 50, 50] }, identity('V'), 'ABCDEFGHIJ');
  end.inject(fresh, 'nostr:reloaded');
  await settle();
  expect(engine.state.peers.get(peer('V').id)?.ptr).toEqual([50, 50, 50]);
  vi.advanceTimersByTime(5000);
  end.inject(captured, 'nostr:attacker');
  await settle();
  expect(engine.state.peers.get(peer('V').id)?.ptr).toEqual([50, 50, 50]);
  engine.stop();
});

it('rejects future, missing and tampered presence send times', async () => {
  const { signPresence } = await import('./identity');
  const { engine, end } = setup();
  await engine.start();
  const message = { ...presence('V'), v: 2 as const, k: 'presence' as const, sentAt: Date.now() + 120001 };
  end.inject(await signPresence(message, identity('V'), 'ABCDEFGHIJ'), 'nostr:v');
  await settle();
  expect(engine.state.peers.size).toBe(0);
  const signed = await signPresence({ ...message, sentAt: Date.now() }, identity('V'), 'ABCDEFGHIJ');
  const { sentAt: _time, ...untimed } = signed;
  end.inject(untimed, 'nostr:v');
  end.inject({ ...signed, sentAt: Date.now() + 1 }, 'nostr:v');
  await settle();
  expect(engine.state.peers.size).toBe(0);
  end.inject(signed, 'nostr:v');
  await settle();
  expect(engine.state.peers.size).toBe(1);
  engine.stop();
});
