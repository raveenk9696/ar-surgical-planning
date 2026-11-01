import { expect, it } from 'vitest';
import { loadIdentity, type IdentityStore, type StoredIdentity } from './identityStore';
import { createEngine } from './engine';
import { FakeHub } from '../test/fakehub';

it('retains non-extractable keys and ownership across reload for 24 hours', async () => {
  let value: StoredIdentity | undefined;
  const store: IdentityStore = { read: async () => value, write: async (next) => { value = structuredClone(next); } };
  const a = await loadIdentity(store, 1000);
  const b = await loadIdentity(store, 2000);
  expect(b.peer).toEqual(a.peer);
  expect(b.publicKey).toBe(a.publicKey);
  expect(value?.keys.privateKey.extractable).toBe(false);
  expect(value?.keys.publicKey.type).toBe('public');
  const expired = await loadIdentity(store, 86_403_000);
  expect(expired.peer.id).not.toBe(a.peer.id);
  const data = new Map<string, string>();
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) } as Storage;
  const engine = (who: typeof a) => createEngine({ token: 'ABCDEFGHIJKLMNOPQRST', identity: who, transport: new FakeHub().end('A'), now: Date.now, storage });
  const first = engine(a);
  await first.start();
  const note = await first.addNote({ pos: [1, 2, 3], nrm: [0, 0, 1], mesh: 'bone', text: 'mine' });
  if (!note.ok) throw new Error('add failed');
  first.stop();
  const second = engine(b);
  await second.start();
  const added = await second.addNote({ pos: [1, 2, 3], nrm: [0, 0, 1], mesh: 'bone', text: 'new' });
  expect(added.ok && added.id).not.toBe(note.id);
  await second.deleteNote(note.id);
  expect(second.state.notes.get(note.id)?.deleted).toBe(true);
  second.stop();
});

it('uses a fresh identity when IndexedDB fails', async () => {
  const store: IdentityStore = { read: async () => { throw new Error('blocked'); }, write: async () => { throw new Error('blocked'); } };
  const a = await loadIdentity(store);
  const b = await loadIdentity(store);
  expect(a.peer.id).not.toBe(b.peer.id);
});

it.each(['ecdh', 'wrong pair', 'wrong id', 'null keys', 'missing private key', 'infinite expiry', 'string', 'wrong curve'])('replaces and persists corrupt identity: %s', async (kind) => {
  let value: StoredIdentity | undefined;
  const store: IdentityStore = { read: async () => value, write: async (next) => { value = structuredClone(next); } };
  const original = await loadIdentity(store, 1000);
  const valid = value!;
  if (kind === 'ecdh') valid.keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  if (kind === 'wrong pair') valid.keys.privateKey = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])).privateKey;
  if (kind === 'wrong id') valid.peer.id = 'AAAAAAAAAAAAAAAAAAAAAAAAAA';
  if (kind === 'null keys') value = { ...valid, keys: null } as unknown as StoredIdentity;
  if (kind === 'missing private key') value = { ...valid, keys: { publicKey: valid.keys.publicKey } } as StoredIdentity;
  if (kind === 'infinite expiry') valid.expiresAt = Infinity;
  if (kind === 'string') value = 'corrupt' as unknown as StoredIdentity;
  if (kind === 'wrong curve') valid.keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-384' }, false, ['sign', 'verify']);
  const repaired = await loadIdentity(store, 2000);
  expect(repaired.peer.id).not.toBe(original.peer.id);
  expect(value?.peer).toEqual(repaired.peer);
  expect((await loadIdentity(store, 3000)).peer).toEqual(repaired.peer);
  const { signPresence, verifyPresence } = await import('./identity');
  const signed = await signPresence({ v: 2, k: 'presence', from: repaired.peer, seq: 1, ptr: null, away: false, digest: { n: 0, h: 0 } }, repaired, 'room');
  expect(await verifyPresence(signed, 'room')).toBe(true);
});
