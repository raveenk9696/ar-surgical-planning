import { LIMITS } from '../config';
import type { PeerId, Presence, RoomState } from '../types';
import { byId, h } from './dom';

const SLOT_VARS = ['--you', '--peer-1', '--peer-2', '--peer-3'] as const;
const MAX_ROWS = 4;
const PULSE_MS = 380;

/** Colours are local roster slots, never wire data: you, then the first remote peers in the order they were seen. */
export interface Roster {
  slotOf(id: PeerId): number;
  colorOf(id: PeerId): string;
  update(s: RoomState): void;
}

export function createRoster(selfId: PeerId): Roster {
  const order: PeerId[] = [];
  let colors: string[] | null = null;
  const palette = (): string[] => (colors ??= SLOT_VARS.map((v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim()));
  const slotOf = (id: PeerId): number => {
    if (id === selfId) return 0;
    const i = order.indexOf(id);
    return i < 0 ? 3 : Math.min(i + 1, 3);
  };
  return {
    slotOf,
    colorOf: (id) => palette()[slotOf(id)] ?? '#64748b',
    update(s) {
      for (let i = order.length - 1; i >= 0; i--) if (!s.peers.has(order[i]!)) order.splice(i, 1);
      for (const id of s.peers.keys()) if (order.length < LIMITS.maxPeers && !order.includes(id)) order.push(id);
    },
  };
}

export interface PeopleView {
  render(s: RoomState): void;
}

export function createPeopleView(roster: Roster, o: { onOpenSecond(): void; onOpenSheet(): void }): PeopleView {
  const list = byId('people-list');
  const empty = byId('people-empty');
  const dots = byId('people-dots');
  const lastPtr = new Map<PeerId, string>();
  const pulseUntil = new Map<PeerId, number>();
  byId('btn-open-second').addEventListener('click', o.onOpenSecond);
  dots.addEventListener('click', o.onOpenSheet);

  const dot = (id: PeerId): HTMLElement => {
    const d = h('span', { class: 'dot' });
    d.style.setProperty('--dot', roster.colorOf(id));
    return d;
  };

  return {
    render(s) {
      const peers: Presence[] = [...s.peers.values()];
      const visible = new Set(peers.slice(0, MAX_ROWS - 1).map((p) => p.peer.id));
      for (const id of lastPtr.keys()) if (!visible.has(id)) lastPtr.delete(id);
      for (const id of pulseUntil.keys()) if (!visible.has(id)) pulseUntil.delete(id);
      const rows: HTMLElement[] = [h('li', { class: 'person you' }, h('span', { text: 'You' }))];
      for (const p of peers.slice(0, MAX_ROWS - 1)) {
        const key = p.ptr ? p.ptr.join(',') : '';
        const moved = lastPtr.get(p.peer.id) !== key && key !== '';
        lastPtr.set(p.peer.id, key);
        const row = h('li', { class: 'person' }, dot(p.peer.id), h('span', { text: p.peer.name }), p.away ? h('span', { class: 'away', text: 'Away' }) : null);
        if (moved) pulseUntil.set(p.peer.id, performance.now() + PULSE_MS);
        if ((pulseUntil.get(p.peer.id) ?? 0) > performance.now()) row.classList.add('pulse');
        rows.push(row);
      }
      if (peers.length > MAX_ROWS - 1) rows.push(h('li', { class: 'person', text: `+${peers.length - (MAX_ROWS - 1)}` }));
      list.replaceChildren(...rows);
      empty.hidden = peers.length > 0;

      const dotRow = [h('span', { class: 'dot' }), ...peers.slice(0, 3).map((p) => dot(p.peer.id))];
      dotRow[0]?.style.setProperty('--dot', roster.colorOf(s.self.id));
      dots.replaceChildren(...dotRow);
      dots.setAttribute('aria-label', `People: you and ${peers.length} other${peers.length === 1 ? '' : 's'}`);
    },
  };
}
