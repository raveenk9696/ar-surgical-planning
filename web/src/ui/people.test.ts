import { afterEach, expect, it, vi } from 'vitest';
import { initialState } from '../sync/engine';
import { createPeopleView, createRoster } from './people';

vi.mock('./dom', () => {
  const element = (): object => ({ style: { setProperty() {} }, classList: { add() {} }, addEventListener() {}, setAttribute() {}, replaceChildren() {}, hidden: false });
  return { byId: element, h: element };
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('bounds roster order and pointer maps through 40000 rotated ids, then clears departed peers', () => {
  vi.stubGlobal('document', { documentElement: {} });
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '#000' }));
  const roster = createRoster('SELFSELF');
  const view = createPeopleView(roster, { onOpenSecond() {}, onOpenSheet() {} });
  const state = initialState('ROOM', { id: 'SELFSELF', name: 'You' });
  const maps = new Set<Map<string, unknown>>();
  const set = Map.prototype.set;
  let maxSize = 0;
  vi.spyOn(Map.prototype, 'set').mockImplementation(function (this: Map<string, unknown>, key: string, value: unknown) {
    const result = set.call(this, key, value);
    if (key.startsWith('rotated') && (typeof value === 'string' || typeof value === 'number')) {
      maps.add(this);
      maxSize = Math.max(maxSize, this.size);
    }
    return result;
  });
  for (let i = 0; i < 40000; i++) {
    const id = `rotated${i}`;
    state.peers = new Map([[id, { peer: { id, name: 'Guest' }, seq: i, ptr: [1, 2, 3], away: false, seenAt: 0 }]]);
    roster.update(state);
    view.render(state);
  }
  expect(roster.slotOf('rotated39999')).toBe(1);
  expect(roster.slotOf('rotated0')).toBe(3);
  expect(maxSize).toBeLessThanOrEqual(8);
  state.peers = new Map();
  roster.update(state);
  view.render(state);
  expect(roster.slotOf('rotated39999')).toBe(3);
  for (const map of maps) expect(map.size).toBe(0);
});
