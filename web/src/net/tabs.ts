import type { Wire } from '../types';
import { createSignal, type StatusUpdate, type Transport } from './transport';

export function createTabsTransport(roomId: string, o: { enabled?: boolean } = {}): Transport {
  const message = createSignal<[unknown]>();
  const status = createSignal<[StatusUpdate]>();
  const join = createSignal<[]>();
  let channel: BroadcastChannel | null = null;

  return {
    send(w: Wire) {
      channel?.postMessage(w);
    },
    onMessage: message.on,
    onStatus: status.on,
    onPeerJoin: join.on,
    open() {
      if (channel) return;
      if (o.enabled === false) {
        status.emit({ tabs: 'off' });
      } else if (typeof BroadcastChannel === 'undefined') {
        status.emit({ tabs: 'unavailable' });
      } else {
        channel = new BroadcastChannel(`asp:${roomId}`);
        channel.onmessage = (e: MessageEvent<unknown>) => message.emit(e.data);
        status.emit({ tabs: 'ok' });
      }
    },
    close() {
      channel?.close();
      channel = null;
      status.emit({ tabs: 'off' });
    },
  };
}
