// Construtor mínimo de `OfficeMapDoc` em código (testes, stamps). Coordenadas dentro da área são
// LOCAIS (como no `AreaBuilder`); ids de móveis/itens "f<seq>" vindos de `doc.seq` (nunca reusados).
import type { AreaKind, MapArea, MapDoorway, MapFloor, MapFurniture, MapSpot, MapWallItem, MapWalls, MapZone, OfficeMapDoc, TileRect } from './doc';
import { MAP_SCHEMA } from './doc';
import type { FurnitureKind } from './furniture';

export interface AreaOpts {
  name?: string;
  code?: string;
  kind?: AreaKind;
  /** `false` = sem paredes; objeto = quais lados (os ausentes valem false). Padrão: as 4. */
  walls?: Partial<MapWalls> | false;
  /** Piso cobrindo a área inteira; `false` = nenhum. Padrão: concreto. */
  floor?: Omit<MapFloor, 'lx' | 'ly' | 'w' | 'h'> | false;
  doorways?: MapDoorway[];
  floorTint?: string;
}

export interface AreaHandle {
  readonly area: MapArea;
  /** Móvel de chão em (lx, ly) locais; devolve o id local. */
  furn(kind: FurnitureKind, lx: number, ly: number, o?: Omit<MapFurniture, 'id' | 'kind' | 'lx' | 'ly'>): string;
  /** Item de parede centrado em `lcx`; devolve o id local. */
  wall(kind: FurnitureKind, lcx: number, o?: Partial<Omit<MapWallItem, 'id' | 'kind' | 'lcx'>>): string;
  door(side: 'north' | 'south', lx: number, w?: number): AreaHandle;
  rug(lx: number, ly: number, w: number, h: number, color: string): string;
  block(lx: number, ly: number, w: number, h: number): AreaHandle;
}

export interface DocBuilder {
  readonly doc: OfficeMapDoc;
  area(id: string, rect: TileRect, o?: AreaOpts): AreaHandle;
  zone(z: Omit<MapZone, 'private' | 'lockable'> & Partial<Pick<MapZone, 'private' | 'lockable'>>): DocBuilder;
  spawn(x: number, y: number): DocBuilder;
  spot(s: MapSpot): DocBuilder;
  build(): OfficeMapDoc;
}

const DEFAULT_WALL_STYLE = { base: '#2a292e', trim: '#b79303', pattern: 'plain' as const };

export function createDocBuilder(size: { w: number; h: number }, name = 'teste'): DocBuilder {
  const doc: OfficeMapDoc = { schema: MAP_SCHEMA, name, size: { ...size }, seq: 0, areas: [], zones: [], spawn: [], spots: [] };
  const nextId = () => `f${doc.seq++}`;
  const b: DocBuilder = {
    doc,
    area(id, rect, o = {}) {
      const w = o.walls === false ? {} : (o.walls ?? { north: true, south: true, west: true, east: true });
      const area: MapArea = {
        id,
        name: o.name ?? id,
        kind: o.kind ?? 'room',
        rect: { ...rect },
        walls: { style: DEFAULT_WALL_STYLE, north: !!w.north, south: !!w.south, west: !!w.west, east: !!w.east, ...(w.style ? { style: w.style } : {}) },
        doorways: [...(o.doorways ?? [])],
        floors: o.floor === false ? [] : [{ kind: 'concrete', ...(o.floor ?? {}), lx: 0, ly: 0, w: rect.w, h: rect.h }],
        rugs: [],
        furniture: [],
        wallItems: [],
      };
      if (o.code) area.code = o.code;
      if (o.floorTint) area.floorTint = o.floorTint;
      doc.areas.push(area);
      const h: AreaHandle = {
        area,
        furn(kind, lx, ly, fo = {}) {
          const fid = nextId();
          area.furniture.push({ id: fid, kind, lx, ly, ...fo });
          return fid;
        },
        wall(kind, lcx, wo = {}) {
          const wid = nextId();
          area.wallItems.push({ id: wid, kind, lcx, on: 'face', ...wo });
          return wid;
        },
        door(side, lx, dw = 2) {
          area.doorways.push({ side, lx, w: dw });
          return h;
        },
        rug(lx, ly, rw, rh, color) {
          const rid = nextId();
          area.rugs.push({ id: rid, lx, ly, w: rw, h: rh, color });
          return rid;
        },
        block(lx, ly, bw, bh) {
          (area.blocked ??= []).push({ x: lx, y: ly, w: bw, h: bh });
          return h;
        },
      };
      return h;
    },
    zone(z) {
      doc.zones.push({ private: false, lockable: false, ...z });
      return b;
    },
    spawn(x, y) {
      doc.spawn.push({ x, y });
      return b;
    },
    spot(s) {
      doc.spots.push(s);
      return b;
    },
    build() {
      return doc;
    },
  };
  return b;
}
