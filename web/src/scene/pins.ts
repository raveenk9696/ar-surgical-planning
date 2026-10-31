import { Camera, CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3, type Object3D } from 'three';
import type { Note, NoteId, PeerId, Vec3 } from '../types';
import { lpsDirToRig, lpsToRig } from './coords';
import { drawNoteLabel, drawPin, noteFontReady, placeFlat, textureSize, type View } from './labels';

const PIN_PX = 16;
const PIN_PX_COARSE = 20;
const DISC_FRACTION = 0.8;
const HIT_PX = 22;
const FADED = 0.25;
const MAX_LABELS = 12;
const LABEL_EVERY_MS = 100;
const PULSE_MS = 480;
export const PENDING_PIN = '__pending__';

interface Pin {
  id: string;
  authorId: PeerId;
  text: string;
  pos: Vector3;
  nrm: Vector3;
  disc: Mesh<PlaneGeometry, MeshBasicMaterial>;
  label: Mesh<PlaneGeometry, MeshBasicMaterial> | null;
  opacity: number;
  pulse: number;
}

export interface Pins {
  sync(notes: ReadonlyMap<NoteId, Note>, changed: readonly NoteId[]): void;
  setPending(at: { pos: Vec3; nrm: Vec3 } | null): void;
  update(dt: number, v: View, nowMs: number): void;
  setHover(id: NoteId | null): void;
  pulse(id: NoteId): void;
  nearest(clientX: number, clientY: number, camera: Camera, rect: DOMRect): NoteId | null;
  screenOf(id: string, camera: Camera, rect: DOMRect): { x: number; y: number } | null;
  /** Rig-local metres and normal of a pin, for the camera to face. */
  frame(id: NoteId): { pos: Vector3; nrm: Vector3 } | null;
  recolor(): void;
  redrawLabels(): void;
  dispose(): void;
}

export function createPins(marks: Object3D, view: { colorOf(id: PeerId): string; selfId: PeerId }): Pins {
  const discGeo = new PlaneGeometry(1, 1);
  const labelGeo = new PlaneGeometry(1, 1).translate(0.5, 0.5, 0);
  const pinsById = new Map<string, Pin>();
  const discTextures = new Map<string, CanvasTexture>();
  const coarse = matchMedia('(pointer: coarse)').matches;
  const discPx = (coarse ? PIN_PX_COARSE : PIN_PX) / DISC_FRACTION;
  let hovered: string | null = null;
  let lastLabelPass = -Infinity;
  const tmp = new Vector3();
  const toCam = new Vector3();
  const nrmWorld = new Vector3();

  const discTexture = (colour: string): CanvasTexture => {
    let t = discTextures.get(colour);
    if (!t) discTextures.set(colour, (t = drawPin(colour)));
    return t;
  };

  function material(map: CanvasTexture): MeshBasicMaterial {
    return new MeshBasicMaterial({ map, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
  }

  function addPin(id: string, authorId: PeerId, text: string, pos: Vec3, nrm: Vec3): void {
    const disc = new Mesh(discGeo, material(discTexture(view.colorOf(authorId))));
    disc.renderOrder = 11;
    marks.add(disc);
    pinsById.set(id, { id, authorId, text, pos: lpsToRig(pos, new Vector3()), nrm: lpsDirToRig(nrm), disc, label: null, opacity: 1, pulse: 0 });
  }

  function dropLabel(p: Pin): void {
    if (!p.label) return;
    p.label.removeFromParent();
    p.label.material.map?.dispose();
    p.label.material.dispose();
    p.label = null;
  }

  function dropPin(p: Pin): void {
    dropLabel(p);
    p.disc.removeFromParent();
    p.disc.material.dispose();
    pinsById.delete(p.id);
  }

  function showLabel(p: Pin): void {
    if (p.label || p.id === PENDING_PIN) return;
    const label = new Mesh(labelGeo, material(drawNoteLabel(p.text)));
    label.renderOrder = 10;
    label.material.opacity = p.opacity;
    marks.add(label);
    p.label = label;
  }

  const worldOf = (p: Pin, out: Vector3): Vector3 => out.copy(p.pos).applyMatrix4(marks.matrixWorld);

  function chooseLabels(v: View): void {
    const ranked = [...pinsById.values()]
      .filter((p) => p.id !== PENDING_PIN)
      .map((p) => ({ p, d: v.camPos.distanceToSquared(worldOf(p, tmp)) }))
      .sort((a, b) => a.d - b.d);
    const keep = new Set(ranked.slice(0, MAX_LABELS).map((r) => r.p.id));
    if (hovered) keep.add(hovered);
    for (const { p } of ranked) {
      if (keep.has(p.id)) showLabel(p);
      else dropLabel(p);
    }
  }

  return {
    sync(notes, changed) {
      for (const id of changed) {
        const n = notes.get(id);
        const had = pinsById.get(id);
        if (!n || n.deleted) {
          if (had) dropPin(had);
        } else if (!had) {
          addPin(id, n.author.id, n.text, n.pos, n.nrm);
        }
      }
      lastLabelPass = -Infinity;
    },
    setPending(at) {
      const had = pinsById.get(PENDING_PIN);
      if (had) dropPin(had);
      if (at) addPin(PENDING_PIN, view.selfId, '', at.pos, at.nrm);
    },
    update(dt, v, nowMs) {
      marks.updateWorldMatrix(true, false);
      if (nowMs - lastLabelPass >= LABEL_EVERY_MS) {
        lastLabelPass = nowMs;
        chooseLabels(v);
      }
      const ease = 1 - Math.exp(-dt / 0.06);
      const camPos = v.camPos;
      for (const p of pinsById.values()) {
        const world = worldOf(p, tmp);
        nrmWorld.copy(p.nrm).transformDirection(marks.matrixWorld);
        const facing = toCam.copy(camPos).sub(world).normalize().dot(nrmWorld);
        p.opacity += ((facing < -0.1 ? FADED : 1) - p.opacity) * ease;
        p.pulse = Math.max(0, p.pulse - (dt * 1000) / PULSE_MS);
        const grow = 1 + 0.5 * Math.sin(p.pulse * Math.PI) + (hovered === p.id ? 0.12 : 0);
        p.disc.material.opacity = p.opacity;
        p.disc.position.copy(p.pos);
        placeFlat(p.disc, world, discPx * grow, 1, 0.01 * grow, v);
        if (p.label) {
          const size = textureSize(p.label.material.map as CanvasTexture);
          p.label.material.opacity = p.opacity;
          p.label.position.copy(p.pos);
          placeFlat(p.label, world, size.h * (hovered === p.id ? 1.06 : 1), size.w / size.h, 0.04, v, v.xr ? 'y' : 'full');
        }
      }
    },
    setHover(id) {
      hovered = id;
      lastLabelPass = -Infinity;
      if (id) this.pulse(id);
    },
    pulse(id) {
      const p = pinsById.get(id);
      if (p) p.pulse = 1;
    },
    nearest(clientX, clientY, camera, rect) {
      let best: { id: string; d: number } | null = null;
      for (const p of pinsById.values()) {
        if (p.id === PENDING_PIN) continue;
        const s = projectToScreen(worldOf(p, tmp), camera, rect);
        const d = Math.hypot(s.x - (clientX - rect.left), s.y - (clientY - rect.top));
        if (d < HIT_PX && (!best || d < best.d)) best = { id: p.id, d };
      }
      return best?.id ?? null;
    },
    screenOf(id, camera, rect) {
      const p = pinsById.get(id);
      return p ? projectToScreen(worldOf(p, tmp), camera, rect) : null;
    },
    frame(id) {
      const p = pinsById.get(id);
      return p ? { pos: p.pos.clone(), nrm: p.nrm.clone() } : null;
    },
    recolor() {
      for (const p of pinsById.values()) {
        p.disc.material.map = discTexture(view.colorOf(p.authorId));
        p.disc.material.needsUpdate = true;
      }
    },
    redrawLabels() {
      for (const p of pinsById.values()) dropLabel(p);
      lastLabelPass = -Infinity;
    },
    dispose() {
      for (const p of [...pinsById.values()]) dropPin(p);
      for (const t of discTextures.values()) t.dispose();
      discGeo.dispose();
      labelGeo.dispose();
    },
  };
}

export function projectToScreen(world: Vector3, camera: Camera, rect: DOMRect): { x: number; y: number } {
  const p = world.clone().project(camera);
  return { x: (p.x * 0.5 + 0.5) * rect.width, y: (-p.y * 0.5 + 0.5) * rect.height };
}

/** Labels are drawn in the handwriting font, so they are redrawn once it has loaded. */
export function whenScriptReady(pins: Pins): void {
  void noteFontReady().then(() => pins.redrawLabels());
}
