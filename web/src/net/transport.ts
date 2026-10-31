import type { LinkStatus, Wire } from '../types';

export type StatusUpdate = Partial<LinkStatus> & { peers?: number };

export interface Transport {
  send(w: Wire): void;
  onMessage(fn: (raw: unknown) => void): () => void;
  onStatus(fn: (s: StatusUpdate) => void): () => void;
  onPeerJoin(fn: () => void): () => void;
  open(): void;
  close(): void;
}

/** A small typed listener set shared by the transports. */
export function createSignal<A extends unknown[]>(): { on(fn: (...a: A) => void): () => void; emit(...a: A): void } {
  const fns = new Set<(...a: A) => void>();
  return {
    on(fn) {
      fns.add(fn);
      return () => void fns.delete(fn);
    },
    emit(...a) {
      for (const fn of [...fns]) fn(...a);
    },
  };
}
