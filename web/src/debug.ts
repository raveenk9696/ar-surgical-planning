import type { Viewer } from './scene/viewer';
import type { Engine } from './sync/engine';
import type { RoomState } from './types';

export interface Flags {
  debug: boolean;
  /** only honoured together with debug */
  relays: string[] | null;
  transport: 'tabs' | 'net' | null;
  quality: 'lite' | 'full' | null;
  hero: 'model' | 'together' | null;
}

export function parseFlags(search: string): Flags {
  const q = new URLSearchParams(search);
  const debug = import.meta.env.DEV && q.get('debug') === '1';
  const relays = (q.get('relays') ?? '').split(',').map((r) => r.trim()).filter((r) => /^wss:\/\/[^\s]+$/.test(r));
  const transport = q.get('transport');
  const quality = q.get('quality');
  const hero = q.get('hero');
  return {
    debug,
    relays: debug && relays.length ? relays : null,
    transport: transport === 'tabs' || transport === 'net' ? transport : null,
    quality: quality === 'lite' || quality === 'full' ? quality : null,
    hero: hero === 'model' || hero === 'together' ? hero : null,
  };
}

declare global {
  interface Window {
    __asp?: { engine: Engine; state: () => RoomState; viewer?: Viewer };
  }
}

export function exposeDebug(engine: Engine, viewer?: Viewer): void {
  if (!import.meta.env.DEV) return;
  window.__asp = { engine, state: () => engine.state, viewer };
}
