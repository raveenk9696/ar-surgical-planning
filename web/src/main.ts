import '@fontsource-variable/inter/wght.css';
import '@fontsource/homemade-apple/latin-400.css';
import './styles/tokens.css';
import './styles/app.css';
import { asset, RELAYS } from './config';
import { exposeDebug, parseFlags } from './debug';
import { createMulti } from './net/multi';
import { createNostrTransport } from './net/nostr';
import { createTabsTransport } from './net/tabs';
import type { Transport } from './net/transport';
import { createViewer, type Viewer } from './scene/viewer';
import { createEngine } from './sync/engine';
import { newPeer } from './sync/identity';
import { newToken, readToken, shareUrl, split } from './sync/roomId';
import { setupAbout } from './ui/about';
import { byId } from './ui/dom';
import { createHud } from './ui/hud';
import { createNotesView } from './ui/notesList';
import { createPeopleView, createRoster } from './ui/people';
import { createStatus, MESSAGES } from './ui/status';

const WAIT_FOR_PEER_MS = 10_000;
const LITE_UA = /Android|iPhone|iPad|Quest|OculusBrowser|HoloLens/;

const flags = parseFlags(location.search);
const hash = readToken(location.hash);
const token = hash ?? newToken();
if (!hash) history.replaceState(null, '', `${location.pathname}${location.search}#r=${token}`);
const { roomId } = split(token);
const bootedAt = Date.now();
const quality = flags.quality ?? (matchMedia('(pointer: coarse)').matches || LITE_UA.test(navigator.userAgent) ? 'lite' : 'full');

function storage(): Storage | undefined {
  try {
    return flags.hero ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function modelUrl(): string {
  const full = import.meta.env.VITE_MODEL_URL ?? asset('models/abdomen.glb');
  return quality === 'lite' ? full.replace(/\.glb$/, '-lite.glb') : full;
}

async function copyLink(): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(shareUrl(token, location));
    return true;
  } catch {
    return false;
  }
}

function boot(): void {
  const self = newPeer();
  const status = createStatus();
  let newer = false;
  const tabs = createTabsTransport(roomId, { enabled: flags.transport !== 'net' });
  const multi = createMulti(tabs);
  const engine = createEngine({
    token,
    self,
    transport: multi,
    now: Date.now,
    storage: storage(),
    onNewerVersion: () => {
      newer = true;
      renderStatus();
    },
  });
  if (flags.debug) exposeDebug(engine);

  const roster = createRoster(self.id);
  let viewer: Viewer | null = null;

  const openSecond = (): void => {
    const roomy = matchMedia('(min-width: 960px) and (pointer: fine)').matches;
    const w = roomy
      ? window.open(location.href, 'asp-second', `popup=yes,width=${Math.round(Math.min(720, screen.availWidth / 2))},height=${Math.round(screen.availHeight * 0.9)},left=${Math.round(((screen as Screen & { availLeft?: number }).availLeft ?? 0) + screen.availWidth / 2)}`)
      : window.open(location.href, '_blank');
    if (!w) void copyLink().then(() => status.toast(MESSAGES.popupBlocked, 6000));
  };

  const hud = createHud({
    onSkin: (on) => viewer?.setSkin(on),
    onArm: (on) => {
      hud.setArmed(on);
      viewer?.arm(on);
    },
    onReset: () => viewer?.stage.resetView(true),
    onShare: () => {
      void copyLink().then((ok) => {
        if (ok) hud.setShareCopied();
        else status.toast(`Copy this link: ${shareUrl(token, location)}`, 9000);
      });
    },
    onSecond: openSecond,
    onAr: () => undefined,
  });

  const notesView = createNotesView(roster, {
    onHover: (id) => viewer?.hover(id),
    onSelect: (id) => {
      notesView.select(id);
      viewer?.focus(id);
    },
    onDelete: (id) => engine.deleteNote(id),
  });
  const people = createPeopleView(roster, { onOpenSecond: openSecond, onOpenSheet: () => hud.openSheet(true) });
  setupAbout();

  function renderStatus(): void {
    const s = engine.state;
    const waiting = hash !== null && s.peers.size === 0 && s.netPeers === 0 && Date.now() - bootedAt > WAIT_FOR_PEER_MS;
    status.render(s.link, { netExpected: flags.transport !== 'tabs' && !flags.hero, waiting, newer });
  }
  setTimeout(renderStatus, WAIT_FOR_PEER_MS + 50);

  engine.subscribe((s, c) => {
    if (c.peers) {
      roster.update(s);
      people.render(s);
      notesView.recolor();
    }
    if (c.notes.length) notesView.render(s, c.notes);
    viewer?.sync(s, c);
    if (c.link || c.peers) renderStatus();
  });

  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    hud.setArmed(false);
    viewer?.arm(false);
    hud.openSheet(false);
  });
  addEventListener('pagehide', () => engine.stop());
  addEventListener('pageshow', (e) => {
    if (e.persisted) engine.start();
  });

  people.render(engine.state);
  notesView.render(engine.state, []);
  engine.start();
  renderStatus();
  hud.setAr('unsupported');

  const canvas = byId<HTMLCanvasElement>('stage');
  try {
    viewer = createViewer(canvas, {
      engine,
      roster,
      notesView,
      status,
      quality,
      onDisarm: () => {
        hud.setArmed(false);
        viewer?.arm(false);
      },
      onInteract: () => {
        hud.hideHint();
        hud.openSheet(false);
      },
    });
  } catch {
    showTile(MESSAGES.noGl);
    hud.setThreeDEnabled(false);
    byId('progress').hidden = true;
    lazyNet(multi);
    return;
  }
  const v = viewer;
  if (flags.debug) exposeDebug(engine, v);
  v.sync(engine.state, { notes: [...engine.state.notes.keys()], peers: true, link: false });
  v.layout();
  addEventListener('resize', () => v.layout());
  void v.stage.firstFrame.then(() => lazyNet(multi));

  const bar = byId('progress');
  v.load(modelUrl(), (f) => {
    bar.style.setProperty('--p', String(f));
    bar.setAttribute('aria-valuenow', String(Math.round(f * 100)));
  }).then(
    () => {
      bar.hidden = true;
    },
    (e: unknown) => {
      bar.hidden = true;
      hud.setThreeDEnabled(false);
      showTile(e instanceof Error ? e.message : 'The 3D model could not be loaded.');
      lazyNet(multi);
    },
  );
}

let netStarted = false;
function lazyNet(multi: ReturnType<typeof createMulti>): void {
  if (netStarted || flags.transport === 'tabs' || flags.hero) return;
  netStarted = true;
  void createNostrTransport(token, flags.relays ?? RELAYS).then((t: Transport) => multi.add(t));
}

function showTile(text: string): void {
  byId('model-error-text').textContent = text;
  byId('model-error').hidden = false;
  byId('btn-reload').addEventListener('click', () => location.reload());
}

boot();
