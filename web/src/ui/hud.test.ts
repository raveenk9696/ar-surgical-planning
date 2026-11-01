import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { createHud } from './hud';
import { byId } from './dom';

vi.mock('./icons', () => ({ icon: () => ({}) }));
vi.mock('./dom', () => {
  const nodes = new Map();
  return {
    byId(id: string) {
      if (!nodes.has(id)) {
        const attrs = new Map();
        nodes.set(id, Object.assign(new EventTarget(), {
          append() {}, classList: { add() {}, toggle() {} },
          setAttribute: (key: string, value: string) => attrs.set(key, value),
          getAttribute: (key: string) => attrs.get(key), removeAttribute: (key: string) => attrs.delete(key),
          querySelector: () => ({ setAttribute() {} }),
        }));
      }
      return nodes.get(id);
    },
    setIcon() {}, setLabel() {},
  };
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('explains unsupported AR when clicked and makes its disabled appearance explicit', () => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const unavailable = vi.fn();
  const enter = vi.fn();
  const hud = createHud({ onSkin() {}, onArm() {}, onReset() {}, onShare() {}, onSecond() {}, onAr: enter, onArUnavailable: unavailable });
  hud.setAr('unsupported');
  byId('btn-ar').dispatchEvent(new Event('click'));
  expect(unavailable).toHaveBeenCalledOnce();
  expect(enter).not.toHaveBeenCalled();
  expect(byId('btn-ar').getAttribute('aria-disabled')).toBe('true');
  const css = readFileSync(new URL('../styles/app.css', import.meta.url), 'utf8');
  expect(css).toMatch(/\.btn\.primary\[aria-disabled='true'\][^{]*\{[^}]*background: var\(--mist\)/);
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  expect(html).toContain('Needs a browser with WebXR AR, such as Android Chrome.');
  hud.setAr('ready');
  byId('btn-ar').dispatchEvent(new Event('click'));
  expect(enter).toHaveBeenCalledOnce();
});

it('keeps AR off and reports a failed 3D view without claiming WebXR is unsupported', () => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const unavailable = vi.fn();
  const enter = vi.fn();
  const hud = createHud({ onSkin() {}, onArm() {}, onReset() {}, onShare() {}, onSecond() {}, onAr: enter, onArUnavailable: unavailable });
  hud.setAr('blocked');
  byId('btn-ar').dispatchEvent(new Event('click'));
  expect(byId('btn-ar').getAttribute('aria-disabled')).toBe('true');
  expect(byId('ar-help').hidden).toBe(false);
  expect(byId('ar-help').textContent).toBe('The 3D view could not start.');
  expect(unavailable).toHaveBeenCalledWith('The 3D view could not start.');
  expect(enter).not.toHaveBeenCalled();
});
