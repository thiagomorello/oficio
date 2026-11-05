import { describe, expect, it } from 'vitest';
import { buildDefaultMap } from '../../../shared/map/default-map';
import { TILE } from '../../../shared/map/tile';
import { tileOf } from './geometry';
import { buildFootprintIndex, furnitureAtTile, furnitureInRect, hitTest, spriteHit } from './hit';

describe('contas de tile', () => {
  it('tileOf arredonda para baixo (inclusive negativos)', () => {
    expect(tileOf(0, 0)).toEqual({ tx: 0, ty: 0 });
    expect(tileOf(TILE - 0.01, TILE)).toEqual({ tx: 0, ty: 1 });
    expect(tileOf(-1, -TILE - 1)).toEqual({ tx: -1, ty: -2 });
    expect(tileOf(5 * TILE + 8, 3 * TILE + 15.9)).toEqual({ tx: 5, ty: 3 });
  });
});

describe('índice de footprint', () => {
  const doc = buildDefaultMap();
  const idx = buildFootprintIndex(doc);

  it('cobre todos os tiles de cada móvel (absolutos)', () => {
    const area = doc.areas.find((a) => a.id === 'lounge')!;
    const pp = area.furniture.find((f) => f.kind === 'pingpong_table')!;
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 3; x++) {
        expect(furnitureAtTile(idx, area.rect.x + pp.lx + x, area.rect.y + pp.ly + y)).toContainEqual({ area: 'lounge', id: pp.id });
      }
    }
    expect(furnitureAtTile(idx, area.rect.x + pp.lx + 3, area.rect.y + pp.ly).some((f) => f.id === pp.id)).toBe(false);
  });

  it('total de entradas = soma dos footprints', () => {
    let expected = 0;
    for (const a of doc.areas) {
      for (const f of a.furniture) {
        const fp = { desk: 2, desk_back: 2, bookshelf: 2, coffee_table: 2, bench: 2, sofa: 3, reception_desk: 3, meeting_table: 6, pingpong_table: 6, toilet_stall: 4 } as Record<string, number>;
        expected += fp[f.kind] ?? 1;
      }
    }
    let n = 0;
    for (const l of idx.values()) n += l.length;
    expect(n).toBe(expected);
  });

  it('ignora áreas ocultas', () => {
    const hidden = buildFootprintIndex(doc, new Set(['lounge']));
    for (const l of hidden.values()) expect(l.some((f) => f.area === 'lounge')).toBe(false);
  });

  it('retângulo devolve cada móvel uma vez', () => {
    const a = doc.areas.find((x) => x.id === 'ilha-a1')!;
    const found = furnitureInRect(idx, a.rect);
    expect(found).toHaveLength(a.furniture.length);
    expect(new Set(found.map((f) => f.id)).size).toBe(found.length);
  });
});

describe('hitTest', () => {
  const doc = buildDefaultMap();
  const idx = buildFootprintIndex(doc);
  const center = (tx: number, ty: number) => [tx * TILE + 8, ty * TILE + 8] as const;

  it('móvel pelo footprint', () => {
    const a = doc.areas.find((x) => x.id === 'recepcao')!;
    const desk = a.furniture.find((f) => f.kind === 'reception_desk')!;
    expect(hitTest({ doc, index: idx }, ...center(a.rect.x + desk.lx + 1, a.rect.y + desk.ly))).toEqual({ t: 'furn', area: 'recepcao', id: desk.id });
  });

  it('item de parede vem antes (face norte)', () => {
    const a = doc.areas.find((x) => x.id === 'recepcao')!;
    const sign = a.wallItems.find((w) => w.kind === 'sign')!;
    const r = hitTest({ doc, index: idx }, (a.rect.x + sign.lcx) * TILE, (a.rect.y + 1) * TILE + 4);
    expect(r).toEqual({ t: 'wall', area: 'recepcao', id: sign.id });
  });

  it('sprite (alpha) vence o footprint; desempate pelo maior ay', () => {
    const r = hitTest({ doc, index: idx, sprite: () => 'lounge#f1' }, ...center(30, 30));
    expect(r).toEqual({ t: 'furn', area: 'lounge', id: 'f1' });
    const items = [
      { id: 'a', ay: 10 },
      { id: 'b', ay: 30 },
      { id: 'c', ay: 20 },
    ];
    expect(spriteHit(items, 0, 0, () => true)?.id).toBe('b');
    expect(spriteHit(items, 0, 0, (it) => it.id !== 'b')?.id).toBe('c');
    expect(spriteHit(items, 0, 0, () => false)).toBeNull();
  });

  it('ponto de entrada, spot, tapete e área', () => {
    const sp = doc.spawn[0];
    expect(hitTest({ doc, index: idx }, ...center(sp.x, sp.y))).toEqual({ t: 'spawn', i: 0 });
    const spot = doc.spots[0];
    expect(hitTest({ doc, index: idx }, ...center(spot.tx, spot.ty))).toEqual({ t: 'spot', id: spot.id });
    const a = doc.areas.find((x) => x.id === 'recepcao')!;
    const rug = a.rugs[0];
    // tapete da recepção (5,4) 6×3: tile (5,6) livre de móveis
    expect(hitTest({ doc, index: idx }, ...center(a.rect.x + rug.lx, a.rect.y + rug.ly + 2))).toEqual({ t: 'rug', area: 'recepcao', id: rug.id });
    expect(hitTest({ doc, index: idx }, ...center(a.rect.x + 13, a.rect.y + 5))).toEqual({ t: 'area', id: 'recepcao' });
    expect(hitTest({ doc, index: idx }, ...center(-3, -3))).toBeNull();
  });
});
