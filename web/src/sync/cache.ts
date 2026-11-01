import { LIMITS } from '../config';
import type { Note } from '../types';
import { decode, verifyWire } from './wire';

const KEY = 'asp:v2:';
// decode() wants a sender id; a cached snapshot has no real sender.
const LOCAL = 'AAAAAAAAAAAAAAAAAAAAAAAAAA';

export async function loadCache(roomId: string, s: Pick<Storage, 'getItem'>, now: number): Promise<Note[]> {
  try {
    const raw = s.getItem(KEY + roomId);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return [];
    const { savedAt, notes } = parsed as { savedAt?: unknown; notes?: unknown };
    if (typeof savedAt !== 'number' || !Number.isFinite(savedAt)) return [];
    if (now - savedAt > LIMITS.cacheTtlMs || savedAt > now + LIMITS.cacheTtlMs) return [];
    const wire = decode({ v: 2, k: 'snapshot', from: LOCAL, notes }, now);
    if (!wire) return [];
    const verified = await verifyWire(wire, roomId);
    return verified.k === 'snapshot' ? verified.notes : [];
  } catch {
    return [];
  }
}

export function saveCache(roomId: string, notes: Note[], s: Pick<Storage, 'setItem'>, now: number): void {
  try {
    s.setItem(KEY + roomId, JSON.stringify({ savedAt: now, notes }));
  } catch {
    // Storage can be blocked or full. Notes still sync; they just are not kept.
  }
}

export function sweepExpiredCaches(storage: Storage, now: number): void {
  try {
    for (let i = storage.length - 1; i >= 0; i--) {
      const key = storage.key(i);
      if (!key?.startsWith('asp:')) continue;
      let savedAt: unknown;
      try {
        const parsed: unknown = JSON.parse(storage.getItem(key) ?? 'null');
        if (typeof parsed === 'object' && parsed !== null && 'savedAt' in parsed) savedAt = parsed.savedAt;
      } catch {
        continue;
      }
      if (typeof savedAt === 'number' && Number.isFinite(savedAt) && now - savedAt > LIMITS.cacheTtlMs) storage.removeItem(key);
    }
  } catch {
    // Storage can be blocked; the room can still open without a cache.
  }
}
