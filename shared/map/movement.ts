// Movimento ao longo de um caminho em tiles — extração fiel de `Sim.stepGo`/`Sim.findPath`
// (client/src/world/sim/sim.ts do Habblaud). Usado pelo servidor (autoritativo) e pela predição
// do cliente: os dois avançam exatamente igual para o mesmo `dt`.
import type { PathFinder } from './astar';
import type { Dir } from './furniture';
import type { WalkGrid } from './grid';
import { FOOT_DX, FOOT_DY, RUN_SPEED, TILE, WALK_SPEED } from './tile';

/** Quem anda: pés em px de mundo, tile lógico e direção. */
export interface Mover {
  x: number;
  y: number;
  tx: number;
  ty: number;
  dir: Dir;
}

/** Caminho em andamento (equivale ao passo `go` da sim antiga). */
export interface PathState {
  /** [x0, y0, x1, y1, ...] SEM o tile de partida e COM o destino (saída do `PathFinder`). */
  path: number[];
  /** Índice do próximo par em `path` (sempre par). */
  i: number;
  run?: boolean;
  /** Posição fina final (px), depois do último tile (ex.: encaixe sem `enter`). */
  fx?: number;
  fy?: number;
  /** Já chegou à posição fina. */
  fine?: boolean;
}

export interface AdvanceResult {
  /** Andou alguma coisa neste passo. */
  moved: boolean;
  /** Chegou ao fim do caminho (e da posição fina, se houver). */
  arrived: boolean;
}

/** Direção dominante de um deslocamento (empate favorece o eixo horizontal). */
export function dirOf(dx: number, dy: number, fallback: Dir): Dir {
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return fallback;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

/** Coloca os pés no ponto padrão de um tile. */
export function placeAtTile(m: Mover, tx: number, ty: number): void {
  m.tx = tx;
  m.ty = ty;
  m.x = tx * TILE + FOOT_DX;
  m.y = ty * TILE + FOOT_DY;
}

/**
 * Caminho de (sx, sy) a (gx, gy). Destino bloqueado → tile caminhável mais próximo (raio 4); se não
 * achar a partir da origem, tenta a partir do tile caminhável mais próximo dela (raio 6) e o inclui
 * no início. Igual a `Sim.findPath`.
 */
export function findPath(grid: WalkGrid, finder: PathFinder, sx: number, sy: number, gx: number, gy: number, out: number[]): boolean {
  if (!grid.walkable(gx, gy)) {
    const n = grid.nearestWalkable(gx, gy, 4);
    if (!n) return false;
    gx = n.x;
    gy = n.y;
  }
  if (finder.find(sx, sy, gx, gy, out)) return true;
  const s = grid.nearestWalkable(sx, sy, 6);
  if (s && (s.x !== sx || s.y !== sy) && finder.find(s.x, s.y, gx, gy, out)) {
    out.unshift(s.x, s.y);
    return true;
  }
  return false;
}

/**
 * Avança `m` ao longo de `ps` por `dt` segundos a `speedK` × (WALK_SPEED | RUN_SPEED).
 * O tile lógico (`tx/ty`) passa para o próximo tile do caminho assim que o movimento em direção a
 * ele começa (como na sim antiga). Mesmo laço de `Sim.stepGo`, sem pose/animação.
 */
export function advance(m: Mover, ps: PathState, dt: number, speedK = 1): AdvanceResult {
  const path = ps.path;
  let budget = (ps.run ? RUN_SPEED : WALK_SPEED) * speedK * dt;
  let moved = false;
  while (budget > 0.0001) {
    let gx: number;
    let gy: number;
    const i = ps.i;
    if (i < path.length) {
      m.tx = path[i];
      m.ty = path[i + 1];
      gx = m.tx * TILE + FOOT_DX;
      gy = m.ty * TILE + FOOT_DY;
    } else if (ps.fx !== undefined && ps.fy !== undefined && !ps.fine) {
      gx = ps.fx;
      gy = ps.fy;
    } else break;
    const dx = gx - m.x;
    const dy = gy - m.y;
    const d = Math.hypot(dx, dy);
    if (d > 0.001) m.dir = dirOf(dx, dy, m.dir);
    if (d <= budget) {
      m.x = gx;
      m.y = gy;
      budget -= d;
      if (i < path.length) ps.i = i + 2;
      else ps.fine = true;
    } else {
      m.x += (dx / d) * budget;
      m.y += (dy / d) * budget;
      budget = 0;
    }
    moved = true;
  }
  const arrived = ps.i >= path.length && (ps.fx === undefined || !!ps.fine);
  return { moved, arrived };
}
