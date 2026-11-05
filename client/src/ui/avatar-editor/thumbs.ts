// Miniaturas do montador: recortes do sprite do personagem (parado, de frente) ampliados 3x.
import type { Appearance, ArtModule } from '../../art/api';

export type ThumbKind = 'hair' | 'top' | 'bottom' | 'accessory' | 'full';
export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const THUMB_SCALE = 3;
/** Recortes em px do sprite (24x34). */
export const THUMB_CROPS: Readonly<Record<ThumbKind, Crop>> = {
  hair: { x: 2, y: 0, w: 20, h: 20 },
  top: { x: 4, y: 16, w: 16, h: 12 },
  bottom: { x: 6, y: 22, w: 12, h: 12 },
  accessory: { x: 4, y: 0, w: 16, h: 16 },
  full: { x: 0, y: 0, w: 24, h: 34 },
};

export function thumbSize(kind: ThumbKind, scale = THUMB_SCALE): { w: number; h: number } {
  const c = THUMB_CROPS[kind];
  return { w: c.w * scale, h: c.h * scale };
}

/** Interseção do recorte com os limites do sprite (evita ler fora do canvas). */
export function clampCrop(c: Crop, sw: number, sh: number): Crop {
  const x = Math.max(0, Math.min(c.x, sw));
  const y = Math.max(0, Math.min(c.y, sh));
  return { x, y, w: Math.max(0, Math.min(c.x + c.w, sw) - x), h: Math.max(0, Math.min(c.y + c.h, sh) - y) };
}

/** Campos da aparência que influenciam cada recorte (a chave do cache usa só estes). */
const KEY_FIELDS: Readonly<Record<ThumbKind, readonly (keyof Appearance)[]>> = {
  hair: ['look', 'skin', 'eyes', 'hair', 'hairStyle', 'facialHair', 'makeup', 'freckles'],
  top: ['look', 'skin', 'topStyle', 'top', 'topAccent', 'lanyard', 'bottom', 'bottomStyle'],
  bottom: ['look', 'skin', 'bottomStyle', 'bottom', 'shoes', 'topStyle', 'top', 'topAccent'],
  accessory: ['look', 'skin', 'eyes', 'hair', 'hairStyle', 'accessory', 'accessoryColor', 'facialHair'],
  full: [
    'look', 'skin', 'eyes', 'hair', 'hairStyle', 'topStyle', 'top', 'topAccent', 'bottom', 'bottomStyle', 'shoes', 'accessory',
    'accessoryColor', 'lanyard', 'facialHair', 'makeup', 'freckles',
  ],
};

export function thumbKey(kind: ThumbKind, a: Appearance, scale = THUMB_SCALE): string {
  const rec = a as unknown as Record<string, unknown>;
  return `${kind}@${scale}|${KEY_FIELDS[kind].map((k) => String(rec[k] ?? '-')).join('|')}`;
}

const cache = new Map<string, HTMLCanvasElement>();
const CACHE_LIMIT = 1500;

/** Canvas novo (um canvas só pode ter um pai) com a miniatura; o desenho é cacheado por chave parcial. */
export function thumbCanvas(art: ArtModule, kind: ThumbKind, a: Appearance, scale = THUMB_SCALE): HTMLCanvasElement {
  const key = thumbKey(kind, a, scale);
  let src = cache.get(key);
  if (!src) {
    const sprite = art.characterSprite({ appearance: a, dir: 'down', pose: 'stand', frame: 0 });
    const crop = clampCrop(THUMB_CROPS[kind], sprite.canvas.width, sprite.canvas.height);
    src = document.createElement('canvas');
    src.width = Math.max(1, crop.w * scale);
    src.height = Math.max(1, crop.h * scale);
    const ctx = src.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sprite.canvas, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w * scale, crop.h * scale);
    }
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(key, src);
  }
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  out.className = 'of-thumb';
  const octx = out.getContext('2d');
  if (octx) octx.drawImage(src, 0, 0);
  return out;
}
