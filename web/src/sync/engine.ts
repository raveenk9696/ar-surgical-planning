import { LIMITS } from '../config';
import type { Link, Transport } from '../net/transport';
import type { AddResult, Digest, Mesh, Note, NoteId, Peer, PeerId, Presence, RoomState, Vec3, Wire } from '../types';
import { signNote, signDeletion, type Identity } from './identity';
import { loadCache, saveCache } from './cache';
import { createLimiter } from './limiter';
import { digestOf, mergeNote } from './notes';
import { split } from './roomId';
import { decode, verifyWire, isNewerVersion, isSafeText } from './wire';

const HELLO_AT_MS = [1000, 3000, 7000];
const CACHE_DEBOUNCE_MS = 500;
const PRESENCE_MISMATCHES_BEFORE_SNAPSHOT = 2;

export interface Changes { notes: NoteId[]; peers: boolean; link: boolean }

export interface Engine {
  readonly state: RoomState;
  subscribe(fn: (s: RoomState, c: Changes) => void): () => void;
  addNote(i: { pos: Vec3; nrm: Vec3; mesh: Mesh; text: string }): Promise<AddResult>;
  deleteNote(id: NoteId): Promise<void>;
  setPointer(p: Vec3 | null): void;
  setAway(a: boolean): void;
  start(): Promise<void>;
  stop(): void;
}

export function initialState(roomId: string, self: Peer): RoomState {
  return { roomId, self, notes: new Map(), peers: new Map(), link: { tabs: 'off', net: 'off' }, netPeers: 0 };
}

const digests = new WeakMap<ReadonlyMap<NoteId, Note>, Digest>();
function digestOfMap(notes: ReadonlyMap<NoteId, Note>): Digest {
  let d = digests.get(notes);
  if (!d) {
    d = digestOf(notes.values());
    digests.set(notes, d);
  }
  return d;
}

const sameDigest = (a: Digest, b: Digest): boolean => a.n === b.n && a.h === b.h;

export function mergeNotes(notes: ReadonlyMap<NoteId, Note>, incoming: readonly Note[]): ReadonlyMap<NoteId, Note> {
  let next: Map<NoteId, Note> | null = null;
  for (const note of incoming) {
    const base = next ?? notes;
    const prev = base.get(note.id);
    const merged = mergeNote(prev, note);
    if (!merged.changed) continue;
    next ??= new Map(notes);
    next.set(note.id, merged.note);
  }
  if (!next) return notes;
  if (next.size > LIMITS.maxRecords || liveCount(next) > LIMITS.maxLive) {
    const ordered = [...next.values()].sort((a, b) => Number(a.deleted) - Number(b.deleted) || a.created - b.created || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    let live = 0;
    next = new Map(ordered.filter((n) => n.deleted || ++live <= LIMITS.maxLive).slice(0, LIMITS.maxRecords).map((n) => [n.id, n]));
  }
  if (next.size === notes.size && [...next].every(([id, n]) => notes.get(id) === n)) return notes;
  return next;
}

export function liveCount(notes: ReadonlyMap<NoteId, Note>, authorId?: PeerId): number {
  let n = 0;
  for (const note of notes.values()) if (!note.deleted && (authorId === undefined || note.author.id === authorId)) n++;
  return n;
}

function touch(peers: ReadonlyMap<PeerId, Presence>, id: PeerId, now: number): ReadonlyMap<PeerId, Presence> {
  const p = peers.get(id);
  if (!p) return peers;
  return new Map(peers).set(id, { ...p, seenAt: now });
}

function hello(s: RoomState): Wire {
  return { v: 2, k: 'hello', from: s.self, digest: digestOfMap(s.notes) };
}

function snapshot(s: RoomState): Wire {
  return { v: 2, k: 'snapshot', from: s.self.id, notes: Array.from(s.notes.values()) };
}

/** Applies one inbound message. Pure: rate limits and echo checks belong to the caller. */
export function reduce(s: RoomState, msg: Wire, now: number): { state: RoomState; out: Wire[] } {
  switch (msg.k) {
    case 'hello':
    case 'presence': {
      const known = s.peers.get(msg.from.id);
      if (!known && s.peers.size >= LIMITS.maxPeers) return { state: s, out: [] };
      const out: Wire[] = [];
      if (!known) out.push(hello(s));
      if (!sameDigest(msg.digest, digestOfMap(s.notes))) out.push(snapshot(s));
      const fresh = msg.k === 'presence' && (!known || msg.seq > known.seq);
      const next: Presence = {
        peer: msg.from,
        seq: fresh ? msg.seq : (known?.seq ?? 0),
        ptr: fresh ? msg.ptr : (known?.ptr ?? null),
        away: fresh ? msg.away : (known?.away ?? false),
        seenAt: now,
      };
      return { state: { ...s, peers: new Map(s.peers).set(msg.from.id, next) }, out };
    }
    case 'note':
    case 'snapshot': {
      const notes = mergeNotes(s.notes, msg.k === 'note' ? [msg.note] : msg.notes);
      const peers = touch(s.peers, msg.from, now);
      return { state: notes === s.notes && peers === s.peers ? s : { ...s, notes, peers }, out: [] };
    }
    case 'bye': {
      if (!s.peers.has(msg.from)) return { state: s, out: [] };
      const peers = new Map(s.peers);
      peers.delete(msg.from);
      return { state: { ...s, peers }, out: [] };
    }
  }
}

export function expirePeers(s: RoomState, now: number): RoomState {
  let peers: Map<PeerId, Presence> | null = null;
  for (const [id, p] of s.peers) {
    if (now - p.seenAt > LIMITS.peerTtlMs) (peers ??= new Map(s.peers)).delete(id);
  }
  return peers ? { ...s, peers } : s;
}

function samePeers(a: ReadonlyMap<PeerId, Presence>, b: ReadonlyMap<PeerId, Presence>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [id, p] of a) {
    const q = b.get(id);
    if (!q || q.seq !== p.seq || q.away !== p.away || q.peer.name !== p.peer.name) return false;
  }
  return true;
}

const senderOf = (w: Wire): PeerId => (w.k === 'hello' || w.k === 'presence' ? w.from.id : w.from);

export function createEngine(o: {
  token: string;
  identity: Identity;
  transport: Transport;
  now: () => number;
  storage?: Storage;
  timers?: Pick<typeof globalThis, 'setInterval' | 'clearInterval'>;
  onNewerVersion?: () => void;
}): Engine {
  const { identity, transport, now } = o;
  const self = identity.peer;
  const { roomId } = split(o.token);
  const timers = o.timers ?? globalThis;
  const tickMs = Math.round(1000 / LIMITS.presenceHz);

  const all = createLimiter({ burst: LIMITS.inboundPerSec, refillMs: 1000 / LIMITS.inboundPerSec }, now);
  const perLink = {
    note: createLimiter(LIMITS.noteBucket, now),
    snapshot: createLimiter({ burst: 1, refillMs: LIMITS.snapshotMinGapMs }, now),
    presence: createLimiter({ burst: 30, refillMs: 1000 / 30 }, now),
    hello: createLimiter({ burst: 6, refillMs: 1000 }, now),
  };
  const ownNotes = createLimiter(LIMITS.noteBucket, now);

  let state = initialState(roomId, self);
  const subs = new Set<(s: RoomState, c: Changes) => void>();
  const cleanups: Array<() => void> = [];
  let timer: ReturnType<typeof globalThis.setInterval> | undefined;
  let running = false;
  let generation = 0;
  let pendingVerifications = 0;
  let localTail: Promise<unknown> = Promise.resolve();
  function serialize<T>(op: () => Promise<T>): Promise<T> {
    const next = localTail.then(op);
    localTail = next.catch(() => undefined);
    return next;
  }
  let startedAt = 0;
  let helloIndex = 0;
  let counter = 0;
  let seq = 0;
  let ptr: Vec3 | null = null;
  let ptrDirty = false;
  let away = false;
  let lastPresenceAt = -Infinity;
  let lastSnapshotAt = -Infinity;
  let cacheDirtyAt: number | null = null;
  let newerReported = false;
  const noteLinks = new Map<NoteId, string>();
  const identities = new Map<PeerId, { link: Link; seenAt: number }>();
  const linkPeers = new Map<Link, PeerId>();

  function unbind(id: PeerId): void {
    const binding = identities.get(id);
    if (binding && binding.link !== 'tab') linkPeers.delete(binding.link);
    identities.delete(id);
    mismatches.delete(id);
  }

  const mismatches = new Map<PeerId, number>();

  function commit(next: RoomState): void {
    const prev = state;
    if (next === prev) return;
    state = next;
    const notes: NoteId[] = [];
    if (next.notes !== prev.notes) {
      for (const [id, n] of next.notes) if (prev.notes.get(id) !== n) notes.push(id);
      for (const id of prev.notes.keys()) if (!next.notes.has(id)) notes.push(id);
      for (const id of noteLinks.keys()) if (!next.notes.has(id)) noteLinks.delete(id);
    }
    const peers = !samePeers(prev.peers, next.peers);
    const link = prev.link !== next.link || prev.netPeers !== next.netPeers;
    if (notes.length || peers || link) for (const fn of [...subs]) fn(next, { notes, peers, link });
  }

  const send = (w: Wire): void => transport.send(w);
  const sendHello = (): void => send(hello(state));

  function sendPresence(): void {
    lastPresenceAt = now();
    ptrDirty = false;
    send({ v: 2, k: 'presence', from: self, seq: ++seq, ptr: away ? null : ptr, away, digest: digestOfMap(state.notes) });
  }

  function flushCache(): void {
    cacheDirtyAt = null;
    if (o.storage) saveCache(roomId, Array.from(state.notes.values()), o.storage, now());
  }

  function gateSnapshot(msg: Wire, out: Wire[], t: number): Wire[] {
    const wants = out.some((w) => w.k === 'snapshot');
    if (msg.k === 'presence') {
      const run = wants ? (mismatches.get(msg.from.id) ?? 0) + 1 : 0;
      mismatches.set(msg.from.id, run);
      if (run < PRESENCE_MISMATCHES_BEFORE_SNAPSHOT) return out.filter((w) => w.k !== 'snapshot');
    }
    if (!wants) return out;
    if (t - lastSnapshotAt < LIMITS.snapshotMinGapMs) return out.filter((w) => w.k !== 'snapshot');
    lastSnapshotAt = t;
    if (msg.k === 'presence') mismatches.set(msg.from.id, 0);
    return out;
  }

  function inbound(raw: unknown, link: Link): void {
    const msg = decode(raw, now());
    if (!msg) {
      if (!newerReported && isNewerVersion(raw)) {
        newerReported = true;
        o.onNewerVersion?.();
      }
      return;
    }
    const from = senderOf(msg);
    if (from === self.id || !all.take('all')) return;
    const signed = msg.k === 'note' || msg.k === 'snapshot';
    const bound = identities.get(from);
    // Presence is unsigned. Link binding limits spoofing of pointers, which cannot change notes.
    if (!signed && bound && bound.link !== link) {
      if (now() - bound.seenAt < 5000) return;
      unbind(from);
      if (state.peers.has(from)) {
        const peers = new Map(state.peers);
        peers.delete(from);
        commit({ ...state, peers });
      }
    }
    if (!signed && link !== 'tab' && linkPeers.has(link) && linkPeers.get(link) !== from) return;
    if (msg.k !== 'bye' && !perLink[msg.k].take(link)) return;
    if (!signed) {
      identities.set(from, { link, seenAt: now() });
      if (link !== 'tab') linkPeers.set(link, from);
    }
    if (signed) {
      if (pendingVerifications >= 32) return;
      pendingVerifications++;
      const epoch = generation;
      void verifyWire(msg).then((verified) => {
        if (running && epoch === generation) accept(verified, link);
      }).finally(() => { pendingVerifications--; });
    } else accept(msg, link);
  }

  function accept(msg: Wire, link: Link): void {
    const from = senderOf(msg);
    const t = now();
    let accepted = msg;
    if (msg.k === 'note' || msg.k === 'snapshot') {
      const counts = new Map<string, number>();
      for (const owner of noteLinks.values()) counts.set(owner, (counts.get(owner) ?? 0) + 1);
      const notes = (msg.k === 'note' ? [msg.note] : msg.notes).filter((n) => {
        const prev = state.notes.get(n.id);
        if (prev && !mergeNote(prev, n).changed) return true;
        const owner = link === 'tab' ? `tab:${n.author.id}` : link;
        const previousOwner = noteLinks.get(n.id);
        if (previousOwner === owner) return true;
        const count = counts.get(owner) ?? 0;
        if (count >= LIMITS.perAuthor) return false;
        if (previousOwner) counts.set(previousOwner, (counts.get(previousOwner) ?? 1) - 1);
        noteLinks.set(n.id, owner);
        counts.set(owner, count + 1);
        return true;
      });
      if (msg.k === 'note') {
        if (!notes.length) return;
      } else accepted = { ...msg, notes };
    }
    const { state: next, out } = reduce(state, accepted, t);
    for (const id of noteLinks.keys()) if (!next.notes.has(id)) noteLinks.delete(id);
    if (msg.k === 'bye') unbind(from);
    const notesChanged = next.notes !== state.notes;
    commit(next);
    if (notesChanged) cacheDirtyAt ??= t;
    for (const w of gateSnapshot(msg, out, t)) send(w);
  }

  function tick(): void {
    const t = now();
    while (helloIndex < HELLO_AT_MS.length && t - startedAt >= (HELLO_AT_MS[helloIndex] ?? Infinity)) {
      helloIndex++;
      sendHello();
    }
    const since = t - lastPresenceAt;
    if ((ptrDirty && !away && since >= tickMs - 10) || since >= LIMITS.heartbeatMs) sendPresence();
    for (const [id, binding] of identities) if (t - binding.seenAt > LIMITS.peerTtlMs) unbind(id);
    commit(expirePeers(state, t));
    if (cacheDirtyAt !== null && t - cacheDirtyAt >= CACHE_DEBOUNCE_MS) flushCache();
  }

  function localNote(note: Note): void {
    commit({ ...state, notes: mergeNotes(state.notes, [note]) });
    send({ v: 2, k: 'note', from: self.id, note });
    cacheDirtyAt ??= now();
  }

  return {
    get state() {
      return state;
    },
    subscribe(fn) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
    addNote(i) { return serialize(async () => {
      const normalized = i.text.normalize('NFKC');
      if (!isSafeText(normalized)) return { ok: false, why: 'empty' };
      const text = normalized.replace(/\s+/g, ' ').trim().slice(0, LIMITS.textMax);
      if (!text) return { ok: false, why: 'empty' };
      const { notes } = state;
      if (liveCount(notes) >= LIMITS.maxLive || liveCount(notes, self.id) >= LIMITS.perAuthor) {
        return { ok: false, why: 'full' };
      }
      if (!ownNotes.take('self')) return { ok: false, why: 'rate' };
      const id = `${self.id}.${++counter}`;
      localNote(await signNote({ publicKey: identity.publicKey, signature: '', deletion: null, id, pos: i.pos, nrm: i.nrm, mesh: i.mesh, text, author: self, created: now(), deleted: false }, identity));
      return { ok: true, id };
    }); },
    deleteNote(id) { return serialize(async () => {
      const n = state.notes.get(id);
      if (n && n.author.id === self.id && !n.deleted) localNote({ ...n, deleted: true, deletion: await signDeletion(id, identity) });
    }); },
    setPointer(p) {
      if (p === ptr || (p && ptr && p[0] === ptr[0] && p[1] === ptr[1] && p[2] === ptr[2])) return;
      ptr = p;
      ptrDirty = true;
    },
    setAway(a) {
      if (a === away) return;
      away = a;
      if (a) ptr = null;
      if (!running) return;
      if (!a) sendHello();
      sendPresence();
    },
    async start() {
      if (running) return;
      running = true;
      const epoch = ++generation;
      if (o.storage) {
        const cached = await loadCache(roomId, o.storage, now());
        if (!running || epoch !== generation) return;
        commit({ ...state, notes: mergeNotes(state.notes, cached) });
      }
      startedAt = now();
      cleanups.push(transport.onMessage(inbound), transport.onStatus((st) => {
        const { peers, ...link } = st;
        const changed = Object.entries(link).some(([k, v]) => state.link[k as keyof RoomState['link']] !== v);
        commit({ ...state, link: changed ? { ...state.link, ...link } : state.link, netPeers: peers ?? state.netPeers });
      }), transport.onPeerJoin(sendHello));
      transport.open();
      sendHello();
      timer = timers.setInterval(tick, tickMs);
    },
    stop() {
      if (!running) return;
      running = false;
      generation++;
      send({ v: 2, k: 'bye', from: self.id });
      if (cacheDirtyAt !== null) flushCache();
      if (timer !== undefined) timers.clearInterval(timer);
      for (const off of cleanups.splice(0)) off();
      transport.close();
    },
  };
}
