// Regras de proximidade (áudio/vídeo) sobre o mapa montado — "WP8 — audível":
// - quem está numa zona PRIVADA ouve exatamente os membros da mesma zona (e só eles o ouvem);
// - fora de zona privada: Chebyshev ≤ PROXIMITY_TILES entre pessoas que também não estão em zona privada;
// - volume 1 até 1,5 tile, linear até 0,15 em 4 tiles, 0 além.
// Zonas não privadas (ex.: kind 'open') não isolam ninguém. Banheiros simplesmente não são zona.
import { PROXIMITY_TILES, TILE } from './tile';
import type { OfficeAssembly, ZoneDef } from './types';

/** Pessoa no mundo: tile lógico e (opcional) posição dos pés em px, para distância contínua. */
export interface Person {
  id: string;
  tx: number;
  ty: number;
  x?: number;
  y?: number;
}

export const VOLUME_FULL_TILES = 1.5;
export const VOLUME_MIN = 0.15;

/** Zona no tile, ou null. */
export function zoneAt(assembly: Pick<OfficeAssembly, 'w' | 'h' | 'zoneAt' | 'zones'>, tx: number, ty: number): ZoneDef | null {
  if (tx < 0 || ty < 0 || tx >= assembly.w || ty >= assembly.h) return null;
  const i = assembly.zoneAt[ty * assembly.w + tx];
  return i >= 0 ? (assembly.zones[i] ?? null) : null;
}

/** Zona PRIVADA no tile, ou null. */
export function privateZoneAt(assembly: Pick<OfficeAssembly, 'w' | 'h' | 'zoneAt' | 'zones'>, tx: number, ty: number): ZoneDef | null {
  const z = zoneAt(assembly, tx, ty);
  return z && z.private ? z : null;
}

/** Distância de Chebyshev (em tiles inteiros). */
export function chebyshev(a: { tx: number; ty: number }, b: { tx: number; ty: number }): number {
  return Math.max(Math.abs(a.tx - b.tx), Math.abs(a.ty - b.ty));
}

/** Distância de Chebyshev contínua em tiles (usa px quando os dois têm x/y; senão os tiles). */
export function chebyshevContinuous(a: Person, b: Person): number {
  if (a.x !== undefined && a.y !== undefined && b.x !== undefined && b.y !== undefined) {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) / TILE;
  }
  return chebyshev(a, b);
}

/** Se `a` e `b` se ouvem (simétrico). */
export function canHear(a: Person, b: Person, assembly: Pick<OfficeAssembly, 'w' | 'h' | 'zoneAt' | 'zones'>): boolean {
  if (a.id === b.id) return false;
  const za = privateZoneAt(assembly, a.tx, a.ty);
  const zb = privateZoneAt(assembly, b.tx, b.ty);
  if (za || zb) return za === zb;
  return chebyshev(a, b) <= PROXIMITY_TILES;
}

/** Ids que `self` ouve (sem o próprio). */
export function audibleSet(self: Person, all: readonly Person[], assembly: Pick<OfficeAssembly, 'w' | 'h' | 'zoneAt' | 'zones'>): Set<string> {
  const out = new Set<string>();
  for (const p of all) if (canHear(self, p, assembly)) out.add(p.id);
  return out;
}

/** Curva de volume pela distância (tiles). */
export function volumeAt(d: number): number {
  if (d <= VOLUME_FULL_TILES) return 1;
  if (d > PROXIMITY_TILES) return 0;
  return 1 - ((d - VOLUME_FULL_TILES) / (PROXIMITY_TILES - VOLUME_FULL_TILES)) * (1 - VOLUME_MIN);
}

/** Volume (0..1) com que `self` ouve `other`. Mesma zona privada = 1; quem não se ouve = 0. */
export function volumeFor(self: Person, other: Person, assembly: Pick<OfficeAssembly, 'w' | 'h' | 'zoneAt' | 'zones'>): number {
  if (!canHear(self, other, assembly)) return 0;
  if (privateZoneAt(assembly, self.tx, self.ty)) return 1;
  // audível pelos tiles ⇒ nunca abaixo do mínimo, mesmo que os pés (px) estejam um pouco além de 4 tiles
  return volumeAt(Math.min(PROXIMITY_TILES, chebyshevContinuous(self, other)));
}
