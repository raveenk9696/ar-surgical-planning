import { createSignal, type Link, type StatusUpdate, type Transport } from './transport';

/** Fans a send out to every transport and merges what they receive. Accepts a transport after open(). */
export function createMulti(first: Transport): Transport & { add(t: Transport): void } {
  const message = createSignal<[unknown, Link]>();
  const status = createSignal<[StatusUpdate]>();
  const join = createSignal<[]>();
  const all: Transport[] = [];
  let opened = false;

  const attach = (t: Transport): void => {
    all.push(t);
    t.onMessage((raw, link) => message.emit(raw, link));
    t.onStatus((s) => status.emit(s));
    t.onPeerJoin(() => join.emit());
    if (opened) t.open();
  };
  attach(first);

  return {
    send(w) {
      for (const t of all) t.send(w);
    },
    onMessage: message.on,
    onStatus: status.on,
    onPeerJoin: join.on,
    open() {
      opened = true;
      for (const t of all) t.open();
    },
    close() {
      opened = false;
      for (const t of all) t.close();
    },
    add: attach,
  };
}
