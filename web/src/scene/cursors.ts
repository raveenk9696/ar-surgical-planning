import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3, type Object3D } from 'three';
import type { PeerId, Presence, Vec3 } from '../types';
import { lpsDirToRig, lpsToRig } from './coords';
import { drawPill, drawRing, placeFlat, textureSize, type View } from './labels';

const RING_PX = 22 / 0.7;
const PILL_OFFSET_PX = 12;
const LERP = 0.25;
const IDLE_FADE_MS = 3000;
const FADE_OUT_MS = 300;

interface Cursor {
  peerId: PeerId;
  name: string;
  colour: string;
  target: Vector3;
  normal: Vector3;
  current: Vector3 | null;
  movedAt: number;
  visible: boolean;
  ring: Mesh<PlaneGeometry, MeshBasicMaterial>;
  pill: Mesh<PlaneGeometry, MeshBasicMaterial>;
  opacity: number;
}

export interface Cursors {
  /** `normalOf` finds the surface normal under a pointer; remote pointers carry only a position. */
  sync(peers: ReadonlyMap<PeerId, Presence>, colorOf: (id: PeerId) => string, normalOf: (p: Vec3) => Vec3 | null, nowMs: number): void;
  update(dt: number, v: View, nowMs: number): void;
  dispose(): void;
}

const Z = new Vector3(0, 0, 1);

export function createCursors(marks: Object3D): Cursors {
  const ringGeo = new PlaneGeometry(1, 1);
  const pillGeo = new PlaneGeometry(1, 1).translate(0.5, -0.5, 0);
  const cursors = new Map<PeerId, Cursor>();
  const tmp = new Vector3();
  const right = new Vector3();
  const down = new Vector3();

  function material(map: CanvasTexture): MeshBasicMaterial {
    return new MeshBasicMaterial({ map, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
  }

  function create(p: Presence, colour: string): Cursor {
    const ring = new Mesh(ringGeo, material(drawRing(colour)));
    const pill = new Mesh(pillGeo, material(drawPill(p.peer.name, colour)));
    ring.renderOrder = 12;
    pill.renderOrder = 13;
    marks.add(ring, pill);
    return { peerId: p.peer.id, name: p.peer.name, colour, target: new Vector3(), normal: new Vector3(0, 0, 1), current: null, movedAt: 0, visible: false, ring, pill, opacity: 0 };
  }

  function dispose(c: Cursor): void {
    for (const m of [c.ring, c.pill]) {
      m.removeFromParent();
      m.material.map?.dispose();
      m.material.dispose();
    }
  }

  return {
    sync(peers, colorOf, normalOf, nowMs) {
      for (const [id, c] of cursors) {
        if (!peers.has(id)) {
          dispose(c);
          cursors.delete(id);
        }
      }
      for (const [id, p] of peers) {
        const colour = colorOf(id);
        let c = cursors.get(id);
        if (c && (c.colour !== colour || c.name !== p.peer.name)) {
          dispose(c);
          c = undefined;
        }
        c ??= create(p, colour);
        cursors.set(id, c);
        if (p.ptr && !p.away) {
          lpsToRig(p.ptr, tmp);
          if (!c.visible || !tmp.equals(c.target)) c.movedAt = nowMs;
          c.target.copy(tmp);
          const n = normalOf(p.ptr);
          if (n) c.normal.copy(lpsDirToRig(n));
          c.current ??= c.target.clone();
          c.visible = true;
        } else {
          c.visible = false;
        }
      }
    },
    update(dt, v, nowMs) {
      marks.updateWorldMatrix(true, false);
      for (const c of cursors.values()) {
        const idle = nowMs - c.movedAt;
        const want = c.visible && idle < IDLE_FADE_MS + FADE_OUT_MS ? Math.min(1, (IDLE_FADE_MS + FADE_OUT_MS - idle) / FADE_OUT_MS) : 0;
        c.opacity += (want - c.opacity) * Math.min(1, dt / 0.08);
        const show = c.opacity > 0.01 && c.current !== null;
        c.ring.visible = c.pill.visible = show;
        if (!show || !c.current) continue;
        c.current.lerp(c.target, LERP);
        const world = tmp.copy(c.current).applyMatrix4(marks.matrixWorld);
        c.ring.position.copy(c.current);
        placeFlat(c.ring, world, RING_PX, 1, 0.014, v);
        c.ring.quaternion.setFromUnitVectors(Z, c.normal);
        c.ring.material.opacity = c.pill.material.opacity = c.opacity;

        const size = textureSize(c.pill.material.map as CanvasTexture);
        placeFlat(c.pill, world, size.h, size.w / size.h, 0.012, v);
        const perPx = v.xr ? 0.012 / size.h / v.parentScale : (v.tanFov2 / v.viewH) * v.camPos.distanceTo(world) / v.parentScale;
        right.set(1, 0, 0).applyQuaternion(v.camQuat).applyQuaternion(v.parentQuatInv);
        down.set(0, -1, 0).applyQuaternion(v.camQuat).applyQuaternion(v.parentQuatInv);
        c.pill.position.copy(c.current).addScaledVector(right, PILL_OFFSET_PX * perPx).addScaledVector(down, PILL_OFFSET_PX * perPx);
      }
    },
    dispose() {
      for (const c of cursors.values()) dispose(c);
      cursors.clear();
      ringGeo.dispose();
      pillGeo.dispose();
    },
  };
}
