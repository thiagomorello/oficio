// Ferramenta Zonas: clique escolhe a zona sob o cursor; arrastar cria uma zona nova (sem zona ativa)
// ou soma um retângulo à zona ativa; com Alt, subtrai. As propriedades ficam no painel.
import type { MapZone, OfficeMapDoc, TileRect } from '../../../../shared/map/doc';
import { t } from '../../i18n';
import type { EditorCtx, Tool } from '../context';
import { COLORS, fillTiles, strokeTiles } from '../draw';
import { contains, inRect, rectFromTiles, subtractRect } from '../geometry';
import { addOp, apply, batch, updateOp } from '../ops';

export function zoneAtTile(doc: OfficeMapDoc, tx: number, ty: number): MapZone | undefined {
  for (let i = doc.zones.length - 1; i >= 0; i--) if (doc.zones[i].rects.some((r) => inRect(r, tx, ty))) return doc.zones[i];
  return undefined;
}

/** Retângulos da zona depois de somar (ou subtrair) `r`. */
export function zoneRectsWith(rects: readonly TileRect[], r: TileRect, subtract: boolean): TileRect[] {
  if (subtract) return rects.flatMap((q) => subtractRect(q, r));
  return [...rects.filter((q) => !contains(r, q)), { ...r }];
}

export function zoneTool(ctx: EditorCtx): Tool {
  let rect: TileRect | null = null;
  let sub = false;
  const activeId = () => (ctx.state.mode.k === 'zone' ? ctx.state.mode.id : null);

  return {
    cursor: 'crosshair',
    down(p) {
      rect = null;
      sub = p.alt;
    },
    drag(p, start) {
      if (ctx.readOnly()) return;
      rect = rectFromTiles(start.tx, start.ty, p.tx, p.ty);
      sub = p.alt;
      ctx.redraw();
    },
    up(p, _s, dragged) {
      const r = rect;
      rect = null;
      ctx.redraw();
      const doc = ctx.doc();
      if (!dragged || !r) {
        const z = zoneAtTile(doc, p.tx, p.ty);
        ctx.setMode({ k: 'zone', id: z?.id ?? null });
        ctx.select(z ? [{ t: 'zone', id: z.id }] : []);
        return;
      }
      const id = activeId();
      const index = id ? doc.zones.findIndex((z) => z.id === id) : -1;
      if (index >= 0) {
        const z = doc.zones[index];
        ctx.exec(batch(sub ? 'editor.op.zoneSubtract' : 'editor.op.zoneAdd', [updateOp(doc, { doc: 'zones' }, index, { ...z, rects: zoneRectsWith(z.rects, r, sub) })]));
        return;
      }
      if (sub) return;
      const alloc = ctx.store.allocIds(1, doc);
      const nid = `zona-${alloc.nums[0]}`;
      const zone: MapZone = { id: nid, name: t('editor.new.zone', { n: doc.zones.length + 1 }), kind: 'open', rects: [r], private: false, lockable: false };
      ctx.exec(batch('editor.op.newZone', [alloc.op, addOp(apply(doc, alloc.op), { doc: 'zones' }, zone)]));
      ctx.setMode({ k: 'zone', id: nid });
      ctx.select([{ t: 'zone', id: nid }]);
      ctx.focusProp('name');
    },
    cancel() {
      rect = null;
    },
    draw(g, scale) {
      const id = activeId();
      const z = id ? ctx.doc().zones.find((x) => x.id === id) : undefined;
      if (z) for (const r of z.rects) strokeTiles(g, r, COLORS.yellow, scale, 2);
      if (rect) {
        fillTiles(g, rect, sub ? 'rgba(227,11,47,0.25)' : 'rgba(255,216,0,0.15)');
        strokeTiles(g, rect, sub ? COLORS.red : COLORS.yellow, scale, 1.5, [4, 3]);
      }
    },
  };
}
