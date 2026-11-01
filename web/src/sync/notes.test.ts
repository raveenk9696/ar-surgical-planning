import { eraseContent, canonicalNote } from './identity';
import { noteBy } from '../test/signed';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Note } from '../types';
import { digestOf, mergeNote } from './notes';

const AUTHORS = [
  { id: 'AAAAAAAAAAAAAAAAAAAAAAAAAA', name: 'Guest 2' },
  { id: 'BBBBBBBBBBBBBBBBBBBBBBBBBB', name: 'Guest 3' },
];

const noteArb: fc.Arbitrary<Note> = fc
  .record({
    a: fc.constantFrom(0, 1),
    n: fc.constantFrom(1, 2),
    pos: fc.tuple(fc.integer({ min: -3, max: 3 }), fc.integer({ min: -3, max: 3 }), fc.integer({ min: -3, max: 3 })),
    mesh: fc.constantFrom<'bone' | 'skin'>('bone', 'skin'),
    text: fc.constantFrom('hip', 'rib', 'look'),
    created: fc.constantFrom(10, 20),
    deleted: fc.boolean(),
  })
  .map(({ a, n, pos, mesh, text, created, deleted }) => {
    return noteBy(a === 0 ? 'A' : 'B', n, { pos, mesh, text, created, deleted });
  });

const fold = (notes: Note[]): Map<string, Note> => {
  const m = new Map<string, Note>();
  for (const n of notes) m.set(n.id, mergeNote(m.get(n.id), n).note);
  return m;
};

const sameId = fc.tuple(noteArb, fc.boolean(), fc.boolean(), fc.boolean()).map(([base, ...flags]) =>
  flags.map((deleted) => (deleted ? eraseContent(base) : base)) as [Note, Note, Note],
);

describe('mergeNote', () => {
  it('is commutative', () => {
    fc.assert(
      fc.property(sameId, ([a, b]) => {
        expect(mergeNote(a, b).note).toEqual(mergeNote(b, a).note);
      }),
    );
  });

  it('is associative', () => {
    fc.assert(
      fc.property(sameId, ([a, b, c]) => {
        const left = mergeNote(mergeNote(a, b).note, c).note;
        const right = mergeNote(a, mergeNote(b, c).note).note;
        expect(left).toEqual(right);
      }),
    );
  });

  it('is idempotent', () => {
    fc.assert(
      fc.property(noteArb, (a) => {
        const r = mergeNote(a, a);
        expect(r.changed).toBe(false);
        expect(r.note).toBe(a);
      }),
    );
  });

  it('converges whatever order records arrive in', () => {
    fc.assert(
      fc.property(
        fc.array(noteArb, { maxLength: 14 }).map((arr) => arr.map((n, i) => ({ ...n, id: `${n.author.id}.${i}` }))).chain((arr) => fc.tuple(fc.constant(arr), fc.shuffledSubarray(arr, { minLength: arr.length, maxLength: arr.length }))),
        ([arr, shuffled]) => {
          expect(fold(shuffled)).toEqual(fold(arr));
          expect(fold([...arr, ...arr])).toEqual(fold(arr));
        },
      ),
    );
  });

  it('keeps a tombstone that arrives before its create', () => {
    const create: Note = { id: 'AAAAAAAAAAAAAAAAAAAAAAAAAA.1', pos: [1, 2, 3], nrm: [0, 0, 1], mesh: 'bone', text: 'hip', author: AUTHORS[0]!, created: 5, deleted: false, publicKey: 'A'.repeat(87), signature: 'A'.repeat(86), contentHash: 'A'.repeat(43), deletion: null };
    const tomb: Note = eraseContent(create);
    const first = mergeNote(undefined, tomb).note;
    const after = mergeNote(first, create);
    expect(after.note.deleted).toBe(true);
    expect(after.note).not.toHaveProperty('text');
    expect(after.changed).toBe(false);
  });

  it('chooses conflicting live records deterministically and lets deletion win', () => {
    const a = noteBy('A', 1, { text: 'hip', created: 5 });
    const b = noteBy('A', 1, { text: 'rib', created: 5 });
    const winner = canonicalNote(a) <= canonicalNote(b) ? a : b;
    expect(mergeNote(a, b).note).toEqual(winner);
    expect(mergeNote(b, a).note).toEqual(winner);
    const tomb = eraseContent(b);
    expect(mergeNote(a, tomb).note).toEqual(tomb);
    expect(mergeNote(tomb, a).note).toEqual(tomb);
  });

  it('does not let a stale live copy resurrect a deleted note', () => {
    const live: Note = { id: 'AAAAAAAAAAAAAAAAAAAAAAAAAA.1', pos: [1, 2, 3], nrm: [0, 0, 1], mesh: 'bone', text: 'hip', author: AUTHORS[0]!, created: 5, deleted: false, publicKey: 'A'.repeat(87), signature: 'A'.repeat(86), contentHash: 'A'.repeat(43), deletion: null };
    const dead = mergeNote(live, eraseContent(live)).note;
    expect(mergeNote(dead, live).note.deleted).toBe(true);
  });
});

describe('digestOf', () => {
  it('ignores order and separates deleted from live', () => {
    fc.assert(
      fc.property(fc.array(noteArb, { maxLength: 10 }), (arr) => {
        const unique = [...fold(arr).values()];
        expect(digestOf(unique)).toEqual(digestOf([...unique].reverse()));
      }),
    );
    const n: Note = { id: 'AAAAAAAAAAAAAAAAAAAAAAAAAA.1', pos: [0, 0, 0], nrm: [0, 0, 1], mesh: 'bone', text: 'a', author: AUTHORS[0]!, created: 1, deleted: false, publicKey: 'A'.repeat(87), signature: 'A'.repeat(86), contentHash: 'A'.repeat(43), deletion: null };
    expect(digestOf([n])).not.toEqual(digestOf([eraseContent(n)]));
    expect(digestOf([])).toEqual({ n: 0, h: 0 });
  });
});

it('never combines a deletion from another key with a stored signature', () => {
  const live = { id: 'A'.repeat(26) + '.1', author: { id: 'A'.repeat(26), name: 'Guest' }, pos: [1, 2, 3], nrm: [0, 0, 1], mesh: 'bone', text: 'hip', created: 1, deleted: false, deletion: null, publicKey: 'A'.repeat(87), signature: 'A'.repeat(86), contentHash: 'A'.repeat(43) } as Note;
  const tomb = { ...eraseContent(live), publicKey: 'B'.repeat(87), deletion: { id: live.id, signature: 'B'.repeat(86) } };
  expect(mergeNote(live, tomb)).toEqual({ note: live, changed: false });
});
