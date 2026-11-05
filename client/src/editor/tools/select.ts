// Ferramenta Selecionar: clique (Shift soma/remove), retângulo, arrastar para mover com encaixe,
// Del, R/Shift+R girar, C variante, Ctrl+C/X/V/D, setas empurram 1 tile.
import { TILE } from '../../../../shared/map/tile';
import { t, tn } from '../../i18n';
import { copySelection, cycleVariantOps, deleteOps, moveOps, pasteOps, rotateOps, type Clipboard } from '../actions';
import type { EditorCtx, PointerInfo, Tool } from '../context';
import { COLORS, strokePx, strokeTiles } from '../draw';
import { inRect, intersects, rectFromTiles, refBounds, snapQuarter } from '../geometry';
import { furnitureInRect } from '../hit';
import { hasRef, pruneRefs, refKey, type Ref } from '../types';

export interface SelectTool extends Tool {
  del(): void;
  rotate(reverse: boolean): void;
  cycle(step: number): void;
  copy(): boolean;
  cut(): void;
  paste(): void;
  duplicate(): void;
  nudge(dx: number, dy: number): void;
}

/** Área de transferência compartilhada (sobrevive a trocas de modo). */
let clipboard: Clipboard | null = null;

export function selectTool(ctx: EditorCtx): SelectTool {
  let pending: 'move' | 'rect' | null = null;
  let rect: { x: number; y: number; w: number; h: number } | null = null;
  let move: { dx: number; dy: number; fdx: number; fdy: number; ok: boolean } | null = null;

  const sel = () => ctx.state.selection;

  const applySel = (refs: Ref[]) => ctx.select(pruneRefs(ctx.doc(), refs));

  const tool: SelectTool = {
    cursor: 'default',
    down(p) {
      move = null;
      rect = null;
      const hit = ctx.hit(p.wx, p.wy);
      if (hit && hit.t !== 'area') {
        if (p.shift) {
          const k = refKey(hit);
          applySel(hasRef(sel(), hit) ? sel().filter((r) => refKey(r) !== k) : [...sel(), hit]);
          pending = null;
          return;
        }
        if (!hasRef(sel(), hit)) applySel([hit]);
        pending = ctx.readOnly() ? null : 'move';
        return;
      }
      // área: clique seleciona a área; arrastar a partir dela faz retângulo (mover área é na ferramenta Áreas)
      pending = 'rect';
    },
    drag(p, start) {
      if (pending === 'move') {
        const dx = p.tx - start.tx;
        const dy = p.ty - start.ty;
        const fdx = snapQuarter((p.wx - start.wx) / TILE);
        const fdy = snapQuarter((p.wy - start.wy) / TILE);
        const r = moveOps(ctx.store, ctx.doc(), sel(), dx, dy, fdx, fdy);
        move = { dx, dy, fdx, fdy, ok: !r.problem };
      } else if (pending === 'rect') {
        rect = rectFromTiles(start.tx, start.ty, p.tx, p.ty);
      }
      ctx.redraw();
    },
    up(p, start, dragged) {
      if (pending === 'move' && dragged && move) {
        const r = moveOps(ctx.store, ctx.doc(), sel(), move.dx, move.dy, move.fdx, move.fdy);
        if (r.problem) ctx.toast(t('editor.tool.cannotMove', { problem: r.problem }), 'error');
        else if (r.op) {
          const before = sel();
          ctx.exec(r.op);
          // móveis que trocaram de área ganham nova referência: re-seleciona pelo tile
          const kept = pruneRefs(ctx.doc(), before);
          applySel(kept.length ? kept : before);
        }
      } else if (pending === 'rect' && dragged && rect) {
        applySel(p.shift ? mergeRefs(sel(), refsInRect(ctx, rect)) : refsInRect(ctx, rect));
      } else if (!dragged && pending === 'rect' && !p.shift) {
        const hit = ctx.hit(start.wx, start.wy);
        applySel(hit ? [hit] : []);
      }
      pending = null;
      rect = null;
      move = null;
      ctx.redraw();
    },
    cancel() {
      pending = null;
      rect = null;
      move = null;
    },
    draw(g, scale) {
      if (rect) {
        g.fillStyle = 'rgba(255,216,0,0.08)';
        g.fillRect(rect.x * TILE, rect.y * TILE, rect.w * TILE, rect.h * TILE);
        strokeTiles(g, rect, COLORS.yellow, scale, 1, [4, 3]);
      }
      if (move) {
        const color = move.ok ? COLORS.yellow : COLORS.red;
        for (const r of sel()) {
          const b = refBounds(ctx.doc(), r);
          if (!b) continue;
          const frac = r.t === 'rug' || r.t === 'wall';
          const ox = frac ? move.fdx : move.dx;
          const oy = r.t === 'wall' ? 0 : frac ? move.fdy : move.dy;
          strokePx(g, (b.x + ox) * TILE, (b.y + oy) * TILE, b.w * TILE, b.h * TILE, color, scale, 1.5, [4, 3]);
        }
      }
    },
    del() {
      if (ctx.readOnly() || !sel().length) return;
      ctx.exec(deleteOps(ctx.doc(), sel()));
      applySel([]);
    },
    rotate(reverse) {
      if (ctx.readOnly() || !sel().length) return;
      ctx.exec(rotateOps(ctx.doc(), sel(), reverse));
    },
    cycle(step) {
      if (ctx.readOnly() || !sel().length) return;
      ctx.exec(cycleVariantOps(ctx.doc(), sel(), step));
    },
    copy() {
      const c = copySelection(ctx.doc(), sel());
      if (!c) return false;
      clipboard = c;
      ctx.toast(tn('editor.tool.copied', c.items.length), 'info');
      return true;
    },
    cut() {
      if (ctx.readOnly()) return;
      if (tool.copy()) tool.del();
    },
    paste() {
      if (ctx.readOnly() || !clipboard) return;
      const h = ctx.hover;
      const at = h ? { x: h.tx, y: h.ty } : (() => {
        const b = sel().map((r) => refBounds(ctx.doc(), r)).find(Boolean);
        return b ? { x: Math.floor(b.x) + 1, y: Math.floor(b.y) + 1 } : null;
      })();
      if (!at) return;
      pasteAt(at.x, at.y);
    },
    duplicate() {
      if (ctx.readOnly()) return;
      const c = copySelection(ctx.doc(), sel());
      if (!c) return;
      const bounds = sel().map((r) => refBounds(ctx.doc(), r)).filter((b): b is NonNullable<typeof b> => !!b);
      const x0 = Math.floor(Math.min(...bounds.map((b) => b.x)));
      const y0 = Math.floor(Math.min(...bounds.map((b) => b.y)));
      for (const [ox, oy] of [
        [c.w, 0],
        [0, c.h],
        [1, 1],
      ]) {
        const r = pasteOps(ctx.store, ctx.doc(), c, x0 + ox, y0 + oy);
        if (r.op) {
          ctx.exec(r.op);
          applySel(r.refs);
          return;
        }
      }
      ctx.toast(t('editor.tool.noRoomDuplicate'), 'error');
    },
    nudge(dx, dy) {
      if (ctx.readOnly() || !sel().length) return;
      const r = moveOps(ctx.store, ctx.doc(), sel(), dx, dy);
      if (r.problem) ctx.toast(t('editor.tool.cannotMove', { problem: r.problem }), 'error');
      else if (r.op) ctx.exec(r.op);
    },
  };

  function pasteAt(x: number, y: number): void {
    if (!clipboard) return;
    const r = pasteOps(ctx.store, ctx.doc(), clipboard, x, y);
    if (r.problem || !r.op) {
      ctx.toast(t('editor.tool.cannotPaste', { problem: r.problem ?? t('editor.problem.invalidPosition') }), 'error');
      return;
    }
    ctx.exec(r.op);
    applySel(r.refs);
  }

  return tool;
}

function mergeRefs(a: readonly Ref[], b: readonly Ref[]): Ref[] {
  const out = [...a];
  for (const r of b) if (!hasRef(out, r)) out.push(r);
  return out;
}

/** Móveis, tapetes, spots e pontos de entrada dentro do retângulo de tiles. */
export function refsInRect(ctx: EditorCtx, r: { x: number; y: number; w: number; h: number }): Ref[] {
  const doc = ctx.doc();
  const hidden = ctx.state.hiddenAreas;
  const out: Ref[] = furnitureInRect(ctx.scene.index, r).map((f) => ({ t: 'furn', area: f.area, id: f.id }));
  for (const a of doc.areas) {
    if (hidden.has(a.id)) continue;
    for (const rug of a.rugs) {
      const b = { x: Math.floor(a.rect.x + rug.lx), y: Math.floor(a.rect.y + rug.ly), w: Math.ceil(rug.w), h: Math.ceil(rug.h) };
      if (intersects(b, r)) out.push({ t: 'rug', area: a.id, id: rug.id });
    }
  }
  for (const s of doc.spots) if (inRect(r, s.tx, s.ty)) out.push({ t: 'spot', id: s.id });
  doc.spawn.forEach((s, i) => {
    if (inRect(r, s.x, s.y)) out.push({ t: 'spawn', i });
  });
  return out;
}

export type { PointerInfo };
