// Ferramenta Portas: clique numa parede norte (2 linhas da face) ou sul cria uma passagem de 2 tiles;
// arrastar ajusta a largura (1..4). Clique numa passagem existente a seleciona; arrastá-la ajusta a
// largura a partir da borda esquerda.
import { doorwayRect } from '../../../../shared/map/assemble';
import type { MapArea, MapDoorway, OfficeMapDoc } from '../../../../shared/map/doc';
import { t } from '../../i18n';
import type { EditorCtx, PointerInfo, Tool } from '../context';
import { COLORS, fillTiles, strokeTiles } from '../draw';
import { inRect, intersects } from '../geometry';
import { addOp, batch, updateOp } from '../ops';

export interface WallSide {
  area: MapArea;
  side: 'north' | 'south';
  lx: number;
}

/** Parede (norte/sul) sob o tile absoluto. */
export function wallSideAt(doc: OfficeMapDoc, tx: number, ty: number, hidden?: ReadonlySet<string>): WallSide | null {
  for (const a of doc.areas) {
    if (hidden?.has(a.id) || tx < a.rect.x || tx >= a.rect.x + a.rect.w) continue;
    if (a.walls.north && (ty === a.rect.y || ty === a.rect.y + 1)) return { area: a, side: 'north', lx: tx - a.rect.x };
    if (a.walls.south && ty === a.rect.y + a.rect.h - 1) return { area: a, side: 'south', lx: tx - a.rect.x };
  }
  return null;
}

/** Problema da passagem (null = ok), ignorando a de índice `ignore`. */
export function doorwayProblem(area: MapArea, d: MapDoorway, ignore = -1): string | null {
  if (d.w < 1 || d.w > 4) return t('editor.problem.doorWidth');
  if (d.lx < 1 || d.lx + d.w > area.rect.w - 1) return t('editor.problem.outsideWall');
  const r = doorwayRect(area, d);
  for (let i = 0; i < area.doorways.length; i++) {
    if (i === ignore || area.doorways[i].side !== d.side) continue;
    if (intersects(r, doorwayRect(area, area.doorways[i]))) return t('editor.problem.overlapsDoorway');
  }
  return null;
}

export function doorwayTool(ctx: EditorCtx): Tool {
  let hover: PointerInfo | null = null;
  let g: { area: MapArea; index: number; d: MapDoorway; problem: string | null } | null = null;

  const draftAt = (w: WallSide, x0: number, x1: number): MapDoorway => {
    const lo = Math.min(x0, x1);
    const width = Math.max(1, Math.min(4, Math.abs(x1 - x0) + 1));
    return { side: w.side, lx: lo, w: width };
  };

  return {
    cursor: 'crosshair',
    hover(p) {
      hover = p;
      ctx.redraw();
    },
    down(p) {
      g = null;
      if (ctx.readOnly()) return;
      const w = wallSideAt(ctx.doc(), p.tx, p.ty, ctx.state.hiddenAreas);
      if (!w) return;
      const index = w.area.doorways.findIndex((d) => d.side === w.side && inRect(doorwayRect(w.area, d), w.lx, p.ty - w.area.rect.y));
      if (index >= 0) {
        ctx.select([{ t: 'door', area: w.area.id, i: index }]);
        g = { area: w.area, index, d: w.area.doorways[index], problem: null };
        return;
      }
      const lx = Math.max(1, Math.min(w.area.rect.w - 3, w.lx));
      const d: MapDoorway = { side: w.side, lx, w: 2 };
      g = { area: w.area, index: -1, d, problem: doorwayProblem(w.area, d) };
    },
    drag(p, start) {
      if (!g) return;
      const w: WallSide = { area: g.area, side: g.d.side, lx: start.tx - g.area.rect.x };
      const x0 = g.index >= 0 ? g.area.doorways[g.index].lx : w.lx;
      g.d = draftAt(w, x0, p.tx - g.area.rect.x);
      g.problem = doorwayProblem(g.area, g.d, g.index);
      ctx.redraw();
    },
    up(_p, _s, dragged) {
      const cur = g;
      g = null;
      ctx.redraw();
      if (!cur) return;
      if (cur.index >= 0 && !dragged) return;
      if (cur.problem) {
        ctx.toast(t('editor.tool.invalidDoorway', { problem: cur.problem }), 'error');
        return;
      }
      const doc = ctx.doc();
      const at = { area: cur.area.id, list: 'doorways' as const };
      if (cur.index >= 0) ctx.exec(batch('editor.op.adjustDoorway', [updateOp(doc, at, cur.index, cur.d)]));
      else {
        ctx.exec(batch('editor.op.newDoorway', [addOp(doc, at, cur.d)]));
        ctx.select([{ t: 'door', area: cur.area.id, i: cur.area.doorways.length }]);
      }
    },
    cancel() {
      g = null;
    },
    draw(gx, scale) {
      if (g) {
        const r = doorwayRect(g.area, g.d);
        const abs = { x: g.area.rect.x + r.x, y: g.area.rect.y + r.y, w: r.w, h: r.h };
        fillTiles(gx, abs, g.problem ? 'rgba(227,11,47,0.3)' : 'rgba(255,216,0,0.25)');
        strokeTiles(gx, abs, g.problem ? COLORS.red : COLORS.yellow, scale, 1.5);
        return;
      }
      if (!hover) return;
      const w = wallSideAt(ctx.doc(), hover.tx, hover.ty, ctx.state.hiddenAreas);
      if (!w) return;
      const lx = Math.max(1, Math.min(w.area.rect.w - 3, w.lx));
      const d: MapDoorway = { side: w.side, lx, w: 2 };
      const r = doorwayRect(w.area, d);
      const ok = !doorwayProblem(w.area, d);
      strokeTiles(gx, { x: w.area.rect.x + r.x, y: w.area.rect.y + r.y, w: r.w, h: r.h }, ok ? COLORS.yellow : COLORS.red, scale, 1, [3, 2]);
    },
  };
}
