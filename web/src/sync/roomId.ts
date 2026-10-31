const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOKEN = /^#r=([A-Z2-7]{20})$/;
const ROOM_CHARS = 10;

export function readToken(hash: string): string | null {
  return TOKEN.exec(hash)?.[1] ?? null;
}

export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  let t = '';
  for (const b of bytes) t += ALPHABET[b & 31];
  return t;
}

/** The first half is the room topic that relays see hashed. The second half is the Trystero password and never leaves the browser. */
export function split(t: string): { roomId: string; secret: string } {
  return { roomId: t.slice(0, ROOM_CHARS), secret: t.slice(ROOM_CHARS) };
}

export function shareUrl(token: string, loc: Pick<Location, 'origin' | 'pathname'>): string {
  return `${loc.origin}${loc.pathname}#r=${token}`;
}
