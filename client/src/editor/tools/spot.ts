// Ferramenta Pontos: `talk` entra em par (dois tiles vizinhos, um virado para o outro); `stand` e
// `watch` entram sozinhos olhando para baixo (R gira depois de selecionado).
import type { MapSpot, OfficeMapDoc } from '../../../../shared/map/doc';
import { t } from '../../i18n';
import type { EditorCtx, PointerInfo, Tool } from '../context';
import { COLORS, drawDirArrow, drawTileMarker } from '../draw';
import { addOp, apply, batch, type EditOp } from '../ops';
import type { Mode } from '../state';

type SpotMode = Extract<Mode, { k: 'spot' }>;

/** Spots a criar com o clique em (tx, ty). */
export function spotsFor(kind: MapSpot['kind'], num: number, tx: number, ty: number): MapSpot[] {
  if (kind === 'talk') {
    const group = `talk-${num}`;
    return [
      { id: `${group}-0`, kind: 'talk', tx, ty, dir: 'right', group },
      { id: `${group}-1`, kind: 'talk', tx: tx + 1, ty, dir: 'left', group },
    ];
  }
  return [{ id: `${kind}-${num}`, kind, tx, ty, dir: 'down' }];
}

export function spotTool(ctx: EditorCtx): Tool {
  let hover: PointerInfo | null = null;
  const mode = (): SpotMode | null => (ctx.state.mode.k === 'spot' ? ctx.state.mode : null);
  const freeTile = (doc: OfficeMapDoc, tx: number, ty: number): boolean => {
    if (doc.spots.some((s) => s.tx === tx && s.ty === ty)) return false;
    const a = ctx.scene.assembly();
    return a ? a.grid.walkable(tx, ty) : true;
  };
  return {
    cursor: 'crosshair',
    hover(p) {
      hover = p;
      ctx.redraw();
    },
    up(p, _s, dragged) {
      const m = mode();
      if (!m || dragged || ctx.readOnly()) return;
      const doc = ctx.doc();
      const existing = doc.spots.find((s) => s.tx === p.tx && s.ty === p.ty);
      if (existing) {
        ctx.select([{ t: 'spot', id: existing.id }]);
        return;
      }
      const alloc = ctx.store.allocIds(1, doc);
      const spots = spotsFor(m.kind, alloc.nums[0], p.tx, p.ty);
      if (!spots.every((s) => freeTile(doc, s.tx, s.ty))) {
        ctx.toast(t('editor.tool.spotsFreeTiles'), 'error');
        return;
      }
      const ops: EditOp[] = [alloc.op];
      let cur = apply(doc, alloc.op);
      for (const s of spots) {
        const o = addOp(cur, { doc: 'spots' }, s);
        ops.push(o);
        cur = apply(cur, o);
      }
      ctx.exec(batch('editor.op.spot', ops, { kind: m.kind }));
      ctx.select(spots.map((s) => ({ t: 'spot' as const, id: s.id })));
    },
    draw(g, scale) {
      const m = mode();
      if (!m || !hover) return;
      for (const s of spotsFor(m.kind, 0, hover.tx, hover.ty)) {
        const ok = freeTile(ctx.doc(), s.tx, s.ty);
        drawTileMarker(g, s.tx, s.ty, ok ? COLORS.cyan : COLORS.red, s.kind[0].toUpperCase(), scale, 0.6);
        drawDirArrow(g, s.tx, s.ty, s.dir, ok ? COLORS.cyan : COLORS.red, scale);
      }
    },
  };
}
