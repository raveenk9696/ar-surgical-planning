import { LIMITS } from '../config';
import type { Note } from '../types';
import { decode } from './wire';

const KEY = 'asp:v1:';
// decode() wants a sender id; a cached snapshot has no real sender.
const LOCAL = 'AAAAAAAA';

export function loadCache(roomId: string, s: Pick<Storage, 'getItem'>, now: number): Note[] {
  try {
    const raw = s.getItem(KEY + roomId);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return [];
    const { savedAt, notes } = parsed as { savedAt?: unknown; notes?: unknown };
    if (typeof savedAt !== 'number' || !Number.isFinite(savedAt)) return [];
    if (now - savedAt > LIMITS.cacheTtlMs || savedAt > now + LIMITS.cacheTtlMs) return [];
    const wire = decode({ v: 1, k: 'snapshot', from: LOCAL, notes });
    return wire?.k === 'snapshot' ? wire.notes : [];
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
