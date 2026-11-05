// Ferramenta Tapete: arrastar um retângulo (encaixe de 0,25 tile) dentro de uma área.
import type { MapArea, MapRug } from '../../../../shared/map/doc';
import { TILE } from '../../../../shared/map/tile';
import { t } from '../../i18n';
import type { EditorCtx, Tool } from '../context';
import { COLORS, strokePx } from '../draw';
import { areaAt, snapQuarter } from '../geometry';
import { addOp, apply, batch } from '../ops';

interface Draft {
  area: MapArea;
  lx: number;
  ly: number;
  w: number;
  h: number;
}

/** Retângulo local (frações de 0,25) entre dois pontos em px de mundo, recortado na área. */
export function rugRect(area: MapArea, ax: number, ay: number, bx: number, by: number): { lx: number; ly: number; w: number; h: number } {
  const clampX = (v: number) => Math.max(0, Math.min(area.rect.w, snapQuarter(v / TILE - area.rect.x)));
  const clampY = (v: number) => Math.max(0, Math.min(area.rect.h, snapQuarter(v / TILE - area.rect.y)));
  const x0 = clampX(Math.min(ax, bx));
  const x1 = clampX(Math.max(ax, bx));
  const y0 = clampY(Math.min(ay, by));
  const y1 = clampY(Math.max(ay, by));
  return { lx: x0, ly: y0, w: x1 - x0, h: y1 - y0 };
}

export function rugTool(ctx: EditorCtx): Tool {
  let draft: Draft | null = null;
  const color = () => (ctx.state.mode.k === 'rug' ? ctx.state.mode.color : '#b79303');
  return {
    cursor: 'crosshair',
    down(p) {
      const a = areaAt(ctx.doc(), p.tx, p.ty, ctx.state.hiddenAreas);
      draft = a && !ctx.readOnly() ? { area: a, lx: 0, ly: 0, w: 0, h: 0 } : null;
    },
    drag(p, start) {
      if (!draft) return;
      draft = { area: draft.area, ...rugRect(draft.area, start.wx, start.wy, p.wx, p.wy) };
      ctx.redraw();
    },
    up(_p, _s, dragged) {
      const d = draft;
      draft = null;
      if (!d || !dragged) {
        if (!dragged) ctx.toast(t('editor.tool.dragRug'), 'info');
        return;
      }
      if (d.w < 0.5 || d.h < 0.5) return;
      const doc = ctx.doc();
      const alloc = ctx.store.allocIds(1, doc);
      const rug: MapRug = { id: `f${alloc.nums[0]}`, lx: d.lx, ly: d.ly, w: d.w, h: d.h, color: color() };
      ctx.exec(batch('editor.op.rug', [alloc.op, addOp(apply(doc, alloc.op), { area: d.area.id, list: 'rugs' }, rug)]));
      ctx.select([{ t: 'rug', area: d.area.id, id: rug.id }]);
      ctx.redraw();
    },
    cancel() {
      draft = null;
    },
    draw(g, scale) {
      if (!draft || draft.w <= 0 || draft.h <= 0) return;
      const x = (draft.area.rect.x + draft.lx) * TILE;
      const y = (draft.area.rect.y + draft.ly) * TILE;
      g.save();
      g.globalAlpha = 0.6;
      g.fillStyle = color();
      g.fillRect(x, y, draft.w * TILE, draft.h * TILE);
      g.restore();
      strokePx(g, x, y, draft.w * TILE, draft.h * TILE, COLORS.yellow, scale, 1, [4, 3]);
    },
  };
}
