// Minimapa (canto inferior direito): pisos por área, contornos das zonas, você (amarelo), os outros (cinza)
// e o retângulo visível. Clique/arrasto centraliza a câmera. Redesenha ~20 fps só enquanto visível.
import { TILE } from '../../../shared/map/tile';
import type { MinimapSource } from '../world/api';
import { onLocaleChange, t } from '../i18n';
import { h, setHidden } from './dom';
import { AREA_FLOOR_COLOR, fitProjection, miniToWorld, viewToMini, worldToMini, type MiniProjection } from './minimap-logic';
import type { Panel } from './deps';

const WIDTH = 220;
const MAX_HEIGHT = 180;
const FRAME_MS = 50;

export interface MinimapPanel extends Panel {
  onToggle(cb: (open: boolean) => void): () => void;
}

export function createMinimap(root: HTMLElement, getSource: () => MinimapSource, initiallyOpen: boolean): MinimapPanel {
  const canvas = h('canvas', { class: 'ui-minimap__canvas', attrs: { 'aria-label': t('shell.minimap.canvasLabel'), role: 'img' } });
  const el = h('div', { class: 'ui-minimap of-panel of-panel--float', attrs: { id: 'ui-minimap' } }, canvas);
  const offLocale = onLocaleChange(() => canvas.setAttribute('aria-label', t('shell.minimap.canvasLabel')));
  let open = initiallyOpen;
  setHidden(el, !open);
  const toggleCbs = new Set<(open: boolean) => void>();

  const bg = document.createElement('canvas');
  let bgVersion = -1;
  let bgKey = '';
  let proj: MiniProjection = { scale: 1, ox: 0, oy: 0 };
  let cssW = WIDTH;
  let cssH = MAX_HEIGHT;
  let dpr = 1;
  let raf = 0;
  let last = 0;
  let colors = { yellow: '#ffd800', gray: '#C8C5CA' };
  let dragging = false;

  const readColors = () => {
    const cs = getComputedStyle(root);
    colors = { yellow: cs.getPropertyValue('--accent').trim() || colors.yellow, gray: cs.getPropertyValue('--gray-100').trim() || colors.gray };
  };

  function layout(src: MinimapSource): void {
    const ww = src.assembly.w * TILE;
    const wh = src.assembly.h * TILE;
    const nextH = Math.max(60, Math.min(MAX_HEIGHT, Math.round((WIDTH * wh) / Math.max(1, ww))));
    const nextDpr = Math.min(2, window.devicePixelRatio || 1);
    const key = `${src.layoutVersion}|${nextH}|${nextDpr}`;
    if (key === bgKey) return;
    bgKey = key;
    bgVersion = src.layoutVersion;
    cssW = WIDTH;
    cssH = nextH;
    dpr = nextDpr;
    for (const c of [canvas, bg]) {
      c.width = Math.round(cssW * dpr);
      c.height = Math.round(cssH * dpr);
    }
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    proj = fitProjection(ww, wh, cssW, cssH, 4);
    const g = bg.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cssW, cssH);
    g.fillStyle = '#16151a';
    g.fillRect(proj.ox, proj.oy, ww * proj.scale, wh * proj.scale);
    for (const a of src.assembly.areas) {
      const p = worldToMini(proj, a.rect.x * TILE, a.rect.y * TILE);
      g.fillStyle = AREA_FLOOR_COLOR[a.kind] ?? '#2a2930';
      g.fillRect(p.x, p.y, a.rect.w * TILE * proj.scale, a.rect.h * TILE * proj.scale);
    }
    g.lineWidth = 1;
    for (const z of src.assembly.zones) {
      g.strokeStyle = z.color || colors.yellow;
      g.globalAlpha = 0.75;
      for (const r of z.rects) {
        const p = worldToMini(proj, r.x * TILE, r.y * TILE);
        g.strokeRect(Math.round(p.x) + 0.5, Math.round(p.y) + 0.5, Math.max(1, r.w * TILE * proj.scale - 1), Math.max(1, r.h * TILE * proj.scale - 1));
      }
    }
    g.globalAlpha = 1;
  }

  function draw(): void {
    const src = getSource();
    if (src.layoutVersion !== bgVersion || !bgKey) layout(src);
    const g = canvas.getContext('2d');
    if (!g) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.drawImage(bg, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const a of src.avatars()) {
      if (a.self) continue;
      const p = worldToMini(proj, a.x, a.y);
      g.fillStyle = colors.gray;
      g.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 1, 3, 3);
    }
    for (const a of src.avatars()) {
      if (!a.self) continue;
      const p = worldToMini(proj, a.x, a.y);
      g.fillStyle = '#121212';
      g.fillRect(Math.round(p.x) - 3, Math.round(p.y) - 3, 6, 6);
      g.fillStyle = colors.yellow;
      g.fillRect(Math.round(p.x) - 2, Math.round(p.y) - 2, 4, 4);
    }
    const v = viewToMini(proj, src.view(), cssW, cssH);
    g.strokeStyle = '#ffffff';
    g.globalAlpha = 0.8;
    g.lineWidth = 1;
    g.strokeRect(Math.round(v.x) + 0.5, Math.round(v.y) + 0.5, Math.max(1, v.w - 1), Math.max(1, v.h - 1));
    g.globalAlpha = 1;
  }

  function loop(t: number): void {
    raf = 0;
    if (!open) return;
    if (t - last >= FRAME_MS) {
      last = t;
      try {
        draw();
      } catch (err) {
        console.error('[minimapa]', err);
      }
    }
    raf = requestAnimationFrame(loop);
  }
  function start(): void {
    if (open && !raf && !document.hidden) raf = requestAnimationFrame(loop);
  }

  function pointTo(e: PointerEvent): void {
    const src = getSource();
    const r = canvas.getBoundingClientRect();
    const w = miniToWorld(proj, ((e.clientX - r.left) / r.width) * cssW, ((e.clientY - r.top) / r.height) * cssH, src.assembly.w * TILE, src.assembly.h * TILE);
    src.centerOn(w.x, w.y);
  }
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
    pointTo(e);
  });
  canvas.addEventListener('pointermove', (e) => dragging && pointTo(e));
  const end = () => (dragging = false);
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  const onVis = () => (document.hidden ? undefined : start());
  document.addEventListener('visibilitychange', onVis);

  function setOpen(v: boolean): void {
    if (v === open) return;
    open = v;
    setHidden(el, !v);
    if (v) {
      readColors();
      bgKey = '';
      start();
    }
    for (const cb of toggleCbs) cb(v);
  }
  readColors();
  start();

  return {
    el,
    get isOpen() {
      return open;
    },
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(!open),
    onToggle(cb) {
      toggleCbs.add(cb);
      return () => void toggleCbs.delete(cb);
    },
    destroy() {
      open = false;
      offLocale();
      if (raf) cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
      el.remove();
    },
  };
}
