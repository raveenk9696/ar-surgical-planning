import { LIMITS } from '../config';
import type { Digest, Mesh, Note, Peer, Vec3, Wire } from '../types';

type Obj = Record<string, unknown>;

const PEER_ID = /^[A-Z2-7]{8}$/;
const NOTE_ID = /^[A-Z2-7]{8}\.\d{1,9}$/;
const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];
const NAME_MAX = 16;
// Control characters have no place in a 1-3 word note or a guest name.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

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
  return typeof x === 'string' && x.length >= min && x.length <= max && !CONTROL.test(x) ? x : null;
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

function note(x: unknown): Note | null {
  if (!exact(x, ['id', 'pos', 'nrm', 'mesh', 'text', 'author', 'created', 'deleted'])) return null;
  const id = typeof x.id === 'string' && NOTE_ID.test(x.id) ? x.id : null;
  const pos = vec3(x.pos, LIMITS.coordMm);
  const nrm = vec3(x.nrm, 1.0001);
  const mesh: Mesh | null = x.mesh === 'bone' || x.mesh === 'skin' ? x.mesh : null;
  const author = peer(x.author);
  const created = typeof x.created === 'number' && Number.isFinite(x.created) && x.created >= 0 ? x.created : null;
  const deleted = typeof x.deleted === 'boolean' ? x.deleted : null;
  if (!id || !pos || !nrm || !mesh || !author || created === null || deleted === null) return null;
  if (id.slice(0, 8) !== author.id) return null;
  const body = text(x.text, deleted ? 0 : 1, deleted ? 0 : LIMITS.textMax);
  if (body === null) return null;
  return { id, pos, nrm, mesh, text: body, author, created, deleted };
}

export function decode(raw: unknown): Wire | null {
  if (!isObj(raw) || raw.v !== 1) return null;
  switch (raw.k) {
    case 'hello': {
      if (!exact(raw, ['v', 'k', 'from', 'digest'])) return null;
      const from = peer(raw.from);
      const d = digest(raw.digest);
      return from && d ? { v: 1, k: 'hello', from, digest: d } : null;
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
      return { v: 1, k: 'presence', from, seq, ptr, away: raw.away, digest: d };
    }
    case 'note': {
      if (!exact(raw, ['v', 'k', 'from', 'note'])) return null;
      const from = peerId(raw.from);
      const n = note(raw.note);
      return from && n ? { v: 1, k: 'note', from, note: n } : null;
    }
    case 'snapshot': {
      if (!exact(raw, ['v', 'k', 'from', 'notes'])) return null;
      const from = peerId(raw.from);
      const list = raw.notes;
      if (!from || !Array.isArray(list) || list.length > LIMITS.maxRecords) return null;
      const notes: Note[] = [];
      for (const item of list as unknown[]) {
        const n = note(item);
        if (!n) return null;
        notes.push(n);
      }
      return { v: 1, k: 'snapshot', from, notes };
    }
    case 'bye': {
      if (!exact(raw, ['v', 'k', 'from'])) return null;
      const from = peerId(raw.from);
      return from ? { v: 1, k: 'bye', from } : null;
    }
    default:
      return null;
  }
}

/** True for a message from a newer protocol version, which decode() rejects on purpose. */
export function isNewerVersion(raw: unknown): boolean {
  return isObj(raw) && typeof raw.v === 'number' && raw.v > 1 && typeof raw.k === 'string';
}
