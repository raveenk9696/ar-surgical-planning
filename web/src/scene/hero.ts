import { Raycaster, Vector3 } from 'three';
import { createSignal, type StatusUpdate, type Transport } from '../net/transport';
import type { Engine } from '../sync/engine';
import type { Hit } from './pick';
import { pick } from './pick';
import type { ModelHandle } from './model';
import type { Viewer } from './viewer';
import type { Note, Peer, Vec3, Wire } from '../types';

export type HeroMode = 'model' | 'together';

const GUEST: Peer = { id: 'GUESTTWO', name: 'Guest 2' };
// Anatomy points as LPS millimetres on the front of the scan. The probe finds the bone surface under each.
const LEFT_HIP = { x: 95, z: -405 };
const RIGHT_ILIAC = { x: -85, z: -300 };
const POINTER = { x: -35, z: -330 };

/** A transport with no network. In hero mode the page talks only to a made-up second person. */
export function createHeroTransport(): Transport & { inject(w: Wire): void } {
  const message = createSignal<[unknown]>();
  const status = createSignal<[StatusUpdate]>();
  const join = createSignal<[]>();
  return {
    send: () => undefined,
    onMessage: message.on,
    onStatus: status.on,
    onPeerJoin: join.on,
    open: () => status.emit({ tabs: 'off', net: 'off' }),
    close: () => undefined,
    inject: (w) => message.emit(structuredClone(w)),
  };
}

/** The bone point on the front of the patient at LPS (x, z). */
export function probeFront(model: ModelHandle, x: number, z: number): Hit | null {
  const m = model.root.matrixWorld;
  const origin = new Vector3(x, model.bbox.min.y - 100, z).applyMatrix4(m);
  const dir = new Vector3(0, 1, 0).transformDirection(m);
  return pick(model, new Raycaster(origin, dir), false);
}

function noteAt(id: string, text: string, hit: Hit, author: Peer): Note {
  return { id, pos: hit.pos, nrm: hit.nrm, mesh: hit.mesh, text, author, created: Date.now(), deleted: false };
}

/** Frames the model for the README renders. Returns false if the anatomy points are not on the scan. */
export function applyHero(mode: HeroMode, h: { viewer: Viewer; engine: Engine; transport: Pick<Transport & { inject(w: Wire): void }, 'inject'>; model: ModelHandle }): boolean {
  const { viewer, engine, transport, model } = h;
  document.body.classList.add(`hero-${mode}`);
  if (mode === 'model') {
    viewer.stage.setView(28, 10);
    const hit = probeFront(model, LEFT_HIP.x, LEFT_HIP.z);
    if (hit) engine.addNote({ ...hit, text: 'left hip' });
    return !!hit;
  }
  viewer.setSkin(false, true);
  viewer.stage.setView(0, 4, 1.35, -0.07);
  const pin = probeFront(model, RIGHT_ILIAC.x, RIGHT_ILIAC.z);
  const ptr = probeFront(model, POINTER.x, POINTER.z);
  if (!pin || !ptr) return false;
  const presence = (jitter: number): Wire => ({
    v: 1,
    k: 'presence',
    from: GUEST,
    seq: Math.floor(performance.now()),
    ptr: [ptr.pos[0] + jitter, ptr.pos[1], ptr.pos[2]] as Vec3,
    away: false,
    digest: { n: 1, h: 0 },
  });
  transport.inject({ v: 1, k: 'note', from: GUEST.id, note: noteAt('GUESTTWO.1', 'look here', pin, GUEST) });
  // The pointer fades after 3 s without movement, so it nudges a hair every second to stay on screen for the capture.
  let flip = 1;
  transport.inject(presence(0));
  setInterval(() => transport.inject(presence((flip *= -1) * 0.2)), 1000);
  return true;
}
