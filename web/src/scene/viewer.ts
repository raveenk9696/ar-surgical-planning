import { MathUtils } from 'three';
import { LIMITS } from '../config';
import type { Changes, Engine } from '../sync/engine';
import { liveCount } from '../sync/engine';
import type { NoteId, RoomState } from '../types';
import { createNoteInput } from '../ui/noteInput';
import type { NotesView } from '../ui/notesList';
import type { Roster } from '../ui/people';
import { MESSAGES, type StatusView } from '../ui/status';
import { createCursors, type Cursors } from './cursors';
import { noteFontReady } from './labels';
import { createMaterials, setSkinLevel, type Materials, type Quality } from './materials';
import { loadModel, type ModelHandle } from './model';
import { normalAt, pick, type Hit } from './pick';
import { createPins, PENDING_PIN, type Pins } from './pins';
import { createStage, type Stage } from './stage';

const TAP_PX = 4;
const TAP_MS = 300;
const SKIN_FADE_MS = 240;
const FOCUS_EASE_MS = 480;

export interface Viewer {
  readonly stage: Stage;
  readonly pins: Pins;
  readonly cursors: Cursors;
  readonly quality: Quality;
  model(): ModelHandle | null;
  materials(): Materials;
  load(url: string, onProgress: (f: number) => void): Promise<ModelHandle>;
  sync(s: RoomState, c: Changes): void;
  skinOn(): boolean;
  setSkin(on: boolean, instant?: boolean): void;
  /** Swaps material quality, keeping the skin's current fade. Used when AR starts and ends. */
  setQuality(q: Quality): void;
  arm(on: boolean): void;
  hover(id: NoteId | null): void;
  focus(id: NoteId): void;
  layout(): void;
}

export function createViewer(
  canvas: HTMLCanvasElement,
  deps: {
    engine: Engine;
    roster: Roster;
    notesView: NotesView;
    status: StatusView;
    quality: Quality;
    onDisarm(): void;
    onInteract(): void;
  },
): Viewer {
  const stage = createStage(canvas, { lite: deps.quality === 'lite' });
  const pins = createPins(stage.marks, { colorOf: deps.roster.colorOf, selfId: deps.engine.state.self.id });
  const cursors = createCursors(stage.marks);
  let model: ModelHandle | null = null;
  let materials = createMaterials(deps.quality);
  let quality: Quality = deps.quality;
  let level = 1;
  let skin = true;
  let armed = false;
  let pending: Hit | null = null;
  let down: { x: number; y: number; t: number } | null = null;
  const pointer = { x: 0, y: 0, inside: false, dirty: false, touch: false };
  let lastPick = 0;
  let hoverPin: NoteId | null = null;

  const noteInput = createNoteInput({
    onSubmit(text) {
      const at = pending;
      closePending();
      deps.onDisarm();
      if (!at) return;
      const r = deps.engine.addNote({ ...at, text });
      if (r.ok || r.why === 'empty') return;
      const s = deps.engine.state;
      deps.status.toast(r.why === 'rate' ? MESSAGES.rate : liveCount(s.notes) >= LIMITS.maxLive ? MESSAGES.roomFull : MESSAGES.ownFull);
    },
    onCancel() {
      closePending();
      deps.onDisarm();
    },
  });

  function closePending(): void {
    pending = null;
    pins.setPending(null);
  }

  function tap(e: PointerEvent): void {
    if (noteInput.isOpen || !model) return;
    if (armed) {
      const hit = pick(model, stage.rayAt(e.clientX, e.clientY), skin);
      if (!hit) return;
      pending = hit;
      pins.setPending(hit);
      noteInput.show();
      return;
    }
    const id = pins.nearest(e.clientX, e.clientY, stage.camera, canvas.getBoundingClientRect());
    if (id) {
      deps.notesView.select(id);
      pins.pulse(id);
    }
  }

  canvas.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
    deps.onInteract();
  });
  canvas.addEventListener('pointerup', (e) => {
    const d = down;
    down = null;
    if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < TAP_PX && performance.now() - d.t < TAP_MS) tap(e);
  });
  canvas.addEventListener('pointermove', (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.inside = true;
    pointer.dirty = true;
    pointer.touch = e.pointerType === 'touch';
    if (e.pointerType === 'touch') return;
    const id = pins.nearest(e.clientX, e.clientY, stage.camera, canvas.getBoundingClientRect());
    canvas.classList.toggle('over-pin', id !== null && !armed);
    if (id !== hoverPin) {
      hoverPin = id;
      pins.setHover(id);
    }
  });
  canvas.addEventListener('pointerleave', () => {
    pointer.inside = false;
    deps.engine.setPointer(null);
  });
  document.addEventListener('visibilitychange', () => deps.engine.setAway(document.hidden));

  stage.onFrame((dt, now) => {
    if (model && pointer.inside && pointer.dirty && !pointer.touch && !document.hidden && now - lastPick >= 1000 / LIMITS.presenceHz) {
      pointer.dirty = false;
      lastPick = now;
      deps.engine.setPointer(pick(model, stage.rayAt(pointer.x, pointer.y), skin)?.pos ?? null);
    }
    pins.update(dt, stage.view, now);
    cursors.update(dt, stage.view, now);
    if (pending) {
      const at = pins.screenOf(PENDING_PIN, stage.camera, canvas.getBoundingClientRect());
      if (at) noteInput.move(at.x, at.y);
    }
  });

  stage.onContext({
    lost: () => deps.status.toast('3D paused: the graphics context was lost. Restoring.', 4000),
    restored: () => pins.redrawLabels(),
  });
  void noteFontReady().then(() => pins.redrawLabels());

  function applyLevel(): void {
    setSkinLevel(materials, level);
    if (model) model.skin.visible = level > 0.001;
  }

  const viewer: Viewer = {
    stage,
    pins,
    cursors,
    get quality() {
      return quality;
    },
    model: () => model,
    materials: () => materials,
    async load(url, onProgress) {
      const m = await loadModel(url, onProgress);
      m.setMaterials(materials);
      stage.mount(m);
      model = m;
      applyLevel();
      return m;
    },
    sync(s, c) {
      if (c.notes.length) pins.sync(s.notes, c.notes);
      if (c.peers) {
        pins.recolor();
        cursors.sync(s.peers, deps.roster.colorOf, (p) => (model ? normalAt(model, p) : null), performance.now());
      }
    },
    skinOn: () => skin,
    setSkin(on, instant = false) {
      skin = on;
      const from = level;
      const to = on ? 1 : 0;
      if (instant) {
        level = to;
        applyLevel();
        return;
      }
      stage.tween(SKIN_FADE_MS, (k) => {
        level = MathUtils.lerp(from, to, k);
        applyLevel();
      });
    },
    setQuality(q) {
      if (q === quality) return;
      quality = q;
      materials = createMaterials(q);
      model?.setMaterials(materials);
      applyLevel();
    },
    arm(on) {
      armed = on;
      if (!on && noteInput.isOpen) {
        noteInput.hide();
        closePending();
      }
    },
    hover(id) {
      pins.setHover(id);
    },
    focus(id) {
      const f = pins.frame(id);
      pins.pulse(id);
      if (f) stage.faceNormal(f.nrm, FOCUS_EASE_MS);
    },
    layout() {
      const W = innerWidth;
      const H = innerHeight;
      if (matchMedia('(min-width: 960px)').matches) {
        const free = Math.max(320, (document.getElementById('rail')?.getBoundingClientRect().left ?? W) - 24);
        stage.setLayout({ cx: free / 2, cy: H * 0.54, areaW: free, areaH: H });
      } else {
        stage.setLayout({ cx: W / 2, cy: H * 0.42, areaW: W, areaH: Math.max(H * 0.5, H - 300) });
      }
    },
  };
  return viewer;
}
