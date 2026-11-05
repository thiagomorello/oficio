// Cena estática do escritório: pisos, paredes, itens de parede e móveis de cada área do mapa
// montado. Não depende da réplica: o jogo (renderer.ts) e o editor de mapa usam a mesma cena.
// Valores fixos (sem simulação): janela às 14 h, relógio na hora real, TV em descanso; a tela da
// mesa vem de quem chama (`screenOf`).
import { BRAND_SIGN_LABEL } from '../../../../shared/branding';
import { branding } from '../../net/branding';
import { TILE, type ArtModule, type ScreenMode, type Sprite } from '../../art/api';
import { deskDecorPlacements, isEmptyDecor, type DeskDecor, type DeskItemKind } from '../../../../shared/desk-decor';
import type { AreaLayout } from '../../../../shared/map/types';
import type { WorldAssets } from '../assets';
import { buildAreaVis, furnitureSprites, opaqueBounds, WALL_MARGIN, wallItemOrigin, wallSprites, type AreaVis, type FurnVis, type WallVis } from './scene';

/** Retângulo visível (px de mundo). */
export interface ViewRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Tela do monitor de uma mesa. */
export type ScreenOf = (f: FurnVis) => ScreenMode;
/** Decoração da mesa (Adendo D) pelo id do móvel. */
export type DecorOf = (furnitureId: string) => DeskDecor | null | undefined;
/** Recebe cada móvel visível (base e, se houver, a parte da frente) com a profundidade de desenho. */
export type PushFurniture = (f: FurnVis, front: boolean, depth: number) => void;

/** Hora fixa da vista das janelas. */
export const WINDOW_HOUR = 14;

/** Sprite opcional dos itens de mesa (`ArtModule.deskItemSprite?`, Adendo D). */
type DeskItemArt = { deskItemSprite?(kind: DeskItemKind, variant: string): Sprite | null | undefined };

function visible(v: ViewRect, x: number, y: number, w: number, h: number): boolean {
  return x < v.x1 && x + w > v.x0 && y < v.y1 && y + h > v.y0;
}

export class StaticScene {
  readonly areas = new Map<string, AreaVis>();
  private version = -1;
  private layouts: readonly AreaLayout[] = [];
  private assets: WorldAssets | null = null;
  private dirty = false;
  private readonly date = new Date();

  constructor(private readonly art: ArtModule) {}

  setAssets(a: WorldAssets | null): void {
    this.assets = a;
    this.dirty = true;
  }

  /** (Re)constrói os caches quando o mapa (versão) ou os assets mudam. Retorna true se reconstruiu. */
  sync(layouts: readonly AreaLayout[], version: number): boolean {
    if (version === this.version && layouts === this.layouts && !this.dirty) return false;
    const keep = new Set<string>();
    for (const l of layouts) {
      keep.add(l.id);
      const cur = this.areas.get(l.id);
      if (!cur || cur.layout !== l || this.dirty) this.areas.set(l.id, buildAreaVis(this.art, l, this.assets));
    }
    for (const id of [...this.areas.keys()]) if (!keep.has(id)) this.areas.delete(id);
    this.version = version;
    this.layouts = layouts;
    this.dirty = false;
    return true;
  }

  drawFloors(ctx: CanvasRenderingContext2D, view: ViewRect): void {
    for (const vis of this.areas.values()) {
      const p = vis.px;
      if (!visible(view, p.x, p.y, p.w, p.h)) continue;
      ctx.drawImage(vis.floor, p.x, p.y);
    }
  }

  drawWalls(ctx: CanvasRenderingContext2D, view: ViewRect, now: number, hour = WINDOW_HOUR): void {
    this.date.setTime(now);
    for (const vis of this.areas.values()) {
      const p = vis.px;
      if (!visible(view, p.x, p.y - WALL_MARGIN, p.w, p.h + WALL_MARGIN)) continue;
      ctx.drawImage(vis.walls, p.x, p.y - WALL_MARGIN);
      for (const w of vis.wallItems) this.drawWallItem(ctx, w, now, hour);
      if (vis.sign) this.drawSign(ctx, vis, vis.sign);
    }
  }

  /** Móveis visíveis para a ordenação por profundidade (junto com os personagens). */
  collect(push: PushFurniture, view: ViewRect): void {
    for (const vis of this.areas.values()) {
      const p = vis.px;
      if (!visible(view, p.x - TILE, p.y - 3 * TILE, p.w + 2 * TILE, p.h + 4 * TILE)) continue;
      for (const f of vis.furniture) {
        if (!visible(view, f.ax - 3 * TILE, f.ay - 4 * TILE, 6 * TILE, 4 * TILE + 4)) continue;
        push(f, false, f.ay);
        const fs = furnitureSprites(this.art, f, 0);
        if (fs?.front) push(f, true, f.ay + 0.5);
      }
    }
  }

  drawFurniture(ctx: CanvasRenderingContext2D, f: FurnVis, front: boolean, now: number, screenOf?: ScreenOf, decorOf?: DecorOf): void {
    const isDesk = f.kind === 'desk' || f.kind === 'desk_back';
    const decor = isDesk && decorOf ? decorOf(f.id) : null;
    const clean = !!decor && !isEmptyDecor(decor);
    const fs = furnitureSprites(this.art, f, 0, clean);
    if (!fs) return;
    const s = front ? fs.front : fs.base;
    if (!s) return;
    const dx = Math.round(f.ax - s.ax);
    const dy = Math.round(f.ay - s.ay);
    ctx.drawImage(s.canvas, dx, dy);
    if (front) return;
    if (f.kind === 'desk' && s.rects?.screen) {
      const r = s.rects.screen;
      const mode = screenOf ? screenOf(f) : 'standby';
      this.safe(() => this.art.drawScreen(ctx, { x: dx + r.x, y: dy + r.y, w: r.w, h: r.h }, mode, now, f.seed));
    }
    if (clean) this.drawDecor(ctx, f, decor);
  }

  /** Itens da decoração sobre o tampo (D.3): back, left, right; sem sprite na arte, não desenha. */
  private drawDecor(ctx: CanvasRenderingContext2D, f: FurnVis, decor: DeskDecor | null | undefined): void {
    const art = this.art as ArtModule & DeskItemArt;
    if (typeof art.deskItemSprite !== 'function') return;
    for (const p of deskDecorPlacements(decor)) {
      let sprite: Sprite | null | undefined = null;
      try {
        sprite = art.deskItemSprite(p.kind, p.variant);
      } catch {
        sprite = null;
      }
      if (!sprite) continue;
      ctx.drawImage(sprite.canvas, Math.round(f.fx + p.x), Math.round(f.fy + p.baseY - sprite.ay));
    }
  }

  private drawWallItem(ctx: CanvasRenderingContext2D, w: WallVis, now: number, hour: number): void {
    switch (w.kind) {
      case 'window':
        this.drawWindow(ctx, w, hour, now);
        return;
      case 'light_switch':
        this.drawBase(ctx, w, 'on');
        return;
      case 'clock': {
        const s = wallSprites(this.art, 'clock', w.variant, 0, w.seed);
        if (!s) return;
        const o = wallItemOrigin(w, s.base);
        ctx.drawImage(s.base.canvas, o.x, o.y);
        const r = s.base.rects?.face;
        if (r) this.safe(() => this.art.drawClock(ctx, { x: o.x + r.x, y: o.y + r.y, w: r.w, h: r.h }, this.date));
        return;
      }
      case 'whiteboard': {
        const s = wallSprites(this.art, 'whiteboard', w.variant, 0, w.seed);
        if (!s) return;
        const o = wallItemOrigin(w, s.base);
        ctx.drawImage(s.base.canvas, o.x, o.y);
        const r = s.base.rects?.board;
        if (r) this.safe(() => this.art.drawBoard(ctx, { x: o.x + r.x, y: o.y + r.y, w: r.w, h: r.h }, [], now));
        return;
      }
      case 'tv': {
        const s = wallSprites(this.art, 'tv', w.variant, 0, w.seed);
        if (!s) return;
        const o = wallItemOrigin(w, s.base);
        ctx.drawImage(s.base.canvas, o.x, o.y);
        const r = s.base.rects?.tv;
        if (r) this.safe(() => this.art.drawScreen(ctx, { x: o.x + r.x, y: o.y + r.y, w: r.w, h: r.h }, 'idle', now, w.seed));
        return;
      }
      default:
        this.drawBase(ctx, w, w.variant);
    }
  }

  private drawBase(ctx: CanvasRenderingContext2D, w: WallVis, variant: string | undefined): void {
    const s = wallSprites(this.art, w.kind, variant, 0, w.seed);
    if (!s) return;
    const o = wallItemOrigin(w, s.base);
    ctx.drawImage(s.base.canvas, o.x, o.y);
  }

  private drawWindow(ctx: CanvasRenderingContext2D, w: WallVis, hour: number, now: number): void {
    const s = wallSprites(this.art, 'window', w.variant, 0, w.seed);
    if (!s) return;
    const o = wallItemOrigin(w, s.base);
    let r = s.base.rects?.glass;
    if (!r) {
      const b = opaqueBounds(s.base.canvas);
      r = { x: b.x + 2, y: b.y + 2, w: b.w - 4, h: b.h - 4 };
    }
    const rr = r;
    this.safe(() => this.art.drawWindowView(ctx, { x: o.x + rr.x, y: o.y + rr.y, w: rr.w, h: rr.h }, hour, now, w.seed));
    ctx.drawImage(s.base.canvas, o.x, o.y);
  }

  /** A placa da área é a placa da marca (rótulo `{brand}`, texto igual ao configurado ou a recepção)? */
  isBrandSign(vis: AreaVis): boolean {
    if (!vis.sign || !this.assets?.signage) return false;
    const label = vis.sign.label?.trim().toLowerCase();
    return label === BRAND_SIGN_LABEL || (!!label && label === branding().signText.trim().toLowerCase()) || vis.id === 'recepcao';
  }

  /** Placa com o nome (o texto nítido é escrito pelo overlay em espaço de tela) ou o logo da marca. */
  private drawSign(ctx: CanvasRenderingContext2D, vis: AreaVis, w: WallVis): void {
    if (this.isBrandSign(vis) && this.assets?.signage) {
      const a = this.assets.signage;
      const maxW = 5 * TILE;
      const maxH = 24;
      // escala inteira (pixels nítidos) sempre que couber
      const fit = Math.min(maxW / a.w, maxH / a.h);
      const k = fit >= 1 ? Math.floor(fit) : fit;
      const dw = Math.round(a.w * k);
      const dh = Math.round(a.h * k);
      ctx.save();
      ctx.imageSmoothingEnabled = k < 1;
      ctx.drawImage(a.img, Math.round(w.cx - dw / 2), Math.round(w.baseY - 8 - dh), dw, dh);
      ctx.restore();
      return;
    }
    this.drawBase(ctx, w, w.variant);
  }

  /** Retângulo (px de mundo) da área de texto da placa de uma área, se houver. */
  signRect(vis: AreaVis): { x: number; y: number; w: number; h: number } | null {
    if (!vis.sign || this.isBrandSign(vis)) return null;
    const s = wallSprites(this.art, 'sign', vis.sign.variant, 0, vis.sign.seed);
    if (!s) return null;
    const o = wallItemOrigin(vis.sign, s.base);
    const r =
      s.base.rects?.sign ??
      (() => {
        const b = opaqueBounds(s.base.canvas);
        return { x: b.x + 3, y: b.y + 3, w: b.w - 6, h: b.h - 6 };
      })();
    return { x: o.x + r.x, y: o.y + r.y, w: r.w, h: r.h };
  }

  /** Luminância média da área de texto da placa (para escolher a cor do texto). */
  signIsDark(vis: AreaVis): boolean {
    const s = vis.sign ? wallSprites(this.art, 'sign', vis.sign.variant, 0, vis.sign.seed) : null;
    if (!s) return false;
    const c = s.base.canvas as HTMLCanvasElement & { __dark?: boolean };
    if (c.__dark !== undefined) return c.__dark;
    let dark = false;
    try {
      const r = s.base.rects?.sign ?? { x: 2, y: 2, w: c.width - 4, h: c.height - 4 };
      const d = c.getContext('2d')!.getImageData(r.x, r.y, Math.max(1, r.w), Math.max(1, r.h)).data;
      let sum = 0;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 128) continue;
        sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        n++;
      }
      dark = n > 0 && sum / n < 120;
    } catch {
      dark = false;
    }
    c.__dark = dark;
    return dark;
  }

  private safe(fn: () => void): void {
    try {
      fn();
    } catch {
      // arte incompleta (stub) não pode derrubar o mundo
    }
  }
}
