// Carimbos do editor (Ilha de mesas, Sala de reunião 4/8/12, Mesa de almoço, Cabine): os mesmos
// stamps de `shared/map/stamps.ts` que montam o mapa padrão, convertidos num único lote de operações
// (um desfazer desfaz o carimbo inteiro). Inclui a ferramenta com o ghost do conjunto.
import type { AreaHandle } from '../../../shared/map/doc-builder';
import { createDocBuilder } from '../../../shared/map/doc-builder';
import type { MapArea, MapFurniture, MapRug, MapWallItem, MapZone, OfficeMapDoc, TileRect } from '../../../shared/map/doc';
import { WALLS } from '../../../shared/map/palette';
import { stampIsland, stampLunchTable, stampMeetingRoom, stampPhoneBooth } from '../../../shared/map/stamps';
import { t, type MessageKey } from '../i18n';
import type { EditorCtx, PointerInfo, Tool } from './context';
import { COLORS, drawFurnitureGhost, fillTiles, strokeTiles } from './draw';
import { areaAt, areaRectProblem, intersects, placementProblem } from './geometry';
import { addOp, apply, batch, propOp, type EditOp } from './ops';
import type { StampSpec } from './state';
import type { Ref } from './types';

/** Carimbo do catálogo: `label`/`hint` são chaves de mensagem (traduza com `t()` na paleta). */
export interface StampDef {
  spec: StampSpec;
  label: MessageKey;
  hint: MessageKey;
}

export const STAMPS: readonly StampDef[] = [
  { spec: { kind: 'island', size: 1 }, label: 'editor.stamp.island2', hint: 'editor.stamp.island2Hint' },
  { spec: { kind: 'island', size: 2 }, label: 'editor.stamp.island4', hint: 'editor.stamp.island4Hint' },
  { spec: { kind: 'island', size: 3 }, label: 'editor.stamp.island6', hint: 'editor.stamp.island6Hint' },
  { spec: { kind: 'meeting', size: 4 }, label: 'editor.stamp.meeting4', hint: 'editor.stamp.meeting4Hint' },
  { spec: { kind: 'meeting', size: 8 }, label: 'editor.stamp.meeting8', hint: 'editor.stamp.meeting8Hint' },
  { spec: { kind: 'meeting', size: 12 }, label: 'editor.stamp.meeting12', hint: 'editor.stamp.meeting12Hint' },
  { spec: { kind: 'lunch', size: 12 }, label: 'editor.stamp.lunch', hint: 'editor.stamp.lunchHint' },
  { spec: { kind: 'booth', size: 1 }, label: 'editor.stamp.booth', hint: 'editor.stamp.boothHint' },
];

/** Nome traduzido do carimbo (o `kind` quando não está no catálogo). */
export function stampLabel(spec: StampSpec): string {
  const def = STAMPS.find((s) => s.spec.kind === spec.kind && s.spec.size === spec.size);
  return def ? t(def.label) : spec.kind;
}

/** Tamanho da sala de reunião carimbada. */
export const MEETING_ROOM_SIZE = { w: 16, h: 12 } as const;

export interface StampResult {
  op: EditOp | null;
  problem: string | null;
  /** O que selecionar depois de aplicar. */
  refs: Ref[];
  /** Para o ghost: móveis (tiles absolutos) e retângulos (área/zonas). */
  preview: { furniture: (MapFurniture & { x: number; y: number })[]; rects: TileRect[] };
}

/** Maior sufixo numérico de ids (o mesmo critério de `DocStore.allocIds`). */
function nextSeq(doc: OfficeMapDoc): number {
  let max = -1;
  const see = (id: string) => {
    const m = /(\d+)$/.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  };
  for (const a of doc.areas) {
    see(a.id);
    for (const x of [...a.furniture, ...a.wallItems, ...a.rugs]) see(x.id);
  }
  for (const z of doc.zones) see(z.id);
  for (const s of doc.spots) see(s.id);
  return Math.max(doc.seq, max + 1);
}

/** Handle que captura o que o stamp cria numa área existente (sem mexer no documento). */
function capture(area: MapArea, nextId: () => string) {
  const furniture: MapFurniture[] = [];
  const wallItems: MapWallItem[] = [];
  const rugs: MapRug[] = [];
  const handle: AreaHandle = {
    area,
    furn(kind, lx, ly, o = {}) {
      const id = nextId();
      furniture.push({ id, kind, lx, ly, ...o });
      return id;
    },
    wall(kind, lcx, o = {}) {
      const id = nextId();
      wallItems.push({ id, kind, lcx, on: 'face', ...o });
      return id;
    },
    door() {
      return handle;
    },
    rug(lx, ly, w, h, color) {
      const id = nextId();
      rugs.push({ id, lx, ly, w, h, color });
      return id;
    },
    block() {
      return handle;
    },
  };
  return { handle, furniture, wallItems, rugs };
}

const empty = (problem: string): StampResult => ({ op: null, problem, refs: [], preview: { furniture: [], rects: [] } });

function zoneProblem(doc: OfficeMapDoc, zones: readonly MapZone[]): string | null {
  for (const z of zones) {
    if (doc.zones.some((o) => o.id === z.id)) return t('editor.problem.zoneExists', { id: z.id });
    for (const o of doc.zones) for (const r of o.rects) for (const q of z.rects) if (intersects(r, q)) return t('editor.problem.overlapsZone', { name: o.name });
  }
  return null;
}

/**
 * Monta o carimbo com o canto superior esquerdo no tile absoluto (tx, ty). Devolve o lote (ids novos a
 * partir de `doc.seq`, que avança) ou o motivo de não caber.
 */
export function buildStamp(doc: OfficeMapDoc, spec: StampSpec, tx: number, ty: number, hidden?: ReadonlySet<string>): StampResult {
  const seq0 = nextSeq(doc);
  const b = createDocBuilder(doc.size, doc.name);
  b.doc.seq = seq0 + 1; // seq0 fica para o id da área/zona

  if (spec.kind === 'meeting') {
    const seats = (spec.size === 8 || spec.size === 12 ? spec.size : 4) as 4 | 8 | 12;
    const rect: TileRect = { x: tx, y: ty, w: MEETING_ROOM_SIZE.w, h: MEETING_ROOM_SIZE.h };
    const id = `sala-${seq0}`;
    const name = t('editor.new.room', { n: seq0 });
    stampMeetingRoom(b, id, name, undefined, rect, { seats, wall: WALLS.meeting, whiteboard: seats >= 8, tv: seats >= 12 });
    const area = b.doc.areas[0];
    const preview = {
      furniture: area.furniture.map((f) => ({ ...f, x: rect.x + f.lx, y: rect.y + f.ly })),
      rects: [rect, ...b.doc.zones.flatMap((z) => z.rects)],
    };
    const problem = areaRectProblem(doc, rect) ?? zoneProblem(doc, b.doc.zones);
    if (problem) return { op: null, problem, refs: [], preview };
    let cur = doc;
    const ops: EditOp[] = [];
    const push = (o: EditOp) => {
      ops.push(o);
      cur = apply(cur, o);
    };
    push(propOp(cur, 'seq', b.doc.seq));
    push(addOp(cur, { doc: 'areas' }, area));
    for (const z of b.doc.zones) push(addOp(cur, { doc: 'zones' }, z));
    return { op: batch('editor.op.stampMeeting', ops, { seats }), problem: null, refs: [{ t: 'area', id }], preview };
  }

  const area = areaAt(doc, tx, ty, hidden);
  if (!area) return empty(t('editor.problem.notInArea'));
  const lx = tx - area.rect.x;
  const ly = ty - area.rect.y;
  const cap = capture(area, () => `f${b.doc.seq++}`);
  let label: MessageKey;
  let labelParams: { n: number } | undefined;
  if (spec.kind === 'island') {
    const pairs = (spec.size === 1 || spec.size === 2 ? spec.size : 3) as 1 | 2 | 3;
    stampIsland(cap.handle, lx, ly, { pairs });
    label = 'editor.op.stampIsland';
    labelParams = { n: pairs * 2 };
  } else if (spec.kind === 'lunch') {
    stampLunchTable(b, cap.handle, lx, ly, { zone: { id: `almoco-${seq0}`, name: t('editor.new.lunchZone') } });
    label = 'editor.op.stampLunch';
  } else {
    stampPhoneBooth(b, cap.handle, lx, ly, { zone: { id: `cabine-${seq0}`, name: t('editor.new.booth', { n: seq0 }) } });
    label = 'editor.op.stampBooth';
  }
  const preview = {
    furniture: cap.furniture.map((f) => ({ ...f, x: area.rect.x + f.lx, y: area.rect.y + f.ly })),
    rects: b.doc.zones.flatMap((z) => z.rects),
  };
  for (let i = 0; i < cap.furniture.length; i++) {
    const f = cap.furniture[i];
    const p = placementProblem(area, f.kind, f.lx, f.ly, undefined, cap.furniture.slice(0, i));
    if (p) return { op: null, problem: p, refs: [], preview };
  }
  const zp = zoneProblem(doc, b.doc.zones);
  if (zp) return { op: null, problem: zp, refs: [], preview };

  let cur = doc;
  const ops: EditOp[] = [];
  const push = (o: EditOp) => {
    ops.push(o);
    cur = apply(cur, o);
  };
  push(propOp(cur, 'seq', b.doc.seq));
  for (const f of cap.furniture) push(addOp(cur, { area: area.id, list: 'furniture' }, f));
  for (const w of cap.wallItems) push(addOp(cur, { area: area.id, list: 'wallItems' }, w));
  for (const r of cap.rugs) push(addOp(cur, { area: area.id, list: 'rugs' }, r));
  for (const z of b.doc.zones) push(addOp(cur, { doc: 'zones' }, z));
  const refs: Ref[] = cap.furniture.map((f) => ({ t: 'furn', area: area.id, id: f.id }));
  return { op: batch(label, ops, labelParams), problem: null, refs, preview };
}

// ------------------------------------------------------------------ ferramenta

export function stampTool(ctx: EditorCtx): Tool {
  let hover: PointerInfo | null = null;
  let cache: { key: string; doc: OfficeMapDoc; r: StampResult } | null = null;
  const spec = (): StampSpec | null => (ctx.state.mode.k === 'stamp' ? ctx.state.mode.stamp : null);
  const at = (s: StampSpec, tx: number, ty: number): StampResult => {
    const key = `${s.kind}:${s.size}:${tx},${ty}`;
    const doc = ctx.doc();
    if (cache && cache.key === key && cache.doc === doc) return cache.r;
    const r = buildStamp(doc, s, tx, ty, ctx.state.hiddenAreas);
    cache = { key, doc, r };
    return r;
  };
  return {
    cursor: 'crosshair',
    hover(p) {
      hover = p;
      ctx.redraw();
    },
    up(p, _s, dragged) {
      const s = spec();
      if (!s || dragged || ctx.readOnly()) return;
      const r = at(s, p.tx, p.ty);
      if (!r.op) {
        ctx.toast(t('editor.tool.stampNoFit', { problem: r.problem ?? '' }), 'error');
        return;
      }
      ctx.exec(r.op);
      if (!p.shift && !ctx.state.shift) ctx.setMode({ k: 'select' });
      ctx.select(r.refs);
    },
    draw(g, scale) {
      const s = spec();
      if (!s || !hover) return;
      const r = at(s, hover.tx, hover.ty);
      const ok = !r.problem;
      for (const q of r.preview.rects) {
        fillTiles(g, q, ok ? 'rgba(255,216,0,0.08)' : 'rgba(227,11,47,0.15)');
        strokeTiles(g, q, ok ? COLORS.yellow : COLORS.red, scale, 1, [4, 3]);
      }
      for (const f of r.preview.furniture) drawFurnitureGhost(g, ctx.art, f.kind, f.variant, f.x, f.y, f.dx ?? 0, f.dy ?? 0, ok, scale);
      if (!r.preview.furniture.length && !r.preview.rects.length) strokeTiles(g, { x: hover.tx, y: hover.ty, w: 1, h: 1 }, COLORS.red, scale, 1);
    },
  };
}
