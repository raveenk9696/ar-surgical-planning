import { decode } from "./wire";

import { identity, peer, noteBy, run, settle } from '../test/signed';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeHub, type FakeEnd } from '../test/fakehub';
import type { Note, RoomState, Vec3, Wire } from '../types';
import { createEngine, expirePeers, initialState, mergeNotes, reduce, type Engine } from './engine';
import { digestOf } from './notes';

const TOKEN = 'ABCDEFGHIJKLMNOPQRST';
const HERE: Vec3 = [1, 2, 3];
const NRM: Vec3 = [0, 0, 1];

function mk(hub: FakeHub, name: string, extra: Partial<Parameters<typeof createEngine>[0]> = {}): { engine: Engine; end: FakeEnd } {
  const end = hub.end(name);
  const engine = createEngine({ token: TOKEN, identity: identity(name), transport: end, now: () => Date.now(), ...extra });
  return { engine, end };
}

const add = (e: Engine, text = 'hip'): ReturnType<Engine['addNote']> => e.addNote({ pos: HERE, nrm: NRM, mesh: 'bone', text });
const texts = (e: Engine): string[] => [...e.state.notes.values()].filter((n) => !n.deleted).map((n) => n.text).sort();

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

describe('engine on a fake network', () => {
  it('delivers a new note to the other peer', async () => {
    const hub = new FakeHub();
    const a = mk(hub, 'A');
    const b = mk(hub, 'B');
    await a.engine.start();
    await b.engine.start();
    await run(10);
    await settle();
    expect((await add(a.engine))).toEqual({ ok: true, id: expect.stringMatching(new RegExp(`^${peer('A').id}\\.`)) });
    await run(10);
    await settle();
    expect(texts(b.engine)).toEqual(['hip']);
    await settle();
    expect(b.engine.state.peers.has(`${peer('A').id}`)).toBe(true);
  });

  it('brings a late joiner up to date', async () => {
    const hub = new FakeHub();
    const a = mk(hub, 'A');
    await a.engine.start();
    for (const t of ['one', 'two', 'three']) (await add(a.engine, t));
    await run(10);
    const b = mk(hub, 'B');
    await b.engine.start();
    await run(50);
    await settle();
    expect(texts(b.engine)).toEqual(['one', 'three', 'two']);
  });

  it('propagates a delete and keeps it deleted', async () => {
    const hub = new FakeHub();
    const a = mk(hub, 'A');
    const b = mk(hub, 'B');
    await a.engine.start();
    await b.engine.start();
    const r = (await add(a.engine));
    await run(10);
    if (!r.ok) throw new Error('add failed');
    await a.engine.deleteNote(r.id);
    await run(10);
    await settle();
    expect(texts(b.engine)).toEqual([]);
    await settle();
    expect(b.engine.state.notes.get(r.id)?.deleted).toBe(true);
    await run(10_000);
    await settle();
    expect(texts(a.engine)).toEqual([]);
    await settle();
    expect(texts(b.engine)).toEqual([]);
  });

  it('does not notify twice when two transports deliver the same note', async () => {
    const hub = new FakeHub();
    hub.duplicate = true;
    const a = mk(hub, 'A');
    const b = mk(hub, 'B');
    await a.engine.start();
    await b.engine.start();
    const seen: string[][] = [];
    b.engine.subscribe((_s, c) => c.notes.length && seen.push(c.notes));
    (await add(a.engine));
    await run(20);
    await settle();
    expect(seen).toEqual([[...a.engine.state.notes.keys()]]);
  });

  it('repairs a partition by digest once it heals', async () => {
    const hub = new FakeHub();
    const a = mk(hub, 'A');
    const b = mk(hub, 'B');
    await a.engine.start();
    await b.engine.start();
    await run(10);
    hub.cut('A', 'B');
    (await add(a.engine, 'from a'));
    (await add(b.engine, 'from b'));
    await run(5000);
    await settle();
    expect(texts(a.engine)).toEqual(['from a']);
    hub.heal();
    await run(10_000);
    await settle();
    expect(texts(a.engine)).toEqual(['from a', 'from b']);
    await settle();
    expect(texts(b.engine)).toEqual(['from a', 'from b']);
  });

  it('converges A-B-C with A and C cut, through B', async () => {
    const hub = new FakeHub();
    const [a, b, c] = ['A', 'B', 'C'].map((n) => mk(hub, n)) as [ReturnType<typeof mk>, ReturnType<typeof mk>, ReturnType<typeof mk>];
    hub.cut('A', 'C');
    for (const x of [a, b, c]) await x.engine.start();
    await run(10);
    (await add(a.engine, 'a'));
    (await add(c.engine, 'c'));
    await run(15_000);
    for (const x of [a, b, c]) expect(texts(x.engine)).toEqual(['a', 'c']);
  });

  it('survives lossy, reordered delivery', async () => {
    const hub = new FakeHub();
    hub.dropEvery = 3;
    hub.delayMs = (from, to) => ((from.charCodeAt(0) * 7 + to.charCodeAt(0)) % 40) + 1;
    const a = mk(hub, 'A');
    const b = mk(hub, 'B');
    await a.engine.start();
    await b.engine.start();
    for (let i = 0; i < 5; i++) {
      (await add(a.engine, `a${i}`));
      (await add(b.engine, `b${i}`));
      await run(1000);
    }
    await run(30_000);
    await settle();
    expect(texts(a.engine)).toEqual(texts(b.engine));
    await settle();
    expect(texts(a.engine)).toHaveLength(10);
  });

  it('works with a transport that reaches nobody', async () => {
    const hub = new FakeHub();
    const solo = mk(hub, 'A');
    await solo.engine.start();
    await settle();
    expect((await add(solo.engine)).ok).toBe(true);
    await run(5000);
    await settle();
    expect(texts(solo.engine)).toEqual(['hip']);
  });

  it('answers an unknown peer with one hello only', async () => {
    const hub = new FakeHub();
    const a = mk(hub, 'A');
    await a.engine.start();
    const before = a.end.sent.filter((w) => w.k === 'hello').length;
    const presence: Wire = { v: 2, k: 'presence', from: peer('B'), seq: 1, ptr: null, away: false, digest: digestOf([]) };
    a.end.inject(presence);
    a.end.inject({ ...presence, seq: 2 });
    await settle();
    expect(a.end.sent.filter((w) => w.k === 'hello')).toHaveLength(before + 1);
  });

  it('sends at most one snapshot per 2 seconds', async () => {
    const hub = new FakeHub();
    const a = mk(hub, 'A');
    await a.engine.start();
    (await add(a.engine));
    const hello = (c: string): Wire => ({ v: 2, k: 'hello', from: peer(c), digest: { n: 0, h: 0 } });
    a.end.inject(hello('B'));
    a.end.inject(hello('C'));
    a.end.inject(hello('D'));
    await settle();
    expect(a.end.sent.filter((w) => w.k === 'snapshot')).toHaveLength(1);
    await run(2100);
    a.end.inject(hello('E'));
    await settle();
    expect(a.end.sent.filter((w) => w.k === 'snapshot')).toHaveLength(2);
  });

  it('asks for a snapshot after two mismatching presences, not one', async () => {
    const hub = new FakeHub();
    const a = mk(hub, 'A');
    await a.engine.start();
    (await add(a.engine));
    const presence = (seq: number): Wire => ({ v: 2, k: 'presence', from: peer('B'), seq, ptr: null, away: false, digest: { n: 0, h: 0 } });
    a.end.inject(presence(1));
    await settle();
    expect(a.end.sent.filter((w) => w.k === 'snapshot')).toHaveLength(0);
    a.end.inject(presence(2));
    await settle();
    expect(a.end.sent.filter((w) => w.k === 'snapshot')).toHaveLength(1);
  });

  it('ignores its own echo and messages from a newer version', async () => {
    const hub = new FakeHub();
    const onNewer = vi.fn();
    const a = mk(hub, 'A', { onNewerVersion: onNewer });
    await a.engine.start();
    const before = a.engine.state;
    a.end.inject({ v: 2, k: 'note', from: `${peer('A').id}`, note: noteBy('A', 9) });
    a.end.inject({ v: 2, k: 'hello', from: peer('A'), digest: { n: 0, h: 0 } });
    await settle();
    expect(a.engine.state).toBe(before);
    a.end.inject({ v: 2, k: 'note', from: `${peer('B').id}` });
    a.end.inject({ v: 3, k: 'hello' });
    await settle();
    expect(a.engine.state).toBe(before);
    await settle();
    expect(onNewer).toHaveBeenCalledTimes(1);
  });

  it('limits a flooding sender and the whole inbound stream', async () => {
    const hub = new FakeHub();
    const a = mk(hub, 'A');
    await a.engine.start();
    for (let i = 1; i <= 20; i++) a.end.inject({ v: 2, k: 'note', from: `${peer('B').id}`, note: noteBy('B', i) });
    await settle();
    expect(a.engine.state.notes.size).toBe(5);
    await run(3000);
    for (let i = 1; i <= 300; i++) a.end.inject({ v: 2, k: 'bye', from: `${peer('C').id}` });
    a.end.inject({ v: 2, k: 'note', from: `${peer('B').id}`, note: noteBy('B', 99) });
    await settle();
    expect(a.engine.state.notes.has(`${peer('B').id}.99`)).toBe(true);
  });

  it('enforces the per-author, live and record caps locally', async () => {
    const hub = new FakeHub();
    const a = mk(hub, 'A');
    await a.engine.start();
    for (let i = 0; i < 20; i++) {
      await settle();
      expect((await add(a.engine, `n${i}`)).ok).toBe(true);
      await run(1000);
    }
    await settle();
    expect((await add(a.engine))).toEqual({ ok: false, why: 'full' });
    await settle();
    expect(texts(a.engine)).toHaveLength(20);
  });

  it('rate limits local adds to a burst of 5, then 1 per second', async () => {
    const hub = new FakeHub();
    const a = mk(hub, 'A');
    await a.engine.start();
    const results = await Promise.all(Array.from({ length: 7 }, () => add(a.engine)));
    await settle();
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    await settle();
    expect(results[5]).toEqual({ ok: false, why: 'rate' });
    await run(1000);
    await settle();
    expect((await add(a.engine)).ok).toBe(true);
  });

  it('rejects empty and whitespace text, and trims long text', async () => {
    const hub = new FakeHub();
    const a = mk(hub, 'A');
    await settle();
    expect((await add(a.engine, '   '))).toEqual({ ok: false, why: 'empty' });
    (await add(a.engine, '  left   hip  '));
    (await add(a.engine, 'x'.repeat(40)));
    await settle();
    expect(texts(a.engine)).toEqual(['left hip', 'x'.repeat(24)]);
  });

  it('restores cached notes at start and saves changes after a short delay', async () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) } as Storage;
    const hub = new FakeHub();
    const first = mk(hub, 'A', { storage });
    await first.engine.start();
    (await add(first.engine, 'kept'));
    await settle();
    expect(data.size).toBe(0);
    await run(600);
    await settle();
    expect([...data.keys()]).toEqual(['asp:v2:ABCDEFGHIJ']);
    first.engine.stop();

    const second = mk(new FakeHub(), 'B', { storage });
    await second.engine.start();
    await settle();
    expect(texts(second.engine)).toEqual(['kept']);
  });

  it('keeps presence away flags and drops pointers from hidden tabs', async () => {
    const hub = new FakeHub();
    const a = mk(hub, 'A');
    await a.engine.start();
    a.engine.setPointer([5, 5, 5]);
    await run(100);
    await settle();
    expect(a.end.sent.filter((w) => w.k === 'presence').at(-1)).toMatchObject({ ptr: [5, 5, 5], away: false });
    a.engine.setAway(true);
    a.engine.setPointer([6, 6, 6]);
    await run(2500);
    const last = a.end.sent.filter((w) => w.k === 'presence').at(-1);
    await settle();
    expect(last).toMatchObject({ ptr: null, away: true });
    a.engine.setAway(false);
    await settle();
    expect(a.end.sent.filter((w) => w.k === 'hello').at(-1)).toBeDefined();
  });

  it('sends hello at 1, 3 and 7 seconds and bye on stop', async () => {
    const hub = new FakeHub();
    const a = mk(hub, 'A');
    await a.engine.start();
    const hellos = (): number => a.end.sent.filter((w) => w.k === 'hello').length;
    await settle();
    expect(hellos()).toBe(1);
    await run(1100);
    await settle();
    expect(hellos()).toBe(2);
    await run(2000);
    await settle();
    expect(hellos()).toBe(3);
    await run(4000);
    await settle();
    expect(hellos()).toBe(4);
    await run(20_000);
    await settle();
    expect(hellos()).toBe(4);
    a.engine.stop();
    await settle();
    expect(a.end.sent.at(-1)).toEqual({ v: 2, k: 'bye', from: `${peer('A').id}` });
  });

  it('removes a peer on bye and after 8 seconds of silence', async () => {
    const hub = new FakeHub();
    const a = mk(hub, 'A');
    await a.engine.start();
    const hello = (c: string): Wire => ({ v: 2, k: 'hello', from: peer(c), digest: digestOf([]) });
    a.end.inject(hello('B'));
    a.end.inject(hello('C'));
    await settle();
    expect(a.engine.state.peers.size).toBe(2);
    a.end.inject({ v: 2, k: 'bye', from: `${peer('B').id}` });
    await settle();
    expect([...a.engine.state.peers.keys()]).toEqual([`${peer('C').id}`]);
    await run(7900);
    await settle();
    expect(a.engine.state.peers.size).toBe(1);
    await run(200);
    await settle();
    expect(a.engine.state.peers.size).toBe(0);
  });

  it('merges link status from the transport', async () => {
    const hub = new FakeHub();
    const a = mk(hub, 'A');
    await a.engine.start();
    a.end.setStatus({ net: 'ok', peers: 2 });
    await settle();
    expect(a.engine.state.link).toEqual({ tabs: 'ok', net: 'ok' });
    await settle();
    expect(a.engine.state.netPeers).toBe(2);
  });
});

describe('reduce', () => {
  const base = (): RoomState => initialState('ROOM', peer('A'));
  const presence = (seq: number, ptr: Vec3 | null): Wire => ({ v: 2, k: 'presence', from: peer('B'), seq, ptr, away: false, digest: digestOf([]) });

  it('ignores a presence with an older sequence number', async () => {
    const s5 = reduce(base(), presence(5, [5, 5, 5]), 0).state;
    const s3 = reduce(s5, presence(3, [3, 3, 3]), 10).state;
    await settle();
    expect(s3.peers.get(`${peer('B').id}`)).toMatchObject({ seq: 5, ptr: [5, 5, 5], seenAt: 10 });
  });

  it('does not add peers beyond the limit of eight', async () => {
    let s = base();
    for (const c of 'BCDEFGHIJK') s = reduce(s, { v: 2, k: 'hello', from: peer(c), digest: digestOf([]) }, 0).state;
    await settle();
    expect(s.peers.size).toBe(8);
  });

  it('expires peers only after the time to live', async () => {
    const s = reduce(base(), presence(1, null), 1000).state;
    await settle();
    expect(expirePeers(s, 9000)).toBe(s);
    await settle();
    expect(expirePeers(s, 9001).peers.size).toBe(0);
  });

  it('returns the same state for a note it already has', async () => {
    const s = reduce(base(), { v: 2, k: 'note', from: `${peer('B').id}`, note: noteBy('B', 1) }, 0).state;
    await settle();
    expect(reduce(s, { v: 2, k: 'note', from: `${peer('B').id}`, note: noteBy('B', 1) }, 5).state).toBe(s);
  });
});

describe('mergeNotes caps', () => {
  it('caps remote live records at 100', async () => {
    const incoming: Note[] = [];
    for (const c of 'BCDEFG') for (let n = 1; n <= 25; n++) incoming.push(noteBy(c, n));
    const notes = mergeNotes(new Map(), incoming);
    await settle();
    expect(notes.size).toBe(100);

  });

  it('stops at 300 records, counting tombstones, but still applies deletes', async () => {
    const tombs = Array.from({ length: 320 }, (_, i) => noteBy('B', i + 1, { created: Date.now() - 1000 + i + 1, deleted: true, text: '' }));
    const full = mergeNotes(new Map(), tombs);
    await settle();
    expect(full.size).toBe(300);
    const incoming = noteBy('C', 1, { created: Date.now() - 10_000 });
    const merged = mergeNotes(full, [incoming]);
    await settle();
    expect(merged.size).toBe(300);
    await settle();
    expect(merged.has(incoming.id)).toBe(true);
    await settle();
    expect(merged.has(`${peer('B').id}.300`)).toBe(false);
  });

  it('applies a delete to a stored note', async () => {
    const first = mergeNotes(new Map(), [noteBy('B', 1)]);
    const gone = mergeNotes(first, [noteBy('B', 1, { deleted: true, text: '' })]);
    await settle();
    expect(gone.get(`${peer('B').id}.1`)?.deleted).toBe(true);
  });
});


describe('transport identity', () => {
  it('accepts a signed note despite an unrelated presence binding', async () => {
    const a = mk(new FakeHub(), 'A');
    await a.engine.start();
    a.end.inject({ v: 2, k: 'hello', from: peer('B'), digest: digestOf([]) }, 'nostr:b');
    a.end.inject({ v: 2, k: 'note', from: peer('C').id, note: noteBy('C', 1) }, 'nostr:b');
    await settle();
    expect(a.engine.state.notes.size).toBe(1);
  });

  it('drops forged higher-seq presence from another link without changing state', async () => {
    const a = mk(new FakeHub(), 'A');
    await a.engine.start();
    const msg: Wire = { v: 2, k: 'presence', from: peer('B'), seq: 1, ptr: null, away: false, digest: digestOf([]) };
    a.end.inject(msg, 'nostr:b');
    const before = a.engine.state;
    a.end.inject({ ...msg, seq: 999, from: { ...peer('B'), name: 'Impersonator' }, away: true }, 'nostr:attacker');
    await settle();
    expect(a.engine.state).toBe(before);
  });

  it.each(['bye', 'expiry'])('releases an identity on %s', async (reason) => {
    const a = mk(new FakeHub(), 'A');
    await a.engine.start();
    const hello: Wire = { v: 2, k: 'hello', from: peer('B'), digest: digestOf([]) };
    a.end.inject(hello, 'nostr:b');
    if (reason === 'bye') a.end.inject({ v: 2, k: 'bye', from: peer('B').id }, 'nostr:b');
    else await run(8200);
    a.end.inject(hello, 'nostr:new');
    await settle();
    expect(a.engine.state.peers.has(peer('B').id)).toBe(true);
    a.end.inject({ ...hello, from: peer('C') }, 'nostr:b');
    await settle();
    expect(a.engine.state.peers.has(peer('C').id)).toBe(true);
  });

  it('allows distinct trusted tabs to bind their own identities', async () => {
    const a = mk(new FakeHub(), 'A');
    await a.engine.start();
    for (const c of ['B', 'C']) a.end.inject({ v: 2, k: 'hello', from: peer(c), digest: digestOf([]) }, 'tab');
    await settle();
    expect(a.engine.state.peers.size).toBe(2);
  });
});


describe('note authorship', () => {
  it('rejects live notes and deletes attributed to another sender but accepts snapshot relays', async () => {
    const a = mk(new FakeHub(), 'A');
    await a.engine.start();
    const n = noteBy('C', 1);
    a.end.inject({ v: 2, k: 'note', from: peer('B').id, note: n });
    await settle();
    expect(a.engine.state.notes.size).toBe(0);
    a.end.inject({ v: 2, k: 'snapshot', from: peer('B').id, notes: [n] });
    await settle();
    expect(a.engine.state.notes.get(n.id)).toEqual(n);
    a.end.inject({ v: 2, k: 'note', from: peer('B').id, note: { ...n, deleted: true, text: '' } });
    await settle();
    expect(a.engine.state.notes.get(n.id)?.deleted).toBe(false);
  });

  it('does not emit local deletes for another author', async () => {
    const a = mk(new FakeHub(), 'A');
    await a.engine.start();
    const n = noteBy('B', 1);
    a.end.inject({ v: 2, k: 'note', from: peer('B').id, note: n });
    await a.engine.deleteNote(n.id);
    await settle();
    expect(a.engine.state.notes.get(n.id)?.deleted).toBe(false);
    await settle();
    expect(a.end.sent.filter((w) => w.k === 'note')).toHaveLength(0);
  });
});

describe('link limits', () => {
  it('cannot reset the five-note burst by rotating ids after bye', async () => {
    const a = mk(new FakeHub(), 'A');
    await a.engine.start();
    for (const c of 'BCDEFGHIJK') {
      a.end.inject({ v: 2, k: 'note', from: peer(c).id, note: noteBy(c, 1) }, 'nostr:one');
      a.end.inject({ v: 2, k: 'bye', from: peer(c).id }, 'nostr:one');
    }
    await settle();
    expect(a.engine.state.notes.size).toBe(5);
  });

  it('keeps the verified author live-note quota across link changes and expiry', async () => {
    const a = mk(new FakeHub(), 'A');
    await a.engine.start();
    for (let i = 1; i <= 21; i++) {
      a.end.inject({ v: 2, k: 'note', from: peer('B').id, note: noteBy('B', i) }, `nostr:link${i}`);
      await run(8200);
    }
    await settle();
    expect(a.engine.state.notes.size).toBe(20);
  });

  it('cannot reset the snapshot gap by rotating ids after bye', async () => {
    const a = mk(new FakeHub(), 'A');
    await a.engine.start();
    for (const c of 'BC') {
      a.end.inject({ v: 2, k: 'snapshot', from: peer(c).id, notes: [noteBy(c, 1)] }, 'nostr:one');
      a.end.inject({ v: 2, k: 'bye', from: peer(c).id }, 'nostr:one');
    }
    await settle();
    expect(a.engine.state.notes.size).toBe(1);
  });
});

it('normalizes local fullwidth input before creating and sending a note', async () => {
  const a = mk(new FakeHub(), 'A');
  await a.engine.start();
  await settle();
  expect((await add(a.engine, 'ｌｅｆｔ　ｈｉｐ')).ok).toBe(true);
  await settle();
  expect(texts(a.engine)).toEqual(['left hip']);
  await settle();
  expect(a.end.sent.at(-1)).toMatchObject({ k: 'note', note: { text: 'left hip' } });
});

it.each(['\u200B', '\u202E', '\u2066', '\u2028', '\u2029', '\u0000'])('rejects local control text %j', async (ch) => {
  const a = mk(new FakeHub(), 'A');
  await settle();
  expect((await add(a.engine, `a${ch}b`)).ok).toBe(false);
  await settle();
  expect(a.engine.state.notes.size).toBe(0);
});


it('converges three replicas after concurrent adds at 99 notes with loss, duplicates and reorder', async () => {
  const seed: Note[] = [];
  for (const c of 'DEFGH') for (let i = 1; i <= 20; i++) seed.push(noteBy(c, i, { created: Date.now() - 1000 }));
  seed.pop();
  const storage: Storage = { getItem: () => JSON.stringify({ savedAt: Date.now(), notes: seed }), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn(), key: () => null, length: 1 };
  const hub = new FakeHub();
  const replicas = ['A', 'B', 'C'].map((c) => mk(hub, c, { storage }));
  hub.cut('A', 'B'); hub.cut('A', 'C'); hub.cut('B', 'C');
  for (const { engine } of replicas) {
    await engine.start();
    await settle();
    expect(engine.state.notes.size).toBe(99);
    await settle();
    expect((await add(engine)).ok).toBe(true);
    await settle();
    expect((await add(engine)).ok).toBe(true);
  }
  hub.duplicate = true;
  hub.dropEvery = 3;
  let delivery = 0;
  hub.delayMs = () => (++delivery % 2 ? 90 : 1);
  hub.heal();
  await run(30_000);
  hub.dropEvery = 0;
  await run(12_000);
  for (const { engine } of replicas) {
    await settle();
    expect(engine.state.notes.size).toBe(100);
    await settle();
    expect(digestOf(engine.state.notes.values())).toEqual(digestOf(replicas[0]!.engine.state.notes.values()));
    engine.stop();
  }
});

it('keeps the same 300 records regardless of union order and notifies about evicted pins', async () => {
  const notes = Array.from({ length: 301 }, (_, i) => noteBy('B', i + 1, { created: Date.now() - 1, deleted: true, text: '' }));
  await settle();
  expect(mergeNotes(new Map(), notes)).toEqual(mergeNotes(new Map(), [...notes].reverse()));
  const storage = { getItem: () => JSON.stringify({ savedAt: Date.now(), notes: notes.slice(0, 300) }), setItem: vi.fn() } as unknown as Storage;
  const a = mk(new FakeHub(), 'A', { storage });
  await a.engine.start();
  expect(a.engine.state.notes.size).toBe(300);
  const changes: string[] = [];
  a.engine.subscribe((_s, c) => changes.push(...c.notes));
  const before = new Set(a.engine.state.notes.keys());
  a.end.inject({ v: 2, k: 'note', from: peer('C').id, note: noteBy('C', 1, { created: Date.now() - 10_000 }) });
  await settle();
  expect(a.engine.state.notes.has(`${peer('C').id}.1`)).toBe(true);
  const evicted = [...before].find((id) => !a.engine.state.notes.has(id));
  await settle();
  expect(evicted).toBeDefined();
  await settle();
  expect(changes).toContain(evicted);
});

it('drops the verifier snapshot forgery and next-id squatting', async () => {
  const a = mk(new FakeHub(), 'A');
  await a.engine.start();
  a.end.inject({ v: 2, k: 'snapshot', from: peer('M').id, notes: [{ ...noteBy('A', 1), text: 'AMPUTATE LEFT LEG' }] }, 'nostr:m');
  await settle();
  expect(a.engine.state.notes.size).toBe(0);
  await settle();
  expect((await add(a.engine, 'real')).ok).toBe(true);
  await settle();
  expect(texts(a.engine)).toEqual(['real']);
});

it('lets a new presence link recover an id after five seconds of silence', async () => {
  const a = mk(new FakeHub(), 'A');
  await a.engine.start();
  const presence: Wire = { v: 2, k: 'presence', from: peer('V'), seq: 999, ptr: null, away: false, digest: digestOf([]) };
  a.end.inject(presence, 'nostr:squatter');
  await run(5000);
  a.end.inject({ ...presence, seq: 1, ptr: [1, 2, 3] }, 'nostr:v');
  expect(a.engine.state.peers.get(peer('V').id)?.ptr).toEqual([1, 2, 3]);
});

it('counts 300 relayed deletions against the introducing link and preserves honest notes', async () => {
  const a = mk(new FakeHub(), 'A');
  await a.engine.start();
  await add(a.engine, 'honest');
  const tombs = Array.from({ length: 300 }, (_, i) => noteBy('M', i + 1, { deleted: true, created: Date.now() - 1000 }));
  a.end.inject({ v: 2, k: 'snapshot', from: peer('B').id, notes: tombs }, 'nostr:m');
  await expect.poll(() => a.engine.state.notes.size > 1).toBe(true);
  expect(a.engine.state.notes.size).toBeLessThanOrEqual(21);
  expect(texts(a.engine)).toEqual(['honest']);
  expect((await add(a.engine, 'after')).ok).toBe(true);
});
it('lets a third tab see all 24 honest notes', async () => {
  const a = mk(new FakeHub(), 'C');
  await a.engine.start();
  for (const c of ['A', 'B']) {
    a.end.inject({ v: 2, k: 'snapshot', from: peer(c).id, notes: Array.from({ length: 12 }, (_, i) => noteBy(c, i + 1)) }, 'tab');
    await run(2100);
  }
  expect(a.engine.state.notes.size).toBe(24);
});
it('evicts deletions before live notes in every arrival order', () => {
  const tombs = Array.from({ length: 300 }, (_, i) => noteBy('M', i + 1, { deleted: true, created: Date.now() - 1000 }));
  const honest = noteBy('A', 1);
  expect(mergeNotes(new Map(), [...tombs, honest]).has(honest.id)).toBe(true);
  expect(mergeNotes(new Map(), [...tombs, honest])).toEqual(mergeNotes(new Map(), [honest, ...tombs.reverse()]));
});

it('delivers honest notes and presence during a 300-message-per-second link flood', async () => {
  const a = mk(new FakeHub(), 'A');
  await a.engine.start();
  for (let t = 0; t < 1000; t++) {
    for (let i = 0; i < 3; i++) a.end.inject({ v: 2, k: 'bye', from: peer('M').id }, 'nostr:m');
    if (t % 7 === 0) a.end.inject({ v: 2, k: 'presence', from: peer('V'), seq: t + 1, ptr: [1, 2, 3], away: false, digest: digestOf([]) }, 'nostr:v');
    if (t % 100 === 99) a.end.inject({ v: 2, k: 'note', from: peer('V').id, note: noteBy('V', t + 1) }, 'nostr:v');
    vi.advanceTimersByTime(10);
  }
  await settle();
  expect(a.engine.state.notes.size).toBe(10);
  expect(a.engine.state.peers.get(peer('V').id)?.seq).toBe(995);
});

it('cuts local text at 24 code points without splitting an emoji', async () => {
  const a = mk(new FakeHub(), 'A');
  await a.engine.start();
  expect((await add(a.engine, 'a'.repeat(23) + '😀extra')).ok).toBe(true);
  expect(texts(a.engine)).toEqual(['a'.repeat(23) + '😀']);
  const wire = a.end.sent.at(-1);
  expect(wire && decode(wire)).not.toBeNull();
});
