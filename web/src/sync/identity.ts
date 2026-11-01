import { LIMITS } from '../config';
import type { Peer, Note, LiveNote, Tombstone, Deletion, Wire } from '../types';

export interface Identity { peer: Peer; publicKey: string; privateKey: CryptoKey }
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const encoder = new TextEncoder();
export const canonicalContent = (n: LiveNote): string => JSON.stringify([n.pos, n.nrm, n.mesh, n.author.name, n.text]);
export const canonicalNote = (n: Note): string => JSON.stringify([n.id, n.author.id, n.created, n.contentHash]);
export function eraseContent(n: Note, deletion: Deletion | null = n.deletion): Tombstone {
  return { id: n.id, author: n.author, created: n.created, contentHash: n.contentHash, publicKey: n.publicKey, signature: n.signature, deleted: true, deletion };
}
async function contentHash(n: LiveNote): Promise<string> {
  return base64url(await crypto.subtle.digest('SHA-256', encoder.encode(canonicalContent(n))));
}
export const base64url = (bytes: ArrayBuffer): string => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const bytesOf = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));

export async function peerIdOf(raw: Uint8Array<ArrayBuffer>): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', raw));
  let id = '';
  for (let bit = 0; bit < 130; bit += 5) {
    const byte = bit >> 3;
    const value = ((hash[byte] ?? 0) << 8) | (byte + 1 < 16 ? hash[byte + 1] ?? 0 : 0);
    id += ALPHABET[(value >> (11 - (bit % 8))) & 31];
  }
  return id;
}

export async function newPeer(): Promise<Identity> {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const raw = await crypto.subtle.exportKey('raw', keys.publicKey);
  return { peer: { id: await peerIdOf(new Uint8Array(raw)), name: `Guest ${2 + crypto.getRandomValues(new Uint8Array(1))[0]! % 98}` }, publicKey: base64url(raw), privateKey: keys.privateKey };
}

async function sign(value: string, identity: Identity): Promise<string> {
  return base64url(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, identity.privateKey, encoder.encode(value)));
}

export async function signNote(n: Omit<LiveNote, 'contentHash'> & { contentHash?: string }, identity: Identity, roomId: string): Promise<LiveNote> {
  const hashed: LiveNote = { ...n, contentHash: await contentHash({ ...n, contentHash: '' }) };
  return { ...hashed, publicKey: identity.publicKey, signature: await sign(JSON.stringify(['asp-note-v2', roomId, canonicalNote(hashed)]), identity) };
}

export async function signDeletion(id: string, identity: Identity, roomId: string): Promise<Deletion> {
  return { id, signature: await sign(JSON.stringify(['asp-del-v2', roomId, id]), identity) };
}

export async function verifyNote(n: Note, roomId: string): Promise<boolean> {
  try {
    if (!n.deleted && await contentHash(n) !== n.contentHash) return false;
    const raw = bytesOf(n.publicKey);
    if (await peerIdOf(raw) !== n.author.id || n.id.split('.')[0] !== n.author.id) return false;
    const key = await crypto.subtle.importKey('raw', raw, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const verify = (value: string, sig: string): Promise<boolean> => crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, bytesOf(sig), encoder.encode(value));
    if (!await verify(JSON.stringify(['asp-note-v2', roomId, canonicalNote(n)]), n.signature)) return false;
    return !n.deleted || !!n.deletion && n.deletion.id === n.id && await verify(JSON.stringify(['asp-del-v2', roomId, n.id]), n.deletion.signature);
  } catch { return false; }
}

type PresenceMessage = Extract<Wire, { k: 'presence' }>;
const canonicalPresence = (m: PresenceMessage, roomId: string): string =>
  JSON.stringify(['asp-presence-v2', roomId, m.from.id, m.from.name, m.sentAt, m.seq, m.ptr, m.away, m.digest.n, m.digest.h]);

export async function signPresence(message: PresenceMessage, identity: Identity, roomId: string): Promise<PresenceMessage> {
  const timed = { ...message, sentAt: message.sentAt ?? Date.now() };
  return { ...timed, proof: { publicKey: identity.publicKey, signature: await sign(canonicalPresence(timed, roomId), identity) } };
}

export async function verifyPresence(message: PresenceMessage, roomId: string, now = Date.now()): Promise<boolean> {
  try {
    if (!message.proof || !presenceIsTimely(message, now)) return false;
    const raw = bytesOf(message.proof.publicKey);
    if (await peerIdOf(raw) !== message.from.id) return false;
    const key = await crypto.subtle.importKey('raw', raw, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, bytesOf(message.proof.signature), encoder.encode(canonicalPresence(message, roomId)));
  } catch { return false; }
}

export function presenceIsTimely(message: PresenceMessage, now: number): boolean {
  const sentAt = message.sentAt;
  return typeof sentAt === 'number' && Number.isSafeInteger(sentAt)
    && sentAt >= now - LIMITS.presenceMaxAgeMs && sentAt <= now + LIMITS.maxClockSkewMs;
}
