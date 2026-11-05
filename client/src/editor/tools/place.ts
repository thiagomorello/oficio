// Ferramenta Colocar móvel: ghost com encaixe no tile sob o cursor (vermelho se inválido); clique
// coloca. Sem Shift volta para Selecionar com o móvel novo selecionado; com Shift continua colocando.
// R gira o ghost, C troca a variante.
import type { MapArea, MapFurniture } from '../../../../shared/map/doc';
import { FURNITURE, type FurnitureKind } from '../../../../shared/map/furniture';
import { t } from '../../i18n';
import type { EditorCtx, PointerInfo, Tool } from '../context';
import { drawFurnitureGhost } from '../draw';
import { areaAt, cycleVariant, placementProblem, rotateFurniture } from '../geometry';
import { addOp, apply, batch } from '../ops';
import type { Mode } from '../state';

type PlaceMode = Extract<Mode, { k: 'place' }>;

/** Canto (tiles absolutos) para o móvel ficar "sob" o cursor. */
export function anchorFor(kind: FurnitureKind, tx: number, ty: number): { x: number; y: number } {
  const { w, h } = FURNITURE[kind].footprint;
  return { x: tx - Math.floor((w - 1) / 2), y: ty - Math.floor((h - 1) / 2) };
}

/** Deslocamento automático de cadeira de escritório centrada numa mesa de 2 tiles. */
export function autoChairDx(area: MapArea, kind: FurnitureKind, lx: number, ly: number): number | undefined {
  const deskKind = kind === 'office_chair' ? 'desk' : kind === 'office_chair_front' ? 'desk_back' : null;
  if (!deskKind) return undefined;
  const dy = kind === 'office_chair' ? -1 : 1;
  for (const f of area.furniture) {
    if (f.kind !== deskKind || f.ly !== ly + dy) continue;
    if (f.lx === lx) return 8;
    if (f.lx === lx - 1) return -8;
  }
  return undefined;
}

export interface Placement {
  area: MapArea | undefined;
  lx: number;
  ly: number;
  x: number;
  y: number;
  dx?: number;
  problem: string | null;
}

export function placementAt(ctx: EditorCtx, kind: FurnitureKind, tx: number, ty: number): Placement {
  const { x, y } = anchorFor(kind, tx, ty);
  const area = areaAt(ctx.doc(), x, y, ctx.state.hiddenAreas);
  if (!area) return { area, lx: 0, ly: 0, x, y, problem: t('editor.problem.notInArea') };
  const lx = x - area.rect.x;
  const ly = y - area.rect.y;
  return { area, lx, ly, x, y, dx: autoChairDx(area, kind, lx, ly), problem: placementProblem(area, kind, lx, ly) };
}

export function placeTool(ctx: EditorCtx): Tool {
  let hover: PointerInfo | null = null;
  const mode = (): PlaceMode | null => (ctx.state.mode.k === 'place' ? ctx.state.mode : null);

  return {
    cursor: 'crosshair',
    hover(p) {
      hover = p;
      ctx.redraw();
    },
    up(p, _start, dragged) {
      const m = mode();
      if (!m || dragged || ctx.readOnly()) return;
      const pl = placementAt(ctx, m.kind, p.tx, p.ty);
      if (pl.problem || !pl.area) {
        ctx.toast(t('editor.tool.cannotPlace', { problem: pl.problem ?? '' }), 'error');
        return;
      }
      const doc = ctx.doc();
      const alloc = ctx.store.allocIds(1, doc);
      const id = `f${alloc.nums[0]}`;
      const item: MapFurniture = { id, kind: m.kind, lx: pl.lx, ly: pl.ly };
      if (m.variant) item.variant = m.variant;
      if (pl.dx) item.dx = pl.dx;
      const add = addOp(apply(doc, alloc.op), { area: pl.area.id, list: 'furniture' }, item);
      ctx.exec(batch('editor.op.place', [alloc.op, add], { kind: m.kind }));
      if (!p.shift && !ctx.state.shift) {
        ctx.setMode({ k: 'select' });
        ctx.select([{ t: 'furn', area: pl.area.id, id }]);
      }
    },
    key(e) {
      const m = mode();
      if (!m || e.ctrlKey || e.metaKey) return false;
      const k = e.key.toLowerCase();
      if (k === 'r') {
        const r = rotateFurniture({ id: 'ghost', kind: m.kind, variant: m.variant, lx: 0, ly: 0 }, e.shiftKey);
        if (r) ctx.setMode({ k: 'place', kind: r.kind, variant: r.variant });
        return true;
      }
      if (k === 'c') {
        const v = cycleVariant(m.kind, m.variant, e.shiftKey ? -1 : 1);
        if (v !== undefined) ctx.setMode({ k: 'place', kind: m.kind, variant: v });
        return true;
      }
      return false;
    },
    draw(g, scale) {
      const m = mode();
      if (!m || !hover) return;
      const pl = placementAt(ctx, m.kind, hover.tx, hover.ty);
      drawFurnitureGhost(g, ctx.art, m.kind, m.variant, pl.x, pl.y, pl.dx ?? 0, 0, !pl.problem, scale);
    },
  };
}
