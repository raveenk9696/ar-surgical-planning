import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Note, Wire } from '../types';
import { decode, isNewerVersion } from './wire';

const peer = { id: 'AAAAAAAA', name: 'Guest 2' };
const note: Note = { id: 'AAAAAAAA.1', pos: [10, -20, -300], nrm: [0, -1, 0], mesh: 'bone', text: 'left hip', author: peer, created: 1_700_000_000_000, deleted: false, publicKey: 'A'.repeat(87), signature: 'A'.repeat(86), deletion: null };
const digest = { n: 1, h: 123 };
const valid: Wire[] = [
  { v: 2, k: 'hello', from: peer, digest },
  { v: 2, k: 'snapshot', from: 'AAAAAAAA', notes: [note] },
  { v: 2, k: 'note', from: 'AAAAAAAA', note },
  { v: 2, k: 'note', from: 'AAAAAAAA', note: { ...note, deleted: true, deletion: { id: note.id, signature: 'A'.repeat(86) } } },
  { v: 2, k: 'presence', from: peer, seq: 4, ptr: [1, 2, 3], away: false, digest },
  { v: 2, k: 'presence', from: peer, seq: 0, ptr: null, away: true, digest },
  { v: 2, k: 'bye', from: 'AAAAAAAA' },
];

const clone = (w: unknown): Record<string, unknown> => JSON.parse(JSON.stringify(w)) as Record<string, unknown>;
const withNote = (patch: Record<string, unknown>): unknown => ({ ...clone(valid[2]), note: { ...clone(note), ...patch } });

describe('decode', () => {
  it.each(valid.map((w) => [w.k, w] as const))('accepts a well-formed %s', (_k, w) => {
    expect(decode(JSON.parse(JSON.stringify(w)))).toEqual(w);
  });

  it.each<[string, unknown]>([
    ['null', null],
    ['a string', 'hello'],
    ['an array', [1, 2]],
    ['a number', 7],
    ['wrong version', { ...clone(valid[6]), v: 3 }],
    ['no version', { k: 'bye', from: 'AAAAAAAA' }],
    ['unknown kind', { v: 2, k: 'nope', from: 'AAAAAAAA' }],
    ['extra key', { ...clone(valid[6]), extra: 1 }],
    ['__proto__ key', JSON.parse('{"v":2,"k":"bye","from":"AAAAAAAA","__proto__":{"x":1}}')],
    ['constructor key', { ...clone(valid[6]), constructor: 1 }],
    ['bad peer id', { v: 2, k: 'bye', from: 'short' }],
    ['NaN coordinate', withNote({ pos: [Number.NaN, 0, 0] })],
    ['Infinity coordinate', withNote({ pos: [Number.POSITIVE_INFINITY, 0, 0] })],
    ['1e9 mm', withNote({ pos: [1e9, 0, 0] })],
    ['1501 mm', withNote({ pos: [0, 1501, 0] })],
    ['non-unit normal', withNote({ nrm: [5, 0, 0] })],
    ['25-character text', withNote({ text: 'x'.repeat(25) })],
    ['10 MB text', withNote({ text: 'x'.repeat(10_000_000) })],
    ['empty live text', withNote({ text: '' })],
    ['text on a tombstone', withNote({ deleted: true })],
    ['control character', withNote({ text: 'a\u0000b' })],
    ['author not matching the id', withNote({ author: { id: 'BBBBBBBB', name: 'x' } })],
    ['bad mesh', withNote({ mesh: 'liver' })],
    ['pos with 2 numbers', withNote({ pos: [1, 2] })],
    ['presence seq negative', { ...clone(valid[4]), seq: -1 }],
    ['presence seq fraction', { ...clone(valid[4]), seq: 1.5 }],
    ['digest too large', { ...clone(valid[0]), digest: { n: 1000, h: 0 } }],
    ['name too long', { ...clone(valid[0]), from: { id: 'AAAAAAAA', name: 'x'.repeat(17) } }],
  ])('rejects %s', (_name, raw) => {
    expect(decode(raw)).toBeNull();
  });

  it('rejects a snapshot of 301 notes and accepts 300', () => {
    const many = (n: number): unknown => ({ v: 2, k: 'snapshot', from: 'AAAAAAAA', notes: Array.from({ length: n }, (_, i) => ({ ...clone(note), id: `AAAAAAAA.${i + 1}` })) });
    expect(decode(many(301))).toBeNull();
    expect(decode(many(300))).not.toBeNull();
  });

  it('turns -0 into 0 so equal positions compare equal', () => {
    const w = decode(withNote({ pos: [-0, 0, 0] }));
    expect(w?.k === 'note' && Object.is(w.note.pos[0], 0)).toBe(true);
  });

  it('never throws on arbitrary input', () => {
    fc.assert(fc.property(fc.anything(), (x) => { decode(x); }));
    fc.assert(fc.property(fc.jsonValue(), (x) => { decode(x); }));
  });

  it('never throws on mutated valid messages', () => {
    fc.assert(
      fc.property(fc.constantFrom(...valid), fc.jsonValue(), fc.nat(5), (w, junk, i) => {
        const copy = clone(w);
        const key = Object.keys(copy)[i % Object.keys(copy).length]!;
        copy[key] = junk;
        decode(copy);
      }),
    );
  });
});

describe('isNewerVersion', () => {
  it('flags only well-shaped messages from a later version', () => {
    expect(isNewerVersion({ v: 3, k: 'hello' })).toBe(true);
    expect(isNewerVersion({ v: 2, k: 'hello' })).toBe(false);
    expect(isNewerVersion({ v: 3 })).toBe(false);
    expect(isNewerVersion('x')).toBe(false);
  });
});

it.each(['\u200B', '\u202E', '\u2066', '\u2028', '\u2029', 'ｈｉｐ'])('rejects unsafe or non-normalized note text %j', (text) => {
  expect(decode(withNote({ text }))).toBeNull();
  expect(decode({ v: 2, k: 'snapshot', from: peer.id, notes: [{ ...note, text }] })).toBeNull();
});
