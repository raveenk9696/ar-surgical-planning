import { describe, expect, it } from 'vitest';
import type { Note } from '../types';
import { loadCache, saveCache } from './cache';

const note: Note = { id: 'AAAAAAAA.1', pos: [1, 2, 3], nrm: [0, 0, 1], mesh: 'bone', text: 'hip', author: { id: 'AAAAAAAA', name: 'Guest 2' }, created: 5, deleted: false };
const DAY = 86_400_000;

function memory(): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) } as Storage & { data: Map<string, string> };
}

describe('cache', () => {
  it('restores notes saved less than 24 hours ago, under one namespaced key', () => {
    const s = memory();
    saveCache('ROOM', [note], s, 1000);
    expect([...s.data.keys()]).toEqual(['asp:v1:ROOM']);
    expect(loadCache('ROOM', s, 1000 + DAY - 1)).toEqual([note]);
  });

  it('drops notes after 24 hours', () => {
    const s = memory();
    saveCache('ROOM', [note], s, 1000);
    expect(loadCache('ROOM', s, 1000 + DAY + 1)).toEqual([]);
  });

  it('survives blocked storage', () => {
    const blocked = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(() => saveCache('ROOM', [note], blocked, 0)).not.toThrow();
    expect(loadCache('ROOM', blocked, 0)).toEqual([]);
  });

  it.each(['{not json', 'null', '[]', '{"savedAt":"x","notes":[]}', '{"savedAt":0,"notes":[{"id":1}]}', '{"savedAt":0}'])('ignores corrupt data %s', (raw) => {
    const s = memory();
    s.data.set('asp:v1:ROOM', raw);
    expect(loadCache('ROOM', s, 0)).toEqual([]);
  });

  it('rejects cached notes that fail the wire rules', () => {
    const s = memory();
    saveCache('ROOM', [{ ...note, text: 'x'.repeat(25) }], s, 0);
    expect(loadCache('ROOM', s, 0)).toEqual([]);
  });
});
