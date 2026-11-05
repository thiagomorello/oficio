// Ferramenta Áreas: arrastar no vazio cria uma área; arrastar a borda de uma área a redimensiona
// (o conteúdo fica no lugar); arrastar o miolo move a área inteira (com zonas, spots e entradas).
import type { MapArea, OfficeMapDoc, TileRect } from '../../../../shared/map/doc';
import { FLOORS, WALLS } from '../../../../shared/map/palette';
import { TILE } from '../../../../shared/map/tile';
import { t } from '../../i18n';
import type { EditorCtx, Tool } from '../context';
import { COLORS, fillTiles, strokeTiles } from '../draw';
import { areaAt, areaRectProblem, moveAreaOps, rectFromTiles, resizeArea } from '../geometry';
import { addOp, apply, batch, updateOp } from '../ops';

type Edge = { l: boolean; r: boolean; t: boolean; b: boolean };

/** Bordas sob o ponto (dentro da área, a menos de `m` tiles da borda). */
export function edgesAt(a: MapArea, wx: number, wy: number, m = 0.45): Edge | null {
  const x = wx / TILE - a.rect.x;
  const y = wy / TILE - a.rect.y;
  const e = { l: x < m, r: x > a.rect.w - m, t: y < m, b: y > a.rect.h - m };
  return e.l || e.r || e.t || e.b ? e : null;
}

/** Retângulo redimensionado pelas bordas arrastadas (mínimo 4×4). */
export function resizedRect(r: TileRect, e: Edge, dx: number, dy: number): TileRect {
  let x0 = r.x;
  let y0 = r.y;
  let x1 = r.x + r.w;
  let y1 = r.y + r.h;
  if (e.l) x0 = Math.min(x0 + dx, x1 - 4);
  if (e.r) x1 = Math.max(x1 + dx, x0 + 4);
  if (e.t) y0 = Math.min(y0 + dy, y1 - 4);
  if (e.b) y1 = Math.max(y1 + dy, y0 + 4);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Área nova (aberta, sem paredes, carpete do open plan). */
export function newArea(doc: OfficeMapDoc, id: string, rect: TileRect): MapArea {
  const n = doc.areas.length + 1;
  return {
    id,
    name: t('editor.new.area', { n }),
    kind: 'open',
    rect: { ...rect },
    walls: { style: { ...WALLS.office }, north: false, south: false, west: false, east: false },
    doorways: [],
    floors: [{ ...FLOORS.openCarpet, lx: 0, ly: 0, w: rect.w, h: rect.h }],
    rugs: [],
    furniture: [],
    wallItems: [],
  };
}

export function areaTool(ctx: EditorCtx): Tool {
  let g: { k: 'create' | 'move' | 'resize'; area?: MapArea; edge?: Edge; rect: TileRect; problem: string | null } | null = null;

  return {
    cursor: 'crosshair',
    down(p) {
      if (ctx.readOnly()) return;
      const a = areaAt(ctx.doc(), p.tx, p.ty, ctx.state.hiddenAreas);
      if (!a) {
        g = { k: 'create', rect: { x: p.tx, y: p.ty, w: 1, h: 1 }, problem: t('editor.problem.min4x4') };
        return;
      }
      ctx.select([{ t: 'area', id: a.id }]);
      const e = edgesAt(a, p.wx, p.wy);
      g = e ? { k: 'resize', area: a, edge: e, rect: a.rect, problem: null } : { k: 'move', area: a, rect: a.rect, problem: null };
    },
    drag(p, start) {
      if (!g) return;
      const doc = ctx.doc();
      const dx = p.tx - start.tx;
      const dy = p.ty - start.ty;
      if (g.k === 'create') g.rect = rectFromTiles(start.tx, start.ty, p.tx, p.ty);
      else if (g.k === 'move' && g.area) g.rect = { ...g.area.rect, x: g.area.rect.x + dx, y: g.area.rect.y + dy };
      else if (g.k === 'resize' && g.area && g.edge) g.rect = resizedRect(g.area.rect, g.edge, dx, dy);
      g.problem = areaRectProblem(doc, g.rect, g.area?.id);
      ctx.redraw();
    },
    up(_p, _s, dragged) {
      const cur = g;
      g = null;
      ctx.redraw();
      if (!cur || !dragged) return;
      if (cur.problem) {
        ctx.toast(t('editor.tool.invalidArea', { problem: cur.problem }), 'error');
        return;
      }
      const doc = ctx.doc();
      if (cur.k === 'create') {
        const alloc = ctx.store.allocIds(1, doc);
        const id = `area-${alloc.nums[0]}`;
        ctx.exec(batch('editor.op.newArea', [alloc.op, addOp(apply(doc, alloc.op), { doc: 'areas' }, newArea(doc, id, cur.rect))]));
        ctx.select([{ t: 'area', id }]);
        ctx.focusProp('name');
        return;
      }
      const a = cur.area!;
      const index = doc.areas.findIndex((x) => x.id === a.id);
      if (index < 0) return;
      if (cur.k === 'move') ctx.exec(batch('editor.op.moveArea', moveAreaOps(doc, a.id, cur.rect.x - a.rect.x, cur.rect.y - a.rect.y)));
      else ctx.exec(batch('editor.op.resizeArea', [updateOp(doc, { doc: 'areas' }, index, resizeArea(doc.areas[index], cur.rect))]));
    },
    cancel() {
      g = null;
    },
    draw(gx, scale) {
      if (!g) return;
      const ok = !g.problem;
      fillTiles(gx, g.rect, ok ? 'rgba(255,216,0,0.10)' : 'rgba(227,11,47,0.25)');
      strokeTiles(gx, g.rect, ok ? COLORS.yellow : COLORS.red, scale, 2, [6, 4]);
    },
  };
}
