// Referências a coisas selecionáveis do documento e resolução ref -> item/índice. Puro.
import type { MapArea, MapDoorway, MapFurniture, MapRug, MapSpot, MapWallItem, MapZone, OfficeMapDoc } from '../../../shared/map/doc';
import type { Coll } from './ops';

export type Ref =
  | { t: 'furn'; area: string; id: string }
  | { t: 'wall'; area: string; id: string }
  | { t: 'rug'; area: string; id: string }
  | { t: 'door'; area: string; i: number }
  | { t: 'area'; id: string }
  | { t: 'zone'; id: string }
  | { t: 'spawn'; i: number }
  | { t: 'spot'; id: string };

export function refKey(r: Ref): string {
  switch (r.t) {
    case 'furn':
    case 'wall':
    case 'rug':
      return `${r.t}:${r.area}#${r.id}`;
    case 'door':
      return `door:${r.area}#${r.i}`;
    case 'spawn':
      return `spawn:${r.i}`;
    default:
      return `${r.t}:${r.id}`;
  }
}

export function sameRef(a: Ref, b: Ref): boolean {
  return refKey(a) === refKey(b);
}

export function hasRef(list: readonly Ref[], r: Ref): boolean {
  const k = refKey(r);
  return list.some((x) => refKey(x) === k);
}

/** Separa o id absoluto "area#local" de um móvel/item. */
export function splitAbsId(abs: string): { area: string; id: string } | null {
  const i = abs.indexOf('#');
  if (i <= 0) return null;
  return { area: abs.slice(0, i), id: abs.slice(i + 1) };
}

export type Resolved =
  | { t: 'furn'; area: MapArea; item: MapFurniture; index: number; at: Coll }
  | { t: 'wall'; area: MapArea; item: MapWallItem; index: number; at: Coll }
  | { t: 'rug'; area: MapArea; item: MapRug; index: number; at: Coll }
  | { t: 'door'; area: MapArea; item: MapDoorway; index: number; at: Coll }
  | { t: 'area'; item: MapArea; index: number; at: Coll }
  | { t: 'zone'; item: MapZone; index: number; at: Coll }
  | { t: 'spawn'; item: { x: number; y: number }; index: number; at: Coll }
  | { t: 'spot'; item: MapSpot; index: number; at: Coll };

/** Encontra o item de uma referência no documento (null se não existe mais). */
export function resolve(doc: OfficeMapDoc, r: Ref): Resolved | null {
  switch (r.t) {
    case 'furn':
    case 'wall':
    case 'rug':
    case 'door': {
      const area = doc.areas.find((a) => a.id === r.area);
      if (!area) return null;
      if (r.t === 'door') {
        const item = area.doorways[r.i];
        return item ? { t: 'door', area, item, index: r.i, at: { area: area.id, list: 'doorways' } } : null;
      }
      const list = r.t === 'furn' ? 'furniture' : r.t === 'wall' ? 'wallItems' : 'rugs';
      const index = (area[list] as { id: string }[]).findIndex((x) => x.id === r.id);
      if (index < 0) return null;
      const at: Coll = { area: area.id, list };
      if (r.t === 'furn') return { t: 'furn', area, item: area.furniture[index], index, at };
      if (r.t === 'wall') return { t: 'wall', area, item: area.wallItems[index], index, at };
      return { t: 'rug', area, item: area.rugs[index], index, at };
    }
    case 'area': {
      const index = doc.areas.findIndex((a) => a.id === r.id);
      return index < 0 ? null : { t: 'area', item: doc.areas[index], index, at: { doc: 'areas' } };
    }
    case 'zone': {
      const index = doc.zones.findIndex((z) => z.id === r.id);
      return index < 0 ? null : { t: 'zone', item: doc.zones[index], index, at: { doc: 'zones' } };
    }
    case 'spot': {
      const index = doc.spots.findIndex((s) => s.id === r.id);
      return index < 0 ? null : { t: 'spot', item: doc.spots[index], index, at: { doc: 'spots' } };
    }
    case 'spawn': {
      const item = doc.spawn[r.i];
      return item ? { t: 'spawn', item, index: r.i, at: { doc: 'spawn' } } : null;
    }
  }
}

/** Mantém só as referências que ainda existem. */
export function pruneRefs(doc: OfficeMapDoc, refs: readonly Ref[]): Ref[] {
  return refs.filter((r) => resolve(doc, r) !== null);
}
