import type { JsonValue } from '@trystero-p2p/nostr';
import { APP_ID, RELAYS } from '../config';
import { split } from '../sync/roomId';
import type { Wire } from '../types';
import { createSignal, type StatusUpdate, type Transport } from './transport';

const POLL_MS = 1000;
const DOWN_AFTER_MS = 8000;
const OPEN = 1;

/** Other devices, over WebRTC with public Nostr relays as the signalling channel. This module is only ever dynamic-imported. */
export async function createNostrTransport(token: string, relays: readonly string[] = RELAYS): Promise<Transport> {
  const message = createSignal<[unknown]>();
  const status = createSignal<[StatusUpdate]>();
  const join = createSignal<[]>();
  const lib = await import('@trystero-p2p/nostr').catch(() => null);
  if (!lib) {
    return {
      send: () => undefined,
      onMessage: message.on,
      onStatus: status.on,
      onPeerJoin: join.on,
      open: () => status.emit({ net: 'down' }),
      close: () => undefined,
    };
  }
  const { joinRoom, getRelaySockets } = lib;
  const { roomId, secret } = split(token);
  const peers = new Set<string>();
  let room: ReturnType<typeof joinRoom> | null = null;
  let send: ((w: Wire) => void) | null = null;
  let poll: ReturnType<typeof setInterval> | undefined;
  let net: StatusUpdate['net'] = 'off';

  const setNet = (next: NonNullable<StatusUpdate['net']>): void => {
    if (net === next) return;
    net = next;
    status.emit({ net: next });
  };

  const anySocketOpen = (): boolean => {
    const sockets: Record<string, WebSocket> = getRelaySockets();
    return Object.values(sockets).some((s) => s.readyState === OPEN);
  };

  return {
    send(w) {
      if (peers.size > 0) send?.(w);
    },
    onMessage: message.on,
    onStatus: status.on,
    onPeerJoin: join.on,
    open() {
      if (room) return;
      const startedAt = Date.now();
      setNet('connecting');
      room = joinRoom(
        { appId: APP_ID, password: secret, relayConfig: { urls: [...relays] } },
        roomId,
        { onJoinError: () => setNet('blocked') },
      );
      const action = room.makeAction<JsonValue>('asp');
      send = (w) => void action.send(w as unknown as JsonValue).catch(() => undefined);
      action.onMessage = (data) => message.emit(data);
      room.onPeerJoin = (id) => {
        peers.add(id);
        status.emit({ peers: peers.size });
        join.emit();
      };
      room.onPeerLeave = (id) => {
        peers.delete(id);
        status.emit({ peers: peers.size });
      };
      poll = setInterval(() => {
        if (net === 'blocked') return;
        if (anySocketOpen()) setNet('ok');
        else if (net === 'ok' || Date.now() - startedAt >= DOWN_AFTER_MS) setNet('down');
      }, POLL_MS);
    },
    close() {
      clearInterval(poll);
      void room?.leave();
      room = null;
      send = null;
      peers.clear();
      net = 'off';
      status.emit({ net: 'off', peers: 0 });
    },
  };
}
