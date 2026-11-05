import { describe, expect, it } from 'vitest';
import { assembleOffice } from './assemble';
import { deskAtTile } from './desks';
import { BLOCKED, FREE, SEAT } from './grid';
import { clone, twoAreaDoc } from './test-fixtures';
import { TILE } from './tile';

describe('assembleOffice', () => {
  const doc = twoAreaDoc();
  const as = assembleOffice(doc, 3);

  it('grade: paredes bloqueadas, interior/porta/corredor livres, assentos SEAT, móveis bloqueiam', () => {
    expect(as.w).toBe(20);
    expect(as.h).toBe(14);
    expect(as.grid.version).toBe(3);
    // face norte (2 linhas), tampas laterais, mureta sul
    for (let x = 0; x < 10; x++) {
      expect(as.grid.get(x, 0)).toBe(BLOCKED);
      expect(as.grid.get(x, 1)).toBe(BLOCKED);
    }
    for (let y = 0; y < 8; y++) {
      expect(as.grid.get(0, y)).toBe(BLOCKED);
      expect(as.grid.get(9, y)).toBe(BLOCKED);
    }
    expect(as.grid.get(3, 7)).toBe(BLOCKED);
    expect(as.grid.get(6, 7)).toBe(BLOCKED);
    // passagem sul (lx 4, w 2) caminhável
    expect(as.grid.get(4, 7)).toBe(FREE);
    expect(as.grid.get(5, 7)).toBe(FREE);
    // interior
    expect(as.grid.get(1, 2)).toBe(FREE);
    expect(as.grid.get(8, 6)).toBe(FREE);
    // mesas bloqueiam, cadeiras viram SEAT
    expect(as.grid.get(2, 3)).toBe(BLOCKED);
    expect(as.grid.get(3, 4)).toBe(BLOCKED);
    expect(as.grid.get(2, 2)).toBe(SEAT);
    expect(as.grid.get(2, 5)).toBe(SEAT);
    // corredor sem paredes
    expect(as.grid.get(0, 8)).toBe(FREE);
    expect(as.grid.get(19, 13)).toBe(FREE);
  });

  it('alcançabilidade a partir do spawn passa pela porta', () => {
    expect(as.reach[10 * 20 + 10]).toBe(1);
    expect(as.reach[2 * 20 + 1]).toBe(1);
    expect(as.reach[0]).toBe(0);
  });

  it('AreaLayout: paredes, batente só em porta norte, ids absolutos', () => {
    const sala = as.areaById.get('sala')!;
    expect(sala.walls.map((w) => w.kind).sort()).toEqual(['cap', 'cap', 'face', 'south']);
    const south = sala.walls.find((w) => w.kind === 'south')!;
    expect(south).toMatchObject({ x: 0.5 * TILE, y: 7 * TILE, w: 9 * TILE, doorways: [{ x: 4 * TILE, w: 2 * TILE }] });
    expect(sala.wallItems.some((w) => w.kind === 'door_frame')).toBe(false);
    expect(sala.furniture.map((f) => f.id)).toEqual(['sala#f0', 'sala#f1', 'sala#f2', 'sala#f3']);
    expect(sala.signId).toBe('sala#f4');
    expect(sala.wallItems[0]).toMatchObject({ id: 'sala#f4', kind: 'sign', cx: 5 * TILE, baseY: 2 * TILE, label: 'Sala Um' });
    expect(sala.door).toEqual({ x: 4, y: 7, w: 2, h: 1 });
    expect(as.areaById.get('corr')!.walls).toEqual([]);
  });

  it('porta norte gera door_frame automático', () => {
    const d = clone(doc);
    d.areas[0].doorways = [{ side: 'north', lx: 3, w: 2 }];
    const a = assembleOffice(d).areaById.get('sala')!;
    const frame = a.wallItems.find((w) => w.kind === 'door_frame')!;
    expect(frame).toMatchObject({ id: 'sala#~door0', cx: 4 * TILE, baseY: 2 * TILE, on: 'face' });
    expect(assembleOffice(d).grid.get(3, 0)).toBe(FREE);
    expect(assembleOffice(d).grid.get(4, 1)).toBe(FREE);
  });

  it('zona: máscara, zoneAt e doorTiles = os 2 tiles junto da porta', () => {
    expect(as.zones).toHaveLength(1);
    const z = as.zones[0];
    expect(z.count).toBe(8 * 5);
    expect(z.tiles[2 * 20 + 1]).toBe(1);
    expect(z.tiles[7 * 20 + 4]).toBe(0);
    expect(as.zoneAt[3 * 20 + 5]).toBe(0);
    expect(as.zoneAt[10 * 20 + 10]).toBe(-1);
    expect(z.doorTiles).toEqual([
      { x: 4, y: 6 },
      { x: 5, y: 6 },
    ]);
  });

  it('mesas derivadas com código por (ly, lx), placa e índice por tile', () => {
    expect(as.desks.map((d) => [d.id, d.code, d.kind, d.side, d.chairId, d.spotId])).toEqual([
      ['sala#f0', 'S1-01', 'desk_back', 'N', 'sala#f2', 'sala#f2:desk'],
      ['sala#f1', 'S1-02', 'desk', 'S', 'sala#f3', 'sala#f3:desk'],
    ]);
    const back = as.deskById.get('sala#f0')!;
    expect(back).toMatchObject({ tx: 2, ty: 3, dx: 0, label: 'S1-01', plate: { x: 2 * TILE + TILE, y: 3 * TILE + 3 } });
    expect(as.deskById.get('sala#f1')!.plate).toEqual({ x: 3 * TILE, y: 5 * TILE - 2 });
    expect(deskAtTile(as, 3, 4)?.id).toBe('sala#f1');
    expect(deskAtTile(as, 2, 5)?.id).toBe('sala#f1');
    expect(deskAtTile(as, 2, 2)?.id).toBe('sala#f0');
    expect(deskAtTile(as, 5, 5)).toBeNull();
  });

  it('deskLabels sobrescreve o rótulo; sem code usa as iniciais', () => {
    const d = clone(doc);
    d.deskLabels = { 'sala#f1': 'Thiago' };
    delete d.areas[0].code;
    const a = assembleOffice(d);
    expect(a.deskById.get('sala#f1')).toMatchObject({ code: 'SU-02', label: 'Thiago' });
  });

  it('spots: derivados das áreas + avulsos do documento', () => {
    const d = clone(doc);
    d.spots.push({ id: 'papo', kind: 'talk', tx: 12, ty: 10, dir: 'left', group: 'g1' });
    const a = assembleOffice(d);
    expect(a.spotById.get('spot:papo')).toMatchObject({ areaId: 'corr', tx: 12, ty: 10, x: 12 * TILE + 8, y: 10 * TILE + 11, group: 'g1' });
    expect(a.spotById.get('sala#f3:desk')).toMatchObject({ deskId: 'sala#f1', side: 'S', dir: 'up' });
  });

  it('memoiza por identidade do documento + versão', () => {
    expect(assembleOffice(doc, 3)).toBe(as);
    expect(assembleOffice(doc, 4)).not.toBe(as);
    expect(assembleOffice(clone(doc), 3)).not.toBe(as);
  });
});
