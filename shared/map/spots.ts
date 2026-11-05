// Derivação dos spots (assentos e pontos de uso) a partir dos móveis de uma área do documento
// (tabela A.2 do plano). Puro e determinístico: ids `${area.id}#${f.id}:${kind}[:${i}]`, então
// assentos e reivindicações sobrevivem a republicações do mapa.
import type { MessageKey, Params } from '../i18n';
import { SEAT_FOOT_DY, SEATED_SORT_BIAS } from './builder';
import type { MapArea, MapFurniture, MapSpot } from './doc';
import { FURNITURE, type Dir, type FurnitureKind } from './furniture';
import { FOOT_DX, FOOT_DY, TILE } from './tile';
import type { SpotDef, SpotKind } from './types';

export { SEAT_FOOT_DY, SEATED_SORT_BIAS };

/** Id absoluto de um móvel/item de parede/tapete. */
export function absId(areaId: string, localId: string): string {
  return `${areaId}#${localId}`;
}

/** Mesas para as quais uma banqueta se vira. */
const TABLES = new Set<FurnitureKind>(['meeting_table', 'cafe_table', 'coffee_table', 'desk', 'desk_back', 'counter', 'reception_desk']);

/** Spots em que o jogador "usa" algo (ação `use`). `talk`/`stand`/`watch` são só posições. */
export const USE_SPOT_KINDS: ReadonlySet<SpotKind> = new Set<SpotKind>(['coffee', 'water', 'snack', 'fridge', 'sink', 'stall', 'arcade', 'pingpong', 'shelf', 'whiteboard']);

/** Máquinas de uso em pé: personagem ao sul, virado para cima. */
const MACHINES: Partial<Record<FurnitureKind, SpotKind>> = {
  coffee_machine: 'coffee',
  water_cooler: 'water',
  vending_machine: 'snack',
  fridge: 'fridge',
  sink: 'sink',
  counter_sink: 'sink',
  arcade: 'arcade',
};

export interface SpotCtx {
  /** Recebe avisos da derivação (ex.: cadeira de escritório sem mesa vira banqueta). */
  warn?(code: 'chair_without_desk', key: MessageKey, params: Params, ref: string): void;
}

const DIRS: readonly Dir[] = ['down', 'up', 'left', 'right'];

function asDir(v: string | undefined, fallback: Dir): Dir {
  return v && (DIRS as readonly string[]).includes(v) ? (v as Dir) : fallback;
}

/** Móvel de chão cujo footprint cobre o tile local (x, y). */
function furnitureAt(area: MapArea, x: number, y: number, pred: (f: MapFurniture) => boolean): MapFurniture | undefined {
  for (const f of area.furniture) {
    if (!pred(f)) continue;
    const { w, h } = FURNITURE[f.kind].footprint;
    if (x >= f.lx && x < f.lx + w && y >= f.ly && y < f.ly + h) return f;
  }
  return undefined;
}

/** Mesa (`kind`) com canto em (lx-1..lx, ly). */
function deskFor(area: MapArea, kind: 'desk' | 'desk_back', lx: number, ly: number): MapFurniture | undefined {
  return area.furniture.find((f) => f.kind === kind && f.ly === ly && f.lx === lx) ?? area.furniture.find((f) => f.kind === kind && f.ly === ly && f.lx === lx - 1);
}

/** Gera os spots de uma área (móveis + itens de parede). Não inclui os `MapSpot` avulsos. */
export function deriveSpots(area: MapArea, ctx: SpotCtx = {}): SpotDef[] {
  const x0 = area.rect.x;
  const y0 = area.rect.y;
  const px = (lx: number) => (x0 + lx) * TILE;
  const py = (ly: number) => (y0 + ly) * TILE;
  const out: SpotDef[] = [];

  const seat = (f: MapFurniture, kind: SpotKind, lx: number, ly: number, dir: Dir, suffix = '', extra: Partial<SpotDef> = {}): void => {
    const base = py(ly + 1);
    out.push({
      id: `${absId(area.id, f.id)}:${kind}${suffix}`,
      kind,
      areaId: area.id,
      tx: x0 + lx,
      ty: y0 + ly,
      x: px(lx) + TILE / 2 + (f.dx ?? 0),
      y: base - SEAT_FOOT_DY + (f.dy ?? 0),
      dir,
      seated: true,
      furnitureId: absId(area.id, f.id),
      sortY: base + SEATED_SORT_BIAS,
      ...extra,
    });
  };

  const stand = (refId: string, kind: SpotKind, lx: number, ly: number, dir: Dir, o: { dx?: number; dy?: number; x?: number; group?: string; suffix?: string; furnitureId?: string } = {}): void => {
    out.push({
      id: `${absId(area.id, refId)}:${kind}${o.suffix ?? ''}`,
      kind,
      areaId: area.id,
      tx: x0 + lx,
      ty: y0 + ly,
      x: o.x ?? px(lx) + FOOT_DX + (o.dx ?? 0),
      y: py(ly) + FOOT_DY + (o.dy ?? 0),
      dir,
      furnitureId: o.furnitureId,
      group: o.group,
    });
  };

  for (const f of area.furniture) {
    const fid = absId(area.id, f.id);
    switch (f.kind) {
      case 'office_chair': {
        const desk = deskFor(area, 'desk', f.lx, f.ly - 1);
        if (desk) seat(f, 'desk', f.lx, f.ly, 'up', '', { deskId: absId(area.id, desk.id), side: 'S' });
        else {
          ctx.warn?.('chair_without_desk', 'map.validate.chairWithoutDeskAbove', { id: fid }, fid);
          seat(f, 'stool', f.lx, f.ly, 'up');
        }
        break;
      }
      case 'office_chair_front': {
        const desk = deskFor(area, 'desk_back', f.lx, f.ly + 1);
        if (desk) seat(f, 'desk', f.lx, f.ly, 'down', '', { deskId: absId(area.id, desk.id), side: 'N' });
        else {
          ctx.warn?.('chair_without_desk', 'map.validate.chairWithoutDeskBelow', { id: fid }, fid);
          seat(f, 'stool', f.lx, f.ly, 'down');
        }
        break;
      }
      case 'stool': {
        let dir: Dir = f.dir ?? 'down';
        const near: [Dir, number, number][] = [
          ['up', f.lx, f.ly - 1],
          ['down', f.lx, f.ly + 1],
          ['left', f.lx - 1, f.ly],
          ['right', f.lx + 1, f.ly],
        ];
        for (const [d, x, y] of near) {
          if (furnitureAt(area, x, y, (g) => TABLES.has(g.kind))) {
            dir = d;
            break;
          }
        }
        seat(f, 'stool', f.lx, f.ly, dir);
        break;
      }
      case 'cafe_chair':
        seat(f, 'cafe_seat', f.lx, f.ly, asDir(f.variant, 'down'));
        break;
      case 'armchair':
        seat(f, 'armchair', f.lx, f.ly, asDir(f.variant, 'down'));
        break;
      case 'sofa': {
        const dir = asDir(f.variant, 'down');
        for (let i = 0; i < FURNITURE.sofa.footprint.w; i++) seat(f, 'sofa', f.lx + i, f.ly, dir, `:${i}`);
        break;
      }
      case 'bench':
        for (let i = 0; i < FURNITURE.bench.footprint.w; i++) seat(f, 'bench', f.lx + i, f.ly, f.dir ?? 'down', `:${i}`);
        break;
      case 'beanbag':
        seat(f, 'beanbag', f.lx, f.ly, f.dir ?? 'down');
        break;
      case 'bookshelf':
        stand(f.id, 'shelf', f.lx, f.ly + 1, 'up', { dx: 8, dy: -2, furnitureId: fid });
        break;
      case 'toilet_stall':
        stand(f.id, 'stall', f.lx, f.ly + 2, 'up', { x: px(f.lx + 1), furnitureId: fid });
        break;
      case 'pingpong_table': {
        const pp = `pp:${fid}`;
        const watch = `watch:${fid}`;
        stand(f.id, 'pingpong', f.lx - 1, f.ly + 1, 'right', { group: pp, suffix: ':0', furnitureId: fid });
        stand(f.id, 'pingpong', f.lx + 3, f.ly + 1, 'left', { group: pp, suffix: ':1', furnitureId: fid });
        stand(f.id, 'watch', f.lx, f.ly - 1, 'down', { group: watch, suffix: ':0', furnitureId: fid });
        stand(f.id, 'watch', f.lx + 2, f.ly - 1, 'down', { group: watch, suffix: ':1', furnitureId: fid });
        break;
      }
      default: {
        const kind = MACHINES[f.kind];
        if (kind) stand(f.id, kind, f.lx, f.ly + 1, 'up', { dy: -3, furnitureId: fid });
      }
    }
  }

  for (const w of area.wallItems) {
    if (w.kind === 'whiteboard' && w.on === 'face') stand(w.id, 'whiteboard', Math.floor(w.lcx - 0.5), 2, 'up', { dx: 8, dy: 2, furnitureId: absId(area.id, w.id) });
  }
  return out;
}

/** Spot avulso do documento (talk/stand/watch), em tiles absolutos. */
export function docSpot(s: MapSpot, areaId: string): SpotDef {
  return {
    id: `spot:${s.id}`,
    kind: s.kind,
    areaId,
    tx: s.tx,
    ty: s.ty,
    x: s.tx * TILE + FOOT_DX + (s.dx ?? 0),
    y: s.ty * TILE + FOOT_DY + (s.dy ?? 0),
    dir: s.dir,
    group: s.group,
  };
}

