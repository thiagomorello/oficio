import { describe, expect, it } from 'vitest';
import { buildDefaultMap } from '../../../shared/map/default-map';
import { validateMap } from '../../../shared/map/validate';
import { copySelection, deleteOps, moveOps, pasteOps, rotateOps } from './actions';
import { DocStore } from './doc-store';
import { furnRect, moveAreaOps, placementProblem, resizeArea, rotateFurniture } from './geometry';
import { apply, batch } from './ops';
import { paintOps } from './tools/floor';
import { zoneRectsWith } from './tools/zone';
import { resolve, type Ref } from './types';

describe('ações da seleção', () => {
  const doc = buildDefaultMap();
  const store = new DocStore(doc);
  const lounge = doc.areas.find((a) => a.id === 'lounge')!;
  const plant = lounge.furniture.find((f) => f.kind === 'beanbag')!;
  const ref: Ref = { t: 'furn', area: 'lounge', id: plant.id };
  const zen = doc.areas.find((a) => a.id === 'sala-zen')!;
  /** Tile livre (local) na sala zen. */
  const freeZen = (() => {
    for (let y = 3; y < zen.rect.h - 1; y++) for (let x = 1; x < zen.rect.w - 1; x++) if (!placementProblem(zen, 'beanbag', x, y)) return { x, y };
    throw new Error('sem tile livre');
  })();

  it('move dentro da área e recusa sobreposição', () => {
    const free = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].find(([dx, dy]) => !moveOps(store, doc, [ref], dx, dy).problem)!;
    const r = moveOps(store, doc, [ref], free[0], free[1]);
    const next = apply(doc, r.op!);
    const moved = resolve(next, ref);
    expect(moved?.t === 'furn' && [moved.item.lx, moved.item.ly]).toEqual([plant.lx + free[0], plant.ly + free[1]]);
    const other = lounge.furniture.find((f) => f.kind === 'pingpong_table')!;
    expect(moveOps(store, doc, [ref], other.lx - plant.lx, other.ly - plant.ly).problem).toMatch(/sobrepõe/);
  });

  it('móvel arrastado para outra área muda de área', () => {
    const tx = zen.rect.x + freeZen.x;
    const ty = zen.rect.y + freeZen.y;
    const r = moveOps(store, doc, [ref], tx - (lounge.rect.x + plant.lx), ty - (lounge.rect.y + plant.ly));
    expect(r.problem).toBeNull();
    const next = apply(doc, r.op!);
    expect(next.areas.find((a) => a.id === 'lounge')!.furniture.some((f) => f.id === plant.id)).toBe(false);
    const inZen = next.areas.find((a) => a.id === 'sala-zen')!.furniture.find((f) => f.kind === 'beanbag' && f.lx === freeZen.x && f.ly === freeZen.y);
    expect(inZen).toBeDefined();
  });

  it('copiar/colar e apagar', () => {
    const clip = copySelection(doc, [ref])!;
    expect(clip.items).toHaveLength(1);
    const p = pasteOps(store, doc, clip, zen.rect.x + freeZen.x, zen.rect.y + freeZen.y);
    expect(p.problem).toBeNull();
    const next = apply(doc, p.op!);
    expect(resolve(next, p.refs[0])).not.toBeNull();
    const del = apply(next, deleteOps(next, p.refs));
    expect(JSON.stringify(del.areas)).toBe(JSON.stringify(doc.areas));
    expect(pasteOps(store, doc, clip, -10, -10).problem).toBe('fora de uma área');
  });

  it('girar segue as regras do plano', () => {
    const f = { id: 'x', lx: 0, ly: 0 };
    expect(rotateFurniture({ ...f, kind: 'cafe_chair', variant: 'up' })?.variant).toBe('right');
    expect(rotateFurniture({ ...f, kind: 'cafe_chair', variant: 'up' }, true)?.variant).toBe('left');
    expect(rotateFurniture({ ...f, kind: 'sofa', variant: 'down' })?.variant).toBe('up');
    expect(rotateFurniture({ ...f, kind: 'glass_partition', variant: 'v' })?.variant).toBe('end');
    expect(rotateFurniture({ ...f, kind: 'office_chair' })?.kind).toBe('office_chair_front');
    expect(rotateFurniture({ ...f, kind: 'desk_back' })?.kind).toBe('desk');
    expect(rotateFurniture({ ...f, kind: 'stool' })?.dir).toBe('left');
    expect(rotateFurniture({ ...f, kind: 'plant_small' })).toBeNull();
    const r = rotateOps(doc, [ref]);
    expect(r.t === 'batch' && r.ops.length).toBe(1);
  });
});

describe('áreas, pisos e zonas', () => {
  const doc = buildDefaultMap();

  it('redimensionar pela esquerda mantém o conteúdo no lugar', () => {
    const a = doc.areas.find((x) => x.id === 'praca')!;
    const before = a.furniture.map((f) => furnRect(a, f));
    const b = resizeArea(a, { x: a.rect.x + 2, y: a.rect.y, w: a.rect.w - 2, h: a.rect.h });
    expect(b.furniture.map((f) => furnRect(b, f))).toEqual(before);
    expect(b.floors).toEqual([{ ...a.floors[0], w: b.rect.w, h: b.rect.h }]);
  });

  it('mover área leva zonas, spots e entradas junto', () => {
    const big = { ...doc, size: { w: 100, h: 58 } };
    const lounge = big.areas.find((x) => x.id === 'lounge')!;
    const ops = moveAreaOps(big, 'lounge', 0, 0);
    expect(ops).toHaveLength(0);
    // abre espaço: some com a sala zen e move o lounge 20 para a direita
    const zenIdx = big.areas.findIndex((x) => x.id === 'sala-zen');
    const noZen = apply(big, { t: 'remove', at: { doc: 'areas' }, index: zenIdx, item: big.areas[zenIdx] });
    const next = apply(noZen, batch('editor.op.move', moveAreaOps(noZen, 'lounge', 20, 0)));
    expect(next.areas.find((x) => x.id === 'lounge')!.rect.x).toBe(lounge.rect.x + 20);
    expect(next.zones.find((z) => z.id === 'lounge')!.rects[0].x).toBe(doc.zones.find((z) => z.id === 'lounge')!.rects[0].x + 20);
    const talk = doc.spots.filter((s) => s.tx >= lounge.rect.x && s.tx < lounge.rect.x + lounge.rect.w && s.ty >= lounge.rect.y && s.ty < lounge.rect.y + lounge.rect.h);
    for (const s of talk) expect(next.spots.find((x) => x.id === s.id)!.tx).toBe(s.tx + 20);
  });

  it('pintar piso recorta por área e não estraga a validação', () => {
    const op = paintOps(doc, [{ x: 10, y: 10, w: 20, h: 10 }], { kind: 'wood', tint: '#3d3530', tintK: 0.65 });
    expect(op.t === 'batch' && op.ops.length).toBeGreaterThan(1);
    const next = apply(doc, op);
    expect(validateMap(next).errors).toEqual([]);
  });

  it('zona: somar e subtrair retângulos', () => {
    const r = { x: 0, y: 0, w: 10, h: 10 };
    expect(zoneRectsWith([r], { x: 2, y: 2, w: 3, h: 3 }, true).reduce((n, q) => n + q.w * q.h, 0)).toBe(91);
    expect(zoneRectsWith([{ x: 1, y: 1, w: 2, h: 2 }], r, false)).toEqual([r]);
  });
});
