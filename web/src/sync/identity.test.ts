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
    expect(decode({ v: 2, k: 'snapshot', from: identity('B').peer.id, notes: [n.deletion] })).toBeNull();
  });
});
