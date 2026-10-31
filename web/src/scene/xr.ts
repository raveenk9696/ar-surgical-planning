import {
  CircleGeometry,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Raycaster,
  RingGeometry,
  Vector3,
} from 'three';
import { PRESETS } from '../config';
import type { Engine } from '../sync/engine';
import { byId, h, setLabel } from '../ui/dom';
import { placeInFront, yawToward } from './coords';
import type { ModelHandle } from './model';
import { pick } from './pick';
import type { Stage } from './stage';
import type { Viewer } from './viewer';
import { createXrPanel, type PanelId, type XrPanel } from './xrpanel';

const SIZES: readonly number[] = [0.25, 0.5, 1];
const RISE_MS = 240;
const POINTER_MS = 1000 / 15;
const AHEAD_M = 1.2;
const AHEAD_TOAST = 'Placing the model 1.2 m ahead';
const BLUE = 0x2563eb;

export interface ArUi {
  viewer: Viewer;
  overlay: HTMLElement;
  toast(text: string): void;
  onActive(active: boolean): void;
}

export interface Ar {
  supported(): Promise<boolean>;
  start(): Promise<void>;
}

type Phase = 'placing' | 'placed';

export async function referenceSpaceType(session: Pick<XRSession, 'requestReferenceSpace'>): Promise<XRReferenceSpaceType> {
  try {
    await session.requestReferenceSpace('local-floor');
    return 'local-floor';
  } catch {
    await session.requestReferenceSpace('local');
    return 'local';
  }
}

function reticle(): Group {
  const g = new Group();
  const ring = new Mesh(new RingGeometry(0.1, 0.12, 48), new MeshBasicMaterial({ color: BLUE, transparent: true, opacity: 0.9, side: DoubleSide, toneMapped: false }));
  const dot = new Mesh(new CircleGeometry(0.012, 24), new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide, toneMapped: false }));
  g.add(ring, dot);
  g.rotation.x = -Math.PI / 2;
  const holder = new Group();
  holder.add(g);
  holder.matrixAutoUpdate = false;
  holder.visible = false;
  return holder;
}

export function setupAr(stage: Stage, model: ModelHandle, engine: Engine, ui: ArUi): Ar {
  const xr = navigator.xr;
  const ray = new Raycaster();
  const shown = reticle();
  let session: XRSession | null = null;
  let phase: Phase = 'placing';
  let hitSource: XRHitTestSource | undefined;
  let hasHit = false;
  let noHitTest = false;
  let size = 0.5;
  let baseY = 0;
  let preset = 0;
  let panel: XrPanel | null = null;
  let lastPointer = 0;
  let breathe = 0;
  let restoreQuality = ui.viewer.quality;
  let off: Array<() => void> = [];

  const chips = {
    skin: byId('ar-skin'),
    move: byId('ar-move'),
    size: byId('ar-size'),
    exit: byId('ar-exit'),
  };
  const presetBar = byId('ar-presets');
  const presetChips = PRESETS.map((p, i) => {
    const b = h('button', { class: 'chip', attrs: { type: 'button', 'aria-pressed': String(i === preset) } }, h('span', { class: 'label', text: p }));
    b.addEventListener('click', () => choosePreset(i));
    presetBar.append(b);
    return b;
  });
  ui.overlay.addEventListener('beforexrselect', (e) => e.preventDefault());

  function choosePreset(i: number): void {
    preset = i % PRESETS.length;
    presetChips.forEach((b, n) => b.setAttribute('aria-pressed', String(n === preset)));
    panel?.setLabel('note', PRESETS[preset] ?? '', true);
  }

  function placeStage(): void {
    stage.stage.scale.setScalar(size);
    stage.stage.position.y = baseY + (model.heightM / 2) * size;
    panel?.place(size, model.widthM);
  }

  function viewerMatrix(f: XRFrame, refSpace: XRReferenceSpace): Matrix4 {
    const pose = f.getViewerPose(refSpace);
    return pose ? new Matrix4().fromArray(pose.transform.matrix) : new Matrix4().copy(stage.renderer.xr.getCamera().matrixWorld);
  }

  function place(at: Vector3, yaw: number): void {
    baseY = at.y;
    stage.stage.position.set(at.x, baseY, at.z);
    stage.stage.rotation.set(0, yaw, 0);
    stage.stage.scale.setScalar(size);
    stage.stage.visible = true;
    stage.tween(RISE_MS, (k) => {
      stage.stage.position.y = baseY + (model.heightM / 2) * size - (1 - k) * 0.06;
    });
    phase = 'placed';
    shown.visible = false;
    hitSource?.cancel();
    hitSource = undefined;
    panel?.place(size, model.widthM);
  }

  async function startHitTest(): Promise<void> {
    if (!session || noHitTest) return;
    try {
      const viewerSpace = await session.requestReferenceSpace('viewer');
      hitSource = await session.requestHitTestSource?.({ space: viewerSpace });
      if (!hitSource) noHitTest = true;
    } catch {
      noHitTest = true;
    }
  }

  function startPlacing(): void {
    phase = 'placing';
    hasHit = false;
    void startHitTest();
  }

  function onSelect(e: XRInputSourceEvent): void {
    const frame = e.frame;
    const refSpace = stage.renderer.xr.getReferenceSpace();
    if (!refSpace) return;
    if (phase === 'placing') {
      const head = viewerMatrix(frame, refSpace);
      const eye = new Vector3().setFromMatrixPosition(head);
      if (hasHit && !noHitTest) {
        const at = new Vector3().setFromMatrixPosition(shown.matrix);
        place(at, yawToward(at, eye));
      } else {
        const m = placeInFront(head, AHEAD_M);
        const at = new Vector3().setFromMatrixPosition(m);
        const yaw = yawToward(at, eye);
        place(new Vector3(at.x, at.y - (model.heightM / 2) * size, at.z), yaw);
        ui.toast(AHEAD_TOAST);
      }
      return;
    }
    if (!setRay(frame, e.inputSource, refSpace)) return;
    stage.stage.updateMatrixWorld(true);
    const control = panel?.hit(ray);
    if (control) {
      act(control);
      return;
    }
    const hit = pick(model, ray, ui.viewer.skinOn());
    if (hit) engine.addNote({ ...hit, text: PRESETS[preset] ?? PRESETS[0] });
  }

  function setRay(frame: XRFrame, source: XRInputSource, refSpace: XRReferenceSpace): boolean {
    const pose = frame.getPose(source.targetRaySpace, refSpace);
    if (!pose) return false;
    const { position, orientation } = pose.transform;
    ray.set(new Vector3(position.x, position.y, position.z), new Vector3(0, 0, -1).applyQuaternion(new Quaternion(orientation.x, orientation.y, orientation.z, orientation.w)));
    return true;
  }

  function act(id: PanelId): void {
    if (id === 'skin') {
      ui.viewer.setSkin(!ui.viewer.skinOn());
      syncChips();
    } else if (id === 'size') {
      size = SIZES[(SIZES.indexOf(size) + 1) % SIZES.length] ?? 0.5;
      placeStage();
      syncChips();
    } else if (id === 'move') {
      startPlacing();
    } else if (id === 'note') {
      choosePreset(preset + 1);
    } else {
      void session?.end();
    }
  }

  function syncChips(): void {
    const on = ui.viewer.skinOn();
    chips.skin.setAttribute('aria-checked', String(on));
    setLabel(chips.skin, on ? 'Skin on' : 'Skin off');
    setLabel(chips.size, `Size ${size === 1 ? 'life' : `${size}x`}`);
    panel?.setLabel('skin', on ? 'Skin on' : 'Skin off', on);
    panel?.setLabel('size', `Size ${size === 1 ? 'life' : `${size}x`}`);
    panel?.setLabel('move', 'Move model');
    panel?.setLabel('note', PRESETS[preset] ?? '', true);
    panel?.setLabel('exit', 'Exit');
  }

  chips.skin.addEventListener('click', () => act('skin'));
  chips.size.addEventListener('click', () => act('size'));
  chips.move.addEventListener('click', () => act('move'));
  chips.exit.addEventListener('click', () => act('exit'));

  function frame(dt: number, now: number, f: XRFrame | undefined): void {
    if (!session || !f) return;
    const refSpace = stage.renderer.xr.getReferenceSpace();
    if (!refSpace) return;
    if (phase === 'placing' && hitSource) {
      const pose = f.getHitTestResults(hitSource)[0]?.getPose(refSpace);
      hasHit = !!pose;
      shown.visible = hasHit;
      if (pose) shown.matrix.fromArray(pose.transform.matrix);
      breathe += dt;
      const k = 1 + 0.08 * (0.5 - 0.5 * Math.cos((breathe / 1.2) * Math.PI * 2));
      shown.children[0]?.scale.setScalar(k);
    }
    if (phase === 'placed' && now - lastPointer >= POINTER_MS) {
      lastPointer = now;
      const source = Array.from(session.inputSources).find((s) => s.targetRaySpace);
      if (source && setRay(f, source, refSpace)) {
        stage.stage.updateMatrixWorld(true);
        engine.setPointer(pick(model, ray, ui.viewer.skinOn())?.pos ?? null);
      }
    }
  }

  async function begin(s: XRSession): Promise<void> {
    session = s;
    restoreQuality = ui.viewer.quality;
    const renderer = stage.renderer;
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType(await referenceSpaceType(s));
    ui.viewer.setQuality('lite');
    stage.setXr(true);
    stage.stage.visible = false;
    stage.scene.add(shown);
    const domOverlay = !!s.domOverlayState;
    if (!domOverlay) panel = createXrPanel(stage.stage);
    document.body.classList.add('in-ar');
    ui.overlay.hidden = !domOverlay;
    ui.overlay.style.visibility = '';
    ui.onActive(true);
    syncChips();
    off = [stage.onFrame(frame)];
    s.addEventListener('select', onSelect);
    s.addEventListener('end', finish, { once: true });
    await renderer.xr.setSession(s);
    startPlacing();
  }

  function finish(): void {
    for (const fn of off) fn();
    off = [];
    hitSource?.cancel();
    hitSource = undefined;
    panel?.dispose();
    panel = null;
    shown.removeFromParent();
    session = null;
    noHitTest = false;
    stage.renderer.xr.enabled = false;
    stage.stage.visible = true;
    stage.setXr(false);
    ui.viewer.setQuality(restoreQuality);
    engine.setPointer(null);
    ui.overlay.hidden = true;
    ui.overlay.style.visibility = '';
    document.body.classList.remove('in-ar');
    ui.onActive(false);
  }

  return {
    async supported() {
      try {
        return !!xr && (await xr.isSessionSupported('immersive-ar'));
      } catch {
        return false;
      }
    },
    async start() {
      if (!xr || session) return;
      // Browsers want the overlay root rendered when the session is requested.
      ui.overlay.hidden = false;
      ui.overlay.style.visibility = 'hidden';
      try {
        const s = await xr.requestSession('immersive-ar', {
          optionalFeatures: ['local-floor', 'hit-test', 'dom-overlay'],
          domOverlay: { root: ui.overlay },
        });
        await begin(s);
      } catch {
        ui.toast('AR could not start on this device.');
        finish();
      }
    },
  };
}
