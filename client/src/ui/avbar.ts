// Barra de A/V (WP8): faixa de tiles no topo (eu primeiro, depois quem eu ouço, do mais
// perto para o mais longe) e controles no centro inferior. Vídeo quando há câmera/tela; sem vídeo,
// a cabeça do avatar + nome + microfone. Tile de quem fala ganha a borda amarela. No celular os
// tiles viram fichas com o avatar. Escondida inteira quando o servidor não tem LiveKit.
import './avbar.css';
import type { Track } from 'livekit-client';
import type { Appearance } from '../../../shared/model';
import { CHARACTER_SHEET, avatarCanvas, characterSprite } from '../art';
import type { LocalMediaState, MediaManager } from '../av/livekit';
import { openDevicesModal } from '../av/devices-modal';
import { STRIP_TILE, gridRows, planTiles, tileSize } from './avbar-layout';
import { safeLocalStorage } from './prefs';
import { getLocale, onLocaleChange, t } from '../i18n';
import type { OfficeClientStore } from '../net/world-store';
import { h, setAttr, setHidden, setStyleVar, setText, setTitle } from './dom';
import { pixelIcon } from './icons';

const AV_ICONS = {
  mic: pixelIcon(['...##...', '..####..', '..####..', '..####..', '..####..', '#.####.#', '#..##..#', '.#....#.', '..####..', '...##...', '.######.']),
  micOff: pixelIcon(['#..##...', '.#####..', '..####..', '..####..', '..####..', '#.####.#', '#..###.#', '.#...##.', '..####.#', '...##...', '.######.']),
  cam: pixelIcon(['..........', '#######...', '#######.##', '#######.##', '##########', '#######.##', '#######.##', '#######...']),
  camOff: pixelIcon(['#.........', '.######...', '#.#####.##', '##.####.##', '###.######', '####.##.##', '#####.#.##', '#######...']),
  screen: pixelIcon(['##########', '#........#', '#...##...#', '#..####..#', '#...##...#', '#........#', '##########', '....##....', '..######..']),
  leave: pixelIcon(['####....', '#.......', '#....#..', '#.######', '#....#..', '#.......', '####....']),
  caret: pixelIcon(['#......#', '##....##', '.##..##.', '..####..', '...##...']),
  expand: pixelIcon(['####..####', '#........#', '#........#', '#........#', '..........', '#........#', '#........#', '#........#', '####..####']),
  shrink: pixelIcon(['..##..##..', '..##..##..', '###....###', '..........', '..........', '###....###', '..##..##..', '..##..##..']),
  pin: pixelIcon(['..####..', '..#..#..', '..#..#..', '.######.', '...##...', '...##...', '...##...', '...#....']),
  stop: pixelIcon(['########', '########', '########', '########', '########', '########', '########']),
  chevron: pixelIcon(['..#.', '.##.', '##..', '.##.', '..#.']),
};

/** Parte do art usada aqui (injetável). */
export interface AvBarArt {
  characterSprite: typeof characterSprite;
  avatarCanvas: typeof avatarCanvas;
}

export interface AvBarOptions {
  manager: MediaManager;
  store: OfficeClientStore;
  /** Eu (id do usuário); padrão: `store.selfId`. */
  me?: { id: number } | number | null;
  art?: AvBarArt;
}

export interface AvBarHandle {
  readonly el: HTMLElement;
  /** false = servidor sem LiveKit: a barra some inteira. */
  setAvailable(on: boolean): void;
  /** Elemento onde o gerenciador pode pendurar os <audio> dos colegas. */
  readonly audioHost: HTMLElement;
  destroy(): void;
}

interface TileView {
  key: string;
  el: HTMLElement;
  video: HTMLVideoElement;
  head: HTMLElement;
  name: HTMLElement;
  muted: HTMLElement;
  track: Track | null;
  headKey: string;
  expandBtn: HTMLButtonElement;
  pinBtn: HTMLButtonElement;
  stopBtn: HTMLButtonElement;
}

export const AVBAR_MIN_KEY = 'oficio:avbar-min';

/** Cabeça do avatar (recorte do sprite em pé, de frente) ampliada, em cache por aparência. */
const headCache = new Map<string, HTMLCanvasElement>();
function headCanvas(art: AvBarArt, userId: number, appearance: Appearance | null, scale = 3): HTMLCanvasElement {
  if (!appearance) return art.avatarCanvas(userId, { scale });
  const key = `${JSON.stringify(appearance)}|${scale}`;
  let c = headCache.get(key);
  if (c) return c;
  const sprite = art.characterSprite({ appearance, dir: 'down', pose: 'stand', frame: 0 });
  const sw = Math.min(sprite.canvas.width, CHARACTER_SHEET.w) - 4;
  const sh = Math.min(20, sprite.canvas.height - 2);
  c = document.createElement('canvas');
  c.width = sw * scale;
  c.height = sh * scale;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sprite.canvas, 2, 2, sw, sh, 0, 0, c.width, c.height);
  }
  if (headCache.size > 200) headCache.clear();
  headCache.set(key, c);
  return c;
}

/** Copia o canvas em cache (um mesmo nó não pode estar em dois tiles). */
/** innerHTML só quando muda (os botões re-renderizam a cada mudança de fala). */
function setHtml(el: HTMLElement, html: string): void {
  const rec = el as unknown as { __html?: string };
  if (rec.__html === html) return;
  rec.__html = html;
  el.innerHTML = html;
}

function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  c.className = 'av-tile__head-img';
  c.getContext('2d')?.drawImage(src, 0, 0);
  return c;
}

/**
 * Clique de mouse não deixa o botão focado: Enter/Espaço são atalhos do mundo (Enter abre o chat) e,
 * com o foco num botão, o navegador também o "clica" (ex.: "Sair do áudio" disparando sozinho).
 * Teclado (detail 0) mantém o foco, para a navegação por Tab continuar funcionando.
 */
function dropMouseFocus(b: HTMLButtonElement, ev: MouseEvent): void {
  if (ev.detail > 0) b.blur();
}

export function mountAvBar(slot: HTMLElement, opts: AvBarOptions): AvBarHandle {
  const { manager, store } = opts;
  const art: AvBarArt = opts.art ?? { characterSprite, avatarCanvas };
  const meId = (): number | null => (typeof opts.me === 'number' ? opts.me : opts.me?.id) ?? store.selfId;

  // ---------------------------------------------------------------- estrutura
  const strip = h('div', { class: 'av-strip', role: 'list' });
  const unlock = h('button', { class: 'of-btn of-btn--primary of-btn--sm av-unlock', type: 'button', hidden: true });
  unlock.addEventListener('click', () => void manager.unlockAudio());
  const status = h('div', { class: 'av-status of-caption', attrs: { 'aria-live': 'polite' }, hidden: true });

  // Rótulos (title/aria-label) são definidos em renderControls/applyTexts, no idioma atual.
  const ctrlBtn = (cls: string, onClick: () => void): HTMLButtonElement => {
    const b = h('button', { class: `av-ctrl ${cls}`, type: 'button' });
    b.addEventListener('click', (ev) => {
      dropMouseFocus(b, ev);
      onClick();
    });
    return b;
  };
  const micBtn = ctrlBtn('av-ctrl--mic', () => void manager.toggleMic());
  const camBtn = ctrlBtn('av-ctrl--cam', () => void manager.toggleCam());
  const screenBtn = ctrlBtn('av-ctrl--screen', () => void manager.toggleScreen());
  screenBtn.innerHTML = AV_ICONS.screen;
  const caretBtn = ctrlBtn('av-ctrl--caret', () => openDevicesModal(manager));
  caretBtn.innerHTML = AV_ICONS.caret;
  setAttr(caretBtn, 'aria-haspopup', 'dialog');
  const leaveBtn = h('button', { class: 'of-btn of-btn--sm av-leave', type: 'button' });
  leaveBtn.addEventListener('click', (ev) => {
    dropMouseFocus(leaveBtn, ev);
    if (manager.state.status === 'left' || manager.state.status === 'idle') void manager.rejoin();
    else void manager.leave();
  });
  const controls = h(
    'div',
    { class: 'av-controls of-panel of-panel--float', role: 'toolbar' },
    micBtn,
    camBtn,
    screenBtn,
    caretBtn,
    leaveBtn,
  );
  const audioHost = h('div', { class: 'av-audio-host', hidden: true });
  const stage = h('div', { class: 'av-stage', hidden: true });
  const minBtn = h('button', { class: 'av-min', type: 'button', attrs: { 'aria-pressed': 'false' } });
  minBtn.innerHTML = AV_ICONS.chevron;
  const row = h('div', { class: 'av-row' }, strip, minBtn);
  const root = h('div', { class: 'av-bar', hidden: true }, stage, row, unlock, status, controls, audioHost);
  slot.append(root);

  let minimized = false;
  try {
    minimized = safeLocalStorage()?.getItem(AVBAR_MIN_KEY) === '1';
  } catch {
    minimized = false;
  }
  function setMinimized(on: boolean): void {
    minimized = on;
    try {
      safeLocalStorage()?.setItem(AVBAR_MIN_KEY, on ? '1' : '0');
    } catch {
      // sem armazenamento: vale só nesta sessão
    }
    schedule();
  }
  minBtn.addEventListener('click', () => setMinimized(!minimized));
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Escape') return;
    if (expanded) setExpanded(null);
  };
  document.addEventListener('keydown', onKey);

  // ---------------------------------------------------------------- tiles
  const tiles = new Map<string, TileView>();
  let expanded: string | null = null;
  let pinned: string | null = null;

  function setExpanded(key: string | null): void {
    expanded = key;
    schedule();
  }
  function setPinned(key: string | null): void {
    pinned = key;
    schedule();
  }

  function makeTile(key: string, screen: boolean): TileView {
    const video = h('video', { class: 'av-tile__video', attrs: { playsinline: true, autoplay: true, muted: true } });
    video.muted = true;
    const head = h('div', { class: 'av-tile__head' });
    const name = h('span', { class: 'of-tile__name' });
    const muted = h('span', { class: 'of-tile__muted', hidden: true });
    muted.innerHTML = AV_ICONS.micOff;
    // Rótulos dos botões são aplicados em render(), no idioma atual.
    const tileBtn = (cls: string, icon: string, onClick: () => void): HTMLButtonElement => {
      const b = h('button', { class: `av-tile__btn ${cls}`, type: 'button' });
      b.innerHTML = icon;
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        onClick();
      });
      return b;
    };
    const expandBtn = tileBtn('av-tile__btn--expand', AV_ICONS.expand, () => setExpanded(expanded === key ? null : key));
    const pinBtn = tileBtn('av-tile__btn--pin', AV_ICONS.pin, () => setPinned(pinned === key ? null : key));
    const stopBtn = tileBtn('av-tile__btn--stop', AV_ICONS.stop, () => void manager.toggleScreen());
    stopBtn.hidden = true;
    const actions = h('div', { class: 'av-tile__actions' }, pinBtn, expandBtn, stopBtn);
    const el = h('div', { class: `of-tile av-tile${screen ? ' av-tile--screen' : ''}`, role: 'listitem' }, video, head, name, muted, actions);
    el.addEventListener('dblclick', () => setExpanded(expanded === key ? null : key));
    return { key, el, video, head, name, muted, track: null, headKey: '', expandBtn, pinBtn, stopBtn };
  }

  function setTrack(t: TileView, track: Track | null): void {
    if (t.track === track) return;
    if (t.track) t.track.detach(t.video);
    t.track = track;
    if (track) track.attach(t.video);
    t.el.classList.toggle('has-video', !!track);
  }

  function updateHead(t: TileView, id: number): void {
    const u = store.users.get(id) ?? (store.self?.id === id ? store.self : undefined);
    const appearance = u?.appearance ?? (id === meId() ? (store.self?.appearance ?? null) : null);
    const key = `${id}|${appearance ? JSON.stringify(appearance) : '-'}`;
    if (t.headKey === key) return;
    t.headKey = key;
    try {
      t.head.replaceChildren(cloneCanvas(headCanvas(art, id, appearance)));
    } catch {
      t.head.replaceChildren();
    }
  }

  /** Quem aparece na faixa: eu (se no A/V) e quem eu ouço, do mais alto ao mais baixo volume. */
  function people(): number[] {
    const self = meId();
    const av = store.avSet;
    const ids = (av?.hear ?? []).filter((id) => id !== self);
    const vol = (id: number): number => av?.volumes[String(id)] ?? 0;
    ids.sort((a, b) => vol(b) - vol(a) || store.nameOf(a).localeCompare(store.nameOf(b), getLocale()));
    const st = manager.state.status;
    const inAv = st === 'connected' || st === 'reconnecting' || st === 'connecting';
    return inAv && self !== null ? [self, ...ids] : inAv ? ids : [];
  }

  function render(): void {
    raf = 0;
    const st = manager.state;
    const self = meId();
    const wanted: { key: string; id: number; screen: boolean }[] = [];
    for (const id of people()) {
      const v = manager.videoOf(id);
      if (v.screen) wanted.push({ key: `${id}:screen`, id, screen: true });
      wanted.push({ key: `${id}:main`, id, screen: false });
    }
    const keep = new Set(wanted.map((w) => w.key));
    for (const [key, t] of tiles) {
      if (keep.has(key)) continue;
      setTrack(t, null);
      t.el.remove();
      tiles.delete(key);
      if (expanded === key) expanded = null;
      if (pinned === key) pinned = null;
    }
    let prev: HTMLElement | null = null;
    for (const w of wanted) {
      let tile = tiles.get(w.key);
      if (!tile) {
        tiles.set(w.key, (tile = makeTile(w.key, w.screen)));
        // Tela compartilhada que aparece abre ampliada por padrão.
        if (w.screen) expanded = w.key;
      }
      const isSelf = w.id === self;
      const v = manager.videoOf(w.id);
      const media = isSelf ? { mic: st.mic, cam: st.cam } : store.media.get(w.id);
      const speaking = isSelf ? st.speaking : store.speaking.has(w.id);
      setTrack(tile, w.screen ? v.screen : v.camera);
      updateHead(tile, w.id);
      const name = store.nameOf(w.id);
      const label = w.screen ? t('av.tile.screenOf', { name }) : isSelf ? t('shell.nameYou', { name }) : name;
      setText(tile.name, label);
      setTitle(tile.el, label);
      setTitle(tile.muted, t('av.tile.muted'));
      setHidden(tile.muted, w.screen || !media || media.mic);
      tile.el.classList.toggle('is-self', isSelf);
      tile.el.classList.toggle('is-speaking', !w.screen && speaking);
      tile.el.classList.toggle('is-expanded', expanded === w.key);
      tile.el.classList.toggle('is-pinned', pinned === w.key);
      const isExp = expanded === w.key;
      setAttr(tile.expandBtn, 'aria-label', isExp ? t('av.tile.shrink') : t('av.tile.expand'));
      setTitle(tile.expandBtn, isExp ? t('av.tile.shrinkEsc') : t('av.tile.expand'));
      setHtml(tile.expandBtn, isExp ? AV_ICONS.shrink : AV_ICONS.expand);
      const pinLabel = pinned === w.key ? t('av.tile.unpin') : t('av.tile.pin');
      setTitle(tile.pinBtn, pinLabel);
      setAttr(tile.pinBtn, 'aria-label', pinLabel);
      setAttr(tile.pinBtn, 'aria-pressed', pinned === w.key ? 'true' : 'false');
      setTitle(tile.stopBtn, t('av.tile.stop'));
      setAttr(tile.stopBtn, 'aria-label', t('av.tile.stop'));
      setHidden(tile.stopBtn, !(w.screen && isSelf));
    }
    // Ordem: ampliado no palco, resto na faixa (fixado primeiro).
    const plan = planTiles(wanted.map((w) => w.key), pinned, minimized ? null : expanded);
    prev = null;
    for (const key of plan.strip) {
      const tile = tiles.get(key)!;
      const anchor: ChildNode | null = prev ? prev.nextSibling : strip.firstChild;
      if (anchor !== tile.el) strip.insertBefore(tile.el, anchor);
      prev = tile.el;
    }
    const big = plan.expanded ? tiles.get(plan.expanded)! : null;
    if (big && stage.firstChild !== big.el) stage.replaceChildren(big.el);
    if (!big && stage.firstChild) stage.replaceChildren();
    setHidden(stage, !big);
    // Tamanho dos tiles pela quantidade; a faixa sob um ampliado fica pequena.
    const size = big ? STRIP_TILE : tileSize(wanted.length);
    const avail = Math.min(typeof innerWidth === 'number' ? innerWidth - 80 : 1200, 1200);
    setStyleVar(root, '--av-w', `${size.w}px`);
    setStyleVar(root, '--av-h', `${size.h}px`);
    setStyleVar(root, '--av-rows', String(gridRows(plan.strip.length, avail, size.w)));
    root.classList.toggle('is-min', minimized);
    row.classList.toggle('is-empty', wanted.length === 0);
    setAttr(minBtn, 'aria-pressed', minimized ? 'true' : 'false');
    setAttr(minBtn, 'aria-label', minimized ? t('av.restore') : t('av.minimize'));
    setTitle(minBtn, minimized ? t('av.restoreShort') : t('av.minimizeShort'));
    setHidden(minBtn, wanted.length === 0);
    renderControls(st);
  }

  /** Textos fixos (fora do render); roda na montagem e a cada troca de idioma. */
  function applyTexts(): void {
    setAttr(strip, 'aria-label', t('av.strip.label'));
    setText(unlock, t('av.unlock'));
    setAttr(controls, 'aria-label', t('av.controls.label'));
    setTitle(caretBtn, t('av.devices.title'));
    setAttr(caretBtn, 'aria-label', t('av.devices.title'));
  }

  function renderControls(st: LocalMediaState): void {
    const inRoom = st.status === 'connected';
    setHtml(micBtn, st.mic ? AV_ICONS.mic : AV_ICONS.micOff);
    const micLabel = st.micBlocked ? t('av.mic.blocked') : st.mic ? t('av.mic.off') : t('av.mic.on');
    setTitle(micBtn, micLabel);
    setAttr(micBtn, 'aria-label', micLabel);
    setAttr(micBtn, 'aria-pressed', st.mic ? 'true' : 'false');
    micBtn.classList.toggle('is-off', !st.mic);
    micBtn.disabled = !inRoom;

    setHtml(camBtn, st.cam ? AV_ICONS.cam : AV_ICONS.camOff);
    const camLabel = st.camBlocked ? t('av.cam.blocked') : st.cam ? t('av.cam.off') : t('av.cam.on');
    setTitle(camBtn, camLabel);
    setAttr(camBtn, 'aria-label', camLabel);
    setAttr(camBtn, 'aria-pressed', st.cam ? 'true' : 'false');
    camBtn.classList.toggle('is-off', !st.cam);
    camBtn.disabled = !inRoom;

    const canScreen = inRoom && (st.screenAllowed || st.screen);
    const screenLabel = st.screen ? t('av.screen.stop') : st.screenAllowed ? t('av.screen.share') : t('av.screen.onlyMeeting');
    setTitle(screenBtn, screenLabel);
    setAttr(screenBtn, 'aria-label', screenLabel);
    setAttr(screenBtn, 'aria-pressed', st.screen ? 'true' : 'false');
    screenBtn.classList.toggle('is-active', st.screen);
    screenBtn.disabled = !canScreen;

    const out = st.status === 'left' || st.status === 'idle';
    // Textos vêm do dicionário (sem HTML); o ícone é SVG gerado pelo próprio código.
    const leaveLabel = h('span', { text: t('av.leave') });
    setHtml(leaveBtn, out ? h('span', { text: t('av.join') }).innerHTML : `${AV_ICONS.leave}${leaveLabel.outerHTML}`);
    leaveBtn.className = `of-btn of-btn--sm av-leave ${out ? 'of-btn--primary' : 'av-leave--out'}`;
    leaveBtn.disabled = st.status === 'unavailable';

    setHidden(unlock, !st.audioLocked);
    const text =
      st.status === 'connecting' ? t('av.status.connecting')
      : st.status === 'reconnecting' ? t('av.status.reconnecting')
      : st.status === 'unavailable' ? t('av.status.unavailable')
      : st.status === 'left' ? t('av.status.left')
      : '';
    setText(status, text);
    setHidden(status, !text);
  }

  let raf = 0;
  const schedule = (): void => {
    if (raf) return;
    raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(render) : (setTimeout(render, 16) as unknown as number);
  };

  const offs = [
    manager.on('change', schedule),
    manager.on('tracks', schedule),
    store.on('av', schedule),
    store.on('speaking', schedule),
    store.on('media', schedule),
    store.on('user', schedule),
    store.on('appearance', schedule),
    store.on('leave', schedule),
    store.on('reset', schedule),
    onLocaleChange(() => {
      applyTexts();
      schedule();
    }),
  ];
  applyTexts();
  render();

  return {
    el: root,
    audioHost,
    setAvailable(on) {
      setHidden(root, !on);
      if (on) schedule();
    },
    destroy() {
      for (const off of offs) off();
      if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey);
      for (const tile of tiles.values()) setTrack(tile, null);
      tiles.clear();
      root.remove();
    },
  };
}
