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
