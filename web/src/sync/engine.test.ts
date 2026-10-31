import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeHub, type FakeEnd } from '../test/fakehub';
import type { Note, Peer, RoomState, Vec3, Wire } from '../types';
import { createEngine, expirePeers, initialState, mergeNotes, reduce, type Engine } from './engine';
import { digestOf } from './notes';

const TOKEN = 'ABCDEFGHIJKLMNOPQRST';
const peer = (c: string): Peer => ({ id: c.repeat(8), name: `Guest ${c}` });
const run = (ms: number): void => void vi.advanceTimersByTime(ms);
const HERE: Vec3 = [1, 2, 3];
const NRM: Vec3 = [0, 0, 1];

function mk(hub: FakeHub, name: string, extra: Partial<Parameters<typeof createEngine>[0]> = {}): { engine: Engine; end: FakeEnd } {
  const end = hub.end(name);
  const engine = createEngine({ token: TOKEN, self: peer(name), transport: end, now: () => Date.now(), ...extra });
  return { engine, end };
}

const add = (e: Engine, text = 'hip'): ReturnType<Engine['addNote']> => e.addNote({ pos: HERE, nrm: NRM, mesh: 'bone', text });
const noteBy = (c: string, n: number, over: Partial<Note> = {}): Note => ({ id: `${c.repeat(8)}.${n}`, pos: HERE, nrm: NRM, mesh: 'bone', text: 'x', author: peer(c), created: n, deleted: false, ...over });
const texts = (e: Engine): string[] => [...e.state.notes.values()].filter((n) => !n.deleted).map((n) => n.text).sort();

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

describe('engine on a fake network', () => {
  it('delivers a new note to the other peer', () => {
    const hub = new FakeHub();
    const a = mk(hub, 'A');
    const b = mk(hub, 'B');
    a.engine.start();
    b.engine.start();
    run(10);
    expect(add(a.engine)).toEqual({ ok: true, id: 'AAAAAAAA.1' });
    run(10);
    expect(texts(b.engine)).toEqual(['hip']);
    expect(b.engine.state.peers.has('AAAAAAAA')).toBe(true);
  });

  it('brings a late joiner up to date', () => {
    const hub = new FakeHub();
    const a = mk(hub, 'A');
    a.engine.start();
    for (const t of ['one', 'two', 'three']) add(a.engine, t);
    run(10);
    const b = mk(hub, 'B');
    b.engine.start();
    run(50);
    expect(texts(b.engine)).toEqual(['one', 'three', 'two']);
  });

  it('propagates a delete and keeps it deleted', () => {
    const hub = new FakeHub();
    const a = mk(hub, 'A');
    const b = mk(hub, 'B');
    a.engine.start();
    b.engine.start();
    const r = add(a.engine);
    run(10);
    if (!r.ok) throw new Error('add failed');
    a.engine.deleteNote(r.id);
    run(10);
    expect(texts(b.engine)).toEqual([]);
    expect(b.engine.state.notes.get(r.id)?.deleted).toBe(true);
    run(10_000);
    expect(texts(a.engine)).toEqual([]);
    expect(texts(b.engine)).toEqual([]);
  });

  it('does not notify twice when two transports deliver the same note', () => {
    const hub = new FakeHub();
    hub.duplicate = true;
    const a = mk(hub, 'A');
    const b = mk(hub, 'B');
    a.engine.start();
    b.engine.start();
    const seen: string[][] = [];
    b.engine.subscribe((_s, c) => c.notes.length && seen.push(c.notes));
    add(a.engine);
    run(20);
    expect(seen).toEqual([['AAAAAAAA.1']]);
  });

  it('repairs a partition by digest once it heals', () => {
    const hub = new FakeHub();
    const a = mk(hub, 'A');
    const b = mk(hub, 'B');
    a.engine.start();
    b.engine.start();
    run(10);
    hub.cut('A', 'B');
    add(a.engine, 'from a');
    add(b.engine, 'from b');
    run(5000);
    expect(texts(a.engine)).toEqual(['from a']);
    hub.heal();
    run(10_000);
    expect(texts(a.engine)).toEqual(['from a', 'from b']);
    expect(texts(b.engine)).toEqual(['from a', 'from b']);
  });

  it('converges A-B-C with A and C cut, through B', () => {
    const hub = new FakeHub();
    const [a, b, c] = ['A', 'B', 'C'].map((n) => mk(hub, n)) as [ReturnType<typeof mk>, ReturnType<typeof mk>, ReturnType<typeof mk>];
    hub.cut('A', 'C');
    for (const x of [a, b, c]) x.engine.start();
    run(10);
    add(a.engine, 'a');
    add(c.engine, 'c');
    run(15_000);
    for (const x of [a, b, c]) expect(texts(x.engine)).toEqual(['a', 'c']);
  });

  it('survives lossy, reordered delivery', () => {
    const hub = new FakeHub();
    hub.dropEvery = 3;
    hub.delayMs = (from, to) => ((from.charCodeAt(0) * 7 + to.charCodeAt(0)) % 40) + 1;
    const a = mk(hub, 'A');
    const b = mk(hub, 'B');
    a.engine.start();
    b.engine.start();
    for (let i = 0; i < 5; i++) {
      add(a.engine, `a${i}`);
      add(b.engine, `b${i}`);
      run(1000);
    }
    run(30_000);
    expect(texts(a.engine)).toEqual(texts(b.engine));
    expect(texts(a.engine)).toHaveLength(10);
  });

  it('works with a transport that reaches nobody', () => {
    const hub = new FakeHub();
    const solo = mk(hub, 'A');
    solo.engine.start();
    expect(add(solo.engine).ok).toBe(true);
    run(5000);
    expect(texts(solo.engine)).toEqual(['hip']);
  });

  it('answers an unknown peer with one hello only', () => {
    const hub = new FakeHub();
    const a = mk(hub, 'A');
    a.engine.start();
    const before = a.end.sent.filter((w) => w.k === 'hello').length;
    const presence: Wire = { v: 1, k: 'presence', from: peer('B'), seq: 1, ptr: null, away: false, digest: digestOf([]) };
    a.end.inject(presence);
    a.end.inject({ ...presence, seq: 2 });
    expect(a.end.sent.filter((w) => w.k === 'hello')).toHaveLength(before + 1);
  });

  it('sends at most one snapshot per 2 seconds', () => {
    const hub = new FakeHub();
    const a = mk(hub, 'A');
    a.engine.start();
    add(a.engine);
    const hello = (c: string): Wire => ({ v: 1, k: 'hello', from: peer(c), digest: { n: 0, h: 0 } });
    a.end.inject(hello('B'));
    a.end.inject(hello('C'));
    a.end.inject(hello('D'));
    expect(a.end.sent.filter((w) => w.k === 'snapshot')).toHaveLength(1);
    run(2100);
    a.end.inject(hello('E'));
    expect(a.end.sent.filter((w) => w.k === 'snapshot')).toHaveLength(2);
  });

  it('asks for a snapshot after two mismatching presences, not one', () => {
    const hub = new FakeHub();
    const a = mk(hub, 'A');
    a.engine.start();
    add(a.engine);
    const presence = (seq: number): Wire => ({ v: 1, k: 'presence', from: peer('B'), seq, ptr: null, away: false, digest: { n: 0, h: 0 } });
    a.end.inject(presence(1));
    expect(a.end.sent.filter((w) => w.k === 'snapshot')).toHaveLength(0);
    a.end.inject(presence(2));
    expect(a.end.sent.filter((w) => w.k === 'snapshot')).toHaveLength(1);
  });

  it('ignores its own echo and messages from a newer version', () => {
    const hub = new FakeHub();
    const onNewer = vi.fn();
    const a = mk(hub, 'A', { onNewerVersion: onNewer });
    a.engine.start();
    const before = a.engine.state;
    a.end.inject({ v: 1, k: 'note', from: 'AAAAAAAA', note: noteBy('A', 9) });
    a.end.inject({ v: 1, k: 'hello', from: peer('A'), digest: { n: 0, h: 0 } });
    expect(a.engine.state).toBe(before);
    a.end.inject({ v: 2, k: 'note', from: 'BBBBBBBB' });
    a.end.inject({ v: 3, k: 'hello' });
    expect(a.engine.state).toBe(before);
    expect(onNewer).toHaveBeenCalledTimes(1);
  });

  it('limits a flooding sender and the whole inbound stream', () => {
    const hub = new FakeHub();
    const a = mk(hub, 'A');
    a.engine.start();
    for (let i = 1; i <= 20; i++) a.end.inject({ v: 1, k: 'note', from: 'BBBBBBBB', note: noteBy('B', i) });
    expect(a.engine.state.notes.size).toBe(5);
    run(3000);
    for (let i = 1; i <= 300; i++) a.end.inject({ v: 1, k: 'bye', from: 'CCCCCCCC' });
    a.end.inject({ v: 1, k: 'note', from: 'BBBBBBBB', note: noteBy('B', 99) });
    expect(a.engine.state.notes.has('BBBBBBBB.99')).toBe(false);
  });

  it('enforces the per-author, live and record caps locally', () => {
    const hub = new FakeHub();
    const a = mk(hub, 'A');
    a.engine.start();
    for (let i = 0; i < 20; i++) {
      expect(add(a.engine, `n${i}`).ok).toBe(true);
      run(1000);
    }
    expect(add(a.engine)).toEqual({ ok: false, why: 'full' });
    expect(texts(a.engine)).toHaveLength(20);
  });

  it('rate limits local adds to a burst of 5, then 1 per second', () => {
    const hub = new FakeHub();
    const a = mk(hub, 'A');
    a.engine.start();
    const results = Array.from({ length: 7 }, () => add(a.engine));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect(results[5]).toEqual({ ok: false, why: 'rate' });
    run(1000);
    expect(add(a.engine).ok).toBe(true);
  });

  it('rejects empty and whitespace text, and trims long text', () => {
    const hub = new FakeHub();
    const a = mk(hub, 'A');
    expect(add(a.engine, '   ')).toEqual({ ok: false, why: 'empty' });
    add(a.engine, '  left   hip  ');
    add(a.engine, 'x'.repeat(40));
    expect(texts(a.engine)).toEqual(['left hip', 'x'.repeat(24)]);
  });

  it('restores cached notes at start and saves changes after a short delay', () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) } as Storage;
    const hub = new FakeHub();
    const first = mk(hub, 'A', { storage });
    first.engine.start();
    add(first.engine, 'kept');
    expect(data.size).toBe(0);
    run(600);
    expect([...data.keys()]).toEqual(['asp:v1:ABCDEFGHIJ']);
    first.engine.stop();

    const second = mk(new FakeHub(), 'B', { storage });
    second.engine.start();
    expect(texts(second.engine)).toEqual(['kept']);
  });

  it('keeps presence away flags and drops pointers from hidden tabs', () => {
    const hub = new FakeHub();
    const a = mk(hub, 'A');
    a.engine.start();
    a.engine.setPointer([5, 5, 5]);
    run(100);
    expect(a.end.sent.filter((w) => w.k === 'presence').at(-1)).toMatchObject({ ptr: [5, 5, 5], away: false });
    a.engine.setAway(true);
    a.engine.setPointer([6, 6, 6]);
    run(2500);
    const last = a.end.sent.filter((w) => w.k === 'presence').at(-1);
    expect(last).toMatchObject({ ptr: null, away: true });
    a.engine.setAway(false);
    expect(a.end.sent.filter((w) => w.k === 'hello').at(-1)).toBeDefined();
  });

  it('sends hello at 1, 3 and 7 seconds and bye on stop', () => {
    const hub = new FakeHub();
    const a = mk(hub, 'A');
    a.engine.start();
    const hellos = (): number => a.end.sent.filter((w) => w.k === 'hello').length;
    expect(hellos()).toBe(1);
    run(1100);
    expect(hellos()).toBe(2);
    run(2000);
    expect(hellos()).toBe(3);
    run(4000);
    expect(hellos()).toBe(4);
    run(20_000);
    expect(hellos()).toBe(4);
    a.engine.stop();
    expect(a.end.sent.at(-1)).toEqual({ v: 1, k: 'bye', from: 'AAAAAAAA' });
  });

  it('removes a peer on bye and after 8 seconds of silence', () => {
    const hub = new FakeHub();
    const a = mk(hub, 'A');
    a.engine.start();
    const hello = (c: string): Wire => ({ v: 1, k: 'hello', from: peer(c), digest: digestOf([]) });
    a.end.inject(hello('B'));
    a.end.inject(hello('C'));
    expect(a.engine.state.peers.size).toBe(2);
    a.end.inject({ v: 1, k: 'bye', from: 'BBBBBBBB' });
    expect([...a.engine.state.peers.keys()]).toEqual(['CCCCCCCC']);
    run(7900);
    expect(a.engine.state.peers.size).toBe(1);
    run(200);
    expect(a.engine.state.peers.size).toBe(0);
  });

  it('merges link status from the transport', () => {
    const hub = new FakeHub();
    const a = mk(hub, 'A');
    a.engine.start();
    a.end.setStatus({ net: 'ok', peers: 2 });
    expect(a.engine.state.link).toEqual({ tabs: 'ok', net: 'ok' });
    expect(a.engine.state.netPeers).toBe(2);
  });
});

describe('reduce', () => {
  const base = (): RoomState => initialState('ROOM', peer('A'));
  const presence = (seq: number, ptr: Vec3 | null): Wire => ({ v: 1, k: 'presence', from: peer('B'), seq, ptr, away: false, digest: digestOf([]) });

  it('ignores a presence with an older sequence number', () => {
    const s5 = reduce(base(), presence(5, [5, 5, 5]), 0).state;
    const s3 = reduce(s5, presence(3, [3, 3, 3]), 10).state;
    expect(s3.peers.get('BBBBBBBB')).toMatchObject({ seq: 5, ptr: [5, 5, 5], seenAt: 10 });
  });

  it('does not add peers beyond the limit of eight', () => {
    let s = base();
    for (const c of 'BCDEFGHIJK') s = reduce(s, { v: 1, k: 'hello', from: peer(c), digest: digestOf([]) }, 0).state;
    expect(s.peers.size).toBe(8);
  });

  it('expires peers only after the time to live', () => {
    const s = reduce(base(), presence(1, null), 1000).state;
    expect(expirePeers(s, 9000)).toBe(s);
    expect(expirePeers(s, 9001).peers.size).toBe(0);
  });

  it('returns the same state for a note it already has', () => {
    const s = reduce(base(), { v: 1, k: 'note', from: 'BBBBBBBB', note: noteBy('B', 1) }, 0).state;
    expect(reduce(s, { v: 1, k: 'note', from: 'BBBBBBBB', note: noteBy('B', 1) }, 5).state).toBe(s);
  });
});

describe('mergeNotes caps', () => {
  it('stops at 100 live notes and 20 per author', () => {
    const incoming: Note[] = [];
    for (const c of 'BCDEFG') for (let n = 1; n <= 25; n++) incoming.push(noteBy(c, n));
    const notes = mergeNotes(new Map(), incoming);
    expect(notes.size).toBe(100);
    for (const c of 'BCDEF') expect([...notes.values()].filter((n) => n.author.id === c.repeat(8))).toHaveLength(20);
  });

  it('stops at 300 records, counting tombstones, but still applies deletes', () => {
    const tombs = Array.from({ length: 320 }, (_, i) => noteBy('B', i + 1, { deleted: true, text: '' }));
    const full = mergeNotes(new Map(), tombs);
    expect(full.size).toBe(300);
    expect(mergeNotes(full, [noteBy('C', 1)])).toBe(full);
  });

  it('applies a delete to a stored note', () => {
    const first = mergeNotes(new Map(), [noteBy('B', 1)]);
    const gone = mergeNotes(first, [noteBy('B', 1, { deleted: true, text: '' })]);
    expect(gone.get('BBBBBBBB.1')?.deleted).toBe(true);
  });
});
