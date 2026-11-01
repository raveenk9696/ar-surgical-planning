/// <reference types="node" />
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { vi } from 'vitest';
import type { Note, LiveNote, Tombstone, Peer } from '../types';
import { canonicalNote, canonicalContent, eraseContent, type Identity } from '../sync/identity';

const identities = new Map<string, Identity>();
const keys = new Map<string, KeyObject>();
for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
  const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = key.publicKey.export({ format: 'jwk' });
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, 'base64url'), Buffer.from(jwk.y!, 'base64url')]);
  const bits = [...createHash('sha256').update(raw).digest().subarray(0, 16)].map((n) => n.toString(2).padStart(8, '0')).join('') + '00';
  const id = bits.match(/.{5}/g)!.map((b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[parseInt(b, 2)]).join('');
  const privateKey = await crypto.subtle.importKey('jwk', key.privateKey.export({ format: 'jwk' }), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  identities.set(c, { peer: { id, name: `Guest ${c}` }, publicKey: raw.toString('base64url'), privateKey });
  keys.set(c, key.privateKey);
}
export const identity = (c: string): Identity => identities.get(c)!;
export const peer = (c: string): Peer => identity(c).peer;
type NoteOverrides = Partial<Omit<LiveNote, 'deleted'>> & { deleted?: boolean };
export function noteBy(c: string, n: number, over: NoteOverrides & { deleted: true }, roomId?: string): Tombstone;
export function noteBy(c: string, n: number, over?: NoteOverrides & { deleted?: false }, roomId?: string): LiveNote;
export function noteBy(c: string, n: number, over: NoteOverrides, roomId?: string): Note;
export function noteBy(c: string, n: number, over: Partial<Omit<LiveNote, 'deleted'>> & { deleted?: boolean } = {}, roomId = 'ABCDEFGHIJ'): Note {
  const who = identity(c);
  const note: LiveNote = { id: `${who.peer.id}.${n}`, pos: [1, 2, 3], nrm: [0, 0, 1], mesh: 'bone', text: 'x', author: who.peer, created: Date.now(), deletion: null, publicKey: who.publicKey, signature: '', contentHash: '', ...over, deleted: false };
  const signed = (s: string): string => sign('sha256', Buffer.from(s), { key: keys.get(c)!, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  if (!note.text) note.text = 'x';
  note.contentHash = createHash('sha256').update(canonicalContent(note)).digest('base64url');
  note.signature = signed(JSON.stringify(['asp-note-v2', roomId, canonicalNote(note)]));
  if (over.deleted) note.deletion = { id: note.id, signature: signed(JSON.stringify(['asp-del-v2', roomId, note.id])) };
  return over.deleted ? eraseContent(note) : note;
}
export const settle = async (): Promise<void> => { await delay(30); };
export async function run(ms: number): Promise<void> {
  for (let t = 0; t < ms; t += 100) {
    await vi.advanceTimersByTimeAsync(Math.min(100, ms - t));
    await delay(1);
  }
  await settle();
}
