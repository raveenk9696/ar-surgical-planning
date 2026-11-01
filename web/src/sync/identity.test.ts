import { describe, expect, it } from 'vitest';
import { noteBy, identity } from '../test/signed';
import { newPeer, peerIdOf, signDeletion, signNote, verifyNote } from './identity';
import { decode, verifyWire } from './wire';
import { loadCache } from './cache';

describe('signed records at the boundary', () => {
  it('makes a fresh P-256 key and binds its id to the raw public key', async () => {
    const a = await newPeer();
    const b = await newPeer();
    expect(a.peer.id).not.toBe(b.peer.id);
    expect(a.peer.id).toBe(await peerIdOf(Uint8Array.from(Buffer.from(a.publicKey, 'base64url'))));
    expect(a.privateKey.extractable).toBe(false);
    const n = await signNote({ ...noteBy('A', 1), id: `${a.peer.id}.1`, author: a.peer }, a);
    expect(await verifyNote(n)).toBe(true);
  });
  it.each(['signature', 'prefix', 'key', 'text', 'name', 'deletion'] as const)('drops snapshot and cached notes with forged %s', async (attack) => {
    const n = noteBy('A', 1);
    const bad = { ...n };
    if (attack === 'signature') bad.signature = 'A'.repeat(86);
    if (attack === 'prefix') bad.id = `${identity('B').peer.id}.1`;
    if (attack === 'key') bad.publicKey = identity('B').publicKey;
    if (attack === 'text') bad.text = 'AMPUTATE LEFT LEG';
    if (attack === 'name') bad.author = { ...n.author, name: 'Dr Chen' };
    if (attack === 'deletion') { bad.deleted = true; bad.deletion = await signDeletion(n.id, identity('B')); }
    const wire = decode({ v: 2, k: 'snapshot', from: identity('B').peer.id, notes: [bad] });
    if (wire) expect(await verifyWire(wire)).toMatchObject({ notes: [] });
    expect(await loadCache('ROOM', { getItem: () => JSON.stringify({ savedAt: Date.now(), notes: [bad] }) }, Date.now())).toEqual([]);
  });
  it('accepts a relayed author deletion with its signed note and rejects an orphan deletion', async () => {
    const n = noteBy('A', 1, { deleted: true });
    expect(await verifyNote(n)).toBe(true);
    expect(decode({ v: 2, k: 'snapshot', from: identity('B').peer.id, notes: [n.deletion] })).toMatchObject({ notes: [] });
  });
});

it.each([1e16, Date.now() - 25 * 3600_000 - 1000, Date.now() + 120_000 + 1000])('drops the verifier timestamp poison %s on wire and reload', async (created) => {
  const n = noteBy('A', 1, { created });
  expect(decode({ v: 2, k: 'note', from: n.author.id, note: n })).toBeNull();
  expect(await loadCache('ROOM', { getItem: () => JSON.stringify({ savedAt: Date.now(), notes: [n] }) }, Date.now())).toEqual([]);
});

it('separates the verifier 40-bit collision at the full 128-bit width', async () => {
  const keys = [
    '04c65177dd10097dd8072095e0773e4ffcf432b848859ed24709e97c7b04c3e8a3d53540081ae20a8f586bc481009f8d493268c0b1209fad4ae0f40469149bc552',
    '04bbf2b61aafb80d7a94cd0722cfff2476071dce50a3ffe36fcdc219b4b45d69f105a297e5ea79a970e1080e359bdc209b4f24f04555d3f6b54923218bfaba48ba',
  ];
  const ids = await Promise.all(keys.map((key) => peerIdOf(Uint8Array.from(Buffer.from(key, 'hex')))));
  expect(ids[0]?.slice(0, 8)).toBe(ids[1]?.slice(0, 8));
  expect(ids[0]).toHaveLength(26);
  expect(ids[0]).not.toBe(ids[1]);
  const n = noteBy('A', 1);
  expect(decode({ v: 2, k: 'note', from: ids[0]?.slice(0, 8), note: n })).toBeNull();
});
