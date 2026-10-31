import type { Peer } from '../types';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function newPeer(): Peer {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  let id = '';
  for (let i = 0; i < 8; i++) id += ALPHABET[(bytes[i] ?? 0) & 31];
  return { id, name: `Guest ${2 + ((bytes[8] ?? 0) % 98)}` };
}
