import type { Peer, Note, Deletion } from '../types';

export interface Identity { peer: Peer; publicKey: string; privateKey: CryptoKey }
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const encoder = new TextEncoder();
export const canonicalNote = (n: Note): string => JSON.stringify([n.id, n.pos, n.nrm, n.mesh, n.author.id, n.author.name, n.created, n.text]);
export const base64url = (bytes: ArrayBuffer): string => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const bytesOf = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));

export async function peerIdOf(raw: Uint8Array<ArrayBuffer>): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', raw));
  let id = '';
  for (let bit = 0; bit < 40; bit += 5) {
    const byte = bit >> 3;
    const value = ((hash[byte] ?? 0) << 8) | (hash[byte + 1] ?? 0);
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

export async function signNote(n: Note, identity: Identity): Promise<Note> {
  return { ...n, publicKey: identity.publicKey, signature: await sign(canonicalNote(n), identity) };
}

export async function signDeletion(id: string, identity: Identity): Promise<Deletion> {
  return { id, signature: await sign(JSON.stringify(['del', id]), identity) };
}

export async function verifyNote(n: Note): Promise<boolean> {
  try {
    const raw = bytesOf(n.publicKey);
    if (await peerIdOf(raw) !== n.author.id || n.id.split('.')[0] !== n.author.id) return false;
    const key = await crypto.subtle.importKey('raw', raw, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const verify = (value: string, sig: string): Promise<boolean> => crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, bytesOf(sig), encoder.encode(value));
    if (!await verify(canonicalNote(n), n.signature)) return false;
    return !n.deleted || !!n.deletion && n.deletion.id === n.id && await verify(JSON.stringify(['del', n.id]), n.deletion.signature);
  } catch { return false; }
}
