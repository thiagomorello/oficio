// Interpolação dos avatares remotos: desenha cada um em `serverNow - INTERP_DELAY_MS`, entre as
// duas amostras que cercam esse instante. Sem amostra nova, extrapola até 100 ms e depois segura.
import { FLAG_MOVING, FLAG_RUN, FLAG_SEATED, type Dir, type Pose } from '../../../../shared/model';
import { dirOf } from '../../../../shared/map/movement';
import { INTERP_DELAY_MS, INTERP_MARGIN_MS, INTERP_MAX_MS } from '../../../../shared/map/tile';
import type { Sample } from '../../net/world-store';

export { INTERP_DELAY_MS };

/** Máximo de extrapolação além da última amostra (ms). */
export const EXTRAPOLATE_MS = 100;

export interface Interp {
  x: number;
  y: number;
  dir: Dir;
  pose: Pose;
  moving: boolean;
  run: boolean;
  seated: boolean;
}

function still(p: Pose): Pose {
  return p === 'walk' || p === 'run' ? 'stand' : p;
}

function motionPose(run: boolean): Pose {
  return run ? 'run' : 'walk';
}

/** Quanto o atraso pode mudar por ms de frame: os remotos andam a 90-110 % do tempo real, sem pulo. */
export const DELAY_WARP = 0.1;

/**
 * Atraso de desenho ideal: as amostras chegam `lag` ms depois do tick (latência + fila) e a próxima
 * só vem `broadcastMs` depois; desenhando antes disso o buffer esvazia e o avatar extrapola/para.
 */
export function targetDelay(lags: readonly number[], broadcastMs: number): number {
  if (!lags.length) return Math.max(INTERP_DELAY_MS, broadcastMs + INTERP_MARGIN_MS);
  const sorted = [...lags].sort((a, b) => a - b);
  const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
  return Math.min(INTERP_MAX_MS, Math.max(INTERP_DELAY_MS, broadcastMs + p90 + INTERP_MARGIN_MS));
}

/** Aproxima o atraso atual do alvo sem fazer o relógio de desenho voltar ou saltar. */
export function stepDelay(current: number, target: number, dtMs: number): number {
  const max = Math.max(0, dtMs) * DELAY_WARP;
  const diff = target - current;
  return current + Math.max(-max, Math.min(max, diff));
}

/** Instante de desenho dos remotos. */
export function renderTime(serverNow: number, delay = INTERP_DELAY_MS): number {
  return serverNow - delay;
}

/**
 * Estado interpolado no instante `t` (relógio do servidor). `buf` em ordem crescente de `ts`.
 * Retorna null para buffer vazio.
 */
export function sampleAt(buf: readonly Sample[], t: number): Interp | null {
  const n = buf.length;
  if (!n) return null;
  const first = buf[0];
  if (n === 1 || t <= first.ts) {
    const s = t <= first.ts ? first : buf[n - 1];
    return hold(s);
  }
  const last = buf[n - 1];
  if (t >= last.ts) {
    const prev = buf[n - 2];
    const moving = (last.flags & FLAG_MOVING) !== 0;
    const span = last.ts - prev.ts;
    if (!moving || span <= 0) return hold(last);
    const dt = Math.min(EXTRAPOLATE_MS, t - last.ts);
    const vx = (last.x - prev.x) / span;
    const vy = (last.y - prev.y) / span;
    const run = (last.flags & FLAG_RUN) !== 0;
    return {
      x: last.x + vx * dt,
      y: last.y + vy * dt,
      dir: last.dir,
      pose: motionPose(run),
      moving: true,
      run,
      seated: false,
    };
  }
  // busca binária do par que cerca t
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (buf[mid].ts <= t) lo = mid;
    else hi = mid;
  }
  const a = buf[lo];
  const b = buf[hi];
  const k = (t - a.ts) / (b.ts - a.ts);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const travelled = Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01;
  const moving = travelled && ((a.flags | b.flags) & FLAG_MOVING) !== 0;
  const run = ((moving ? b.flags : a.flags) & FLAG_RUN) !== 0;
  const near = k < 0.5 ? a : b;
  return {
    x: a.x + dx * k,
    y: a.y + dy * k,
    dir: moving ? dirOf(dx, dy, near.dir) : near.dir,
    pose: moving ? motionPose(run) : still(near.pose),
    moving,
    run: moving && run,
    seated: (near.flags & FLAG_SEATED) !== 0,
  };
}

function hold(s: Sample): Interp {
  return { x: s.x, y: s.y, dir: s.dir, pose: still(s.pose), moving: false, run: false, seated: (s.flags & FLAG_SEATED) !== 0 };
}
