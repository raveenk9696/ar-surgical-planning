import {
  CanvasTexture,
  DirectionalLight,
  Euler,
  Group,
  HemisphereLight,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  NeutralToneMapping,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Quaternion,
  Raycaster,
  Scene,
  Spherical,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Texture,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CAMERA_FOV_DEG, fitDistance, homePosition, lpsToRig, patientMatrix } from './coords';
import { createView, type View } from './labels';
import type { ModelHandle } from './model';

type FrameCb = (dt: number, nowMs: number, frame: XRFrame | undefined) => void;

export interface Layout {
  /** where the model's centre should appear, CSS px inside the canvas */
  cx: number;
  cy: number;
  /** the part of the canvas free of panels */
  areaW: number;
  areaH: number;
}

export interface Stage {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;
  /** AR pose and scale. Identity on the 2D page. */
  readonly stage: Group;
  readonly rig: Group;
  readonly patient: Group;
  readonly marks: Group;
  readonly view: View;
  readonly firstFrame: Promise<void>;
  readonly xrActive: boolean;
  mount(model: ModelHandle): void;
  setLayout(l: Layout): void;
  resetView(animate?: boolean): void;
  setView(azimuthDeg: number, elevationDeg: number): void;
  /** Turns the camera around the model to look at a surface with this rig-space normal. */
  faceNormal(nrm: Vector3, ms?: number): void;
  rayAt(clientX: number, clientY: number): Raycaster;
  onFrame(cb: FrameCb): () => void;
  tween(ms: number, step: (k: number) => void, done?: () => void): void;
  setXr(on: boolean): void;
  stopAutoRotate(): void;
  onContext(handlers: { lost(): void; restored(): void }): void;
  dispose(): void;
}

const reducedMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeOut = (k: number): number => 1 - (1 - k) ** 3;
const AUTO_ROTATE_MS = 5000;

function shadowTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(11,31,58,0.10)');
    g.addColorStop(0.55, 'rgba(11,31,58,0.05)');
    g.addColorStop(1, 'rgba(11,31,58,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export function createStage(canvas: HTMLCanvasElement, o: { lite: boolean }): Stage {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0xffffff, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NeutralToneMapping;
  renderer.setPixelRatio(Math.min(devicePixelRatio, o.lite ? 1.5 : 2));

  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  const buildEnvironment = (): Texture => pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = buildEnvironment();
  scene.environmentIntensity = 0.85;

  const camera = new PerspectiveCamera(CAMERA_FOV_DEG, 1, 0.05, 20);
  const stage = new Group();
  const rig = new Group();
  const patient = new Group();
  const marks = new Group();
  patient.matrixAutoUpdate = false;
  patient.matrix.copy(patientMatrix);
  rig.add(patient, marks);
  stage.add(rig);
  scene.add(stage, camera);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minPolarAngle = MathUtils.degToRad(20);
  controls.maxPolarAngle = MathUtils.degToRad(160);
  controls.autoRotate = !reducedMotion();
  controls.autoRotateSpeed = 1;

  const view = createView();
  const raycaster = new Raycaster();
  const frameCbs = new Set<FrameCb>();
  const tweens: Array<{ start: number; ms: number; step: (k: number) => void; done?: () => void }> = [];
  const lights: Group = new Group();
  let shadow: Mesh<PlaneGeometry, MeshBasicMaterial> | null = null;
  const shadowMap = shadowTexture();
  let model: ModelHandle | null = null;
  let layout: Layout | null = null;
  let homeDistance = 1.35;
  let moved = false;
  let xrActive = false;
  let firstFrameDone = false;
  let resolveFirst: () => void = () => undefined;
  const firstFrame = new Promise<void>((r) => (resolveFirst = r));
  const startedAt = performance.now();

  function size(): { w: number; h: number } {
    return { w: canvas.clientWidth || window.innerWidth, h: canvas.clientHeight || window.innerHeight };
  }

  function applyLayout(): void {
    const { w, h } = size();
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    if (xrActive) {
      camera.clearViewOffset();
      return;
    }
    const l = layout ?? { cx: w / 2, cy: h / 2, areaW: w, areaH: h };
    camera.setViewOffset(w, h, w / 2 - l.cx, h / 2 - l.cy, w, h);
    if (model) {
      homeDistance = fitDistance({ w: model.widthM, h: model.heightM }, { w, h }, { w: l.areaW, h: l.areaH });
      controls.minDistance = homeDistance / 3;
      controls.maxDistance = homeDistance * 2;
      if (!moved) camera.position.copy(homePosition(homeDistance));
    }
  }

  function addLights(heightM: number, widthM: number): void {
    lights.clear();
    const dir = (colour: number, intensity: number, at: [number, number, number]): DirectionalLight => {
      const l = new DirectionalLight(colour, intensity);
      l.position.set(...at).multiplyScalar(heightM);
      lights.add(l, l.target);
      return l;
    };
    dir(0xffffff, 1.6, [-1.2, 1.6, 1.4]);
    dir(0xbfdbfe, 0.5, [1.5, 0.4, 0.8]);
    dir(0x3b82f6, 1.1, [0.6, 1.0, -1.6]);
    lights.add(new HemisphereLight(0xf8fbff, 0x1e3a8a, 0.35));
    if (!shadow) {
      shadow = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: shadowMap, transparent: true, depthWrite: false, toneMapped: false }));
      shadow.rotation.x = -Math.PI / 2;
      shadow.renderOrder = 0;
      lights.add(shadow);
    }
    shadow.scale.setScalar(widthM * 1.4);
    shadow.position.y = -heightM / 2 - 0.002;
  }

  function updateView(): void {
    scene.updateMatrixWorld();
    const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
    cam.matrixWorld.decompose(view.camPos, view.camQuat, new Vector3());
    view.viewH = size().h;
    view.tanFov2 = 2 * Math.tan(MathUtils.degToRad(camera.fov) / 2);
    view.xr = renderer.xr.isPresenting;
    const q = new Quaternion();
    const s = new Vector3();
    marks.matrixWorld.decompose(new Vector3(), q, s);
    view.parentYaw = new Euler().setFromQuaternion(q, 'YXZ').y;
    view.parentQuatInv.copy(q).invert();
    view.parentScale = s.x;
  }

  let last = performance.now();
  renderer.setAnimationLoop((t, frame) => {
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    for (const tw of [...tweens]) {
      const k = Math.min(1, (t - tw.start) / tw.ms);
      tw.step(easeOut(k));
      if (k >= 1) {
        tweens.splice(tweens.indexOf(tw), 1);
        tw.done?.();
      }
    }
    if (controls.autoRotate && t - startedAt > AUTO_ROTATE_MS) controls.autoRotate = false;
    if (!xrActive) controls.update(dt);
    updateView();
    for (const cb of [...frameCbs]) cb(dt, t, frame);
    renderer.render(scene, camera);
    if (model && !firstFrameDone) {
      firstFrameDone = true;
      performance.mark('asp:first-frame');
      resolveFirst();
    }
  });

  const resize = new ResizeObserver(applyLayout);
  resize.observe(canvas);
  controls.addEventListener('start', () => {
    moved = true;
    controls.autoRotate = false;
    canvas.classList.add('dragging');
  });
  controls.addEventListener('end', () => canvas.classList.remove('dragging'));

  function tween(ms: number, step: (k: number) => void, done?: () => void): void {
    if (ms <= 0 || reducedMotion()) {
      step(1);
      done?.();
      return;
    }
    tweens.push({ start: performance.now(), ms, step, done });
  }

  function glide(to: Vector3, ms: number): void {
    const from = new Spherical().setFromVector3(camera.position);
    const goal = new Spherical().setFromVector3(to);
    let dTheta = goal.theta - from.theta;
    dTheta -= Math.round(dTheta / (2 * Math.PI)) * 2 * Math.PI;
    controls.autoRotate = false;
    tween(ms, (k) => {
      const s = new Spherical(MathUtils.lerp(from.radius, goal.radius, k), MathUtils.lerp(from.phi, goal.phi, k), from.theta + dTheta * k);
      camera.position.setFromSpherical(s);
      camera.lookAt(0, 0, 0);
    });
  }

  return {
    canvas,
    renderer,
    scene,
    camera,
    controls,
    stage,
    rig,
    patient,
    marks,
    view,
    firstFrame,
    get xrActive() {
      return xrActive;
    },
    mount(m) {
      model = m;
      patient.add(m.root);
      m.mounted = { rig, patient };
      rig.position.copy(lpsToRig(m.centre, new Vector3())).negate();
      addLights(m.heightM, m.widthM);
      stage.add(lights);
      applyLayout();
    },
    setLayout(l) {
      layout = l;
      applyLayout();
    },
    resetView(animate = true) {
      moved = false;
      glide(homePosition(homeDistance), animate ? 600 : 0);
    },
    setView(azimuthDeg, elevationDeg) {
      moved = true;
      controls.autoRotate = false;
      camera.position.copy(homePosition(homeDistance, azimuthDeg, elevationDeg));
      camera.lookAt(0, 0, 0);
    },
    faceNormal(nrm, ms = 480) {
      const dir = nrm.clone().normalize();
      const polar = MathUtils.clamp(Math.acos(MathUtils.clamp(dir.y, -1, 1)), controls.minPolarAngle, controls.maxPolarAngle);
      const s = new Spherical(camera.position.length(), polar, Math.atan2(dir.x, dir.z));
      moved = true;
      glide(new Vector3().setFromSpherical(s), ms);
    },
    rayAt(clientX, clientY) {
      const r = canvas.getBoundingClientRect();
      raycaster.setFromCamera(new Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), camera);
      return raycaster;
    },
    onFrame(cb) {
      frameCbs.add(cb);
      return () => void frameCbs.delete(cb);
    },
    tween,
    setXr(on) {
      xrActive = on;
      controls.enabled = !on;
      if (!on) {
        stage.position.set(0, 0, 0);
        stage.rotation.set(0, 0, 0);
        stage.scale.setScalar(1);
      }
      applyLayout();
    },
    stopAutoRotate() {
      controls.autoRotate = false;
    },
    onContext(h) {
      canvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        h.lost();
      });
      canvas.addEventListener('webglcontextrestored', () => {
        scene.environment = buildEnvironment();
        h.restored();
      });
    },
    dispose() {
      renderer.setAnimationLoop(null);
      resize.disconnect();
      controls.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };
}
