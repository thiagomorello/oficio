// Primitivas de desenho do editor em coordenadas de mundo (linhas de 1 px de tela em qualquer zoom).
import type { ArtModule } from '../art/api';
import { hash32 } from '../../../shared/hash';
import type { TileRect } from '../../../shared/map/doc';
import { FURNITURE, type FurnitureKind } from '../../../shared/map/furniture';
import { TILE } from '../../../shared/map/tile';

export const COLORS = {
  yellow: '#ffd800',
  red: '#e30b2f',
  blue: '#4970fc',
  cyan: '#04d1d1',
  pink: '#e810b3',
  green: '#04d131',
  white: '#ffffff',
} as const;

export function strokeTiles(g: CanvasRenderingContext2D, r: TileRect, color: string, scale: number, width = 1.5, dash?: number[]): void {
  g.save();
  g.strokeStyle = color;
  g.lineWidth = width / scale;
  if (dash) g.setLineDash(dash.map((d) => d / scale));
  const inset = width / scale / 2;
  g.strokeRect(r.x * TILE + inset, r.y * TILE + inset, r.w * TILE - 2 * inset, r.h * TILE - 2 * inset);
  g.restore();
}

export function fillTiles(g: CanvasRenderingContext2D, r: TileRect, color: string): void {
  g.fillStyle = color;
  g.fillRect(r.x * TILE, r.y * TILE, r.w * TILE, r.h * TILE);
}

/** Retângulo em px de mundo. */
export function strokePx(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, scale: number, width = 1.5, dash?: number[]): void {
  g.save();
  g.strokeStyle = color;
  g.lineWidth = width / scale;
  if (dash) g.setLineDash(dash.map((d) => d / scale));
  g.strokeRect(x, y, w, h);
  g.restore();
}

/** Ghost de um móvel com canto em (tx, ty) absolutos. */
export function drawFurnitureGhost(g: CanvasRenderingContext2D, art: ArtModule, kind: FurnitureKind, variant: string | undefined, tx: number, ty: number, dx: number, dy: number, valid: boolean, scale: number): void {
  const fp = FURNITURE[kind].footprint;
  g.save();
  g.globalAlpha = 0.6;
  try {
    const s = art.furnitureSprites(kind, variant, 0, { seed: hash32(`${kind}:${variant ?? ''}`) });
    const ax = (tx + fp.w / 2) * TILE + dx;
    const ay = (ty + fp.h) * TILE + dy;
    if (s?.base?.canvas) g.drawImage(s.base.canvas, Math.round(ax - s.base.ax), Math.round(ay - s.base.ay));
    if (s?.front?.canvas) g.drawImage(s.front.canvas, Math.round(ax - s.front.ax), Math.round(ay - s.front.ay));
  } catch {
    // arte sem o sprite: só o contorno
  }
  g.restore();
  const r = { x: tx, y: ty, w: fp.w, h: Math.max(1, fp.h) };
  if (!valid) fillTiles(g, r, 'rgba(227,11,47,0.35)');
  strokeTiles(g, r, valid ? COLORS.yellow : COLORS.red, scale, 1, [3, 2]);
}

/** Ghost de item de parede centrado em `cx` (px) com rodapé em `baseY` (px). */
export function drawWallGhost(g: CanvasRenderingContext2D, art: ArtModule, kind: FurnitureKind, variant: string | undefined, cx: number, baseY: number, on: 'face' | 'south', valid: boolean, scale: number): void {
  const w = FURNITURE[kind].footprint.w * TILE;
  g.save();
  g.globalAlpha = 0.6;
  try {
    const s = art.furnitureSprites(kind, variant, 0, { seed: 1 });
    if (s?.base?.canvas) {
      if (on === 'face') g.drawImage(s.base.canvas, Math.round(cx - s.base.ax), Math.round(baseY - s.base.ay));
      else g.drawImage(s.base.canvas, Math.round(cx - s.base.canvas.width / 2), Math.round(baseY - TILE + 9 - s.base.canvas.height / 2));
    }
  } catch {
    // sem sprite
  }
  g.restore();
  const y = on === 'face' ? baseY - 2 * TILE : baseY - TILE;
  const h = on === 'face' ? 2 * TILE : TILE;
  if (!valid) {
    g.fillStyle = 'rgba(227,11,47,0.35)';
    g.fillRect(cx - w / 2, y, w, h);
  }
  strokePx(g, cx - w / 2, y, w, h, valid ? COLORS.yellow : COLORS.red, scale, 1, [3, 2]);
}

/** Marcador redondo num tile (spawn, spot). */
export function drawTileMarker(g: CanvasRenderingContext2D, tx: number, ty: number, color: string, label: string, scale: number, alpha = 1): void {
  const cx = tx * TILE + TILE / 2;
  const cy = ty * TILE + TILE / 2;
  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = color;
  g.beginPath();
  g.arc(cx, cy, 5, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 1 / scale;
  g.strokeStyle = '#121212';
  g.stroke();
  if (label && scale >= 1.5) {
    g.fillStyle = '#121212';
    g.font = `600 ${7}px Poppins, system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, cx, cy + 0.5);
  }
  g.restore();
}

/** Seta de direção a partir do centro de um tile. */
export function drawDirArrow(g: CanvasRenderingContext2D, tx: number, ty: number, dir: string, color: string, scale: number): void {
  const cx = tx * TILE + TILE / 2;
  const cy = ty * TILE + TILE / 2;
  const v = dir === 'up' ? [0, -1] : dir === 'down' ? [0, 1] : dir === 'left' ? [-1, 0] : [1, 0];
  g.save();
  g.strokeStyle = color;
  g.lineWidth = 1.5 / scale;
  g.beginPath();
  g.moveTo(cx + v[0] * 5, cy + v[1] * 5);
  g.lineTo(cx + v[0] * 8, cy + v[1] * 8);
  g.stroke();
  g.restore();
}
