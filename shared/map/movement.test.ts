import { describe, expect, it } from 'vitest';
import { PathFinder } from './astar';
import { BLOCKED, FREE, WalkGrid } from './grid';
import { advance, dirOf, findPath, placeAtTile, type Mover, type PathState } from './movement';
import { FOOT_DX, FOOT_DY, RUN_SPEED, TICK_MS, TILE, WALK_SPEED } from './tile';

/** 12×10 livre com uma parede vertical em x=5 (y 0..6): o caminho contorna por baixo. */
function world() {
  const g = new WalkGrid(12, 10);
  g.fill(0, 0, 12, 10, FREE);
  g.fill(5, 0, 1, 7, BLOCKED);
  return { g, f: new PathFinder(g) };
}

function mover(tx: number, ty: number): Mover {
  const m: Mover = { x: 0, y: 0, tx: 0, ty: 0, dir: 'down' };
  placeAtTile(m, tx, ty);
  return m;
}

const DT = TICK_MS / 1000;

describe('movement (extraído de Sim.stepGo/findPath)', () => {
  it('fixture: posição após N ticks de 50 ms (speedK 1,04)', () => {
    // fixture regenerado em 15/10/2026 (5 tiles/s) rodando advance() (cópia fiel do laço de Sim.stepGo) uma vez;
    // a paridade com a sim original foi verificada no WP1 (teste removido no WP5 junto com a sim).
    const { g, f } = world();
    const m = mover(2, 2);
    const ps: PathState = { path: [], i: 0 };
    expect(findPath(g, f, 2, 2, 9, 3, ps.path)).toBe(true);
    expect(ps.path).toEqual([3, 2, 4, 2, 4, 3, 4, 4, 4, 5, 4, 6, 4, 7, 5, 7, 6, 7, 7, 7, 8, 7, 9, 7, 9, 6, 9, 5, 9, 4, 9, 3]);
    const at: Record<number, [number, number, number, number, string, number]> = {
      10: [72, 52.6, 4, 3, 'down', 4],
      25: [72, 115, 4, 7, 'down', 12],
      40: [126.4, 123, 8, 7, 'right', 20],
    };
    let arrivedAt = -1;
    for (let k = 1; k <= 140 && arrivedAt < 0; k++) {
      const r = advance(m, ps, DT, 1.04);
      expect(r.moved).toBe(true);
      const exp = at[k];
      if (exp) {
        expect(m.x).toBeCloseTo(exp[0], 6);
        expect(m.y).toBeCloseTo(exp[1], 6);
        expect([m.tx, m.ty, m.dir, ps.i]).toEqual(exp.slice(2));
      }
      if (r.arrived) arrivedAt = k;
    }
    expect(arrivedAt).toBe(62);
    expect(m).toEqual({ x: 9 * TILE + FOOT_DX, y: 3 * TILE + FOOT_DY, tx: 9, ty: 3, dir: 'up' });
  });

  it('velocidade de caminhada = 5 tiles/s (± 1%) e corrida = 12 tiles/s', () => {
    expect(WALK_SPEED / TILE).toBe(5);
    expect(RUN_SPEED / TILE).toBe(12);
    const g = new WalkGrid(30, 3);
    g.fill(0, 0, 30, 3, FREE);
    const f = new PathFinder(g);
    for (const run of [false, true]) {
      const m = mover(1, 1);
      const ps: PathState = { path: [], i: 0, run };
      findPath(g, f, 1, 1, 28, 1, ps.path);
      for (let k = 0; k < 20; k++) advance(m, ps, DT); // 1 s
      const tilesPerSec = (m.x - (1 * TILE + FOOT_DX)) / TILE;
      const want = run ? 12 : 5;
      expect(Math.abs(tilesPerSec - want) / want).toBeLessThan(0.01);
    }
  });

  it('posição fina (fx, fy) depois do último tile', () => {
    const { g, f } = world();
    const m = mover(1, 1);
    const ps: PathState = { path: [], i: 0, fx: 3 * TILE + 2, fy: 1 * TILE + 5 };
    findPath(g, f, 1, 1, 3, 1, ps.path);
    let r = advance(m, ps, 0.5);
    expect(r.arrived).toBe(false);
    for (let k = 0; k < 10 && !r.arrived; k++) r = advance(m, ps, DT);
    expect(r.arrived).toBe(true);
    expect(ps.fine).toBe(true);
    expect([m.x, m.y, m.tx, m.ty]).toEqual([3 * TILE + 2, 1 * TILE + 5, 3, 1]);
  });

  it('caminho vazio: chega na hora, sem mover', () => {
    const m = mover(2, 2);
    expect(advance(m, { path: [], i: 0 }, DT)).toEqual({ moved: false, arrived: true });
  });

  it('findPath: destino bloqueado vai ao caminhável mais próximo; origem bloqueada é contornada', () => {
    const { g, f } = world();
    const out: number[] = [];
    expect(findPath(g, f, 2, 2, 5, 3, out)).toBe(true);
    const last = [out[out.length - 2], out[out.length - 1]];
    expect(g.walkable(last[0], last[1])).toBe(true);
    expect(Math.abs(last[0] - 5) + Math.abs(last[1] - 3)).toBe(1);
    // fora da grade e sem nada caminhável perto
    const tiny = new WalkGrid(3, 3);
    expect(findPath(tiny, new PathFinder(tiny), 0, 0, 2, 2, out)).toBe(false);
  });

  it('dirOf: eixo dominante, empate horizontal, fallback parado', () => {
    expect(dirOf(5, 1, 'up')).toBe('right');
    expect(dirOf(-5, 1, 'up')).toBe('left');
    expect(dirOf(1, 5, 'up')).toBe('down');
    expect(dirOf(1, -5, 'down')).toBe('up');
    expect(dirOf(3, 3, 'up')).toBe('right');
    expect(dirOf(0, 0.001, 'left')).toBe('left');
  });
});
