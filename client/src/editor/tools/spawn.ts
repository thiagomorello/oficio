// Ferramenta Entrada (spawn): clique num tile livre adiciona um ponto de entrada; clique num ponto
// existente o seleciona (Del remove). O primeiro ponto é a referência de alcançabilidade.
import { t } from '../../i18n';
import type { EditorCtx, PointerInfo, Tool } from '../context';
import { COLORS, drawTileMarker } from '../draw';
import { areaAt } from '../geometry';
import { addOp, batch } from '../ops';

export function spawnTool(ctx: EditorCtx): Tool {
  let hover: PointerInfo | null = null;
  const free = (tx: number, ty: number): boolean => {
    const a = ctx.scene.assembly();
    if (a) return a.grid.get(tx, ty) === 1;
    return !!areaAt(ctx.doc(), tx, ty);
  };
  return {
    cursor: 'crosshair',
    hover(p) {
      hover = p;
      ctx.redraw();
    },
    up(p, _s, dragged) {
      if (dragged) return;
      const doc = ctx.doc();
      const i = doc.spawn.findIndex((s) => s.x === p.tx && s.y === p.ty);
      if (i >= 0) {
        ctx.select([{ t: 'spawn', i }]);
        return;
      }
      if (ctx.readOnly()) return;
      if (!free(p.tx, p.ty)) {
        ctx.toast(t('editor.tool.spawnFreeTile'), 'error');
        return;
      }
      ctx.exec(batch('editor.op.spawn', [addOp(doc, { doc: 'spawn' }, { x: p.tx, y: p.ty })]));
      ctx.select([{ t: 'spawn', i: doc.spawn.length }]);
    },
    draw(g, scale) {
      if (!hover) return;
      drawTileMarker(g, hover.tx, hover.ty, free(hover.tx, hover.ty) ? COLORS.yellow : COLORS.red, 'E', scale, 0.6);
    },
  };
}
