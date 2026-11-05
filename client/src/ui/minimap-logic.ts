// Matemática pura do minimapa: projeção mundo <-> canvas e cores por tipo de área.
import type { AreaKind } from '../../../shared/map/types';

export interface MiniProjection {
  /** px do canvas por px de mundo. */
  scale: number;
  /** Deslocamento (px do canvas) que centraliza o mapa. */
  ox: number;
  oy: number;
}

/** Encaixa o mundo (ww x wh) no canvas (cw x ch) com margem, mantendo a proporção. */
export function fitProjection(ww: number, wh: number, cw: number, ch: number, margin = 4): MiniProjection {
  if (ww <= 0 || wh <= 0 || cw <= 0 || ch <= 0) return { scale: 1, ox: 0, oy: 0 };
  const scale = Math.min((cw - margin * 2) / ww, (ch - margin * 2) / wh);
  return { scale, ox: (cw - ww * scale) / 2, oy: (ch - wh * scale) / 2 };
}

export function worldToMini(p: MiniProjection, x: number, y: number): { x: number; y: number } {
  return { x: p.ox + x * p.scale, y: p.oy + y * p.scale };
}

/** Ponto do canvas -> mundo, limitado ao retângulo do mundo. */
export function miniToWorld(p: MiniProjection, mx: number, my: number, ww: number, wh: number): { x: number; y: number } {
  const x = (mx - p.ox) / p.scale;
  const y = (my - p.oy) / p.scale;
  return { x: Math.min(ww, Math.max(0, x)), y: Math.min(wh, Math.max(0, y)) };
}

/** Retângulo visível projetado, recortado ao canvas. */
export function viewToMini(p: MiniProjection, v: { x0: number; y0: number; x1: number; y1: number }, cw: number, ch: number): { x: number; y: number; w: number; h: number } {
  const a = worldToMini(p, v.x0, v.y0);
  const b = worldToMini(p, v.x1, v.y1);
  const x0 = Math.max(0, Math.min(cw, a.x));
  const y0 = Math.max(0, Math.min(ch, a.y));
  const x1 = Math.max(0, Math.min(cw, b.x));
  const y1 = Math.max(0, Math.min(ch, b.y));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

export const AREA_FLOOR_COLOR: Record<AreaKind, string> = {
  reception: '#3a3640',
  restroom: '#2f3a3d',
  cafe: '#3d3a2f',
  lounge: '#3a3128',
  room: '#2e2d33',
  corridor: '#252428',
  open: '#2a2930',
  zen: '#2b3631',
};
