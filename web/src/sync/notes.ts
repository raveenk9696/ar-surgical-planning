import { canonicalNote } from './identity';
import type { Digest, Note } from '../types';

export function fnv32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mergeNote(a: Note | undefined, b: Note): { note: Note; changed: boolean } {
  if (!a) return { note: b, changed: true };
  if (a.publicKey !== b.publicKey) return { note: a, changed: false };
  const winner = canonicalNote(a) <= canonicalNote(b) ? a : b;
  const deletion = a.deletion && b.deletion ? (a.deletion.signature < b.deletion.signature ? a.deletion : b.deletion) : a.deletion ?? b.deletion;
  const deleted = a.deleted || b.deleted;
  if (winner === a && deleted === a.deleted && deletion === a.deletion) return { note: a, changed: false };
  return { note: { ...winner, deleted, deletion }, changed: true };
}

export function digestOf(notes: Iterable<Note>): Digest {
  let n = 0;
  let h = 0;
  for (const note of notes) {
    n++;
    h = (h ^ fnv32(canonicalNote(note) + (note.deleted ? 'x' : ''))) >>> 0;
  }
  return { n, h };
}
