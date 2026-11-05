// Canvas do editor: laço rAF (só redesenha quando algo muda ou a câmera anima), câmera reaproveitada
// do jogo, ponteiro (ferramentas, pan, pinça, roda) e as camadas de desenho:
// fundo #121212 → pisos → overlays de piso (grade, zonas, caminhável) → paredes → móveis por `ay` →
// marcadores (entrada, pontos) → ghost da ferramenta → seleção → problemas → placas e nomes (Poppins).
import type { ArtModule } from '../art/api';
import type { OfficeMapDoc } from '../../../shared/map/doc';
import { BLOCKED, SEAT } from '../../../shared/map/grid';
import { TILE } from '../../../shared/map/tile';
import type { MapIssue } from '../../../shared/map/validate';
import type { Camera } from '../world/camera';
import { StaticScene, type ViewRect } from '../world/render/static';
import type { FurnVis } from '../world/render/scene';
import { furnitureSprites } from '../world/render/scene';
import type { WorldAssets } from '../world/assets';
import { t } from '../i18n';
import type { EditorCtx, PointerInfo, Tool } from './context';
import { COLORS, drawDirArrow, drawTileMarker, strokePx, strokeTiles } from './draw';
import { refBounds } from './geometry';
import { alphaAt, spriteHit } from './hit';
import { nextGesture } from './state';

export const BG = '#121212';
const MAP_BG = '#19191c';
const GRID = 'rgba(255,216,0,0.12)';
const GRID_MAJOR = 'rgba(255,216,0,0.3)';

/** Cor padrão das zonas por tipo. */
export const ZONE_COLORS: Readonly<Record<string, string>> = {
  meeting: '#4970fc',
  lunch: '#04d1d1',
  lounge: '#e810b3',
  quiet: '#04d131',
  phone: '#ffd800',
  open: '#c8c5ca',
};

/** Mistura um #rrggbb com alpha. */
export function rgba(hex: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return `rgba(200,197,202,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export interface ViewHooks {
  tool(): Tool;
  issues(): readonly MapIssue[];
  /** Ponteiro mudou de tile / saiu do canvas. */
  pointer(p: PointerInfo | null): void;
}

export class EditorView {
  readonly canvas: HTMLCanvasElement;
  readonly scene: StaticScene;
  private readonly g: CanvasRenderingContext2D;
  private raf = 0;
  private dirty = true;
  private lastTick = 0;
  private lastHoverKey = '';
  private readonly ro: ResizeObserver;
  private pointers = new Map<number, { x: number; y: number }>();
  private start: PointerInfo | null = null;
  private dragged = false;
  private lastPan: { x: number; y: number } | null = null;
  private pinch: { d: number; zoom: number; cx: number; cy: number } | null = null;
  private fitted = false;
  private readonly view: ViewRect = { x0: 0, y0: 0, x1: 0, y1: 0 };
  private readonly ents: { f: FurnVis; front: boolean; y: number }[] = [];
  private areaMask: { doc: OfficeMapDoc; mask: Uint8Array } | null = null;
  private readonly offs: (() => void)[] = [];

  constructor(
    host: HTMLElement,
    private readonly ctx: EditorCtx,
    private readonly art: ArtModule,
    private readonly camera: Camera,
    private readonly hooks: ViewHooks,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'med-canvas';
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('aria-label', t('editor.canvasLabel'));
    host.append(this.canvas);
    this.g = this.canvas.getContext('2d', { alpha: false })!;
    this.scene = new StaticScene(art);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.bind();
    this.raf = requestAnimationFrame(this.loop);
  }

  setAssets(a: WorldAssets | null): void {
    this.scene.setAssets(a);
    this.redraw();
  }

  redraw(): void {
    this.dirty = true;
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    for (const off of this.offs) off();
    this.canvas.remove();
  }

  // ---------------------------------------------------------------- câmera

  private resize(): void {
    const host = this.canvas.parentElement;
    if (!host) return;
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.camera.setView(w, h, dpr);
    this.updateBounds();
    if (!this.fitted && w > 50 && h > 50) {
      this.fitted = true;
      this.fit(false);
    }
    this.camera.clamp();
    this.redraw();
  }

  /** Limites da câmera: o mapa com uma margem de 6 tiles. */
  updateBounds(): void {
    const doc = this.ctx.doc();
    const m = 6 * TILE;
    this.camera.bounds = { x: -m, y: -m, w: doc.size.w * TILE + 2 * m, h: doc.size.h * TILE + 2 * m };
    const fit = this.camera.fitZoom(this.camera.bounds, 8);
    this.camera.minZoom = Math.max(0.2, Math.min(1, fit));
  }

  /** Enquadra o mapa inteiro. */
  fit(animate = true): void {
    const doc = this.ctx.doc();
    const r = { x: 0, y: 0, w: doc.size.w * TILE, h: doc.size.h * TILE };
    const z = Math.max(this.camera.minZoom, Math.min(this.camera.fitZoom(r, 24), 3));
    if (animate) this.camera.animateTo(r.w / 2, r.h / 2, z, performance.now(), 300);
    else {
      this.camera.zoom = z;
      this.camera.x = r.w / 2;
      this.camera.y = r.h / 2;
      this.camera.clamp();
    }
    this.redraw();
  }

  zoomStep(steps: number): void {
    this.camera.zoomAt(this.camera.stepZoom(steps), this.camera.viewW / 2, this.camera.viewH / 2, performance.now());
    this.redraw();
  }

  zoomTo(z: number): void {
    this.camera.zoomAt(z, this.camera.viewW / 2, this.camera.viewH / 2, performance.now());
    this.redraw();
  }

  /** Centraliza um retângulo de tiles (aproxima se estiver longe). */
  centerOn(r: { x: number; y: number; w: number; h: number }): void {
    const z = Math.max(this.camera.zoom, Math.min(3, this.camera.fitZoom({ x: r.x * TILE, y: r.y * TILE, w: Math.max(4, r.w) * TILE, h: Math.max(4, r.h) * TILE }, 80)));
    this.camera.animateTo((r.x + r.w / 2) * TILE, (r.y + r.h / 2) * TILE, z, performance.now(), 300);
    this.redraw();
  }

  // ---------------------------------------------------------------- ponteiro

  private info(e: PointerEvent | MouseEvent): PointerInfo {
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const w = this.camera.screenToWorld(sx, sy);
    return { sx, sy, wx: w.x, wy: w.y, tx: Math.floor(w.x / TILE), ty: Math.floor(w.y / TILE), shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey, button: e.button };
  }

  private on<K extends keyof HTMLElementEventMap>(el: HTMLElement, type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions): void {
    el.addEventListener(type, fn as EventListener, opts);
    this.offs.push(() => el.removeEventListener(type, fn as EventListener, opts));
  }

  private bind(): void {
    const c = this.canvas;
    this.on(c, 'contextmenu', (e) => e.preventDefault());
    this.on(c, 'pointerdown', (e) => {
      c.focus({ preventScroll: true });
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        this.hooks.tool().cancel?.();
        this.ctx.state.gesture = nextGesture(this.ctx.state.gesture, { t: 'pinch' });
        const [a, b] = [...this.pointers.values()];
        const rect = c.getBoundingClientRect();
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.camera.zoom, cx: (a.x + b.x) / 2 - rect.left, cy: (a.y + b.y) / 2 - rect.top };
        this.start = null;
        return;
      }
      if (this.pointers.size > 2) return;
      const p = this.info(e);
      this.ctx.state.gesture = nextGesture(this.ctx.state.gesture, { t: 'down', sx: p.sx, sy: p.sy, button: e.button, space: this.ctx.state.space });
      this.start = p;
      this.dragged = false;
      this.lastPan = { x: p.sx, y: p.sy };
      const g = this.ctx.state.gesture;
      if (g.k === 'pressing' && !g.pan) this.hooks.tool().down?.(p);
      this.redraw();
    });
    this.on(c, 'pointermove', (e) => {
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pinch && this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinch.d > 0) this.camera.zoomAt(this.pinch.zoom * (d / this.pinch.d), this.pinch.cx, this.pinch.cy, performance.now(), false);
        this.redraw();
        return;
      }
      const p = this.info(e);
      this.ctx.hover = p;
      const hk = `${p.tx},${p.ty}`;
      if (hk !== this.lastHoverKey) {
        this.lastHoverKey = hk;
        this.hooks.pointer(p);
      }
      const g0 = this.ctx.state.gesture;
      if (g0.k === 'idle') {
        this.hooks.tool().hover?.(p);
        return;
      }
      const g = (this.ctx.state.gesture = nextGesture(g0, { t: 'move', sx: p.sx, sy: p.sy, kind: 'rect' }));
      if (g.k !== 'dragging') return;
      this.dragged = true;
      if (g.kind === 'pan') {
        if (this.lastPan) this.camera.panBy(p.sx - this.lastPan.x, p.sy - this.lastPan.y);
        this.lastPan = { x: p.sx, y: p.sy };
        this.redraw();
        return;
      }
      this.hooks.tool().hover?.(p);
      if (this.start) this.hooks.tool().drag?.(p, this.start);
    });
    const end = (e: PointerEvent, cancel: boolean) => {
      this.pointers.delete(e.pointerId);
      if (this.pinch) {
        if (this.pointers.size < 2) {
          this.pinch = null;
          this.camera.settle(performance.now());
          this.ctx.state.gesture = { k: 'idle' };
        }
        return;
      }
      const g = this.ctx.state.gesture;
      const p = this.info(e);
      this.ctx.state.gesture = nextGesture(g, { t: cancel ? 'cancel' : 'up' });
      const pan = (g.k === 'pressing' && g.pan) || (g.k === 'dragging' && g.kind === 'pan');
      if (!pan && this.start && g.k !== 'idle') {
        if (cancel) this.hooks.tool().cancel?.();
        else this.hooks.tool().up?.(p, this.start, this.dragged);
      }
      this.start = null;
      this.lastPan = null;
      this.redraw();
    };
    this.on(c, 'pointerup', (e) => end(e, false));
    this.on(c, 'pointercancel', (e) => end(e, true));
    this.on(c, 'pointerleave', () => {
      if (this.ctx.state.gesture.k !== 'idle') return;
      this.ctx.hover = null;
      this.lastHoverKey = '';
      this.hooks.pointer(null);
      this.hooks.tool().hover?.(null);
      this.redraw();
    });
    this.on(
      c,
      'wheel',
      (e) => {
        e.preventDefault();
        const rect = c.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        // trackpad (dois dedos) faz pan; pinça (ctrl) e roda do mouse fazem zoom
        if (!e.ctrlKey && e.deltaMode === 0 && Math.abs(e.deltaX) > 0.5 && Math.abs(e.deltaY) < 60) {
          this.camera.panBy(-e.deltaX, -e.deltaY);
        } else if (e.ctrlKey) {
          this.camera.zoomAt(this.camera.zoom * Math.exp(-e.deltaY * 0.01), sx, sy, performance.now(), false);
          clearTimeout(this.settleTimer);
          this.settleTimer = setTimeout(() => this.camera.settle(performance.now()), 160);
        } else {
          this.camera.zoomAt(this.camera.stepZoom(e.deltaY < 0 ? 1 : -1), sx, sy, performance.now());
        }
        this.redraw();
      },
      { passive: false },
    );
  }

  private settleTimer: ReturnType<typeof setTimeout> | undefined;

  /** Móvel (id absoluto) cujo pixel sob o ponto é opaco. */
  spriteAt(wx: number, wy: number): string | null {
    const items: FurnVis[] = [];
    for (const vis of this.scene.areas.values()) {
      const p = vis.px;
      if (wx < p.x - 2 * TILE || wx > p.x + p.w + 2 * TILE || wy < p.y - 4 * TILE || wy > p.y + p.h + TILE) continue;
      for (const f of vis.furniture) if (Math.abs(f.ax - wx) < 3 * TILE && wy <= f.ay + 2 && wy > f.ay - 5 * TILE) items.push(f);
    }
    const hit = spriteHit(items, wx, wy, (f) => {
      const fs = furnitureSprites(this.art, f, 0);
      if (!fs) return false;
      for (const s of [fs.base, fs.front]) {
        if (!s) continue;
        const x = wx - Math.round(f.ax - s.ax);
        const y = wy - Math.round(f.ay - s.ay);
        if (alphaAt(s.canvas, x, y)) return true;
      }
      return false;
    });
    return hit?.id ?? null;
  }

  // ---------------------------------------------------------------- desenho

  private loop = (now: number): void => {
    this.raf = requestAnimationFrame(this.loop);
    const anim = this.camera.animating;
    if (anim) this.camera.update(now, null, 0.016);
    // relógios/TVs: um quadro por segundo basta no editor
    if (!this.dirty && !anim && now - this.lastTick < 1000) return;
    this.lastTick = now;
    this.dirty = false;
    try {
      this.draw(now);
    } catch (e) {
      console.error('[editor] falha ao desenhar', e);
    }
  };

  private visibleAreaMask(doc: OfficeMapDoc): Uint8Array {
    if (this.areaMask?.doc === doc) return this.areaMask.mask;
    const { w, h } = doc.size;
    const mask = new Uint8Array(w * h);
    for (const a of doc.areas) {
      if (this.ctx.state.hiddenAreas.has(a.id)) continue;
      for (let y = Math.max(0, a.rect.y); y < Math.min(h, a.rect.y + a.rect.h); y++) for (let x = Math.max(0, a.rect.x); x < Math.min(w, a.rect.x + a.rect.w); x++) mask[y * w + x] = 1;
    }
    this.areaMask = { doc, mask };
    return mask;
  }

  invalidateMask(): void {
    this.areaMask = null;
  }

  private draw(now: number): void {
    const { g, camera, ctx } = this;
    const doc = ctx.doc();
    const sceneData = ctx.scene;
    this.scene.sync(sceneData.layouts, sceneData.version);
    const W = this.canvas.width;
    const H = this.canvas.height;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    g.fillStyle = BG;
    g.fillRect(0, 0, W, H);
    const { scale, ox, oy } = camera.transform();
    g.setTransform(scale, 0, 0, scale, ox, oy);
    const v = this.view;
    v.x0 = -ox / scale;
    v.y0 = -oy / scale;
    v.x1 = v.x0 + W / scale;
    v.y1 = v.y0 + H / scale;
    const zoom = camera.zoom;

    // mapa
    g.fillStyle = MAP_BG;
    g.fillRect(0, 0, doc.size.w * TILE, doc.size.h * TILE);
    this.scene.drawFloors(g, v);

    const st = ctx.state;
    const asm = sceneData.assembly();
    const tx0 = Math.max(0, Math.floor(v.x0 / TILE));
    const ty0 = Math.max(0, Math.floor(v.y0 / TILE));
    const tx1 = Math.min(doc.size.w, Math.ceil(v.x1 / TILE));
    const ty1 = Math.min(doc.size.h, Math.ceil(v.y1 / TILE));

    // ---- overlays de piso
    if (st.overlays.walk && asm && asm.w === doc.size.w && asm.h === doc.size.h) {
      const mask = this.visibleAreaMask(doc);
      g.save();
      for (let y = ty0; y < ty1; y++) {
        for (let x = tx0; x < tx1; x++) {
          const i = y * doc.size.w + x;
          if (!mask[i]) continue;
          const c = asm.grid.cells[i];
          if (c === BLOCKED) {
            g.fillStyle = 'rgba(227,11,47,0.25)';
            g.fillRect(x * TILE, y * TILE, TILE, TILE);
          } else {
            if (c === SEAT) {
              g.fillStyle = 'rgba(73,112,252,0.25)';
              g.fillRect(x * TILE, y * TILE, TILE, TILE);
            }
            if (asm.spawn.length && !asm.reach[i]) {
              // inalcançável: hachurado
              g.strokeStyle = 'rgba(227,11,47,0.6)';
              g.lineWidth = 1 / scale;
              g.beginPath();
              for (let k = 0; k <= TILE; k += 4) {
                g.moveTo(x * TILE + k, y * TILE);
                g.lineTo(x * TILE, y * TILE + k);
                g.moveTo(x * TILE + TILE, y * TILE + k);
                g.lineTo(x * TILE + k, y * TILE + TILE);
              }
              g.stroke();
            }
          }
        }
      }
      g.restore();
    }
    if (st.overlays.zones) {
      for (const z of doc.zones) {
        const col = z.color ?? ZONE_COLORS[z.kind] ?? '#c8c5ca';
        for (const r of z.rects) {
          g.fillStyle = rgba(col, 0.2);
          g.fillRect(r.x * TILE, r.y * TILE, r.w * TILE, r.h * TILE);
          strokeTiles(g, r, rgba(col, 0.9), scale, 1.5);
        }
      }
    }
    if (st.overlays.grid && zoom >= 0.75) {
      g.save();
      g.lineWidth = 1 / scale;
      for (const major of [false, true]) {
        g.strokeStyle = major ? GRID_MAJOR : GRID;
        g.beginPath();
        for (let x = tx0; x <= tx1; x++) {
          if ((x % 8 === 0) !== major) continue;
          g.moveTo(x * TILE, ty0 * TILE);
          g.lineTo(x * TILE, ty1 * TILE);
        }
        for (let y = ty0; y <= ty1; y++) {
          if ((y % 8 === 0) !== major) continue;
          g.moveTo(tx0 * TILE, y * TILE);
          g.lineTo(tx1 * TILE, y * TILE);
        }
        g.stroke();
      }
      g.restore();
    }

    // ---- paredes e móveis
    this.scene.drawWalls(g, v, Date.now());
    const ents = this.ents;
    ents.length = 0;
    this.scene.collect((f, front, depth) => ents.push({ f, front, y: depth }), v);
    ents.sort((a, b) => a.y - b.y);
    for (const e of ents) this.scene.drawFurniture(g, e.f, e.front, now);

    // ---- marcadores: entrada e pontos
    doc.spawn.forEach((s, i) => drawTileMarker(g, s.x, s.y, i === 0 ? COLORS.yellow : '#b79303', 'E', scale));
    for (const s of doc.spots) {
      drawTileMarker(g, s.tx, s.ty, COLORS.cyan, s.kind[0].toUpperCase(), scale, 0.9);
      drawDirArrow(g, s.tx, s.ty, s.dir, COLORS.cyan, scale);
    }

    // ---- ghost da ferramenta
    if (!ctx.readOnly()) this.hooks.tool().draw?.(g, scale);

    // ---- seleção
    for (const r of st.selection) {
      if (r.t === 'zone') {
        const z = doc.zones.find((x) => x.id === r.id);
        for (const q of z?.rects ?? []) strokeTiles(g, q, COLORS.yellow, scale, 2);
        continue;
      }
      const b = refBounds(doc, r);
      if (b) strokePx(g, b.x * TILE - 1 / scale, b.y * TILE - 1 / scale, b.w * TILE + 2 / scale, b.h * TILE + 2 / scale, COLORS.yellow, scale, 2);
    }

    // ---- problemas
    if (st.overlays.problems) {
      const s = 10 / scale;
      for (const is of this.hooks.issues()) {
        if (!is.at) continue;
        const cx = (is.at.x + Math.min(is.at.w, 1) / 2) * TILE;
        const cy = (is.at.y + Math.min(is.at.h, 1) / 2) * TILE;
        g.fillStyle = is.severity === 'error' ? COLORS.red : COLORS.yellow;
        g.fillRect(cx - s / 2, cy - s / 2, s, s);
        g.strokeStyle = BG;
        g.lineWidth = 1 / scale;
        g.strokeRect(cx - s / 2, cy - s / 2, s, s);
      }
    }

    // ---- hover
    const h = ctx.hover;
    if (h && st.gesture.k === 'idle' && h.tx >= 0 && h.ty >= 0 && h.tx < doc.size.w && h.ty < doc.size.h) strokeTiles(g, { x: h.tx, y: h.ty, w: 1, h: 1 }, 'rgba(255,255,255,0.35)', scale, 1);

    // ---- textos em espaço de tela (nítidos)
    g.setTransform(camera.dpr, 0, 0, camera.dpr, 0, 0);
    this.drawLabels(doc, zoom);
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  private pill(text: string, x: number, y: number, fg: string, bg: string, size = 11, align: 'left' | 'center' = 'left'): void {
    const g = this.g;
    g.font = `500 ${size}px Poppins, system-ui, sans-serif`;
    const w = g.measureText(text).width + 8;
    const left = align === 'center' ? x - w / 2 : x;
    g.fillStyle = bg;
    g.fillRect(Math.round(left), Math.round(y), Math.ceil(w), size + 5);
    g.fillStyle = fg;
    g.textBaseline = 'top';
    g.textAlign = 'left';
    g.fillText(text, Math.round(left + 4), Math.round(y + 2));
  }

  private drawLabels(doc: OfficeMapDoc, zoom: number): void {
    const cam = this.camera;
    const st = this.ctx.state;
    const vw = cam.viewW;
    const vh = cam.viewH;
    const onScreen = (x: number, y: number) => x > -200 && y > -40 && x < vw + 40 && y < vh + 40;
    // placas das mesas
    const asm = this.ctx.scene.assembly();
    if (asm && zoom >= 2) {
      for (const d of asm.desks) {
        if (st.hiddenAreas.has(d.areaId)) continue;
        const p = cam.worldToScreen(d.plate.x, d.plate.y);
        if (!onScreen(p.x, p.y)) continue;
        this.pill(d.label, p.x, p.y - 7, '#121212', 'rgba(255,216,0,0.85)', 9, 'center');
      }
    }
    // placas das áreas (texto da placa)
    if (zoom >= 1.5) {
      for (const vis of this.scene.areas.values()) {
        if (!vis.sign) continue;
        const r = this.scene.signRect(vis);
        if (!r) continue;
        const p = cam.worldToScreen(r.x + r.w / 2, r.y);
        if (!onScreen(p.x, p.y)) continue;
        this.pill(vis.sign.label ?? '', p.x, p.y, '#ffffff', 'rgba(18,18,18,0.6)', 9, 'center');
      }
    }
    // zonas
    if (st.overlays.zones && zoom >= 1) {
      for (const z of doc.zones) {
        const r = z.rects[0];
        if (!r) continue;
        const p = cam.worldToScreen((r.x + r.w) * TILE, (r.y + r.h) * TILE);
        if (!onScreen(p.x, p.y)) continue;
        this.g.font = '500 10px Poppins, system-ui, sans-serif';
        const w = this.g.measureText(z.name).width + 8;
        this.pill(z.name, p.x - w - 2, p.y - 17, '#121212', rgba(z.color ?? ZONE_COLORS[z.kind] ?? '#c8c5ca', 0.9), 10);
      }
    }
    // nomes das áreas
    if (zoom >= 0.6) {
      for (const a of doc.areas) {
        if (st.hiddenAreas.has(a.id)) continue;
        const p = cam.worldToScreen(a.rect.x * TILE, a.rect.y * TILE);
        if (!onScreen(p.x, p.y)) continue;
        this.pill(a.name, p.x + 2, p.y + 2, '#ffffff', 'rgba(18,18,18,0.72)', 11);
      }
    }
  }
}
