// Ferramenta Piso: pinta (ou apaga) por tile (pincel) ou por retângulo, com tipo + tint + intensidade.
// Cada área tocada recebe um `setFloors` com os pisos normalizados ("último vence"); tudo num lote.
import type { OfficeMapDoc, TileRect } from '../../../../shared/map/doc';
import { TILE } from '../../../../shared/map/tile';
import { floorColor } from '../../../../shared/map/validate';
import type { EditorCtx, PointerInfo, Tool } from '../context';
import { COLORS, strokeTiles } from '../draw';
import { intersection, rectFromTiles } from '../geometry';
import { batch, paintFloors, sameFloors, type EditOp, type FloorStyle } from '../ops';
import type { Mode } from '../state';

type FloorMode = Extract<Mode, { k: 'floor' }>;

/** Estilo do piso do modo (null = borracha). */
export function floorStyleOf(m: FloorMode): FloorStyle | null {
  if (m.kind === 'erase') return null;
  const s: FloorStyle = { kind: m.kind };
  if (m.tint) s.tint = m.tint;
  if (m.tint2 && m.kind === 'carpet') s.tint2 = m.tint2;
  if (m.tintK !== undefined && m.kind !== 'carpet') s.tintK = m.tintK;
  return s;
}

/** Operações para pintar retângulos absolutos (recortados por área). */
export function paintOps(doc: OfficeMapDoc, rects: readonly TileRect[], style: FloorStyle | null, hidden?: ReadonlySet<string>): EditOp {
  const ops: EditOp[] = [];
  for (const a of doc.areas) {
    if (hidden?.has(a.id)) continue;
    const local: TileRect[] = [];
    for (const r of rects) {
      const i = intersection(a.rect, r);
      if (i) local.push({ x: i.x - a.rect.x, y: i.y - a.rect.y, w: i.w, h: i.h });
    }
    if (!local.length) continue;
    const after = paintFloors(a, local, style);
    if (!sameFloors(after, a.floors)) ops.push({ t: 'setFloors', area: a.id, before: a.floors, after });
  }
  return batch(style ? 'editor.op.paintFloor' : 'editor.op.eraseFloor', ops);
}

export function floorTool(ctx: EditorCtx): Tool {
  let hover: PointerInfo | null = null;
  let rect: TileRect | null = null;
  let tiles: Map<string, TileRect> | null = null;
  const mode = (): FloorMode | null => (ctx.state.mode.k === 'floor' ? ctx.state.mode : null);

  const addTile = (p: PointerInfo) => {
    tiles ??= new Map();
    tiles.set(`${p.tx},${p.ty}`, { x: p.tx, y: p.ty, w: 1, h: 1 });
  };

  return {
    cursor: 'crosshair',
    hover(p) {
      hover = p;
      ctx.redraw();
    },
    down(p) {
      const m = mode();
      if (!m || ctx.readOnly()) return;
      if (m.brush === 'tile') addTile(p);
      else rect = { x: p.tx, y: p.ty, w: 1, h: 1 };
    },
    drag(p, start) {
      const m = mode();
      if (!m) return;
      if (m.brush === 'tile') addTile(p);
      else rect = rectFromTiles(start.tx, start.ty, p.tx, p.ty);
      ctx.redraw();
    },
    up() {
      const m = mode();
      const rects = rect ? [rect] : tiles ? [...tiles.values()] : [];
      rect = null;
      tiles = null;
      if (!m || !rects.length || ctx.readOnly()) return;
      ctx.exec(paintOps(ctx.doc(), rects, floorStyleOf(m), ctx.state.hiddenAreas));
    },
    cancel() {
      rect = null;
      tiles = null;
    },
    draw(g, scale) {
      const m = mode();
      if (!m) return;
      const color = m.kind === 'erase' ? 'rgba(18,18,18,0.6)' : floorColor(m.kind, m.tint, m.tintK);
      g.save();
      g.globalAlpha = 0.55;
      g.fillStyle = color;
      const list = rect ? [rect] : tiles ? [...tiles.values()] : hover ? [{ x: hover.tx, y: hover.ty, w: 1, h: 1 }] : [];
      for (const r of list) g.fillRect(r.x * TILE, r.y * TILE, r.w * TILE, r.h * TILE);
      g.restore();
      if (rect) strokeTiles(g, rect, COLORS.yellow, scale, 1, [4, 3]);
      else if (hover && !tiles) strokeTiles(g, { x: hover.tx, y: hover.ty, w: 1, h: 1 }, COLORS.yellow, scale, 1);
    },
  };
}
