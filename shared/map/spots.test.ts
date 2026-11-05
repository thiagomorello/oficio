// Uma asserção por linha da tabela A.2 (spots derivados dos móveis).
import { describe, expect, it } from 'vitest';
import { AreaBuilder } from './builder';
import { createDocBuilder } from './doc-builder';
import type { MapArea } from './doc';
import { deriveSpots } from './spots';
import { TILE } from './tile';
import type { SpotDef } from './types';

// Área sem paredes em (10, 20) para exercitar a conversão local -> absoluta.
const X0 = 10;
const Y0 = 20;
const px = (lx: number) => (X0 + lx) * TILE;
const py = (ly: number) => (Y0 + ly) * TILE;
/** Assento (igual a AreaBuilder.seat). */
const seatPos = (lx: number, ly: number, dx = 0) => ({ x: px(lx) + TILE / 2 + dx, y: py(ly + 1) - 3, sortY: py(ly + 1) + 0.25, seated: true });
/** Uso em pé no tile (lx, ly). */
const standPos = (lx: number, ly: number, dx = 0, dy = 0) => ({ x: px(lx) + 8 + dx, y: py(ly) + 11 + dy });

function make(fill: (a: ReturnType<ReturnType<typeof createDocBuilder>['area']>) => void): { area: MapArea; spots: SpotDef[]; byId: Map<string, SpotDef>; warns: string[] } {
  const b = createDocBuilder({ w: 60, h: 60 });
  const h = b.area('ar', { x: X0, y: Y0, w: 30, h: 20 }, { walls: false });
  fill(h);
  const warns: string[] = [];
  const spots = deriveSpots(h.area, { warn: (code, _key, _params, ref) => warns.push(`${code}:${ref}`) });
  return { area: h.area, spots, byId: new Map(spots.map((s) => [s.id, s])), warns };
}

describe('deriveSpots (tabela A.2)', () => {
  it('posição do assento é idêntica à de AreaBuilder.seat', () => {
    const ab = new AreaBuilder('x', 'room', { x: X0, y: Y0, w: 30, h: 20 });
    const ref = ab.seat('stool', 'stool', 4, 6, 'up', undefined, { dx: 8 });
    const { spots } = make((a) => a.furn('stool', 4, 6, { dx: 8 }));
    expect(spots[0]).toMatchObject({ tx: ref.tx, ty: ref.ty, x: ref.x, y: ref.y, sortY: ref.sortY, seated: true });
  });

  it('office_chair com desk em (lx-1..lx, ly-1) → desk, up, deskId, side S, dx do placement', () => {
    const { byId } = make((a) => {
      a.furn('desk', 2, 3);
      a.furn('office_chair', 2, 4, { dx: 8 });
    });
    expect(byId.get('ar#f1:desk')).toEqual({ id: 'ar#f1:desk', kind: 'desk', areaId: 'ar', tx: X0 + 2, ty: Y0 + 4, dir: 'up', furnitureId: 'ar#f1', deskId: 'ar#f0', side: 'S', ...seatPos(2, 4, 8) });
  });

  it('office_chair na coluna direita da mesa (lx-1) também encaixa', () => {
    const { byId } = make((a) => {
      a.furn('desk', 2, 3);
      a.furn('office_chair', 3, 4);
    });
    expect(byId.get('ar#f1:desk')?.deskId).toBe('ar#f0');
  });

  it('office_chair sem mesa → stool (e aviso chair_without_desk)', () => {
    const { byId, warns } = make((a) => a.furn('office_chair', 2, 4));
    expect(byId.get('ar#f0:stool')).toMatchObject({ kind: 'stool', dir: 'up', seated: true });
    expect(byId.get('ar#f0:stool')?.deskId).toBeUndefined();
    expect(warns).toEqual(['chair_without_desk:ar#f0']);
  });

  it('office_chair_front com desk_back em (lx-1..lx, ly+1) → desk, down, side N', () => {
    const { byId } = make((a) => {
      a.furn('desk_back', 2, 3);
      a.furn('office_chair_front', 2, 2, { dx: 8 });
    });
    expect(byId.get('ar#f1:desk')).toMatchObject({ kind: 'desk', dir: 'down', side: 'N', deskId: 'ar#f0', tx: X0 + 2, ty: Y0 + 2, ...seatPos(2, 2, 8) });
  });

  it('office_chair_front sem desk_back → stool', () => {
    const { byId, warns } = make((a) => a.furn('office_chair_front', 2, 2));
    expect(byId.get('ar#f0:stool')).toMatchObject({ kind: 'stool', dir: 'down' });
    expect(warns).toHaveLength(1);
  });

  it('stool vira para a mesa vizinha; sem mesa usa f.dir ?? down', () => {
    const { byId } = make((a) => {
      a.furn('meeting_table', 5, 5); // 3x2: (5..7, 5..6)
      a.furn('stool', 6, 4); // norte da mesa → down
      a.furn('stool', 6, 7); // sul → up
      a.furn('stool', 4, 5); // oeste → right
      a.furn('stool', 8, 6); // leste → left
      a.furn('stool', 20, 10, { dir: 'left' }); // sem mesa
      a.furn('stool', 22, 10); // sem mesa nem dir
      a.furn('cafe_table', 25, 10);
      a.furn('stool', 25, 11); // cafe_table ao norte → up
    });
    expect(byId.get('ar#f1:stool')?.dir).toBe('down');
    expect(byId.get('ar#f2:stool')?.dir).toBe('up');
    expect(byId.get('ar#f3:stool')?.dir).toBe('right');
    expect(byId.get('ar#f4:stool')?.dir).toBe('left');
    expect(byId.get('ar#f5:stool')?.dir).toBe('left');
    expect(byId.get('ar#f6:stool')?.dir).toBe('down');
    expect(byId.get('ar#f8:stool')?.dir).toBe('up');
  });

  it('cafe_chair → cafe_seat e armchair → armchair, dir = variant', () => {
    const { byId } = make((a) => {
      a.furn('cafe_chair', 2, 2, { variant: 'left' });
      a.furn('armchair', 4, 2, { variant: 'right' });
      a.furn('cafe_chair', 6, 2);
    });
    expect(byId.get('ar#f0:cafe_seat')).toMatchObject({ kind: 'cafe_seat', dir: 'left', ...seatPos(2, 2) });
    expect(byId.get('ar#f1:armchair')).toMatchObject({ kind: 'armchair', dir: 'right', ...seatPos(4, 2) });
    expect(byId.get('ar#f2:cafe_seat')?.dir).toBe('down');
  });

  it('sofa 3x1 → 3 assentos (lx+i), dir = variant, furnitureId compartilhado', () => {
    const { spots } = make((a) => a.furn('sofa', 3, 6, { variant: 'up' }));
    expect(spots.map((s) => [s.id, s.kind, s.tx, s.dir, s.furnitureId, s.x])).toEqual([0, 1, 2].map((i) => [`ar#f0:sofa:${i}`, 'sofa', X0 + 3 + i, 'up', 'ar#f0', seatPos(3 + i, 6).x]));
  });

  it('bench 2x1 → 2 assentos, dir = f.dir ?? down', () => {
    const { spots } = make((a) => {
      a.furn('bench', 3, 6);
      a.furn('bench', 8, 6, { dir: 'up' });
    });
    expect(spots.map((s) => [s.id, s.tx, s.dir])).toEqual([
      ['ar#f0:bench:0', X0 + 3, 'down'],
      ['ar#f0:bench:1', X0 + 4, 'down'],
      ['ar#f1:bench:0', X0 + 8, 'up'],
      ['ar#f1:bench:1', X0 + 9, 'up'],
    ]);
  });

  it('beanbag → beanbag, dir = f.dir ?? down', () => {
    const { spots } = make((a) => {
      a.furn('beanbag', 3, 6, { variant: 'yellow' });
      a.furn('beanbag', 5, 6, { dir: 'left' });
    });
    expect(spots.map((s) => [s.id, s.kind, s.dir, s.seated])).toEqual([
      ['ar#f0:beanbag', 'beanbag', 'down', true],
      ['ar#f1:beanbag', 'beanbag', 'left', true],
    ]);
  });

  it('máquinas → spot em pé em (lx, ly+1), up, dy -3, furnitureId', () => {
    const kinds = [
      ['coffee_machine', 'coffee'],
      ['water_cooler', 'water'],
      ['vending_machine', 'snack'],
      ['fridge', 'fridge'],
      ['sink', 'sink'],
      ['counter_sink', 'sink'],
      ['arcade', 'arcade'],
    ] as const;
    const { byId } = make((a) => kinds.forEach(([k], i) => a.furn(k, 2 + i * 2, 3)));
    kinds.forEach(([, spot], i) => {
      const lx = 2 + i * 2;
      expect(byId.get(`ar#f${i}:${spot}`)).toEqual({ id: `ar#f${i}:${spot}`, kind: spot, areaId: 'ar', tx: X0 + lx, ty: Y0 + 4, dir: 'up', furnitureId: `ar#f${i}`, group: undefined, ...standPos(lx, 4, 0, -3) });
    });
  });

  it('bookshelf → shelf em (lx, ly+1), up, dx 8, dy -2', () => {
    const { byId } = make((a) => a.furn('bookshelf', 4, 2));
    expect(byId.get('ar#f0:shelf')).toMatchObject({ kind: 'shelf', tx: X0 + 4, ty: Y0 + 3, dir: 'up', ...standPos(4, 3, 8, -2) });
  });

  it('toilet_stall → stall em (lx, ly+2), up, x = px(lx+1)', () => {
    const { byId } = make((a) => a.furn('toilet_stall', 4, 2));
    expect(byId.get('ar#f0:stall')).toMatchObject({ kind: 'stall', tx: X0 + 4, ty: Y0 + 4, dir: 'up', x: px(5), y: py(4) + 11 });
  });

  it('pingpong_table → 2 jogadores nas pontas + 2 torcedores ao norte, com grupos', () => {
    const { spots } = make((a) => a.furn('pingpong_table', 5, 5));
    expect(spots.map((s) => [s.id, s.kind, s.tx - X0, s.ty - Y0, s.dir, s.group])).toEqual([
      ['ar#f0:pingpong:0', 'pingpong', 4, 6, 'right', 'pp:ar#f0'],
      ['ar#f0:pingpong:1', 'pingpong', 8, 6, 'left', 'pp:ar#f0'],
      ['ar#f0:watch:0', 'watch', 5, 4, 'down', 'watch:ar#f0'],
      ['ar#f0:watch:1', 'watch', 7, 4, 'down', 'watch:ar#f0'],
    ]);
  });

  it('whiteboard (parede) → spot em (floor(lcx-0.5), 2), up, dx 8, dy 2', () => {
    const { byId } = make((a) => a.wall('whiteboard', 4.5));
    expect(byId.get('ar#f0:whiteboard')).toMatchObject({ kind: 'whiteboard', tx: X0 + 4, ty: Y0 + 2, dir: 'up', ...standPos(4, 2, 8, 2) });
  });

  it('demais móveis e itens de parede não geram spot', () => {
    const { spots } = make((a) => {
      a.furn('meeting_table', 2, 2);
      a.furn('desk', 8, 2);
      a.furn('counter', 12, 2);
      a.furn('plant_tall', 14, 2);
      a.furn('printer', 16, 2);
      a.furn('reception_desk', 18, 2);
      a.wall('tv', 4);
      a.wall('poster', 8);
    });
    expect(spots).toEqual([]);
  });
});
