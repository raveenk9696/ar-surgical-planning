import { afterEach, expect, it, vi } from 'vitest';
import { drawNoteLabel, textureSize } from './labels';

afterEach(() => vi.unstubAllGlobals());
it('fits a 24-character wide label within 230 pixels on a 390-pixel phone', () => {
  const ctx = new Proxy({ font: '', measureText(text: string) { return { width: text.length * 25 * (Number(/([\d.]+)px/.exec(this.font)?.[1] ?? 28) / 28) }; } }, {
    get: (target, key) => Reflect.get(target, key) ?? (() => undefined),
  });
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
  const texture = drawNoteLabel('W'.repeat(24));
  const size = textureSize(texture);
  expect(size.w).toBeLessThanOrEqual(230);
  expect(size.w / size.h).toBeCloseTo(texture.image.width / texture.image.height);
  texture.dispose();
});

it('isolates bidirectional canvas label text', () => {
  const fillText = vi.fn();
  const ctx = new Proxy({ fillText, measureText: (text: string) => ({ width: text.length * 8 }) }, {
    get: (target, key) => Reflect.get(target, key) ?? (() => undefined),
  });
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
  drawNoteLabel('ok 12 אבג 34').dispose();
  expect(fillText.mock.calls[0]?.[0]).toBe('\u2068ok 12 אבג 34\u2069');
});

it('keeps all four corners of a right-flank label inside the viewport margin', async () => {
  const { Group, Mesh, PerspectiveCamera, PlaneGeometry, Vector3 } = await import('three');
  const { keepLabelInView } = await import('./labels');
  const camera = new PerspectiveCamera(50, 390 / 844, 0.01, 100);
  camera.position.z = 5;
  camera.updateMatrixWorld();
  const parent = new Group();
  parent.rotation.y = 0.3;
  parent.scale.setScalar(1.4);
  const label = new Mesh(new PlaneGeometry(1, 1).translate(0.5, 0.5, 0));
  parent.add(label);
  label.position.set(1, 0, 0);
  label.rotation.y = -0.3;
  keepLabelInView(label, camera, 390, 844);
  label.updateWorldMatrix(true, false);
  for (const [x, y] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
    const point = new Vector3(x, y, 0).applyMatrix4(label.matrixWorld).project(camera);
    expect((point.x + 1) * 195).toBeGreaterThanOrEqual(11.99);
    expect((point.x + 1) * 195).toBeLessThanOrEqual(378.01);
    expect((1 - point.y) * 422).toBeGreaterThanOrEqual(11.99);
    expect((1 - point.y) * 422).toBeLessThanOrEqual(832.01);
  }
});

it('breaks a 24-character word into two readable lines', () => {
  const fillText = vi.fn();
  const ctx = new Proxy({ fillText, font: '', measureText(text: string) { return { width: text.length * 25 * (Number(/([\d.]+)px/.exec(this.font)?.[1] ?? 28) / 28) }; } }, {
    get: (target, key) => Reflect.get(target, key) ?? (() => undefined),
  });
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
  const label = drawNoteLabel('W'.repeat(24));
  expect(fillText).toHaveBeenCalledTimes(2);
  const effectiveFont = Number(/([\d.]+)px/.exec(ctx.font)?.[1]) * textureSize(label).w / (label.image.width / 2);
  expect(effectiveFont).toBeGreaterThanOrEqual(16);
  expect(textureSize(label).w).toBeLessThanOrEqual(230);
  label.dispose();
});

it('connects a shifted label to its pin with a separate leader ending at the nearest edge', async () => {
  const { Group, PerspectiveCamera, Vector3, Line } = await import('three');
  const { createPins } = await import('./pins');
  const { createView } = await import('./labels');
  const { noteBy } = await import('../test/signed');
  const ctx = new Proxy({ measureText: (text: string) => ({ width: text.length * 8 }) }, { get: (target, key) => Reflect.get(target, key) ?? (() => undefined) });
  vi.stubGlobal('document', { body: { classList: { contains: () => false } }, createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const marks = new Group();
  const pins = createPins(marks, { colorOf: () => '#00f', selfId: 'A' });
  const note = noteBy('A', 1, { pos: [170, 0, 0], text: 'Look here right' });
  pins.sync(new Map([[note.id, note]]), [note.id]);
  const camera = new PerspectiveCamera(50, 390 / 844, 0.01, 100);
  camera.position.z = 1;
  camera.updateMatrixWorld();
  const view = createView();
  Object.assign(view, { camera, viewW: 390, viewH: 844, tanFov2: 2 * Math.tan(25 * Math.PI / 180) });
  view.camPos.copy(camera.position);
  pins.update(0.016, view, 0);
  const leader = marks.children.find((o) => o instanceof Line) as InstanceType<typeof Line> | undefined;
  expect(leader).toBeDefined();
  const points = leader!.geometry.getAttribute('position');
  expect(new Vector3().fromBufferAttribute(points, 0).distanceTo(new Vector3(0.17, 0, 0))).toBeLessThan(0.00001);
  const label = marks.children.find((o) => o.renderOrder === 10)!;
  const end = label.worldToLocal(new Vector3().fromBufferAttribute(points, 1));
  expect(end.x).toBeGreaterThan(0);
  expect(end.x).toBeLessThan(1);
  expect(end.y).toBeCloseTo(0);
  pins.dispose();
});
