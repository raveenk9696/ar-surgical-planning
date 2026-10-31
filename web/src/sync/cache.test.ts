import { noteBy } from '../test/signed';
import { describe, expect, it } from 'vitest';
import { loadCache, saveCache } from './cache';

const note = noteBy('A', 1, { created: 5 });
const DAY = 86_400_000;

function memory(): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) } as Storage & { data: Map<string, string> };
}

describe('cache', async () => {
  it('restores notes saved less than 24 hours ago, under one namespaced key', async () => {
    const s = memory();
    saveCache('ROOM', [note], s, 1000);
    expect([...s.data.keys()]).toEqual(['asp:v2:ROOM']);
    expect(await loadCache('ROOM', s, 1000 + DAY - 1)).toEqual([note]);
  });

  it('drops notes after 24 hours', async () => {
    const s = memory();
    saveCache('ROOM', [note], s, 1000);
    expect(await loadCache('ROOM', s, 1000 + DAY + 1)).toEqual([]);
  });

  it('survives blocked storage', async () => {
    const blocked = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(() => saveCache('ROOM', [note], blocked, 0)).not.toThrow();
    expect(await loadCache('ROOM', blocked, 0)).toEqual([]);
  });

  it.each(['{not json', 'null', '[]', '{"savedAt":"x","notes":[]}', '{"savedAt":0,"notes":[{"id":1}]}', '{"savedAt":0}'])('ignores corrupt data %s', async (raw) => {
    const s = memory();
    s.data.set('asp:v2:ROOM', raw);
    expect(await loadCache('ROOM', s, 0)).toEqual([]);
  });

  it('rejects cached notes that fail the wire rules', async () => {
    const s = memory();
    saveCache('ROOM', [{ ...note, text: 'x'.repeat(25) }], s, 0);
    expect(await loadCache('ROOM', s, 0)).toEqual([]);
  });
});
