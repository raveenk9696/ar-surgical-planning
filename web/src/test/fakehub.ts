import { createSignal, type StatusUpdate, type Transport } from '../net/transport';
import type { Wire } from '../types';

export interface FakeEnd extends Transport {
  readonly name: string;
  /** Delivers a raw value as if a remote peer had sent it. */
  inject(raw: unknown): void;
  setStatus(s: StatusUpdate): void;
  join(): void;
  readonly sent: Wire[];
}

/** In-memory network. Delivery runs on setTimeout, so tests control it with fake timers. */
export class FakeHub {
  delayMs: (from: string, to: string) => number = () => 1;
  duplicate = false;
  dropEvery = 0;
  private readonly ends = new Map<string, FakeEnd>();
  private readonly cuts = new Set<string>();
  private count = 0;

  end(name: string): FakeEnd {
    const message = createSignal<[unknown]>();
    const status = createSignal<[StatusUpdate]>();
    const join = createSignal<[]>();
    const sent: Wire[] = [];
    let open = false;
    const end: FakeEnd = {
      name,
      sent,
      send: (w) => {
        sent.push(w);
        if (open) this.deliver(name, w);
      },
      onMessage: message.on,
      onStatus: status.on,
      onPeerJoin: join.on,
      open: () => {
        open = true;
        status.emit({ tabs: 'ok' });
      },
      close: () => {
        open = false;
      },
      inject: (raw) => message.emit(raw),
      setStatus: (s) => status.emit(s),
      join: () => join.emit(),
    };
    this.ends.set(name, end);
    return end;
  }

  cut(a: string, b: string): void {
    this.cuts.add(`${a}>${b}`);
    this.cuts.add(`${b}>${a}`);
  }

  heal(): void {
    this.cuts.clear();
  }

  private deliver(from: string, w: Wire): void {
    for (const [to, end] of this.ends) {
      if (to === from || this.cuts.has(`${from}>${to}`)) continue;
      if (this.dropEvery && ++this.count % this.dropEvery === 0) continue;
      const copies = this.duplicate ? 2 : 1;
      for (let i = 0; i < copies; i++) {
        setTimeout(() => end.inject(structuredClone(w)), this.delayMs(from, to) + i);
      }
    }
  }
}
