import type { LiveNote, Note, NoteId, RoomState } from '../types';
import { byId, h } from './dom';
import type { Roster } from './people';

const TIME = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

export function noteTime(created: number): { text: string; datetime: string } {
  try { return { text: TIME.format(created), datetime: new Date(created).toISOString() }; }
  catch { return { text: 'Time unavailable', datetime: '' }; }
}

export interface NotesView {
  render(s: RoomState, changed: readonly NoteId[]): void;
  recolor(): void;
  select(id: NoteId | null): void;
}

export function createNotesView(
  roster: Roster,
  o: { onHover(id: NoteId | null): void; onSelect(id: NoteId): void; onDelete(id: NoteId): void },
): NotesView {
  const list = byId('notes-list');
  const empty = byId('notes-empty');
  const counts = [byId('notes-count'), byId('notes-badge')];
  const cards = new Map<NoteId, HTMLElement>();
  let selected: NoteId | null = null;

  function card(n: LiveNote, self: string): HTMLElement {
    const dot = h('span', { class: 'dot', attrs: { 'data-author': n.author.id } });
    dot.style.setProperty('--dot', roster.colorOf(n.author.id));
    const time = noteTime(n.created);
    const meta = h('span', { class: 'meta' }, document.createTextNode(`${n.author.name}, `), h('time', { text: time.text, attrs: { datetime: time.datetime } }));
    const del =
      n.author.id === self
        ? h('button', { class: 'textbtn delete', text: 'Delete', attrs: { type: 'button', 'aria-label': `Delete note ${n.text}` } })
        : null;
    const li = h('li', { class: 'note', attrs: { tabindex: '0', 'data-id': n.id } }, dot, h('span', { class: 'words', text: n.text }), del, meta);
    li.addEventListener('mouseenter', () => o.onHover(n.id));
    li.addEventListener('mouseleave', () => o.onHover(null));
    li.addEventListener('focus', () => o.onHover(n.id));
    li.addEventListener('blur', () => o.onHover(null));
    li.addEventListener('click', () => o.onSelect(n.id));
    del?.addEventListener('click', (e) => {
      e.stopPropagation();
      o.onDelete(n.id);
    });
    return li;
  }

  return {
    render(s, changed) {
      let dirty = false;
      for (const id of changed) {
        const n = s.notes.get(id);
        const had = cards.get(id);
        if (!n || n.deleted) {
          if (had) {
            had.remove();
            cards.delete(id);
            dirty = true;
          }
        } else if (!had) {
          cards.set(id, card(n, s.self.id));
          dirty = true;
        }
      }
      if (dirty) {
        const live = [...cards.keys()].map((id) => s.notes.get(id)).filter((n): n is Note => !!n);
        live.sort((a, b) => b.created - a.created || (a.id < b.id ? 1 : -1));
        list.replaceChildren(...live.map((n) => cards.get(n.id)).filter((c): c is HTMLElement => !!c));
      }
      const count = String(cards.size);
      for (const c of counts) c.textContent = count;
      empty.hidden = cards.size > 0;
    },
    recolor() {
      for (const dot of list.querySelectorAll<HTMLElement>('.dot[data-author]')) {
        dot.style.setProperty('--dot', roster.colorOf(dot.dataset.author ?? ''));
      }
    },
    select(id) {
      selected = id;
      for (const [nid, el] of cards) el.classList.toggle('selected', nid === selected);
      if (id) cards.get(id)?.scrollIntoView({ block: 'nearest' });
    },
  };
}
