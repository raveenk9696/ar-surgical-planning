import type { Digest, Note } from '../types';

export function fnv32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The fields no peer may change. Their JSON text orders two conflicting records the same way on every peer. */
function immutableKey(n: Note): string {
  return JSON.stringify([n.pos, n.nrm, n.mesh, n.author.id, n.author.name, n.created]);
}

/**
 * Join of two records with the same id. Commutative, associative and idempotent:
 * the smaller immutable key wins; within one key, `deleted` is an OR and live text is the smaller string.
 */
export function mergeNote(a: Note | undefined, b: Note): { note: Note; changed: boolean } {
  if (!a) return { note: b.deleted && b.text ? { ...b, text: '' } : b, changed: true };
  const ka = immutableKey(a);
  const kb = immutableKey(b);
  let next: Note;
  if (ka !== kb) {
    next = ka < kb ? a : b;
  } else {
    const deleted = a.deleted || b.deleted;
    next = { ...a, deleted, text: deleted ? '' : a.text <= b.text ? a.text : b.text };
  }
  const changed = next.deleted !== a.deleted || next.text !== a.text || immutableKey(next) !== ka;
  return changed ? { note: next, changed } : { note: a, changed };
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
