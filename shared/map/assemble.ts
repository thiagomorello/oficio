// Montagem do escritório a partir do documento: áreas -> `AreaLayout` (o que o render desenha),
// grade de caminhabilidade, spots, zonas, mesas, spawn e alcançabilidade. Puro, sem DOM; o
// servidor e o cliente chamam a mesma função e obtêm exatamente o mesmo mundo.
import type { MapArea, MapDoorway, OfficeMapDoc } from './doc';
import { deriveDesks, deskTileIndex } from './desks';
import { FURNITURE } from './furniture';
import { furnitureBlocks, furnitureIsSeat } from './builder';
import { BLOCKED, FREE, SEAT, WalkGrid } from './grid';
import { absId, deriveSpots, docSpot, type SpotCtx } from './spots';
import { TILE } from './tile';
import type { AreaLayout, FurniturePlacement, OfficeAssembly, SpotDef, TileRect, WallItemPlacement, WallSegment, ZoneDef } from './types';

// ------------------------------------------------------------------ geometria local de uma área

/** Geometria derivada das paredes de uma área (tiles LOCAIS). */
export interface AreaGeometry {
  /** Interior caminhável (sem paredes). */
  interior: TileRect;
  /** Trecho horizontal coberto pelas paredes norte/sul (frações: tampas laterais de 0,5). */
  spanX0: number;
  spanX1: number;
}

export function areaGeometry(a: MapArea): AreaGeometry {
  const { w, h } = a.rect;
  const x0 = a.walls.west ? 1 : 0;
  const x1 = a.walls.east ? w - 1 : w;
  const y0 = a.walls.north ? 2 : 0;
  const y1 = a.walls.south ? h - 1 : h;
  return {
    interior: { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) },
    spanX0: a.walls.west ? 0.5 : 0,
    spanX1: a.walls.east ? w - 0.5 : w,
  };
}

/** Tiles (locais) de uma passagem: norte = as 2 linhas da face; sul = a linha da mureta. */
export function doorwayRect(a: MapArea, d: MapDoorway): TileRect {
  return d.side === 'north' ? { x: d.lx, y: 0, w: d.w, h: 2 } : { x: d.lx, y: a.rect.h - 1, w: d.w, h: 1 };
}

/** Id do batente automático da i-ésima passagem norte ('~' nunca aparece em ids do documento). */
export function autoDoorFrameId(areaId: string, i: number): string {
  return `${areaId}#~door${i}`;
}

// ------------------------------------------------------------------ área -> AreaLayout

/** Converte uma área do documento no `AreaLayout` consumido pelo render (px/tiles absolutos). */
export function areaToLayout(a: MapArea, ctx: SpotCtx = {}): AreaLayout {
  const x0 = a.rect.x;
  const y0 = a.rect.y;
  const px = (lx: number) => (x0 + lx) * TILE;
  const py = (ly: number) => (y0 + ly) * TILE;
  const abs = (r: TileRect): TileRect => ({ x: x0 + r.x, y: y0 + r.y, w: r.w, h: r.h });
  const geo = areaGeometry(a);
  const doors = (side: 'north' | 'south') => {
    const list = a.doorways.filter((d) => d.side === side).map((d) => ({ x: px(d.lx), w: d.w * TILE }));
    return list.length ? list : undefined;
  };

  const walls: WallSegment[] = [];
  const spanW = (geo.spanX1 - geo.spanX0) * TILE;
  if (a.walls.north) walls.push({ kind: 'face', x: px(geo.spanX0), y: py(0), w: spanW, style: a.walls.style, doorways: doors('north') });
  if (a.walls.south) walls.push({ kind: 'south', x: px(geo.spanX0), y: py(a.rect.h - 1), w: spanW, style: a.walls.style, doorways: doors('south') });
  if (a.walls.west) walls.push({ kind: 'cap', x: px(0), y: py(0), w: TILE / 2, h: a.rect.h * TILE, style: a.walls.style });
  if (a.walls.east) walls.push({ kind: 'cap', x: px(a.rect.w - 0.5), y: py(0), w: TILE / 2, h: a.rect.h * TILE, style: a.walls.style });

  const wallItems: WallItemPlacement[] = a.wallItems.map((w) => ({
    id: absId(a.id, w.id),
    kind: w.kind,
    variant: w.variant,
    cx: Math.round(px(w.lcx)),
    baseY: w.on === 'face' ? py(2) : py(a.rect.h),
    on: w.on,
    order: w.kind === 'sign' ? 0.95 : 0.5,
    label: w.label ?? (w.kind === 'sign' ? a.name : undefined),
  }));
  a.doorways
    .filter((d) => d.side === 'north')
    .forEach((d, i) => {
      wallItems.push({ id: autoDoorFrameId(a.id, i), kind: 'door_frame', cx: Math.round(px(d.lx + d.w / 2)), baseY: py(2), on: 'face', order: 0.05 });
    });

  const furniture: FurniturePlacement[] = a.furniture.map((f) => ({
    id: absId(a.id, f.id),
    kind: f.kind,
    variant: f.variant,
    tx: x0 + f.lx,
    ty: y0 + f.ly,
    dx: f.dx,
    dy: f.dy,
    order: 0.5,
    seat: f.seat,
  }));

  const walkable: TileRect[] = [];
  if (geo.interior.w > 0 && geo.interior.h > 0) walkable.push(abs(geo.interior));
  for (const d of a.doorways) walkable.push(abs(doorwayRect(a, d)));

  const layout: AreaLayout = {
    id: a.id,
    kind: a.kind,
    rect: { ...a.rect },
    floors: a.floors.map((f) => ({ kind: f.kind, x: px(f.lx), y: py(f.ly), w: f.w * TILE, h: f.h * TILE, seed: f.seed ?? 1, tint: f.tint, tint2: f.tint2, ...(f.tintK !== undefined ? { tintK: f.tintK } : {}) })),
    rugs: a.rugs.map((r) => ({ x: Math.round(px(r.lx)), y: Math.round(py(r.ly)), w: Math.round(r.w * TILE), h: Math.round(r.h * TILE), color: r.color, seed: r.seed ?? 1 })),
    walls,
    wallItems,
    furniture,
    spots: deriveSpots(a, ctx),
    walkable,
  };
  if (a.blocked?.length) layout.blocked = a.blocked.map(abs);
  if (a.doorways.length) layout.door = abs(doorwayRect(a, a.doorways[0]));
  if (a.floorTint) layout.floorTint = a.floorTint;
  if (a.signId) layout.signId = absId(a.id, a.signId);
  return layout;
}

/** Marca na grade as células caminháveis de uma área, os bloqueios e os assentos (cópia de `layout/building.ts`). */
export function paintArea(grid: WalkGrid, area: AreaLayout): void {
  for (const r of area.walkable) grid.fill(r.x, r.y, r.w, r.h, FREE);
  for (const r of area.blocked ?? []) grid.fill(r.x, r.y, r.w, r.h, BLOCKED);
  for (const f of area.furniture) {
    const def = FURNITURE[f.kind];
    if (def.mount !== 'floor') continue;
    const { w, h } = def.footprint;
    if (furnitureBlocks(f.kind)) grid.fill(f.tx, f.ty, w, h, BLOCKED);
    else if (furnitureIsSeat(f.kind)) {
      for (let y = f.ty; y < f.ty + h; y++) for (let x = f.tx; x < f.tx + w; x++) if (grid.get(x, y) === FREE) grid.set(x, y, SEAT);
    }
  }
}

// ------------------------------------------------------------------ zonas

const DX4 = [1, -1, 0, 0];
const DY4 = [0, 0, 1, -1];

function buildZones(doc: OfficeMapDoc, grid: WalkGrid): { zones: ZoneDef[]; zoneAt: Int16Array } {
  const { w, h } = grid;
  const zoneAt = new Int16Array(w * h).fill(-1);
  const zones: ZoneDef[] = doc.zones.map((z, index) => {
    const tiles = new Uint8Array(w * h);
    let count = 0;
    for (const r of z.rects) {
      for (let y = Math.max(0, r.y); y < Math.min(h, r.y + r.h); y++) {
        for (let x = Math.max(0, r.x); x < Math.min(w, r.x + r.w); x++) {
          const i = y * w + x;
          if (tiles[i]) continue;
          tiles[i] = 1;
          count++;
          if (zoneAt[i] < 0) zoneAt[i] = index;
        }
      }
    }
    return { ...z, rects: z.rects.map((r) => ({ ...r })), index, tiles, count, doorTiles: [] };
  });
  for (const z of zones) {
    for (let i = 0; i < z.tiles.length; i++) {
      if (!z.tiles[i]) continue;
      const x = i % w;
      const y = (i - x) / w;
      if (!grid.walkable(x, y)) continue;
      for (let k = 0; k < 4; k++) {
        const nx = x + DX4[k];
        const ny = y + DY4[k];
        if (!grid.walkable(nx, ny) || z.tiles[ny * w + nx]) continue;
        z.doorTiles.push({ x, y });
        break;
      }
    }
  }
  return { zones, zoneAt };
}

// ------------------------------------------------------------------ montagem

const memo = new WeakMap<OfficeMapDoc, Map<number, OfficeAssembly>>();

/** Área (do documento) que contém o tile absoluto, ou undefined. */
export function areaAtTile(doc: OfficeMapDoc, tx: number, ty: number): MapArea | undefined {
  return doc.areas.find((a) => tx >= a.rect.x && ty >= a.rect.y && tx < a.rect.x + a.rect.w && ty < a.rect.y + a.rect.h);
}

/**
 * Monta o escritório. Memoizado por identidade do documento + versão (não mute um documento já
 * montado; o editor cria um novo objeto a cada alteração). Supõe um documento que passou no zod
 * (`migrateDoc`); problemas topológicos são do `validateMap`.
 */
export function assembleOffice(doc: OfficeMapDoc, version = 0, ctx: SpotCtx = {}): OfficeAssembly {
  let byVersion = memo.get(doc);
  const hit = byVersion?.get(version);
  if (hit && !ctx.warn) return hit;

  const w = doc.size.w;
  const h = doc.size.h;
  const grid = new WalkGrid(w, h, version);
  const areas = doc.areas.map((a) => areaToLayout(a, ctx));
  for (const a of areas) paintArea(grid, a);

  const spots: SpotDef[] = [];
  for (const a of areas) spots.push(...a.spots);
  for (const s of doc.spots) spots.push(docSpot(s, areaAtTile(doc, s.tx, s.ty)?.id ?? ''));
  const spotById = new Map(spots.map((s) => [s.id, s]));

  const { zones, zoneAt } = buildZones(doc, grid);
  const desks = deriveDesks({ doc, spots });
  const deskById = new Map(desks.map((d) => [d.id, d]));
  const spawn = doc.spawn.map((p) => ({ x: p.x, y: p.y }));
  const reach = spawn.length ? grid.reachableFrom(spawn[0].x, spawn[0].y) : new Uint8Array(w * h);

  const out: OfficeAssembly = {
    version,
    doc,
    w,
    h,
    grid,
    areas,
    areaById: new Map(areas.map((a) => [a.id, a])),
    spots,
    spotById,
    zones,
    zoneById: new Map(zones.map((z) => [z.id, z])),
    zoneAt,
    desks,
    deskById,
    deskAtTile: deskTileIndex(desks, spotById),
    spawn,
    reach,
  };
  if (!byVersion) memo.set(doc, (byVersion = new Map()));
  byVersion.set(version, out);
  return out;
}
