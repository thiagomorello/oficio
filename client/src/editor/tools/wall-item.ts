// Ferramenta Item de parede: ghost sobre a face norte (2 linhas) ou a mureta sul, encaixe de 0,25 tile
// no centro; clique pendura. Placa (`sign`) já entra com o nome da área e o campo de texto em foco.
import type { MapWallItem } from '../../../../shared/map/doc';
import { TILE } from '../../../../shared/map/tile';
import { t } from '../../i18n';
import type { EditorCtx, PointerInfo, Tool } from '../context';
import { drawWallGhost } from '../draw';
import { clampWallCenter, cycleVariant, wallAt, wallItemProblem, type WallHit } from '../geometry';
import { addOp, apply, batch } from '../ops';
import type { Mode } from '../state';

type WallMode = Extract<Mode, { k: 'wallItem' }>;

export interface WallPlacement {
  hit: WallHit;
  lcx: number;
  problem: string | null;
}

export function wallPlacementAt(ctx: EditorCtx, m: WallMode, wx: number, wy: number): WallPlacement | null {
  const hit = wallAt(ctx.doc(), wx, wy, ctx.state.hiddenAreas);
  if (!hit) return null;
  const lcx = clampWallCenter(hit.area, m.kind, hit.lx);
  return { hit, lcx, problem: wallItemProblem(hit.area, m.kind, lcx, hit.on) };
}

export function wallItemTool(ctx: EditorCtx): Tool {
  let hover: PointerInfo | null = null;
  const mode = (): WallMode | null => (ctx.state.mode.k === 'wallItem' ? ctx.state.mode : null);
  return {
    cursor: 'crosshair',
    hover(p) {
      hover = p;
      ctx.redraw();
    },
    up(p, _s, dragged) {
      const m = mode();
      if (!m || dragged || ctx.readOnly()) return;
      const pl = wallPlacementAt(ctx, m, p.wx, p.wy);
      if (!pl || pl.problem) {
        ctx.toast(t('editor.tool.cannotHang', { problem: pl?.problem ?? t('editor.problem.pointAtWall') }), 'error');
        return;
      }
      const doc = ctx.doc();
      const alloc = ctx.store.allocIds(1, doc);
      const item: MapWallItem = { id: `f${alloc.nums[0]}`, kind: m.kind, lcx: pl.lcx, on: pl.hit.on };
      if (m.variant) item.variant = m.variant;
      if (m.kind === 'sign') item.label = pl.hit.area.name.slice(0, 48);
      ctx.exec(batch('editor.op.hang', [alloc.op, addOp(apply(doc, alloc.op), { area: pl.hit.area.id, list: 'wallItems' }, item)], { kind: m.kind }));
      if (m.kind === 'sign' || (!p.shift && !ctx.state.shift)) {
        ctx.setMode({ k: 'select' });
        ctx.select([{ t: 'wall', area: pl.hit.area.id, id: item.id }]);
        if (m.kind === 'sign') ctx.focusProp('label');
      }
    },
    key(e) {
      const m = mode();
      if (!m || e.ctrlKey || e.metaKey || e.key.toLowerCase() !== 'c') return false;
      const v = cycleVariant(m.kind, m.variant, e.shiftKey ? -1 : 1);
      if (v !== undefined) ctx.setMode({ ...m, variant: v });
      return true;
    },
    draw(g, scale) {
      const m = mode();
      if (!m || !hover) return;
      const pl = wallPlacementAt(ctx, m, hover.wx, hover.wy);
      if (!pl) return;
      const a = pl.hit.area;
      const baseY = pl.hit.on === 'face' ? (a.rect.y + 2) * TILE : (a.rect.y + a.rect.h) * TILE;
      drawWallGhost(g, ctx.art, m.kind, m.variant, (a.rect.x + pl.lcx) * TILE, baseY, pl.hit.on, !pl.problem, scale);
    },
  };
}
