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
  if (!a) return { note: b.deleted && b.text ? { ...b, text: '' } : b, changed: true };
  if (!a.deleted && b.deleted) return { note: { ...a, deleted: true, text: '' }, changed: true };
  return { note: a, changed: false };
}

export function digestOf(notes: Iterable<Note>): Digest {
  let n = 0;
  let h = 0;
  for (const note of notes) {
    n++;
    h = (h ^ fnv32(note.id + (note.deleted ? 'x' : ''))) >>> 0;
  }
  return { n, h };
}
