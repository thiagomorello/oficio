// Hit-test do editor: (1) itens de parede nas 2 linhas da face / na mureta sul; (2) móveis pelo alpha
// do sprite (desempate pelo maior `ay`); (3) footprint dos móveis; (4) tile -> spot, entrada, tapete,
// área. As partes puras (índice de footprint, contas de tile) são testadas no node; o teste de alpha
// recebe o "sondador" de pixels de fora.
import type { OfficeMapDoc } from '../../../shared/map/doc';
import { TILE } from '../../../shared/map/tile';
import { areaAt, footprint, tileOf, wallItemAt } from './geometry';
import type { Ref } from './types';

export interface FurnKey {
  area: string;
  id: string;
}

/** Índice "tx,ty" (absolutos) -> móveis cujo footprint cobre o tile. */
export type FootprintIndex = Map<string, FurnKey[]>;

export const tileKey = (tx: number, ty: number): string => `${tx},${ty}`;

export function buildFootprintIndex(doc: OfficeMapDoc, hidden?: ReadonlySet<string>): FootprintIndex {
  const idx: FootprintIndex = new Map();
  for (const a of doc.areas) {
    if (hidden?.has(a.id)) continue;
    for (const f of a.furniture) {
      const fp = footprint(f.kind);
      for (let y = 0; y < fp.h; y++) {
        for (let x = 0; x < fp.w; x++) {
          const k = tileKey(a.rect.x + f.lx + x, a.rect.y + f.ly + y);
          let l = idx.get(k);
          if (!l) idx.set(k, (l = []));
          l.push({ area: a.id, id: f.id });
        }
      }
    }
  }
  return idx;
}

/** Móveis no tile (o último colocado primeiro: é o que fica por cima ao sobrepor). */
export function furnitureAtTile(idx: FootprintIndex, tx: number, ty: number): FurnKey[] {
  return [...(idx.get(tileKey(tx, ty)) ?? [])].reverse();
}

/** Móveis cujo footprint cruza o retângulo de tiles (sem repetição). */
export function furnitureInRect(idx: FootprintIndex, r: { x: number; y: number; w: number; h: number }): FurnKey[] {
  const seen = new Set<string>();
  const out: FurnKey[] = [];
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      for (const f of idx.get(tileKey(x, y)) ?? []) {
        const k = `${f.area}#${f.id}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(f);
      }
    }
  }
  return out;
}

/** Item desenhado (sprite) com âncora no mundo. */
export interface SpriteItem {
  id: string;
  ay: number;
}

/**
 * Entre os itens cujo pixel sob (wx, wy) é opaco (`opaque`), o de maior `ay` (o desenhado por último).
 */
export function spriteHit<T extends SpriteItem>(items: Iterable<T>, wx: number, wy: number, opaque: (item: T, wx: number, wy: number) => boolean): T | null {
  let best: T | null = null;
  for (const it of items) {
    if (best && it.ay < best.ay) continue;
    if (opaque(it, wx, wy)) best = it;
  }
  return best;
}

const pixels = new WeakMap<HTMLCanvasElement, ImageData | null>();

/** Pixel (x, y) do canvas é opaco? `ImageData` em cache por canvas. */
export function alphaAt(canvas: HTMLCanvasElement, x: number, y: number, min = 24): boolean {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return false;
  let data = pixels.get(canvas);
  if (data === undefined) {
    try {
      data = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height) ?? null;
    } catch {
      data = null;
    }
    pixels.set(canvas, data);
  }
  if (!data) return true;
  return data.data[(Math.floor(y) * canvas.width + Math.floor(x)) * 4 + 3] >= min;
}

export interface HitInput {
  doc: OfficeMapDoc;
  index: FootprintIndex;
  hidden?: ReadonlySet<string>;
  /** Teste de alpha dos sprites (opcional; sem ele, só footprint). Devolve o id absoluto do móvel. */
  sprite?: (wx: number, wy: number) => string | null;
}

/** O que está sob o ponto (px de mundo), na ordem de prioridade do editor. */
export function hitTest(inp: HitInput, wx: number, wy: number): Ref | null {
  const { doc, index, hidden } = inp;
  const w = wallItemAt(doc, wx, wy, hidden);
  if (w) return { t: 'wall', area: w.area.id, id: w.item.id };
  const s = inp.sprite?.(wx, wy);
  if (s) {
    const i = s.indexOf('#');
    if (i > 0) return { t: 'furn', area: s.slice(0, i), id: s.slice(i + 1) };
  }
  const { tx, ty } = tileOf(wx, wy);
  const f = furnitureAtTile(index, tx, ty)[0];
  if (f) return { t: 'furn', area: f.area, id: f.id };
  const spot = doc.spots.find((p) => p.tx === tx && p.ty === ty);
  if (spot) return { t: 'spot', id: spot.id };
  const sp = doc.spawn.findIndex((p) => p.x === tx && p.y === ty);
  if (sp >= 0) return { t: 'spawn', i: sp };
  const a = areaAt(doc, tx, ty, hidden);
  if (!a) return null;
  const lx = wx / TILE - a.rect.x;
  const ly = wy / TILE - a.rect.y;
  for (let i = a.rugs.length - 1; i >= 0; i--) {
    const r = a.rugs[i];
    if (lx >= r.lx && ly >= r.ly && lx < r.lx + r.w && ly < r.ly + r.h) return { t: 'rug', area: a.id, id: r.id };
  }
  return { t: 'area', id: a.id };
}
