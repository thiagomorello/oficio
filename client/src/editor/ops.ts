// Operações de edição do documento do mapa (undo/redo). Puras e sem DOM.
//
// `apply(doc, op)` devolve um NOVO documento por cópia-na-escrita: só os arrays/objetos tocados são
// copiados; o resto é compartilhado. Assim (1) `assembleOffice` (memoizado pela identidade do doc)
// remonta, (2) a cena do editor reconstrói só as áreas cujo objeto mudou e (3) os itens guardados nas
// operações nunca são mutados depois. `invert(op)` é a operação que desfaz `op`.
import type { MapArea, MapFloor, OfficeMapDoc } from '../../../shared/map/doc';
import { t, type MessageKey } from '../i18n';
import type { Params } from '../../../shared/i18n';

/** Listas do documento (nível raiz). */
export type DocColl = 'areas' | 'zones' | 'spots' | 'spawn';
/** Listas de dentro de uma área. */
export type AreaColl = 'furniture' | 'wallItems' | 'rugs' | 'doorways';
export type Coll = { doc: DocColl } | { area: string; list: AreaColl };
/** Campos simples do documento. */
export type DocKey = 'name' | 'size' | 'seq' | 'deskLabels';

export type EditOp =
  | { t: 'add'; at: Coll; index: number; item: unknown }
  | { t: 'remove'; at: Coll; index: number; item: unknown }
  /** Troca o item `index` da lista (`at`) ou o campo `key` do documento. */
  | { t: 'update'; at: Coll; index: number; before: unknown; after: unknown }
  | { t: 'update'; key: DocKey; before: unknown; after: unknown }
  | { t: 'setFloors'; area: string; before: MapFloor[]; after: MapFloor[] }
  /** Lote: `label` é uma chave de mensagem (`editor.op.*`) e `labelParams` os parâmetros dela. */
  | { t: 'batch'; label: MessageKey; labelParams?: Params; ops: EditOp[] };

export type FloorStyle = Omit<MapFloor, 'lx' | 'ly' | 'w' | 'h'>;

export class OpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpError';
  }
}

function areaIndex(doc: OfficeMapDoc, id: string): number {
  const i = doc.areas.findIndex((a) => a.id === id);
  if (i < 0) throw new OpError(t('editor.opError.areaMissing', { id }));
  return i;
}

/** Lista apontada por `at` (somente leitura). */
export function listOf(doc: OfficeMapDoc, at: Coll): readonly unknown[] {
  if ('doc' in at) return doc[at.doc];
  return doc.areas[areaIndex(doc, at.area)][at.list];
}

function withArea(doc: OfficeMapDoc, id: string, fn: (a: MapArea) => MapArea): OfficeMapDoc {
  const i = areaIndex(doc, id);
  const areas = doc.areas.slice();
  areas[i] = fn(areas[i]);
  return { ...doc, areas };
}

function withList(doc: OfficeMapDoc, at: Coll, fn: (list: unknown[]) => void): OfficeMapDoc {
  if ('doc' in at) {
    const list = (doc[at.doc] as unknown[]).slice();
    fn(list);
    return { ...doc, [at.doc]: list };
  }
  return withArea(doc, at.area, (a) => {
    const list = (a[at.list] as unknown[]).slice();
    fn(list);
    return { ...a, [at.list]: list };
  });
}

function checkIndex(list: readonly unknown[], index: number, add: boolean): void {
  const max = add ? list.length : list.length - 1;
  if (!Number.isInteger(index) || index < 0 || index > max) throw new OpError(t('editor.opError.indexOutOfRange', { index, length: list.length }));
}

/** Aplica a operação e devolve o novo documento (o original não é alterado). */
export function apply(doc: OfficeMapDoc, op: EditOp): OfficeMapDoc {
  switch (op.t) {
    case 'add':
      return withList(doc, op.at, (l) => {
        checkIndex(l, op.index, true);
        l.splice(op.index, 0, op.item);
      });
    case 'remove':
      return withList(doc, op.at, (l) => {
        checkIndex(l, op.index, false);
        l.splice(op.index, 1);
      });
    case 'update':
      if ('key' in op) {
        const next = { ...doc } as Record<string, unknown>;
        if (op.after === undefined) delete next[op.key];
        else next[op.key] = op.after;
        return next as unknown as OfficeMapDoc;
      }
      return withList(doc, op.at, (l) => {
        checkIndex(l, op.index, false);
        l[op.index] = op.after;
      });
    case 'setFloors':
      return withArea(doc, op.area, (a) => ({ ...a, floors: op.after.slice() }));
    case 'batch':
      return op.ops.reduce(apply, doc);
  }
}

/** Operação inversa. */
export function invert(op: EditOp): EditOp {
  switch (op.t) {
    case 'add':
      return { t: 'remove', at: op.at, index: op.index, item: op.item };
    case 'remove':
      return { t: 'add', at: op.at, index: op.index, item: op.item };
    case 'update':
      return 'key' in op ? { t: 'update', key: op.key, before: op.after, after: op.before } : { t: 'update', at: op.at, index: op.index, before: op.after, after: op.before };
    case 'setFloors':
      return { t: 'setFloors', area: op.area, before: op.after, after: op.before };
    case 'batch':
      return { t: 'batch', label: op.label, ...(op.labelParams ? { labelParams: op.labelParams } : {}), ops: op.ops.map(invert).reverse() };
  }
}

/** Operação sem efeito (lote vazio)? */
export function isNoop(op: EditOp): boolean {
  return op.t === 'batch' && op.ops.every(isNoop);
}

/** Lote com os lotes aninhados achatados (descarta nulos). `label` = chave `editor.op.*` (+ parâmetros). */
export function batch(label: MessageKey, ops: readonly (EditOp | null | undefined | false)[], labelParams?: Params): Extract<EditOp, { t: 'batch' }> {
  const out: EditOp[] = [];
  for (const o of ops) {
    if (!o) continue;
    if (o.t === 'batch') out.push(...batch(o.label, o.ops).ops);
    else out.push(o);
  }
  return { t: 'batch', label, ...(labelParams ? { labelParams } : {}), ops: out };
}

/** Rótulo legível de uma operação (para o histórico/avisos), no idioma atual. */
export function opLabel(op: EditOp): string {
  if (op.t === 'batch') return t(op.label, op.labelParams);
  if (op.t === 'setFloors') return t('editor.op.paintFloor');
  if (op.t === 'add') return t('editor.op.add');
  if (op.t === 'remove') return t('editor.op.remove');
  return t('editor.op.change');
}

// ------------------------------------------------------------------ helpers para construir operações

/** Adiciona `item` ao fim da lista. */
export function addOp(doc: OfficeMapDoc, at: Coll, item: unknown): EditOp {
  return { t: 'add', at, index: listOf(doc, at).length, item };
}

/** Remove o item `index`. */
export function removeOp(doc: OfficeMapDoc, at: Coll, index: number): EditOp {
  return { t: 'remove', at, index, item: listOf(doc, at)[index] };
}

/** Troca o item `index` por `after`. */
export function updateOp(doc: OfficeMapDoc, at: Coll, index: number, after: unknown): EditOp {
  return { t: 'update', at, index, before: listOf(doc, at)[index], after };
}

/** Troca um campo simples do documento. */
export function propOp<K extends DocKey>(doc: OfficeMapDoc, key: K, after: OfficeMapDoc[K]): EditOp {
  return { t: 'update', key, before: doc[key], after };
}

/**
 * Remoções de vários itens de uma lista (índices em ordem decrescente, para que uma remoção não
 * desloque as seguintes).
 */
export function removeManyOps(doc: OfficeMapDoc, at: Coll, indexes: Iterable<number>): EditOp[] {
  const list = listOf(doc, at);
  return [...new Set(indexes)].sort((a, b) => b - a).map((i) => ({ t: 'remove' as const, at, index: i, item: list[i] }));
}

/**
 * Aplica as operações em sequência sobre `doc`, montando cada uma contra o documento já alterado pelas
 * anteriores (`build` recebe o doc corrente). Devolve o lote e o documento final.
 */
export function chain(doc: OfficeMapDoc, label: MessageKey, steps: readonly ((d: OfficeMapDoc) => EditOp | null | undefined)[], labelParams?: Params): { op: Extract<EditOp, { t: 'batch' }>; doc: OfficeMapDoc } {
  const ops: EditOp[] = [];
  let cur = doc;
  for (const s of steps) {
    const o = s(cur);
    if (!o) continue;
    cur = apply(cur, o);
    ops.push(o);
  }
  return { op: batch(label, ops, labelParams), doc: cur };
}

// ------------------------------------------------------------------ pisos

function floorKey(f: MapFloor): string {
  return JSON.stringify([f.kind, f.tint ?? null, f.tint2 ?? null, f.tintK ?? null, f.seed ?? null]);
}

/** Só o estilo do piso (sem o retângulo), com as chaves sempre na mesma ordem. */
export function floorStyle(f: FloorStyle): FloorStyle {
  const s: FloorStyle = { kind: f.kind };
  if (f.tint !== undefined) s.tint = f.tint;
  if (f.tint2 !== undefined) s.tint2 = f.tint2;
  if (f.tintK !== undefined) s.tintK = f.tintK;
  if (f.seed !== undefined) s.seed = f.seed;
  return s;
}

/**
 * Normaliza os pisos de uma área `w × h` (coordenadas locais): pinta-os em ordem ("o último vence"),
 * recorta na área e devolve retângulos mínimos — sequências por linha fundidas verticalmente quando
 * têm o mesmo x, largura e estilo. Determinístico (ordenado por linha, depois coluna) e idempotente.
 */
export function normalizeFloors(floors: readonly MapFloor[], w: number, h: number): MapFloor[] {
  if (w <= 0 || h <= 0) return [];
  const styles: FloorStyle[] = [];
  const keyIndex = new Map<string, number>();
  const cells = new Int32Array(w * h).fill(-1);
  for (const f of floors) {
    const k = floorKey(f);
    let ki = keyIndex.get(k);
    if (ki === undefined) {
      ki = styles.length;
      styles.push(floorStyle(f));
      keyIndex.set(k, ki);
    }
    for (let y = Math.max(0, f.ly); y < Math.min(h, f.ly + f.h); y++) for (let x = Math.max(0, f.lx); x < Math.min(w, f.lx + f.w); x++) cells[y * w + x] = ki;
  }
  const out: { style: number; lx: number; ly: number; w: number; h: number }[] = [];
  /** Retângulos que ainda podem crescer para baixo, por "x,w,estilo". */
  let open = new Map<string, (typeof out)[number]>();
  for (let y = 0; y < h; y++) {
    const next = new Map<string, (typeof out)[number]>();
    let x = 0;
    while (x < w) {
      const k = cells[y * w + x];
      let x1 = x + 1;
      while (x1 < w && cells[y * w + x1] === k) x1++;
      if (k >= 0) {
        const id = `${x},${x1 - x},${k}`;
        const prev = open.get(id);
        if (prev) {
          prev.h++;
          next.set(id, prev);
        } else {
          const r = { style: k, lx: x, ly: y, w: x1 - x, h: 1 };
          out.push(r);
          next.set(id, r);
        }
      }
      x = x1;
    }
    open = next;
  }
  out.sort((a, b) => a.ly - b.ly || a.lx - b.lx);
  return out.map((r) => ({ ...floorStyle(styles[r.style]), lx: r.lx, ly: r.ly, w: r.w, h: r.h }));
}

/** Pisos de uma área depois de pintar (ou apagar, com `style = null`) retângulos locais. */
export function paintFloors(area: MapArea, rects: readonly { x: number; y: number; w: number; h: number }[], style: FloorStyle | null): MapFloor[] {
  const { w, h } = area.rect;
  if (style) return normalizeFloors([...area.floors, ...rects.map((r) => ({ ...floorStyle(style), lx: r.x, ly: r.y, w: r.w, h: r.h }))], w, h);
  const mask = new Uint8Array(w * h);
  for (const r of rects) for (let y = Math.max(0, r.y); y < Math.min(h, r.y + r.h); y++) for (let x = Math.max(0, r.x); x < Math.min(w, r.x + r.w); x++) mask[y * w + x] = 1;
  const cells: MapFloor[] = [];
  for (const f of normalizeFloors(area.floors, w, h)) {
    for (let y = f.ly; y < f.ly + f.h; y++) for (let x = f.lx; x < f.lx + f.w; x++) if (!mask[y * w + x]) cells.push({ ...floorStyle(f), lx: x, ly: y, w: 1, h: 1 });
  }
  return normalizeFloors(cells, w, h);
}

/** Lista de pisos igual (mesmo JSON)? */
export function sameFloors(a: readonly MapFloor[], b: readonly MapFloor[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
