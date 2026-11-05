// Geometria do editor: retângulos, footprints, validade de posição, giro/variante de móveis e
// mover/redimensionar áreas levando o conteúdo junto. Puro (sem DOM).
import { areaGeometry, doorwayRect } from '../../../shared/map/assemble';
import type { MapArea, MapFurniture, MapWallItem, OfficeMapDoc, TileRect } from '../../../shared/map/doc';
import { FURNITURE, type FurnitureKind } from '../../../shared/map/furniture';
import { TILE } from '../../../shared/map/tile';
import { t } from '../i18n';
import { normalizeFloors, updateOp, type EditOp } from './ops';
import { resolve, type Ref } from './types';

// ------------------------------------------------------------------ retângulos

export function inRect(r: TileRect, x: number, y: number): boolean {
  return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
}

export function intersects(a: TileRect, b: TileRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function contains(outer: TileRect, inner: TileRect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

export function intersection(a: TileRect, b: TileRect): TileRect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  return x1 > x && y1 > y ? { x, y, w: x1 - x, h: y1 - y } : null;
}

/** Retângulo (inclusivo) entre dois tiles. */
export function rectFromTiles(ax: number, ay: number, bx: number, by: number): TileRect {
  const x = Math.min(ax, bx);
  const y = Math.min(ay, by);
  return { x, y, w: Math.abs(bx - ax) + 1, h: Math.abs(by - ay) + 1 };
}

/** `a − b` em até 4 retângulos (cima, baixo, esquerda, direita). */
export function subtractRect(a: TileRect, b: TileRect): TileRect[] {
  const i = intersection(a, b);
  if (!i) return [{ ...a }];
  const out: TileRect[] = [];
  if (i.y > a.y) out.push({ x: a.x, y: a.y, w: a.w, h: i.y - a.y });
  if (i.y + i.h < a.y + a.h) out.push({ x: a.x, y: i.y + i.h, w: a.w, h: a.y + a.h - (i.y + i.h) });
  if (i.x > a.x) out.push({ x: a.x, y: i.y, w: i.x - a.x, h: i.h });
  if (i.x + i.w < a.x + a.w) out.push({ x: i.x + i.w, y: i.y, w: a.x + a.w - (i.x + i.w), h: i.h });
  return out;
}

export const snapQuarter = (v: number): number => Math.round(v * 4) / 4;

/** Tile (inteiro) de um ponto em px de mundo. */
export function tileOf(wx: number, wy: number): { tx: number; ty: number } {
  return { tx: Math.floor(wx / TILE), ty: Math.floor(wy / TILE) };
}

// ------------------------------------------------------------------ áreas e móveis

export function areaById(doc: OfficeMapDoc, id: string): MapArea | undefined {
  return doc.areas.find((a) => a.id === id);
}

/** Área que contém o tile absoluto (ignorando as ocultas). */
export function areaAt(doc: OfficeMapDoc, tx: number, ty: number, hidden?: ReadonlySet<string>): MapArea | undefined {
  return doc.areas.find((a) => !hidden?.has(a.id) && inRect(a.rect, tx, ty));
}

export function footprint(kind: FurnitureKind): { w: number; h: number } {
  const fp = FURNITURE[kind].footprint;
  return FURNITURE[kind].mount === 'floor' ? fp : { w: fp.w, h: 1 };
}

/** Footprint absoluto de um móvel. */
export function furnRect(area: MapArea, f: Pick<MapFurniture, 'kind' | 'lx' | 'ly'>): TileRect {
  const fp = footprint(f.kind);
  return { x: area.rect.x + f.lx, y: area.rect.y + f.ly, w: fp.w, h: fp.h };
}

/**
 * Problema de colocar `kind` com canto em (lx, ly) locais na área, ou null se a posição é válida:
 * dentro da área, assento no interior (fora das paredes), sem sobrepor outros móveis (`ignore` = ids
 * que estão sendo movidos) e sem bloquear uma passagem.
 */
export function placementProblem(area: MapArea, kind: FurnitureKind, lx: number, ly: number, ignore?: ReadonlySet<string>, extra?: readonly { kind: FurnitureKind; lx: number; ly: number }[]): string | null {
  const def = FURNITURE[kind];
  if (def.mount !== 'floor') return t('editor.problem.wallItem');
  const { w, h } = def.footprint;
  if (lx < 0 || ly < 0 || lx + w > area.rect.w || ly + h > area.rect.h) return t('editor.problem.outsideArea');
  const geo = areaGeometry(area);
  const mine: TileRect = { x: lx, y: ly, w, h };
  if (def.seat && !contains(geo.interior, mine)) return t('editor.problem.seatOnWall');
  for (const f of area.furniture) {
    if (ignore?.has(f.id)) continue;
    const fp = footprint(f.kind);
    if (intersects(mine, { x: f.lx, y: f.ly, w: fp.w, h: fp.h })) return t('editor.problem.overlapsItem', { kind: f.kind, id: f.id });
  }
  for (const f of extra ?? []) {
    const fp = footprint(f.kind);
    if (intersects(mine, { x: f.lx, y: f.ly, w: fp.w, h: fp.h })) return t('editor.problem.overlaps', { name: f.kind });
  }
  if (def.blocks) for (const d of area.doorways) if (intersects(mine, doorwayRect(area, d))) return t('editor.problem.blocksDoorway');
  return null;
}

// ------------------------------------------------------------------ giro e variante

const CW: Readonly<Record<string, string>> = { up: 'right', right: 'down', down: 'left', left: 'up' };
const CCW: Readonly<Record<string, string>> = { up: 'left', left: 'down', down: 'right', right: 'up' };
const DIR_ROT = new Set<FurnitureKind>(['stool', 'bench', 'beanbag']);

/**
 * `R`: cafe_chair/armchair `up→right→down→left`; sofa `down↔up`; glass_partition `h→v→end`;
 * office_chair↔office_chair_front; desk↔desk_back; stool/bench/beanbag giram `dir`. null = não gira.
 */
export function rotateFurniture(f: MapFurniture, reverse = false): MapFurniture | null {
  switch (f.kind) {
    case 'cafe_chair':
    case 'armchair':
      return { ...f, variant: (reverse ? CCW : CW)[f.variant ?? 'down'] ?? 'down' };
    case 'sofa':
      return { ...f, variant: (f.variant ?? 'down') === 'down' ? 'up' : 'down' };
    case 'glass_partition': {
      const order = ['h', 'v', 'end'];
      const i = order.indexOf(f.variant ?? 'h');
      return { ...f, variant: order[(i + (reverse ? 2 : 1)) % 3] };
    }
    case 'office_chair':
      return { ...f, kind: 'office_chair_front' };
    case 'office_chair_front':
      return { ...f, kind: 'office_chair' };
    case 'desk':
      return { ...f, kind: 'desk_back' };
    case 'desk_back':
      return { ...f, kind: 'desk' };
    default:
      if (DIR_ROT.has(f.kind)) return { ...f, dir: (reverse ? CCW : CW)[f.dir ?? 'down'] as MapFurniture['dir'] };
      return null;
  }
}

/** Próxima variante (`C`), ou undefined se o tipo não tem variantes. */
export function cycleVariant(kind: FurnitureKind, variant: string | undefined, step = 1): string | undefined {
  const list = FURNITURE[kind].variants;
  if (!list?.length) return undefined;
  const i = variant ? list.indexOf(variant) : -1;
  return list[(((i < 0 ? 0 : i + step) % list.length) + list.length) % list.length];
}

// ------------------------------------------------------------------ paredes

/** Trecho de parede (face norte ou mureta sul) sob um ponto em px de mundo. */
export interface WallHit {
  area: MapArea;
  on: 'face' | 'south';
  /** x local (tiles, fracionário). */
  lx: number;
}

export function wallAt(doc: OfficeMapDoc, wx: number, wy: number, hidden?: ReadonlySet<string>): WallHit | null {
  for (const a of doc.areas) {
    if (hidden?.has(a.id)) continue;
    const x0 = a.rect.x * TILE;
    const x1 = (a.rect.x + a.rect.w) * TILE;
    if (wx < x0 || wx >= x1) continue;
    const top = a.rect.y * TILE;
    if (a.walls.north && wy >= top - TILE && wy < top + 2 * TILE) return { area: a, on: 'face', lx: wx / TILE - a.rect.x };
    const s = (a.rect.y + a.rect.h - 1) * TILE;
    if (a.walls.south && wy >= s && wy < s + TILE) return { area: a, on: 'south', lx: wx / TILE - a.rect.x };
  }
  return null;
}

/** Item de parede sob o ponto (o mais próximo do centro quando há mais de um). */
export function wallItemAt(doc: OfficeMapDoc, wx: number, wy: number, hidden?: ReadonlySet<string>): { area: MapArea; item: MapWallItem } | null {
  const hit = wallAt(doc, wx, wy, hidden);
  if (!hit) return null;
  let best: { area: MapArea; item: MapWallItem } | null = null;
  let bestD = Infinity;
  for (const w of hit.area.wallItems) {
    if (w.on !== hit.on) continue;
    const half = FURNITURE[w.kind].footprint.w / 2;
    const d = Math.abs(hit.lx - w.lcx);
    if (d <= half && d < bestD) {
      best = { area: hit.area, item: w };
      bestD = d;
    }
  }
  return best;
}

/** Problema de pendurar `kind` centrado em `lcx` na parede `on` da área, ou null. */
export function wallItemProblem(area: MapArea, kind: FurnitureKind, lcx: number, on: 'face' | 'south', ignoreId?: string): string | null {
  if (on === 'face' ? !area.walls.north : !area.walls.south) return t('editor.problem.noWall');
  const geo = areaGeometry(area);
  const half = FURNITURE[kind].footprint.w / 2;
  if (lcx - half < geo.spanX0 || lcx + half > geo.spanX1) return t('editor.problem.outsideWall');
  for (const w of area.wallItems) {
    if (w.id === ignoreId || w.on !== on) continue;
    const hw = FURNITURE[w.kind].footprint.w / 2;
    if (lcx - half < w.lcx + hw && w.lcx - hw < lcx + half) return t('editor.problem.overlaps', { name: w.kind });
  }
  return null;
}

/** Centro válido mais próximo para um item de parede (encaixe de 0,25 dentro do trecho). */
export function clampWallCenter(area: MapArea, kind: FurnitureKind, lx: number): number {
  const geo = areaGeometry(area);
  const half = FURNITURE[kind].footprint.w / 2;
  return Math.max(geo.spanX0 + half, Math.min(geo.spanX1 - half, snapQuarter(lx)));
}

// ------------------------------------------------------------------ mover / redimensionar áreas

/** A área cabe no mapa e não sobrepõe outra? */
export function areaRectProblem(doc: OfficeMapDoc, rect: TileRect, ignoreId?: string): string | null {
  if (rect.w < 4 || rect.h < 4) return t('editor.problem.min4x4');
  if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > doc.size.w || rect.y + rect.h > doc.size.h) return t('editor.problem.outsideMap');
  for (const a of doc.areas) if (a.id !== ignoreId && intersects(a.rect, rect)) return t('editor.problem.overlaps', { name: a.name });
  return null;
}

/**
 * Área com novo retângulo, mantendo o conteúdo no lugar em coordenadas absolutas (desloca os itens
 * locais quando o canto superior esquerdo muda). Um piso único que cobria a área inteira cresce junto.
 */
export function resizeArea(a: MapArea, rect: TileRect): MapArea {
  const dx = rect.x - a.rect.x;
  const dy = rect.y - a.rect.y;
  const full = normalizeFloors(a.floors, a.rect.w, a.rect.h);
  const single = full.length === 1 && full[0].lx === 0 && full[0].ly === 0 && full[0].w === a.rect.w && full[0].h === a.rect.h;
  const floors = single ? [{ ...full[0], w: rect.w, h: rect.h }] : normalizeFloors(a.floors.map((f) => ({ ...f, lx: f.lx - dx, ly: f.ly - dy })), rect.w, rect.h);
  const next: MapArea = {
    ...a,
    rect: { ...rect },
    floors,
    furniture: a.furniture.map((f) => ({ ...f, lx: f.lx - dx, ly: f.ly - dy })),
    rugs: a.rugs.map((r) => ({ ...r, lx: r.lx - dx, ly: r.ly - dy })),
    wallItems: a.wallItems.map((w) => ({ ...w, lcx: w.lcx - dx })),
    doorways: a.doorways.map((d) => ({ ...d, lx: d.lx - dx })),
  };
  if (a.blocked) next.blocked = a.blocked.map((b) => ({ ...b, x: b.x - dx, y: b.y - dy }));
  return next;
}

/**
 * Move a área inteira por (dx, dy) tiles: o conteúdo local vai junto sozinho; zonas totalmente
 * dentro dela, spots e pontos de entrada dentro dela são deslocados também.
 */
export function moveAreaOps(doc: OfficeMapDoc, areaId: string, dx: number, dy: number): EditOp[] {
  const index = doc.areas.findIndex((a) => a.id === areaId);
  if (index < 0 || (!dx && !dy)) return [];
  const a = doc.areas[index];
  const r = a.rect;
  const ops: EditOp[] = [updateOp(doc, { doc: 'areas' }, index, { ...a, rect: { ...r, x: r.x + dx, y: r.y + dy } })];
  doc.zones.forEach((z, i) => {
    if (z.rects.length && z.rects.every((zr) => contains(r, zr))) ops.push(updateOp(doc, { doc: 'zones' }, i, { ...z, rects: z.rects.map((zr) => ({ ...zr, x: zr.x + dx, y: zr.y + dy })) }));
  });
  doc.spots.forEach((s, i) => {
    if (inRect(r, s.tx, s.ty)) ops.push(updateOp(doc, { doc: 'spots' }, i, { ...s, tx: s.tx + dx, ty: s.ty + dy }));
  });
  doc.spawn.forEach((p, i) => {
    if (inRect(r, p.x, p.y)) ops.push(updateOp(doc, { doc: 'spawn' }, i, { x: p.x + dx, y: p.y + dy }));
  });
  return ops;
}

// ------------------------------------------------------------------ contorno de uma referência

/** Retângulo (tiles absolutos, podendo ser fracionário) ocupado por uma referência. */
export function refBounds(doc: OfficeMapDoc, ref: Ref): TileRect | null {
  const r = resolve(doc, ref);
  if (!r) return null;
  switch (r.t) {
    case 'furn':
      return furnRect(r.area, r.item);
    case 'wall': {
      const half = FURNITURE[r.item.kind].footprint.w / 2;
      const y = r.item.on === 'face' ? r.area.rect.y : r.area.rect.y + r.area.rect.h - 1;
      return { x: r.area.rect.x + r.item.lcx - half, y, w: half * 2, h: r.item.on === 'face' ? 2 : 1 };
    }
    case 'rug':
      return { x: r.area.rect.x + r.item.lx, y: r.area.rect.y + r.item.ly, w: r.item.w, h: r.item.h };
    case 'door': {
      const d = doorwayRect(r.area, r.item);
      return { x: r.area.rect.x + d.x, y: r.area.rect.y + d.y, w: d.w, h: d.h };
    }
    case 'area':
      return r.item.rect;
    case 'zone': {
      if (!r.item.rects.length) return null;
      const x0 = Math.min(...r.item.rects.map((q) => q.x));
      const y0 = Math.min(...r.item.rects.map((q) => q.y));
      const x1 = Math.max(...r.item.rects.map((q) => q.x + q.w));
      const y1 = Math.max(...r.item.rects.map((q) => q.y + q.h));
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    case 'spot':
      return { x: r.item.tx, y: r.item.ty, w: 1, h: 1 };
    case 'spawn':
      return { x: r.item.x, y: r.item.y, w: 1, h: 1 };
  }
}
