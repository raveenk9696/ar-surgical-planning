import { afterEach, expect, it, vi } from 'vitest';
import { drawNoteLabel, textureSize, fitNoteLabel } from './labels';

afterEach(() => vi.unstubAllGlobals());
it('fits a 24-character wide label within 230 pixels on a 390-pixel phone', () => {
  const ctx = new Proxy({ measureText: (text: string) => ({ width: text.length * 25 }) }, {
    get: (target, key) => Reflect.get(target, key) ?? (() => undefined),
  });
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
  const texture = drawNoteLabel('W'.repeat(24));
  const size = textureSize(texture);
  expect(size.w).toBeLessThanOrEqual(230);
  expect(size.w / size.h).toBeCloseTo(texture.image.width / texture.image.height);
  texture.dispose();
});

it('keeps short label sizes and scales wide labels proportionally', () => {
  expect(fitNoteLabel({ w: 100, h: 66 })).toEqual({ w: 100, h: 66 });
  expect(fitNoteLabel({ w: 460, h: 100 })).toEqual({ w: 230, h: 50 });
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
