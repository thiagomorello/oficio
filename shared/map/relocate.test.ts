import { describe, expect, it } from 'vitest';
import { assembleOffice } from './assemble';
import { nearestReachable, planRelocation } from './relocate';
import { clone, twoAreaDoc } from './test-fixtures';
import { FOOT_DX, FOOT_DY, TILE } from './tile';

describe('planRelocation', () => {
  const base = twoAreaDoc();

  it('spot mantido: segue o spot (mesmo que tenha mudado de lugar)', () => {
    const d = clone(base);
    // a ilha anda 3 tiles para a direita: ids iguais, posições novas
    for (const f of d.areas[0].furniture) f.lx += 3;
    const next = assembleOffice(d);
    const spot = next.spotById.get('sala#f3:desk')!;
    const [m] = planRelocation(next, [{ id: 'u', tx: 2, ty: 5, spotId: 'sala#f3:desk' }]);
    expect(m).toEqual({ id: 'u', tx: 5, ty: 5, x: spot.x, y: spot.y, spotId: 'sala#f3:desk', moved: true, released: null, reason: 'spot_kept' });
    const [same] = planRelocation(assembleOffice(base), [{ id: 'u', tx: 2, ty: 5, spotId: 'sala#f3:desk' }]);
    expect(same).toMatchObject({ moved: false, reason: 'spot_kept' });
  });

  it('spot removido: libera o assento e fica no tile', () => {
    const d = clone(base);
    d.areas[0].furniture = d.areas[0].furniture.filter((f) => f.kind !== 'office_chair');
    const next = assembleOffice(d);
    const [m] = planRelocation(next, [{ id: 'u', tx: 2, ty: 5, spotId: 'sala#f3:desk' }]);
    expect(m).toEqual({ id: 'u', tx: 2, ty: 5, x: 2 * TILE + FOOT_DX, y: 5 * TILE + FOOT_DY, spotId: null, moved: true, released: 'sala#f3:desk', reason: 'spot_removed' });
  });

  it('em pé num tile válido: fica', () => {
    const [m] = planRelocation(assembleOffice(base), [{ id: 'u', tx: 12, ty: 10 }]);
    expect(m).toMatchObject({ tx: 12, ty: 10, moved: false, released: null, reason: 'stay' });
  });

  it('tile virou móvel: vai ao alcançável mais próximo (raio 6)', () => {
    const d = clone(base);
    d.areas[1].furniture.push({ id: 'm', kind: 'meeting_table', lx: 11, ly: 2 }); // cobre (11..13, 10..11)
    const next = assembleOffice(d);
    const [m] = planRelocation(next, [{ id: 'u', tx: 12, ty: 10 }]);
    expect(m.reason).toBe('nearest');
    expect(m.moved).toBe(true);
    expect(Math.max(Math.abs(m.tx - 12), Math.abs(m.ty - 10))).toBe(1);
    expect(next.grid.walkable(m.tx, m.ty)).toBe(true);
    expect(next.reach[m.ty * next.w + m.tx]).toBe(1);
  });

  it('tile caminhável mas inalcançável (sala sem porta): vizinho alcançável ou spawn', () => {
    const d = clone(base);
    d.areas[0].doorways = [];
    const next = assembleOffice(d);
    // (4,6) dentro da sala fechada: o tile alcançável mais próximo é no corredor (4,8), a 2 tiles
    const [near] = planRelocation(next, [{ id: 'u', tx: 4, ty: 6 }]);
    expect(near).toMatchObject({ tx: 4, ty: 8, reason: 'nearest' });
    // (4,2) está a 6 tiles do corredor (y 8): com raio 5 não há tile alcançável
    expect(nearestReachable(next, 4, 2, 5)).toBeNull();
  });

  it('nada alcançável perto: volta ao spawn', () => {
    // corredor isolado em y 30..35, sem ligação com o resto: tudo lá é caminhável mas inalcançável
    const big = clone(base);
    big.size.h = 40;
    big.areas.push({ ...clone(base.areas[1]), id: 'longe', rect: { x: 0, y: 30, w: 20, h: 6 } });
    const far = assembleOffice(big);
    const [m] = planRelocation(far, [{ id: 'u', tx: 5, ty: 32 }]);
    expect(m).toMatchObject({ tx: 10, ty: 10, x: 10 * TILE + FOOT_DX, y: 10 * TILE + FOOT_DY, reason: 'spawn', moved: true });
  });
});
