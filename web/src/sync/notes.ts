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
  if (a.deleted || b.deleted) {
    const tomb = a.deleted && b.deleted ? (canonicalNote(a) <= canonicalNote(b) ? a : b) : a.deleted ? a : b;
    return { note: tomb, changed: tomb !== a };
  }
  const winner = canonicalNote(a) <= canonicalNote(b) ? a : b;
  return { note: winner, changed: winner !== a };
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
