// Busca de pontos de uso (café, pia, arcade...) perto de um tile. Puro (sem estado do replica).
import { USE_SPOT_KINDS } from '../../../../shared/map/spots';
import type { OfficeAssembly, SpotDef } from '../../../../shared/map/types';

/**
 * Spot de uso mais próximo do tile (tx, ty): Chebyshev ≤ `max` (padrão 1), desempate pela
 * distância ao tile de aproximação. Ignora assentos e `talk`/`stand`/`watch`.
 */
export function nearestUseSpot(assembly: Pick<OfficeAssembly, 'spots'>, tx: number, ty: number, max = 1): SpotDef | null {
  let best: SpotDef | null = null;
  let bd = Infinity;
  for (const s of assembly.spots) {
    if (s.seated || !USE_SPOT_KINDS.has(s.kind)) continue;
    const cheb = Math.max(Math.abs(s.tx - tx), Math.abs(s.ty - ty));
    if (cheb > max) continue;
    const d = cheb * 1000 + (s.tx - tx) ** 2 + (s.ty - ty) ** 2;
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}
