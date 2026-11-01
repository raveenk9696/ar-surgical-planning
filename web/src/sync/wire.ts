import { verifyNote } from './identity';
import { LIMITS } from '../config';
import type { Digest, Mesh, Note, Peer, Vec3, Wire } from '../types';

type Obj = Record<string, unknown>;

const PEER_ID = /^[A-Z2-7]{26}$/;
const NOTE_ID = /^[A-Z2-7]{26}\.\d{1,9}$/;
const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];
const NAME_MAX = 16;
export function isSafeText(value: string): boolean {
  return !/[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\u2028\u2029\uFDD0-\uFDEF\uFFFE\uFFFF\uFFFC\u115F\u1160\u034F\u17B4\u17B5\u2800\u3164\uFFA0\u1680\uFE00-\uFE0F]/u.test(value) && /[^\s\p{M}]/u.test(value.trim()) && value === value.normalize('NFKC');
}

function isObj(x: unknown): x is Obj {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const proto: unknown = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
}

function exact(o: unknown, keys: readonly string[]): o is Obj {
  if (!isObj(o)) return false;
  const own = Object.keys(o);
  return own.length === keys.length && own.every((k) => keys.includes(k) && !FORBIDDEN_KEYS.includes(k));
}

function text(x: unknown, min: number, max: number): string | null {
  return typeof x === 'string' && x.length <= max * 2 && Array.from(x).length >= min && Array.from(x).length <= max && isSafeText(x) ? x : null;
}

function vec3(x: unknown, limit: number): Vec3 | null {
  if (!Array.isArray(x) || x.length !== 3) return null;
  const out: number[] = [];
  for (const c of x as unknown[]) {
    if (typeof c !== 'number' || !Number.isFinite(c) || Math.abs(c) > limit) return null;
    out.push(c + 0); // turns -0 into 0 so equal positions compare equal
  }
  return [out[0] ?? 0, out[1] ?? 0, out[2] ?? 0];
}

function peerId(x: unknown): string | null {
  return typeof x === 'string' && PEER_ID.test(x) ? x : null;
}

function peer(x: unknown): Peer | null {
  if (!exact(x, ['id', 'name'])) return null;
  const id = peerId(x.id);
  const name = text(x.name, 1, NAME_MAX);
  return id && name ? { id, name } : null;
}

function digest(x: unknown): Digest | null {
  if (!exact(x, ['n', 'h'])) return null;
  const { n, h } = x;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > LIMITS.maxRecords) return null;
  if (typeof h !== 'number' || !Number.isInteger(h) || h < 0 || h > 0xffffffff) return null;
  return { n, h };
}

function note(x: unknown, now: number): Note | null {
  if (!exact(x, ['id', 'pos', 'nrm', 'mesh', 'text', 'author', 'created', 'deleted', 'publicKey', 'signature', 'deletion'])) return null;
  const id = typeof x.id === 'string' && NOTE_ID.test(x.id) ? x.id : null;
  const pos = vec3(x.pos, LIMITS.coordMm);
  const nrm = vec3(x.nrm, 1.0001);
  const mesh: Mesh | null = x.mesh === 'bone' || x.mesh === 'skin' ? x.mesh : null;
  const author = peer(x.author);
  const created = typeof x.created === 'number' && Number.isFinite(x.created) && x.created >= now - LIMITS.maxNoteAgeMs && x.created <= now + LIMITS.maxClockSkewMs ? x.created : null;
  const deleted = typeof x.deleted === 'boolean' ? x.deleted : null;
  if (!id || !pos || !nrm || !mesh || !author || created === null || deleted === null) return null;
  if (id.slice(0, 26) !== author.id) return null;
  const body = text(x.text, 1, LIMITS.textMax);
  if (typeof x.publicKey !== 'string' || !/^[A-Za-z0-9_-]{87}$/.test(x.publicKey)) return null;
  if (typeof x.signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(x.signature)) return null;
  let deletion = null;
  if (deleted) {
    if (!exact(x.deletion, ['id', 'signature']) || x.deletion.id !== id || typeof x.deletion.signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(x.deletion.signature)) return null;
    deletion = { id, signature: x.deletion.signature };
  } else if (x.deletion !== null) return null;
  if (body === null) return null;
  return { id, pos, nrm, mesh, text: body, author, created, deleted, publicKey: x.publicKey, signature: x.signature, deletion };
}

export function decode(raw: unknown, now = Date.now()): Wire | null {
  if (!isObj(raw) || raw.v !== 2) return null;
  switch (raw.k) {
    case 'hello': {
      if (!exact(raw, ['v', 'k', 'from', 'digest'])) return null;
      const from = peer(raw.from);
      const d = digest(raw.digest);
      return from && d ? { v: 2, k: 'hello', from, digest: d } : null;
    }
    case 'presence': {
      if (!exact(raw, ['v', 'k', 'from', 'seq', 'ptr', 'away', 'digest'])) return null;
      const from = peer(raw.from);
      const d = digest(raw.digest);
      const ptr = raw.ptr === null ? null : vec3(raw.ptr, LIMITS.coordMm);
      const seq = raw.seq;
      if (!from || !d || (raw.ptr !== null && !ptr)) return null;
      if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0) return null;
      if (typeof raw.away !== 'boolean') return null;
      return { v: 2, k: 'presence', from, seq, ptr, away: raw.away, digest: d };
    }
    case 'note': {
      if (!exact(raw, ['v', 'k', 'from', 'note'])) return null;
      const from = peerId(raw.from);
      const n = note(raw.note, now);
      return from && n && n.author.id === from ? { v: 2, k: 'note', from, note: n } : null;
    }
    case 'snapshot': {
      if (!exact(raw, ['v', 'k', 'from', 'notes'])) return null;
      const from = peerId(raw.from);
      const list = raw.notes;
      if (!from || !Array.isArray(list) || list.length > LIMITS.maxRecords) return null;
      const notes: Note[] = [];
      for (const item of list as unknown[]) {
        const n = note(item, now);
        if (n) notes.push(n);
      }
      return { v: 2, k: 'snapshot', from, notes };
    }
    case 'bye': {
      if (!exact(raw, ['v', 'k', 'from'])) return null;
      const from = peerId(raw.from);
      return from ? { v: 2, k: 'bye', from } : null;
    }
    default:
      return null;
  }
}

/** True for a message from a newer protocol version, which decode() rejects on purpose. */
export function isNewerVersion(raw: unknown): boolean {
  return isObj(raw) && typeof raw.v === 'number' && raw.v > 2 && typeof raw.k === 'string';
}

export async function verifyWire(w: Wire, roomId: string): Promise<Wire> {
  if (w.k === 'snapshot') {
    const notes: Note[] = [];
    for (const n of w.notes) if (await verifyNote(n, roomId)) notes.push(n);
    return { ...w, notes };
  }
  if (w.k === 'note' && !await verifyNote(w.note, roomId)) return { v: 2, k: 'snapshot', from: w.from, notes: [] };
  return w;
}
