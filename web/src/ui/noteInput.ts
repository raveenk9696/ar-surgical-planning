import { LIMITS } from '../config';
import { byId } from './dom';

export interface NoteInput {
  readonly isOpen: boolean;
  show(): void;
  move(x: number, y: number): void;
  hide(): void;
}

export function createNoteInput(o: { onSubmit(text: string): void; onCancel(): void }): NoteInput {
  const form = byId<HTMLFormElement>('note-form');
  const input = byId<HTMLInputElement>('note-input');
  input.removeAttribute('maxlength');
  input.addEventListener('input', () => {
    input.value = Array.from(input.value).slice(0, LIMITS.textMax).join('');
  });
  let open = false;
  let focusTimer: ReturnType<typeof setTimeout> | undefined;

  const cancel = (): void => {
    if (!open) return;
    api.hide();
    o.onCancel();
  };
  const outside = (e: PointerEvent): void => {
    if (e.target instanceof Node && !form.contains(e.target)) cancel();
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    api.hide();
    o.onSubmit(text);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      cancel();
    }
  });

  const api: NoteInput = {
    get isOpen() {
      return open;
    },
    show() {
      open = true;
      form.hidden = false;
      input.value = '';
      input.focus({ preventScroll: true });
      // Touch-generated mouse events can blur the field after pointerup.
      clearTimeout(focusTimer);
      focusTimer = setTimeout(() => { if (open) input.focus({ preventScroll: true }); }, 0);
      document.addEventListener('pointerdown', outside, true);
    },
    move(x, y) {
      const left = Math.max(8, Math.min(x + 14, window.innerWidth - 236));
      const top = Math.max(8, Math.min(y - 20, window.innerHeight - 56));
      form.style.transform = `translate(${left}px, ${top}px)`;
    },
    hide() {
      open = false;
      clearTimeout(focusTimer);
      form.hidden = true;
      document.removeEventListener('pointerdown', outside, true);
    },
  };
  return api;
}
