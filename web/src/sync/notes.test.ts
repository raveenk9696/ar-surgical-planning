import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Note } from '../types';
import { digestOf, mergeNote } from './notes';

const AUTHORS = [
  { id: 'AAAAAAAA', name: 'Guest 2' },
  { id: 'BBBBBBBB', name: 'Guest 3' },
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
    const author = AUTHORS[a] ?? AUTHORS[0]!;
    return { id: `${author.id}.${n}`, pos, nrm: [0, 0, 1], mesh, text: deleted ? '' : text, author, created, deleted };
  });

const fold = (notes: Note[]): Map<string, Note> => {
  const m = new Map<string, Note>();
  for (const n of notes) m.set(n.id, mergeNote(m.get(n.id), n).note);
  return m;
};

const sameId = fc.tuple(noteArb, fc.boolean(), fc.boolean(), fc.boolean()).map(([base, ...flags]) =>
  flags.map((deleted) => ({ ...base, deleted, text: deleted ? '' : 'hip' })) as [Note, Note, Note],
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
    const create: Note = { id: 'AAAAAAAA.1', pos: [1, 2, 3], nrm: [0, 0, 1], mesh: 'bone', text: 'hip', author: AUTHORS[0]!, created: 5, deleted: false };
    const tomb: Note = { ...create, text: '', deleted: true };
    const first = mergeNote(undefined, tomb).note;
    const after = mergeNote(first, create);
    expect(after.note.deleted).toBe(true);
    expect(after.note.text).toBe('');
    expect(after.changed).toBe(false);
  });

  it('keeps the first immutable fields and ORs conflicting tombstones', () => {
    const a: Note = { id: 'AAAAAAAA.1', pos: [1, 2, 3], nrm: [0, 0, 1], mesh: 'bone', text: 'hip', author: AUTHORS[0]!, created: 5, deleted: false };
    const b: Note = { ...a, pos: [9, 9, 9], text: 'rib' };
    expect(mergeNote(a, b).note).toBe(a);
    expect(mergeNote(b, a).note).toBe(b);
    expect(mergeNote(a, { ...b, text: 'aaa' }).note.text).toBe('hip');
    const tomb = { ...b, deleted: true, text: '' };
    expect(mergeNote(tomb, a).note).toEqual(tomb);
    expect(mergeNote(a, tomb).note).toEqual({ ...a, deleted: true, text: '' });
  });

  it('does not let a stale live copy resurrect a deleted note', () => {
    const live: Note = { id: 'AAAAAAAA.1', pos: [1, 2, 3], nrm: [0, 0, 1], mesh: 'bone', text: 'hip', author: AUTHORS[0]!, created: 5, deleted: false };
    const dead = mergeNote(live, { ...live, text: '', deleted: true }).note;
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
    const n: Note = { id: 'AAAAAAAA.1', pos: [0, 0, 0], nrm: [0, 0, 1], mesh: 'bone', text: 'a', author: AUTHORS[0]!, created: 1, deleted: false };
    expect(digestOf([n])).not.toEqual(digestOf([{ ...n, deleted: true, text: '' }]));
    expect(digestOf([])).toEqual({ n: 0, h: 0 });
  });
});
