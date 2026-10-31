import type { LinkStatus } from '../types';
import { byId } from './dom';
import { icon, type IconName } from './icons';

export const MESSAGES = {
  waiting: 'Waiting for the other person. Their page must be open.',
  netDown: 'Internet sharing is down. Two tabs in this browser still sync.',
  blocked: 'Blocked on this network. Try another network. Tabs in this browser still work.',
  roomFull: 'This room has 100 notes. Delete one to add more.',
  ownFull: 'You have 20 notes. Delete one to add more.',
  rate: 'Slow down. One note per second.',
  newer: 'A newer version is open in another tab. Reload.',
  popupBlocked: 'Your browser blocked the new window. The link is copied: paste it in a new tab.',
  noGl: '3D is not available in this browser.',
} as const;

type Chip = { label: string; icon: IconName } | null;

export function chipFor(link: LinkStatus, netExpected: boolean): Chip {
  switch (link.net) {
    case 'connecting': return { label: 'Connecting', icon: 'spinner' };
    case 'ok': return { label: 'Live', icon: 'check' };
    case 'blocked': return { label: 'Blocked on this network', icon: 'check' };
    case 'down': return { label: 'Tabs only', icon: 'check' };
    case 'off': return netExpected ? null : { label: 'Tabs only', icon: 'check' };
  }
}

export function noticeFor(link: LinkStatus): string | null {
  if (link.net === 'down') return MESSAGES.netDown;
  if (link.net === 'blocked') return MESSAGES.blocked;
  return null;
}

export interface StatusView {
  render(link: LinkStatus, o: { netExpected: boolean; waiting: boolean; newer: boolean }): void;
  toast(text: string, ms?: number): void;
}

export function createStatus(): StatusView {
  const chip = byId('status');
  const notice = byId('notice');
  const toast = byId('toast');
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let shownChip = '';

  return {
    render(link, o) {
      const c = chipFor(link, o.netExpected);
      const key = c ? `${c.label}|${c.icon}` : '';
      if (key !== shownChip) {
        shownChip = key;
        chip.hidden = !c;
        chip.replaceChildren();
        if (c) chip.append(icon(c.icon), document.createTextNode(c.label));
      }
      const text = o.newer ? MESSAGES.newer : (noticeFor(link) ?? (o.waiting ? MESSAGES.waiting : null));
      notice.hidden = !text;
      notice.textContent = text;
    },
    toast(text, ms = 3200) {
      toast.textContent = text;
      toast.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove('show'), ms);
    },
  };
}
