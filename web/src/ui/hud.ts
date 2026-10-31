import { byId, setIcon, setLabel } from './dom';
import { icon } from './icons';

export type ArState = 'checking' | 'ready' | 'unsupported';

export interface Hud {
  setSkin(on: boolean): void;
  setArmed(armed: boolean): void;
  setAr(s: ArState): void;
  setShareCopied(): void;
  setThreeDEnabled(on: boolean): void;
  hideHint(): void;
  openSheet(open: boolean): void;
}

export function createHud(o: {
  onSkin(on: boolean): void;
  onArm(armed: boolean): void;
  onReset(): void;
  onShare(): void;
  onSecond(): void;
  onAr(): void;
}): Hud {
  const skin = byId('btn-skin');
  const add = byId('btn-add');
  const reset = byId('btn-reset');
  const share = byId('btn-share');
  const second = byId('btn-second');
  const ar = byId('btn-ar');
  const arHelp = byId('ar-help');
  const hint = byId('hint');
  const rail = byId('rail');
  let skinOn = true;
  let armed = false;
  let arState: ArState = 'checking';
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  let secondTimer: ReturnType<typeof setTimeout> | undefined;

  const paintSkin = (): void => {
    skin.setAttribute('aria-checked', String(skinOn));
    setLabel(skin, skinOn ? 'Skin on' : 'Skin off');
    setIcon(skin, skinOn ? icon('check') : icon('layers'));
  };
  const paintShare = (copied: boolean): void => {
    share.classList.toggle('copied', copied);
    setLabel(share, copied ? 'Link copied' : 'Share');
    setIcon(share, icon(copied ? 'check' : 'link'));
  };

  paintSkin();
  paintShare(false);
  setIcon(add, icon('plus'));
  setIcon(reset, icon('reset'));
  setIcon(ar, icon('cube'));
  byId('sheet-close').append(icon('close'));
  byId('btn-share').querySelector('.label')?.setAttribute('aria-live', 'polite');
  if (matchMedia('(pointer: coarse)').matches) hint.textContent = 'Drag to rotate. Pinch to zoom.';
  const hintTimer = setTimeout(() => hint.classList.add('gone'), 6000);

  const api: Hud = {
    setSkin(on) {
      skinOn = on;
      paintSkin();
    },
    setArmed(a) {
      armed = a;
      add.setAttribute('aria-pressed', String(a));
      byId('stage').classList.toggle('armed', a);
    },
    setAr(s) {
      arState = s;
      ar.setAttribute('aria-disabled', String(s !== 'ready'));
      arHelp.hidden = s !== 'unsupported';
      ar.setAttribute('aria-describedby', s === 'unsupported' ? 'ar-help' : '');
    },
    setShareCopied() {
      paintShare(true);
      second.hidden = false;
      clearTimeout(copiedTimer);
      clearTimeout(secondTimer);
      copiedTimer = setTimeout(() => paintShare(false), 2000);
      secondTimer = setTimeout(() => (second.hidden = true), 12_000);
    },
    setThreeDEnabled(on) {
      for (const b of [skin, add, reset]) b.setAttribute('aria-disabled', String(!on));
    },
    hideHint() {
      clearTimeout(hintTimer);
      hint.classList.add('gone');
    },
    openSheet(open) {
      if (open) rail.setAttribute('data-open', '');
      else rail.removeAttribute('data-open');
    },
  };

  const guarded = (b: HTMLElement, fn: () => void): void =>
    b.addEventListener('click', () => {
      if (b.getAttribute('aria-disabled') !== 'true') fn();
    });
  guarded(skin, () => o.onSkin(!skinOn));
  guarded(add, () => o.onArm(!armed));
  guarded(reset, o.onReset);
  guarded(ar, () => {
    if (arState === 'ready') o.onAr();
  });
  share.addEventListener('click', o.onShare);
  second.addEventListener('click', o.onSecond);
  byId('btn-notes').addEventListener('click', () => api.openSheet(true));
  byId('sheet-close').addEventListener('click', () => api.openSheet(false));
  return api;
}
