import { CanvasTexture, Quaternion, SRGBColorSpace, Vector3, type Object3D } from 'three';

/** The one red of the 3D scene: the ink of a note and the ring of its pin. */
export const NOTE_RED = '#e11d48';

const SCRIPT = '"Homemade Apple", cursive';
const UI = '"Inter Variable", Inter, system-ui, sans-serif';
const SCALE = 2;
const FONT_PX = 28;
const LINE_PX = 40;
const PAD = 12;
const HALO_PX = 7;
const LEADER_PX = 28;
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
  if (ctx.measureText(text).width <= WRAP_PX) return [text];
  const words = text.split(' ');
  if (words.length < 2) return [text];
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

/** Red handwriting with a white halo and a short pen leader. The pin sits at the lower-left corner. */
export function drawNoteLabel(text: string): CanvasTexture {
  const probe = canvas(1, 1).ctx;
  probe.font = `400 ${FONT_PX}px ${SCRIPT}`;
  const lines = wrap(probe, text).slice(0, 2);
  const widest = Math.max(...lines.map((l) => probe.measureText(l).width));
  const size = { w: Math.ceil(LEADER_PX * 0.8 + PAD + widest + PAD), h: Math.ceil(PAD + lines.length * LINE_PX + 14) };
  const { c, ctx } = canvas(size.w, size.h);
  ctx.font = `400 ${FONT_PX}px ${SCRIPT}`;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const x = LEADER_PX * 0.8 + PAD / 2;
  lines.forEach((line, i) => {
    const y = PAD + (i + 1) * LINE_PX - 8;
    ctx.lineWidth = HALO_PX;
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.strokeText(line, x, y);
    ctx.fillStyle = NOTE_RED;
    ctx.fillText(line, x, y);
  });
  const rad = (40 * Math.PI) / 180;
  const from = { x: 2, y: size.h - 2 };
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(from.x + Math.cos(rad) * LEADER_PX, from.y - Math.sin(rad) * LEADER_PX);
  ctx.lineWidth = HALO_PX;
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = NOTE_RED;
  ctx.stroke();
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
  ctx.fillText(name, 10, size.h / 2 + 0.5);
  return texture(c, size);
}

export interface View {
  camPos: Vector3;
  camQuat: Quaternion;
  /** canvas height in CSS px */
  viewH: number;
  /** 2 * tan(fov / 2): view height per metre of distance */
  tanFov2: number;
  xr: boolean;
  /** world rotation of the marks group, inverted, and its yaw and uniform scale */
  parentQuatInv: Quaternion;
  parentYaw: number;
  parentScale: number;
}

export function createView(): View {
  return { camPos: new Vector3(), camQuat: new Quaternion(), viewH: 1, tanFov2: 1, xr: false, parentQuatInv: new Quaternion(), parentYaw: 0, parentScale: 1 };
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
