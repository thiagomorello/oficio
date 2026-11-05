import { describe, expect, it } from 'vitest';
import type { ClientMsg } from '../../../../shared/protocol';
import { PathFinder } from '../../../../shared/map/astar';
import { FREE, WalkGrid } from '../../../../shared/map/grid';
import { FOOT_DX, FOOT_DY, TILE, WALK_SPEED } from '../../../../shared/map/tile';
import { NUDGE_K, Predictor, SNAP_MS } from './prediction';

function setup(w = 12, h = 8) {
  const grid = new WalkGrid(w, h);
  grid.fill(0, 0, w, h, FREE);
  const finder = new PathFinder(grid);
  const sent: ClientMsg[] = [];
  let now = 1000;
  const p = new Predictor({ grid: () => grid, finder: () => finder, send: (m) => sent.push(m), now: () => now });
  p.reset(2 * TILE + FOOT_DX, 2 * TILE + FOOT_DY);
  const tick = (ms: number) => {
    now += ms;
    p.update(ms / 1000);
  };
  return { grid, p, sent, tick, clock: () => now };
}

describe('Predictor', () => {
  it('clique: planeja na grade compartilhada e anda na velocidade do servidor (sem mandar move_to)', () => {
    const { p, sent, tick } = setup();
    expect(p.moveTo(6, 2)).toBe(true);
    expect(sent).toEqual([]);
    tick(250);
    expect(p.m.x).toBeCloseTo(2 * TILE + FOOT_DX + WALK_SPEED * 0.25, 3);
    for (let i = 0; i < 40; i++) tick(50);
    expect(p.active).toBe(false);
    expect([p.m.tx, p.m.ty]).toEqual([6, 2]);
  });

  it('teclado: um tile por vez; para na parede virado para ela; entra na cadeira e para', () => {
    const { p, tick, grid } = setup();
    grid.set(4, 2, 0); // parede
    p.setDir('right');
    p.setDir('right');
    for (let i = 0; i < 30; i++) tick(50);
    expect([p.m.tx, p.m.ty]).toEqual([3, 2]);
    expect(p.m.dir).toBe('right');
    p.setDir(null);
    grid.set(3, 4, 2); // cadeira (SEAT)
    p.setDir('down');
    for (let i = 0; i < 30; i++) tick(50);
    expect([p.m.tx, p.m.ty]).toEqual([3, 4]);
    expect(p.active).toBe(false);
  });

  it('reconciliação: ≤ 4 px nada; > 4 px parado converge em 150 ms; > 24 px corrige em 150 ms', () => {
    const { p, tick, clock } = setup();
    tick(16);
    const base = { x: p.m.x, y: p.m.y };
    expect(p.reconcile(base.x + 3, base.y, clock())).toBe('ok');
    expect(p.m.x).toBe(base.x);

    expect(p.reconcile(base.x + 10, base.y, clock())).toBe('nudge');
    tick(SNAP_MS);
    expect(p.m.x).toBeCloseTo(base.x + 10);

    const x0 = p.m.x;
    expect(p.reconcile(x0 + 40, base.y, clock())).toBe('snap');
    expect(p.correcting).toBe(true);
    tick(SNAP_MS / 2);
    expect(p.m.x).toBeCloseTo(x0 + 20, 0);
    tick(SNAP_MS);
    expect(p.correcting).toBe(false);
    expect(p.m.x).toBeCloseTo(x0 + 40);
    // o mesmo erro não é corrigido duas vezes (o histórico já reflete a correção)
    expect(p.reconcile(x0 + 40, base.y, clock())).toBe('ok');
  });

  it('compara com a posição prevista no instante equivalente (sem falso erro andando)', () => {
    const { p, tick, clock } = setup();
    p.moveTo(10, 2);
    const t0 = clock();
    const x0 = p.m.x;
    for (let i = 0; i < 12; i++) tick(50);
    // o servidor ainda está onde a predição estava há 600 ms
    expect(p.reconcile(x0, p.m.y, t0)).toBe('ok');
    expect(p.reconcile(x0, p.m.y, clock())).toBe('snap');
  });

  it('moved_reject: para e volta para a posição do servidor', () => {
    const { p, tick } = setup();
    p.moveTo(9, 2);
    tick(200);
    const sx = 2 * TILE + FOOT_DX;
    p.reject(sx, 2 * TILE + FOOT_DY);
    expect(p.active).toBe(false);
    tick(SNAP_MS + 10);
    expect(p.m.x).toBeCloseTo(sx);
    expect(p.m.tx).toBe(2);
  });

  it('teleporte (reset) encaixa na hora', () => {
    const { p } = setup();
    p.moveTo(9, 2);
    p.reset(5 * TILE + FOOT_DX, 6 * TILE + FOOT_DY);
    expect([p.m.tx, p.m.ty, p.active, p.correcting]).toEqual([5, 6, false, false]);
  });
});
