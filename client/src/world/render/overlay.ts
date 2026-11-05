// Passada em ESPAÇO DE TELA (texto nítido na resolução do dispositivo): nomes com o ponto de status,
// balões de chat, textos das placas, pílulas das salas de reunião sobre as portas e (zoom ≥ 2) as
// plaquinhas das mesas em fonte pixel (espaço de mundo).
//
// Itens flutuantes disputam espaço: são POSICIONADOS em ordem decrescente de prioridade (quem chega
// depois desvia ou some) e DESENHADOS em ordem crescente (o mais importante por cima).
import { TILE } from '../../art/api';
import { pixelText, pixelTextWidth } from '../../art/pixelfont';
import type { UserStatus } from '../../../../shared/model';
import type { DeskDef, ZoneDef } from '../../../../shared/map/types';
import type { Camera } from '../camera';
import type { Avatar } from '../replica/avatar';
import type { WorldView } from '../replica/replica';
import type { FrameSelection, HeadInfo, Renderer } from './renderer';

const UI_FONT = 'Poppins, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const LABEL_FONT = `600 10.5px ${UI_FONT}`;
const SAY_FONT = `500 11px ${UI_FONT}`;
const PILL_FONT = `600 11px ${UI_FONT}`;
const COUNT_FONT = `700 10px ${UI_FONT}`;
const signFont = (size: number) => `700 ${size}px ${UI_FONT}`;

export const STATUS_COLORS: Readonly<Record<UserStatus, string>> = {
  available: '#048c22',
  busy: '#e30b2f',
  dnd: '#e30b2f',
  away: '#8a8a90',
};

/** Largura máxima do balão de chat (px CSS). */
export const SAY_MAX_W = 200;
const SAY_H = 18;
const LABEL_H = 16;
/** Altura mínima (px CSS) da placa na tela para escrever o nome nela. */
const SIGN_MIN_PX = 14;
/** Zoom mínimo das plaquinhas das mesas. */
export const PLATE_ZOOM = 2;
/** Abaixo deste zoom, só o próprio nome/selecionado. */
export const TINY_ZOOM = 0.6;
/** Máximo de caracteres na plaquinha da mesa (fonte 3×5: 4 px por letra). */
export const PLATE_MAX_CHARS = 8;

export interface OverlayOptions {
  showNames: boolean;
}

/** Texto da plaquinha: primeiro nome do dono (minúsculo na fonte pixel) ou o rótulo da mesa. Puro. */
export function plateText(desk: Pick<DeskDef, 'label' | 'code'>, ownerName: string | null): string {
  const raw = ownerName ? ownerName.trim().split(/\s+/)[0] : desk.label || desk.code;
  return [...raw].slice(0, PLATE_MAX_CHARS).join('');
}

/**
 * Ponto (px de mundo) da pílula de uma zona: centro dos tiles de porta (o lado de fora fica abaixo
 * ou acima conforme a porta); sem porta, o topo do primeiro retângulo. Puro.
 */
export function zonePillAnchor(z: Pick<ZoneDef, 'doorTiles' | 'rects'>): { x: number; y: number } {
  if (z.doorTiles.length) {
    let sx = 0;
    let minY = Infinity;
    for (const t of z.doorTiles) {
      sx += t.x;
      minY = Math.min(minY, t.y);
    }
    return { x: (sx / z.doorTiles.length + 0.5) * TILE, y: (minY - 2) * TILE };
  }
  const r = z.rects[0] ?? { x: 0, y: 0, w: 1, h: 1 };
  return { x: (r.x + r.w / 2) * TILE, y: r.y * TILE };
}

interface Item {
  kind: 'say' | 'label';
  av: Avatar;
  head: HeadInfo;
  prio: number;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  alpha: number;
}

export class Overlay {
  private widths = new Map<string, number>();
  private fitted = new Map<string, string>();
  private placed: number[] = [];
  private items: Item[] = [];
  private pool: Item[] = [];
  private k = 1;
  private ox = 0;
  private oy = 0;

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly renderer: Renderer,
    private readonly camera: Camera,
  ) {}

  resetCaches(): void {
    this.widths.clear();
    this.fitted.clear();
  }

  private measure(font: string, text: string): number {
    const key = `${font}|${text}`;
    let w = this.widths.get(key);
    if (w === undefined) {
      if (this.widths.size > 4000) this.widths.clear();
      this.ctx.font = font;
      w = this.ctx.measureText(text).width;
      this.widths.set(key, w);
    }
    return w;
  }

  private fit(font: string, text: string, maxW: number): string {
    const key = `${font}|${maxW}|${text}`;
    const hit = this.fitted.get(key);
    if (hit !== undefined) return hit;
    if (this.fitted.size > 2000) this.fitted.clear();
    let out = text;
    if (this.measure(font, text) > maxW) {
      let lo = 0;
      let hi = text.length;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (this.measure(font, `${text.slice(0, mid).trimEnd()}…`) <= maxW) lo = mid;
        else hi = mid - 1;
      }
      out = lo > 0 ? `${text.slice(0, lo).trimEnd()}…` : '';
    }
    this.fitted.set(key, out);
    return out;
  }

  private sx(wx: number): number {
    return wx * this.k + this.ox;
  }

  private sy(wy: number): number {
    return wy * this.k + this.oy;
  }

  private overlaps(x: number, y: number, w: number, h: number): boolean {
    const p = this.placed;
    for (let i = 0; i < p.length; i += 4) if (x < p[i] + p[i + 2] && x + w > p[i] && y < p[i + 1] + p[i + 3] && y + h > p[i + 1]) return true;
    return false;
  }

  private place(x: number, y: number, w: number, h: number): void {
    this.placed.push(x, y, w, h);
  }

  draw(view: WorldView, now: number, opts: OverlayOptions, sel: FrameSelection): void {
    const { ctx, camera } = this;
    const zoom = camera.zoom;
    // ---- plaquinhas das mesas: espaço de mundo, fonte pixel
    if (zoom >= PLATE_ZOOM) this.drawPlates(view);

    const dpr = camera.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textBaseline = 'middle';
    this.placed.length = 0;
    const t = camera.transform();
    this.k = t.scale / dpr;
    this.ox = t.ox / dpr;
    this.oy = t.oy / dpr;

    this.drawSigns(zoom);
    if (zoom >= TINY_ZOOM) this.drawZonePills(view);

    // ---- nomes e balões
    const items = this.items;
    items.length = 0;
    let n = 0;
    const take = (): Item => {
      let it = this.pool[n];
      if (!it) this.pool[n] = it = { kind: 'label', av: null as unknown as Avatar, head: null as unknown as HeadInfo, prio: 0, x: 0, y: 0, w: 0, h: 0, text: '', alpha: 1 };
      n++;
      return it;
    };
    const vw = camera.viewW;
    const vh = camera.viewH;
    const showAll = opts.showNames && zoom >= 0.99;
    for (const av of view.avatars.values()) {
      const head = this.renderer.heads.get(av.id);
      if (!head || !head.visible) continue;
      const hx = this.sx(head.x);
      const hy = this.sy(head.y);
      if (hx < -120 || hx > vw + 120 || hy < -60 || hy > vh + 80) continue;
      const selected = sel.user === av.id;
      const hovered = sel.hover === av.id;
      if (av.sayText && now < av.sayUntil) {
        const it = take();
        it.kind = 'say';
        it.av = av;
        it.head = head;
        it.prio = selected ? 95 : av.self ? 90 : 60;
        it.text = av.sayText;
        it.alpha = Math.max(0, Math.min(1, (now - av.sayAt) / 120, (av.sayUntil - now) / 300));
        items.push(it);
      }
      if (selected || hovered || av.self || showAll || av.speaking) {
        const it = take();
        it.kind = 'label';
        it.av = av;
        it.head = head;
        it.prio = selected ? 100 : hovered ? 96 : av.self ? 80 : av.speaking ? 70 : 40;
        it.text = av.user;
        it.alpha = av.alpha < 1 ? 0.7 : 1;
        items.push(it);
      }
    }
    items.sort((a, b) => b.prio - a.prio || a.head.feetY - b.head.feetY);
    let m = 0;
    for (const it of items) if (it.kind === 'say' ? this.placeSay(it) : this.placeLabel(it, view)) items[m++] = it;
    items.length = m;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.kind === 'say') this.drawSay(it);
      else this.drawLabel(it, sel);
    }
    ctx.textBaseline = 'alphabetic';
  }

  // =================================================================== mesas (mundo)

  private drawPlates(view: WorldView): void {
    const { ctx } = this;
    const dpr = this.camera.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const v = this.renderer.viewRect;
    ctx.font = '600 10px Poppins, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    for (const d of view.assembly.desks) {
      const p = d.plate;
      if (p.x < v.x0 - 20 || p.x > v.x1 + 20 || p.y < v.y0 - 10 || p.y > v.y1 + 10) continue;
      const owner = view.desks.get(d.id)?.userId ?? null;
      if (owner === null) continue; // mesa livre: sem plaquinha (menos poluição)
      const text = plateText(d, view.nameOf(owner));
      if (!text) continue;
      const x = Math.round(this.sx(p.x));
      const y = Math.round(this.sy(p.y));
      const w = Math.ceil(ctx.measureText(text).width) + 8;
      ctx.fillStyle = owner !== null ? 'rgba(18,18,18,0.8)' : 'rgba(18,18,18,0.5)';
      roundRect(ctx, x - w / 2, y - 7, w, 14, 3);
      ctx.fill();
      ctx.fillStyle = owner !== null ? '#ffd800' : '#c8c5ca';
      ctx.fillText(text, x, y + 0.5);
    }
    ctx.textAlign = 'start';
  }

  // =================================================================== placas

  private drawSigns(zoom: number): void {
    const scene = this.renderer.scene;
    const vw = this.camera.viewW;
    const vh = this.camera.viewH;
    for (const vis of scene.areas.values()) {
      const text = vis.sign?.label;
      if (!text) continue;
      const rect = scene.signRect(vis);
      if (!rect || rect.h * zoom < SIGN_MIN_PX) continue;
      const ax = this.sx(rect.x);
      const ay = this.sy(rect.y);
      const w = rect.w * zoom;
      const h = rect.h * zoom;
      if (ax + w < 0 || ax > vw || ay + h < 0 || ay > vh) continue;
      this.drawSignText(text, ax, ay, w, h, scene.signIsDark(vis));
      this.place(ax, ay, w, h);
    }
  }

  private drawSignText(text: string, x: number, y: number, w: number, h: number, dark: boolean): void {
    const { ctx } = this;
    let size = Math.min(18, Math.max(7, Math.floor(h * 0.72)));
    let font = signFont(size);
    while (size > 7 && this.measure(font, text) > w - 4) {
      size--;
      font = signFont(size);
    }
    const t = this.fit(font, text, w - 4);
    ctx.font = font;
    ctx.textAlign = 'center';
    const cx = Math.round(x + w / 2);
    const cy = Math.round(y + h / 2) + 0.5;
    ctx.fillStyle = dark ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.45)';
    ctx.fillText(t, cx, cy + 1);
    ctx.fillStyle = dark ? '#f5f1e6' : '#26303e';
    ctx.fillText(t, cx, cy);
    ctx.textAlign = 'left';
  }

  // =================================================================== salas de reunião

  private drawZonePills(view: WorldView): void {
    const { ctx } = this;
    const vw = this.camera.viewW;
    const vh = this.camera.viewH;
    for (const z of view.assembly.zones) {
      if (z.kind !== 'meeting' && !z.lockable) continue;
      const st = view.zones.get(z.id);
      const count = st?.members.length ?? 0;
      const locked = !!st?.locked;
      if (count === 0 && !locked) continue; // sala vazia: a placa da parede já diz o nome
      const a = zonePillAnchor(z);
      const cx = this.sx(a.x);
      const cy = this.sy(a.y);
      if (cx < -150 || cx > vw + 150 || cy < -40 || cy > vh + 40) continue;
      const name = this.fit(PILL_FONT, z.name, 140);
      const nameW = this.measure(PILL_FONT, name);
      const countText = z.capacity ? `${count}/${z.capacity}` : String(count);
      const cw = this.measure(COUNT_FONT, countText) + 10;
      const lockW = locked ? 12 : 0;
      const h = 20;
      const w = Math.round(10 + lockW + nameW + 6 + cw + 4);
      const x = Math.round(cx - w / 2);
      const y = Math.round(cy - h - 6);
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.roundRect(x, y + 2, w, h, 10);
      ctx.fill();
      ctx.fillStyle = 'rgba(28,28,28,0.92)';
      ctx.strokeStyle = locked ? '#e30b2f' : '#ffd800';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, 10);
      ctx.fill();
      ctx.stroke();
      let dx = x + 8;
      if (locked) {
        this.drawLock(dx, y + h / 2, locked);
        dx += lockW;
      }
      ctx.font = PILL_FONT;
      ctx.fillStyle = '#f3f3f5';
      ctx.fillText(name, dx, y + h / 2 + 1);
      dx += nameW + 6;
      ctx.fillStyle = count > 0 ? '#ffd800' : 'rgba(255,255,255,0.14)';
      ctx.beginPath();
      ctx.roundRect(dx, y + 4, cw, h - 8, 6);
      ctx.fill();
      ctx.font = COUNT_FONT;
      ctx.fillStyle = count > 0 ? '#121212' : '#dfe0e4';
      ctx.textAlign = 'center';
      ctx.fillText(countText, dx + cw / 2, y + h / 2 + 0.5);
      ctx.textAlign = 'left';
      ctx.restore();
      this.place(x, y, w, h);
    }
  }

  /** Cadeado (8×9 px CSS) com o meio em (x, cy). */
  private drawLock(x: number, cy: number, locked: boolean): void {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = locked ? '#ff5a72' : '#c8c5ca';
    ctx.fillStyle = locked ? '#ff5a72' : '#c8c5ca';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(x + 4, cy - 1.5, 2.6, Math.PI, 0);
    ctx.stroke();
    ctx.fillRect(x, cy - 1.5, 8, 6);
    ctx.restore();
  }

  // =================================================================== nomes e balões

  private placeLabel(it: Item, view: WorldView): boolean {
    const nameW = this.measure(LABEL_FONT, this.fit(LABEL_FONT, it.text, 160));
    const w = Math.round(nameW + 22);
    const h = LABEL_H;
    const x = Math.round(this.sx(it.head.x) - w / 2);
    const below = Math.round(this.sy(it.head.feetY) + 3);
    const lift = it.av.icon ? 13 * this.camera.zoom : 0;
    const over = Math.round(this.sy(it.head.y) - lift - h - 3);
    // quem senta de frente para a câmera atrás de uma mesa: etiqueta acima (não cobre a tela do colega)
    const spot = it.av.spot ? view.assembly.spotById.get(it.av.spot) : undefined;
    const above = it.av.seated && it.av.dir === 'down' && spot?.kind === 'desk';
    const first = above ? over : below;
    const second = above ? below : over;
    it.w = w;
    it.h = h;
    it.x = x;
    if (!this.overlaps(x, first, w, h)) it.y = first;
    else if (!this.overlaps(x, second, w, h)) it.y = second;
    else if (it.prio >= 80) it.y = first;
    else return false;
    this.place(it.x, it.y, w, h);
    return true;
  }

  private drawLabel(it: Item, sel: FrameSelection): void {
    const { ctx } = this;
    const { x, y, w, h } = it;
    ctx.save();
    ctx.globalAlpha = it.alpha;
    const selected = sel.user === it.av.id;
    ctx.fillStyle = selected ? 'rgba(255,216,0,0.95)' : 'rgba(18,18,18,0.82)';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 8);
    ctx.fill();
    if (it.av.speaking) {
      ctx.strokeStyle = '#ffd800';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // ponto de status
    ctx.beginPath();
    ctx.arc(x + 8, y + h / 2, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = STATUS_COLORS[it.av.status] ?? STATUS_COLORS.available;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = selected ? 'rgba(18,18,18,0.6)' : 'rgba(255,255,255,0.25)';
    ctx.stroke();
    ctx.font = LABEL_FONT;
    ctx.fillStyle = selected ? '#121212' : '#f5f5f7';
    ctx.fillText(this.fit(LABEL_FONT, it.text, 160), x + 15, y + h / 2 + 0.5);
    ctx.restore();
  }

  private placeSay(it: Item): boolean {
    const text = this.fit(SAY_FONT, it.text, SAY_MAX_W - 16);
    it.text = text;
    it.w = Math.round(Math.min(SAY_MAX_W, this.measure(SAY_FONT, text) + 16));
    it.h = SAY_H;
    const lift = (it.av.icon ? 14 : 2) * this.camera.zoom;
    it.x = Math.max(4, Math.min(this.camera.viewW - it.w - 4, Math.round(this.sx(it.head.x) - it.w / 2)));
    it.y = Math.round(this.sy(it.head.y) - lift - it.h - 6);
    if (this.overlaps(it.x, it.y, it.w, it.h)) {
      const up = it.y - it.h - 4;
      if (!this.overlaps(it.x, up, it.w, it.h)) it.y = up;
      else if (it.prio < 90) return false;
    }
    this.place(it.x, it.y, it.w, it.h);
    return true;
  }

  private drawSay(it: Item): void {
    const { ctx } = this;
    const { x, y, w, h } = it;
    const headX = this.sx(it.head.x);
    const tailX = Math.max(x + 8, Math.min(x + w - 8, Math.round(headX)));
    ctx.save();
    ctx.globalAlpha = it.alpha;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.roundRect(x, y + 2, w, h, 8);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 8);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(tailX - 4, y + h - 1);
    ctx.lineTo(tailX, y + h + 5);
    ctx.lineTo(tailX + 4, y + h - 1);
    ctx.closePath();
    ctx.fill();
    ctx.font = SAY_FONT;
    ctx.fillStyle = '#1c1c1c';
    ctx.textAlign = 'center';
    ctx.fillText(it.text, x + w / 2, y + h / 2 + 1);
    ctx.textAlign = 'left';
    ctx.restore();
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
