import { CanvasTexture, Quaternion, SRGBColorSpace, Vector3, type Camera, type Object3D } from 'three';

/** The one red of the 3D scene: the ink of a note and the ring of its pin. */
export const NOTE_RED = '#e11d48';

const SCRIPT = '"Homemade Apple", cursive';
const UI = '"Inter Variable", Inter, system-ui, sans-serif';
const SCALE = 2;
const FONT_PX = 28;
const LINE_PX = 40;
const PAD = 12;
const HALO_PX = 7;
const MIN_FONT_PX = 16;
const WRAP_PX = 230;

export interface FlatSize { w: number; h: number }

export const noteFontReady = (): Promise<unknown> => document.fonts.load(`${FONT_PX}px ${SCRIPT}`).catch(() => undefined);

function canvas(w: number, h: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * SCALE);
  c.height = Math.ceil(h * SCALE);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available');
  ctx.scale(SCALE, SCALE);
  ctx.direction = 'ltr';
  return { c, ctx };
}

function texture(c: HTMLCanvasElement, size: FlatSize): CanvasTexture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  t.userData = { size };
  return t;
}

export const textureSize = (t: CanvasTexture): FlatSize => (t.userData as { size: FlatSize }).size;

function wrap(ctx: CanvasRenderingContext2D, text: string): string[] {
  if (ctx.measureText(text).width <= WRAP_PX - 2 * PAD) return [text];
  const words = text.split(' ');
  if (words.length < 2) {
    const characters = Array.from(text);
    const middle = Math.ceil(characters.length / 2);
    return [characters.slice(0, middle).join(''), characters.slice(middle).join('')];
  }
  let best = 1;
  let gap = Infinity;
  for (let i = 1; i < words.length; i++) {
    const d = Math.abs(ctx.measureText(words.slice(0, i).join(' ')).width - ctx.measureText(words.slice(i).join(' ')).width);
    if (d < gap) {
      gap = d;
      best = i;
    }
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
}

export function drawNoteLabel(text: string): CanvasTexture {
  const probe = canvas(1, 1).ctx;
  probe.font = `400 ${FONT_PX}px ${SCRIPT}`;
  const font = !text.includes(' ') && probe.measureText(text).width > WRAP_PX - 2 * PAD ? UI : SCRIPT;
  probe.font = `400 ${FONT_PX}px ${font}`;
  const lines = wrap(probe, text);
  let fontPx = FONT_PX;
  let widest = Math.max(...lines.map((line) => probe.measureText(line).width));
  while (widest + 2 * PAD > WRAP_PX && fontPx > MIN_FONT_PX) {
    probe.font = `400 ${--fontPx}px ${font}`;
    widest = Math.max(...lines.map((line) => probe.measureText(line).width));
  }
  const linePx = LINE_PX * fontPx / FONT_PX;
  const size = { w: Math.ceil(2 * PAD + widest), h: Math.ceil(PAD + lines.length * linePx + 14) };
  const { c, ctx } = canvas(size.w, size.h);
  ctx.font = `400 ${fontPx}px ${font}`;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const x = PAD;
  lines.forEach((line, i) => {
    const y = PAD + (i + 1) * linePx - 8;
    ctx.lineWidth = HALO_PX;
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.strokeText(`\u2068${line}\u2069`, x, y);
    ctx.fillStyle = NOTE_RED;
    ctx.fillText(`\u2068${line}\u2069`, x, y);
  });
  return texture(c, size);
}

/** A white disc with a red ring and a dot in the author's colour. The disc fills 80% of the square texture. */
export function drawPin(colour: string): CanvasTexture {
  const S = 40;
  const { c, ctx } = canvas(S, S);
  const D = S * 0.8;
  const ring = (D * 3) / 16;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, D / 2, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, D / 2 - ring / 2, 0, Math.PI * 2);
  ctx.lineWidth = ring;
  ctx.strokeStyle = NOTE_RED;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, (D * 6) / 32, 0, Math.PI * 2);
  ctx.fillStyle = colour;
  ctx.fill();
  return texture(c, { w: S, h: S });
}

/** A remote pointer: 22 px ring in the author's colour with a 2 px white halo. The ring fills 70% of the square texture. */
export function drawRing(colour: string): CanvasTexture {
  const S = 40;
  const { c, ctx } = canvas(S, S);
  const outer = S * 0.35;
  const radius = outer - 1.5 - 2;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, radius, 0, Math.PI * 2);
  ctx.lineWidth = 3 + 4;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.strokeStyle = colour;
  ctx.stroke();
  return texture(c, { w: S, h: S });
}

export function drawPill(name: string, colour: string): CanvasTexture {
  const probe = canvas(1, 1).ctx;
  probe.font = `600 14px ${UI}`;
  const size = { w: Math.ceil(probe.measureText(name).width + 20), h: 28 };
  const { c, ctx } = canvas(size.w, size.h);
  ctx.beginPath();
  ctx.roundRect(0, 0, size.w, size.h, size.h / 2);
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.font = `600 14px ${UI}`;
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(`\u2068${name}\u2069`, 10, size.h / 2 + 0.5);
  return texture(c, size);
}

export interface View {
  camPos: Vector3;
  camQuat: Quaternion;
  /** canvas height in CSS px */
  viewH: number;
  viewW: number;
  camera: Camera | null;
  /** 2 * tan(fov / 2): view height per metre of distance */
  tanFov2: number;
  xr: boolean;
  /** world rotation of the marks group, inverted, and its yaw and uniform scale */
  parentQuatInv: Quaternion;
  parentYaw: number;
  parentScale: number;
}

export function createView(): View {
  return { camPos: new Vector3(), camQuat: new Quaternion(), viewH: 1, viewW: 1, camera: null, tanFov2: 1, xr: false, parentQuatInv: new Quaternion(), parentYaw: 0, parentScale: 1 };
}

/**
 * Sizes a unit plane so it is `px` tall on screen, or `xrMetres` tall in AR, and turns it to the viewer.
 * `turn: 'y'` keeps it upright, as AR labels are.
 */
export function placeFlat(obj: Object3D, worldPos: Vector3, px: number, aspect: number, xrMetres: number, v: View, turn: 'full' | 'y' = 'full'): void {
  const world = v.xr ? xrMetres : (px / v.viewH) * v.tanFov2 * v.camPos.distanceTo(worldPos);
  const local = world / v.parentScale;
  obj.scale.set(local * aspect, local, 1);
  if (turn === 'full') {
    obj.quaternion.copy(v.parentQuatInv).multiply(v.camQuat);
  } else {
    obj.rotation.set(0, Math.atan2(v.camPos.x - worldPos.x, v.camPos.z - worldPos.z) - v.parentYaw, 0);
  }
}

export function keepLabelInView(label: Object3D, camera: Camera, width: number, height: number): void {
  const margin = 12;
  const bounds = () => {
    label.updateWorldMatrix(true, false);
    const corners = [[0, 0], [0, 1], [1, 0], [1, 1]].map(([x, y]) => {
      const point = new Vector3(x, y, 0).applyMatrix4(label.matrixWorld).project(camera);
      return { x: (point.x + 1) * width / 2, y: (1 - point.y) * height / 2 };
    });
    return {
      left: Math.min(...corners.map((p) => p.x)), right: Math.max(...corners.map((p) => p.x)),
      top: Math.min(...corners.map((p) => p.y)), bottom: Math.max(...corners.map((p) => p.y)),
    };
  };
  let box = bounds();
  const scale = Math.min(1, (width - 2 * margin) / (box.right - box.left), (height - 2 * margin) / (box.bottom - box.top));
  if (scale < 1) {
    label.scale.multiplyScalar(scale);
    box = bounds();
  }
  const dx = Math.max(margin - box.left, Math.min(0, width - margin - box.right));
  const dy = Math.max(margin - box.top, Math.min(0, height - margin - box.bottom));
  if (!dx && !dy) return;
  const origin = label.getWorldPosition(new Vector3()).project(camera);
  origin.x += 2 * dx / width;
  origin.y -= 2 * dy / height;
  origin.unproject(camera);
  label.position.copy(label.parent ? label.parent.worldToLocal(origin) : origin);
}

export function nearestLabelEdge(label: Object3D, pinWorld: Vector3): Vector3 {
  label.updateWorldMatrix(true, false);
  const point = label.worldToLocal(pinWorld.clone());
  const x = Math.max(0, Math.min(1, point.x));
  const y = Math.max(0, Math.min(1, point.y));
  const edges = [new Vector3(0, y, 0), new Vector3(1, y, 0), new Vector3(x, 0, 0), new Vector3(x, 1, 0)];
  const worldEdges = edges.map((edge) => label.localToWorld(edge));
  return worldEdges.reduce((nearest, edge) => edge.distanceToSquared(pinWorld) < nearest.distanceToSquared(pinWorld) ? edge : nearest);
}
