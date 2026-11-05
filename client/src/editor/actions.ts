// Ações sobre a seleção (apagar, girar, variante, mover, copiar/colar) como lotes de operações.
// Puro: recebe o documento e as referências, devolve operações (ou o motivo de não poder).
import type { MapFurniture, MapRug, MapSpot, MapWallItem, OfficeMapDoc, TileRect } from '../../../shared/map/doc';
import { FURNITURE } from '../../../shared/map/furniture';
import { t } from '../i18n';
import type { DocStore } from './doc-store';
import { areaAt, contains, cycleVariant, footprint, inRect, moveAreaOps, placementProblem, rotateFurniture, wallItemProblem } from './geometry';
import { addOp, apply, batch, chain, removeOp, updateOp, type EditOp } from './ops';
import { resolve, type Ref } from './types';

type Step = (d: OfficeMapDoc) => EditOp | null | undefined;

/** Índice decrescente para remover refs por posição (spawn/portas) sem deslocar as seguintes. */
function byIndexDesc(a: Ref, b: Ref): number {
  const ia = a.t === 'spawn' || a.t === 'door' ? a.i : -1;
  const ib = b.t === 'spawn' || b.t === 'door' ? b.i : -1;
  return ib - ia;
}

export function deleteOps(doc: OfficeMapDoc, refs: readonly Ref[]): EditOp {
  const steps: Step[] = [...refs].sort(byIndexDesc).map((ref) => (d) => {
    const r = resolve(d, ref);
    return r ? removeOp(d, r.at, r.index) : null;
  });
  return chain(doc, 'editor.op.deleteItems', steps, { n: refs.length }).op;
}

export function rotateOps(doc: OfficeMapDoc, refs: readonly Ref[], reverse = false): EditOp {
  const CW: Record<string, MapSpot['dir']> = { up: 'right', right: 'down', down: 'left', left: 'up' };
  const CCW: Record<string, MapSpot['dir']> = { up: 'left', left: 'down', down: 'right', right: 'up' };
  const steps: Step[] = refs.map((ref) => (d) => {
    const r = resolve(d, ref);
    if (!r) return null;
    if (r.t === 'furn') {
      const next = rotateFurniture(r.item, reverse);
      return next ? updateOp(d, r.at, r.index, next) : null;
    }
    if (r.t === 'spot') return updateOp(d, r.at, r.index, { ...r.item, dir: (reverse ? CCW : CW)[r.item.dir] });
    return null;
  });
  return chain(doc, 'editor.op.rotate', steps).op;
}

export function cycleVariantOps(doc: OfficeMapDoc, refs: readonly Ref[], step = 1): EditOp {
  const steps: Step[] = refs.map((ref) => (d) => {
    const r = resolve(d, ref);
    if (!r || (r.t !== 'furn' && r.t !== 'wall')) return null;
    const v = cycleVariant(r.item.kind, r.item.variant, step);
    return v === undefined ? null : updateOp(d, r.at, r.index, { ...r.item, variant: v });
  });
  return chain(doc, 'editor.op.cycleVariant', steps).op;
}

/** Id local livre ("f<n>") numa área. */
function freeLocalId(doc: OfficeMapDoc, areaId: string, n: number): string {
  const a = doc.areas.find((x) => x.id === areaId);
  const used = new Set<string>([...(a?.furniture ?? []), ...(a?.wallItems ?? []), ...(a?.rugs ?? [])].map((x) => x.id));
  let k = n;
  while (used.has(`f${k}`)) k++;
  return `f${k}`;
}

/**
 * Move a seleção (dx, dy) tiles (tapetes e itens de parede aceitam frações de 0,25 em `fdx`).
 * Móveis que saem da área entram na área de destino (mesmo id se livre). Devolve o lote ou o motivo.
 */
export function moveOps(store: DocStore, doc: OfficeMapDoc, refs: readonly Ref[], dx: number, dy: number, fdx = dx, fdy = dy): { op: EditOp | null; problem: string | null } {
  if (!dx && !dy && !fdx && !fdy) return { op: null, problem: null };
  const movedAreas = new Set(refs.filter((r) => r.t === 'area').map((r) => (r as { id: string }).id));
  const inMovedArea = (r: Ref) => (r.t === 'furn' || r.t === 'wall' || r.t === 'rug' || r.t === 'door') && movedAreas.has(r.area);
  const list = refs.filter((r) => !inMovedArea(r));
  const steps: Step[] = [];
  let problem: string | null = null;

  // móveis, agrupados por área
  const furnByArea = new Map<string, Ref[]>();
  for (const r of list) if (r.t === 'furn') furnByArea.set(r.area, [...(furnByArea.get(r.area) ?? []), r]);
  const seq0 = store.allocIds(1, doc).nums[0];
  for (const [areaId, group] of furnByArea) {
    const area = doc.areas.find((a) => a.id === areaId);
    if (!area) continue;
    const items = group.map((r) => resolve(doc, r)).filter((x): x is Extract<NonNullable<ReturnType<typeof resolve>>, { t: 'furn' }> => x?.t === 'furn');
    const ids = new Set(items.map((i) => i.item.id));
    const stay = items.every((i) => !placementProblem(area, i.item.kind, i.item.lx + dx, i.item.ly + dy, ids));
    if (stay) {
      for (const i of items) steps.push((d) => {
        const r = resolve(d, { t: 'furn', area: areaId, id: i.item.id });
        return r?.t === 'furn' ? updateOp(d, r.at, r.index, { ...r.item, lx: r.item.lx + dx, ly: r.item.ly + dy }) : null;
      });
      continue;
    }
    // destino: a área que contém o canto do primeiro item
    const first = items[0];
    if (!first) continue;
    const target = areaAt(doc, area.rect.x + first.item.lx + dx, area.rect.y + first.item.ly + dy);
    if (!target || target.id === areaId) {
      problem = placementProblem(area, first.item.kind, first.item.lx + dx, first.item.ly + dy, ids) ?? t('editor.problem.invalidPosition');
      break;
    }
    const placed: { kind: MapFurniture['kind']; lx: number; ly: number }[] = [];
    for (const i of items) {
      const lx = area.rect.x + i.item.lx + dx - target.rect.x;
      const ly = area.rect.y + i.item.ly + dy - target.rect.y;
      const p = placementProblem(target, i.item.kind, lx, ly, undefined, placed);
      if (p) {
        problem = p;
        break;
      }
      placed.push({ kind: i.item.kind, lx, ly });
    }
    if (problem) break;
    for (const i of [...items].sort((a, b) => b.index - a.index)) steps.push((d) => {
      const r = resolve(d, { t: 'furn', area: areaId, id: i.item.id });
      return r ? removeOp(d, r.at, r.index) : null;
    });
    items.forEach((i, k) => steps.push((d) => {
      const tgt = d.areas.find((a) => a.id === target.id)!;
      const taken = tgt.furniture.some((f) => f.id === i.item.id) || tgt.wallItems.some((w) => w.id === i.item.id) || tgt.rugs.some((r) => r.id === i.item.id);
      const id = taken ? freeLocalId(d, target.id, seq0) : i.item.id;
      return addOp(d, { area: target.id, list: 'furniture' }, { ...i.item, id, lx: placed[k].lx, ly: placed[k].ly });
    }));
  }
  if (problem) return { op: null, problem };

  for (const ref of list) {
    if (ref.t === 'furn') continue;
    const r = resolve(doc, ref);
    if (!r) continue;
    switch (r.t) {
      case 'wall': {
        const lcx = r.item.lcx + fdx;
        const p = wallItemProblem(r.area, r.item.kind, lcx, r.item.on, r.item.id);
        if (p) return { op: null, problem: p };
        steps.push((d) => {
          const x = resolve(d, ref);
          return x?.t === 'wall' ? updateOp(d, x.at, x.index, { ...x.item, lcx }) : null;
        });
        break;
      }
      case 'rug': {
        const n: MapRug = { ...r.item, lx: r.item.lx + fdx, ly: r.item.ly + fdy };
        if (n.lx < 0 || n.ly < 0 || n.lx + n.w > r.area.rect.w || n.ly + n.h > r.area.rect.h) return { op: null, problem: t('editor.problem.rugOutsideArea') };
        steps.push((d) => {
          const x = resolve(d, ref);
          return x ? updateOp(d, x.at, x.index, n) : null;
        });
        break;
      }
      case 'door': {
        const lx = r.item.lx + dx;
        if (lx < 1 || lx + r.item.w > r.area.rect.w - 1) return { op: null, problem: t('editor.problem.doorOutsideWall') };
        steps.push((d) => {
          const x = resolve(d, ref);
          return x ? updateOp(d, x.at, x.index, { ...r.item, lx }) : null;
        });
        break;
      }
      case 'zone':
        steps.push((d) => {
          const x = resolve(d, ref);
          return x?.t === 'zone' ? updateOp(d, x.at, x.index, { ...x.item, rects: x.item.rects.map((q) => ({ ...q, x: q.x + dx, y: q.y + dy })) }) : null;
        });
        break;
      case 'spot':
        steps.push((d) => {
          const x = resolve(d, ref);
          return x?.t === 'spot' ? updateOp(d, x.at, x.index, { ...x.item, tx: x.item.tx + dx, ty: x.item.ty + dy }) : null;
        });
        break;
      case 'spawn':
        steps.push((d) => {
          const x = resolve(d, ref);
          return x ? updateOp(d, x.at, x.index, { x: r.item.x + dx, y: r.item.y + dy }) : null;
        });
        break;
    }
  }
  // áreas por último (o conteúdo vai junto), verificando sobreposição contra o resto
  for (const id of movedAreas) {
    const a = doc.areas.find((x) => x.id === id);
    if (!a) continue;
    const next: TileRect = { ...a.rect, x: a.rect.x + dx, y: a.rect.y + dy };
    if (next.x < 0 || next.y < 0 || next.x + next.w > doc.size.w || next.y + next.h > doc.size.h) return { op: null, problem: t('editor.problem.areaOutsideMap') };
    for (const o of doc.areas) {
      if (movedAreas.has(o.id)) continue;
      if (next.x < o.rect.x + o.rect.w && o.rect.x < next.x + next.w && next.y < o.rect.y + o.rect.h && o.rect.y < next.y + next.h) return { op: null, problem: t('editor.problem.overlaps', { name: o.name }) };
    }
    steps.push((d) => batch('editor.op.moveArea', moveAreaOps(d, id, dx, dy)));
  }
  const ch = chain(doc, 'editor.op.move', steps);
  return { op: ch.op, problem: null };
}

// ------------------------------------------------------------------ copiar / colar

export type ClipItem =
  | { t: 'furn'; item: MapFurniture; x: number; y: number }
  | { t: 'rug'; item: MapRug; x: number; y: number }
  | { t: 'wall'; item: MapWallItem; x: number; y: number }
  | { t: 'spot'; item: MapSpot; x: number; y: number };

export interface Clipboard {
  items: ClipItem[];
  w: number;
  h: number;
}

/** Copia móveis, tapetes, itens de parede e spots selecionados (posições relativas ao canto). */
export function copySelection(doc: OfficeMapDoc, refs: readonly Ref[]): Clipboard | null {
  const raw: { t: ClipItem['t']; item: unknown; ax: number; ay: number; w: number; h: number }[] = [];
  for (const ref of refs) {
    const r = resolve(doc, ref);
    if (!r) continue;
    if (r.t === 'furn') {
      const fp = footprint(r.item.kind);
      raw.push({ t: 'furn', item: r.item, ax: r.area.rect.x + r.item.lx, ay: r.area.rect.y + r.item.ly, w: fp.w, h: fp.h });
    } else if (r.t === 'rug') raw.push({ t: 'rug', item: r.item, ax: r.area.rect.x + r.item.lx, ay: r.area.rect.y + r.item.ly, w: r.item.w, h: r.item.h });
    else if (r.t === 'wall') {
      const half = FURNITURE[r.item.kind].footprint.w / 2;
      raw.push({ t: 'wall', item: r.item, ax: r.area.rect.x + r.item.lcx - half, ay: r.item.on === 'face' ? r.area.rect.y : r.area.rect.y + r.area.rect.h - 1, w: half * 2, h: 1 });
    } else if (r.t === 'spot') raw.push({ t: 'spot', item: r.item, ax: r.item.tx, ay: r.item.ty, w: 1, h: 1 });
  }
  if (!raw.length) return null;
  const x0 = Math.floor(Math.min(...raw.map((r) => r.ax)));
  const y0 = Math.floor(Math.min(...raw.map((r) => r.ay)));
  const x1 = Math.ceil(Math.max(...raw.map((r) => r.ax + r.w)));
  const y1 = Math.ceil(Math.max(...raw.map((r) => r.ay + r.h)));
  return { items: raw.map((r) => ({ t: r.t, item: r.item, x: r.ax - x0, y: r.ay - y0 }) as ClipItem), w: x1 - x0, h: y1 - y0 };
}

/**
 * Cola com o canto em (tx, ty) absolutos. Cada item vai para a área sob ele, com id novo. Devolve o
 * lote, as referências novas (para selecionar) ou o motivo de não caber.
 */
export function pasteOps(store: DocStore, doc: OfficeMapDoc, clip: Clipboard, tx: number, ty: number): { op: EditOp | null; refs: Ref[]; problem: string | null } {
  const alloc = store.allocIds(clip.items.length, doc);
  const ops: EditOp[] = [alloc.op];
  let cur = apply(doc, alloc.op);
  const refs: Ref[] = [];
  const placed = new Map<string, { kind: MapFurniture['kind']; lx: number; ly: number }[]>();
  for (let k = 0; k < clip.items.length; k++) {
    const c = clip.items[k];
    const num = alloc.nums[k];
    const ax = tx + c.x;
    const ay = ty + c.y;
    let op: EditOp;
    if (c.t === 'spot') {
      const id = `${c.item.kind}-${num}`;
      op = addOp(cur, { doc: 'spots' }, { ...c.item, id, tx: ax, ty: ay, ...(c.item.group ? { group: `${c.item.group.replace(/-\d+$/, '')}-${num}` } : {}) });
      refs.push({ t: 'spot', id });
    } else {
      const area = areaAt(cur, Math.floor(ax), Math.floor(ay));
      if (!area) return { op: null, refs: [], problem: t('editor.problem.notInArea') };
      const id = freeLocalId(cur, area.id, num);
      if (c.t === 'furn') {
        const lx = Math.round(ax) - area.rect.x;
        const ly = Math.round(ay) - area.rect.y;
        const p = placementProblem(area, c.item.kind, lx, ly, undefined, placed.get(area.id));
        if (p) return { op: null, refs: [], problem: p };
        placed.set(area.id, [...(placed.get(area.id) ?? []), { kind: c.item.kind, lx, ly }]);
        op = addOp(cur, { area: area.id, list: 'furniture' }, { ...c.item, id, lx, ly });
        refs.push({ t: 'furn', area: area.id, id });
      } else if (c.t === 'rug') {
        const lx = ax - area.rect.x;
        const ly = ay - area.rect.y;
        if (!contains({ x: 0, y: 0, w: area.rect.w, h: area.rect.h }, { x: Math.floor(lx), y: Math.floor(ly), w: Math.ceil(c.item.w), h: Math.ceil(c.item.h) })) return { op: null, refs: [], problem: t('editor.problem.rugOutsideArea') };
        op = addOp(cur, { area: area.id, list: 'rugs' }, { ...c.item, id, lx, ly });
        refs.push({ t: 'rug', area: area.id, id });
      } else {
        const half = FURNITURE[c.item.kind].footprint.w / 2;
        const lcx = ax - area.rect.x + half;
        const on = inRect({ x: area.rect.x, y: area.rect.y + area.rect.h - 1, w: area.rect.w, h: 1 }, Math.floor(ax), Math.floor(ay)) ? 'south' : 'face';
        const p = wallItemProblem(area, c.item.kind, lcx, on);
        if (p) return { op: null, refs: [], problem: p };
        op = addOp(cur, { area: area.id, list: 'wallItems' }, { ...c.item, id, lcx, on });
        refs.push({ t: 'wall', area: area.id, id });
      }
    }
    ops.push(op);
    cur = apply(cur, op);
  }
  return { op: batch('editor.op.paste', ops), refs, problem: null };
}
