// Predição do próprio avatar: o cliente anda na mesma grade/A* do servidor (`shared/map/movement`)
// assim que o usuário clica ou aperta uma direção, e manda a intenção (`move_to`/`move_dir`). Cada
// posição recebida do servidor é comparada com onde a predição estava naquele instante:
// - erro > 24 px: corrige com uma transição de 150 ms;
// - erro > 4 px: empurra 20 % do erro por delta;
// - `moved_reject`: para e volta (150 ms) para a posição do servidor; `tp`: encaixe imediato.
import type { ClientMsg } from '../../../../shared/protocol';
import type { Dir } from '../../../../shared/model';
import type { PathFinder } from '../../../../shared/map/astar';
import { SEAT, type WalkGrid } from '../../../../shared/map/grid';
import { advance, findPath, type Mover, type PathState } from '../../../../shared/map/movement';
import { FOOT_DX, FOOT_DY, TILE } from '../../../../shared/map/tile';

export const SNAP_PX = 24;
export const NUDGE_PX = 4;
export const NUDGE_K = 0.2;
export const SNAP_MS = 150;
/** Histórico de posições previstas guardado (ms). */
const HISTORY_MS = 2000;
/** Limite do `move_to` (tiles de caminho), igual ao servidor. */
export const MAX_PATH_TILES = 60;

const STEP: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

export interface PredictorDeps {
  grid(): WalkGrid | null;
  finder(): PathFinder | null;
  send(msg: ClientMsg): void;
  /** Relógio local (ms). */
  now(): number;
}

export type ReconcileResult = 'ok' | 'nudge' | 'snap';

/** Contadores de depuração (sonda de fluidez do QA). */
export const predictorStats = { snaps: 0, nudges: 0, samples: 0 };

interface Correction {
  dx: number;
  dy: number;
  /** Fração já aplicada (0..1). */
  done: number;
  dur: number;
}

export class Predictor {
  readonly m: Mover = { x: 0, y: 0, tx: 0, ty: 0, dir: 'down' };
  path: PathState | null = null;
  /** Direção segurada no teclado (WASD/setas). */
  heldDir: Dir | null = null;
  run = false;
  /** Andou no último update. */
  moving = false;
  seq = 0;
  /** seq do último `move_to` (os acks de `move_dir` não replanejam). */
  moveToSeq = -1;
  private history: { t: number; x: number; y: number }[] = [];
  private corr: Correction | null = null;
  private readonly buf: number[] = [];

  constructor(private readonly deps: PredictorDeps) {}

  /** Há movimento local em andamento (clique ou tecla). */
  get active(): boolean {
    return this.path !== null || this.heldDir !== null;
  }

  /** Encaixe imediato (welcome, teleporte, troca de mapa). */
  reset(x: number, y: number, dir?: Dir): void {
    this.m.x = x;
    this.m.y = y;
    this.syncTile();
    if (dir) this.m.dir = dir;
    this.path = null;
    this.corr = null;
    this.history.length = 0;
    this.moving = false;
  }

  /** Para tudo (sem avisar o servidor). */
  stop(): void {
    this.path = null;
    this.heldDir = null;
    this.moving = false;
  }

  /** Clique num tile: planeja e manda `move_to`. Retorna false se não há caminho. */
  moveTo(tx: number, ty: number, run = false): boolean {
    const grid = this.deps.grid();
    const finder = this.deps.finder();
    if (!grid || !finder) return false;
    const out = this.buf;
    if (!findPath(grid, finder, this.m.tx, this.m.ty, tx, ty, out)) return false;
    if (out.length / 2 > MAX_PATH_TILES) return false;
    this.heldDir = null;
    this.run = run;
    this.path = out.length ? { path: out.slice(), i: 0, run } : null;
    this.moveToSeq = ++this.seq;
    // posição vai por `pos` (cliente autoritativo)
    return true;
  }

  /** Replaneja localmente para o destino que o servidor aceitou (ack), sem mandar nova mensagem. */
  replan(tx: number, ty: number): void {
    const grid = this.deps.grid();
    const finder = this.deps.finder();
    if (!grid || !finder) return;
    const out: number[] = [];
    if (!findPath(grid, finder, this.m.tx, this.m.ty, tx, ty, out)) return;
    this.path = out.length ? { path: out, i: 0, run: this.run } : null;
  }

  /** Tecla de direção apertada (ou solta, com null). Manda `move_dir` só quando muda. */
  setDir(dir: Dir | null, run = false): void {
    if (dir === this.heldDir && run === this.run) return;
    this.heldDir = dir;
    this.run = run;
    ++this.seq;
    if (dir) {
      // o caminho do clique é substituído pelo passo a passo do teclado (termina o tile atual)
      if (this.path) this.path = this.path.i < this.path.path.length ? { path: this.path.path.slice(this.path.i, this.path.i + 2), i: 0, run } : null;
      if (!this.path) this.nextStep();
    }
  }

  /** Próximo tile na direção segurada (para na parede, virado para ela). */
  private nextStep(): void {
    const dir = this.heldDir;
    if (!dir) return;
    const grid = this.deps.grid();
    this.m.dir = dir;
    if (!grid) return;
    const [dx, dy] = STEP[dir];
    const nx = this.m.tx + dx;
    const ny = this.m.ty + dy;
    if (!grid.walkable(nx, ny)) return;
    this.path = { path: [nx, ny], i: 0, run: this.run };
    if (grid.get(nx, ny) === SEAT) this.heldDir = null; // entra na cadeira e para (senta ao chegar)
  }

  update(dt: number): void {
    const p = this.path;
    this.moving = false;
    if (p) {
      const r = advance(this.m, p, dt);
      this.moving = r.moved;
      if (r.arrived) {
        this.path = null;
        if (this.heldDir) {
          this.nextStep();
          // continua no mesmo frame com o que sobrou do passo (sem engasgar entre tiles)
          if (this.path) this.moving = advance(this.m, this.path, 0).moved || this.moving;
        }
      }
    }
    this.applyCorrection(dt);
    const t = this.deps.now();
    const h = this.history;
    const c = this.committed();
    h.push({ t, x: c.x, y: c.y });
    while (h.length > 2 && h[0].t < t - HISTORY_MS) h.shift();
  }

  /** Posição prevista no instante local `t` (ou a atual, se o histórico não cobre). */
  positionAt(t: number): { x: number; y: number } {
    const h = this.history;
    if (!h.length || t >= h[h.length - 1].t) return this.committed();
    if (t <= h[0].t) return { x: h[0].x, y: h[0].y };
    for (let i = h.length - 1; i > 0; i--) {
      const a = h[i - 1];
      const b = h[i];
      if (a.t <= t) {
        const k = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
      }
    }
    return { x: h[0].x, y: h[0].y };
  }

  /**
   * Compara a posição do servidor (`sx`, `sy`, px) com a prevista no instante local equivalente
   * (`atLocal`; padrão: agora) e corrige.
   */
  reconcile(sx: number, sy: number, atLocal = this.deps.now()): ReconcileResult {
    const p = this.positionAt(atLocal);
    const ex = sx - p.x;
    const ey = sy - p.y;
    const d = Math.hypot(ex, ey);
    predictorStats.samples++;
    if (d > SNAP_PX) {
      predictorStats.snaps++;
      this.correct(ex, ey, SNAP_MS);
      return 'snap';
    }
    // Enquanto anda, pequenas diferenças são só latência: corrigir aqui vira "elástico". Só ao parar
    // (sem caminho nem tecla) o avatar converge suavemente para onde o servidor o deixou.
    if (d > NUDGE_PX && !this.active && !this.corr) {
      predictorStats.nudges++;
      this.correct(ex, ey, SNAP_MS);
      return 'nudge';
    }
    return 'ok';
  }

  /** Servidor recusou o movimento: para e volta para onde ele diz. */
  reject(sx: number, sy: number): void {
    this.stop();
    this.corr = null;
    this.correct(sx - this.m.x, sy - this.m.y, SNAP_MS);
  }

  /** Vai suavemente (150 ms) até uma posição ditada pelo servidor (sentar, levantar...). */
  follow(sx: number, sy: number): void {
    const c = this.committed();
    const ex = sx - c.x;
    const ey = sy - c.y;
    if (Math.hypot(ex, ey) < 0.5) return;
    this.correct(ex, ey, SNAP_MS);
  }

  private correct(dx: number, dy: number, dur: number): void {
    // o histórico passa a refletir a correção (o próximo delta não corrige de novo o mesmo erro)
    for (const h of this.history) {
      h.x += dx;
      h.y += dy;
    }
    const prev = this.corr;
    if (prev) {
      dx += prev.dx * (1 - prev.done);
      dy += prev.dy * (1 - prev.done);
    }
    this.corr = { dx, dy, done: 0, dur };
  }

  private shift(dx: number, dy: number): void {
    this.m.x += dx;
    this.m.y += dy;
    for (const h of this.history) {
      h.x += dx;
      h.y += dy;
    }
    if (!this.path) this.syncTile();
  }

  private applyCorrection(dt: number): void {
    const c = this.corr;
    if (!c) return;
    const next = Math.min(1, c.done + (dt * 1000) / c.dur);
    const k = next - c.done;
    c.done = next;
    this.m.x += c.dx * k;
    this.m.y += c.dy * k;
    if (next >= 1) {
      this.corr = null;
      if (!this.path) this.syncTile();
    }
  }

  /** Posição já com a correção pendente aplicada inteira. */
  committed(): { x: number; y: number } {
    const c = this.corr;
    return c ? { x: this.m.x + c.dx * (1 - c.done), y: this.m.y + c.dy * (1 - c.done) } : { x: this.m.x, y: this.m.y };
  }

  /** Correção pendente (testes). */
  get correcting(): boolean {
    return this.corr !== null;
  }

  private syncTile(): void {
    this.m.tx = Math.round((this.m.x - FOOT_DX) / TILE);
    this.m.ty = Math.round((this.m.y - FOOT_DY) / TILE);
  }
}
