// Plano de realocação das pessoas quando um novo mapa é publicado (A.5, passo 3). Puro: o
// servidor aplica o resultado num único tick (teleporte `tp:1`, libera assentos, descarta caminhos).
import { FOOT_DX, FOOT_DY, TILE } from './tile';
import type { OfficeAssembly } from './types';

export interface RelocEntity {
  id: string;
  tx: number;
  ty: number;
  /** Spot (assento/ponto de uso) ocupado agora, se houver. */
  spotId?: string | null;
}

export type RelocReason =
  /** Continua no mesmo spot (que pode ter mudado de posição). */
  | 'spot_kept'
  /** O spot sumiu: assento liberado; fica no tile (se ainda for caminhável e alcançável). */
  | 'spot_removed'
  /** Em pé num tile ainda caminhável e alcançável: nada muda. */
  | 'stay'
  /** Tile inválido: vai para o tile alcançável mais próximo (raio 6). */
  | 'nearest'
  /** Nada perto: volta ao spawn. */
  | 'spawn';

export interface RelocMove {
  id: string;
  tx: number;
  ty: number;
  /** Pés em px de mundo. */
  x: number;
  y: number;
  /** Spot que continua ocupando (null = em pé). */
  spotId: string | null;
  /** Posição mudou (o servidor manda com `tp:1`). */
  moved: boolean;
  /** Spot liberado (ocupava e perdeu). */
  released: string | null;
  reason: RelocReason;
}

export const RELOCATE_RADIUS = 6;

function ok(next: OfficeAssembly, x: number, y: number): boolean {
  return next.grid.walkable(x, y) && next.reach[y * next.w + x] === 1;
}

/** Tile caminhável E alcançável mais próximo (anéis de Chebyshev; desempate pela distância euclidiana). */
export function nearestReachable(next: OfficeAssembly, x: number, y: number, maxR = RELOCATE_RADIUS): { x: number; y: number } | null {
  if (ok(next, x, y)) return { x, y };
  for (let r = 1; r <= maxR; r++) {
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || !ok(next, x + dx, y + dy)) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = { x: x + dx, y: y + dy };
        }
      }
    }
    if (best) return best;
  }
  return null;
}

/** Planeja onde cada pessoa fica no mapa `next`. Caminhos em andamento são sempre descartados. */
export function planRelocation(next: OfficeAssembly, entities: readonly RelocEntity[]): RelocMove[] {
  const spawn = next.spawn.find((p) => next.grid.walkable(p.x, p.y)) ?? next.spawn[0] ?? { x: 0, y: 0 };
  return entities.map((e): RelocMove => {
    const spot = e.spotId ? next.spotById.get(e.spotId) : undefined;
    if (spot) {
      const moved = spot.tx !== e.tx || spot.ty !== e.ty;
      return { id: e.id, tx: spot.tx, ty: spot.ty, x: spot.x, y: spot.y, spotId: spot.id, moved, released: null, reason: 'spot_kept' };
    }
    const released = e.spotId ?? null;
    const at = (tx: number, ty: number, reason: RelocReason): RelocMove => ({
      id: e.id,
      tx,
      ty,
      x: tx * TILE + FOOT_DX,
      y: ty * TILE + FOOT_DY,
      spotId: null,
      // quem estava sentado sempre "move" (sai do encaixe do assento para os pés no tile)
      moved: tx !== e.tx || ty !== e.ty || released !== null,
      released,
      reason,
    });
    if (ok(next, e.tx, e.ty)) return at(e.tx, e.ty, released ? 'spot_removed' : 'stay');
    const n = nearestReachable(next, e.tx, e.ty);
    if (n) return at(n.x, n.y, 'nearest');
    return at(spawn.x, spawn.y, 'spawn');
  });
}
