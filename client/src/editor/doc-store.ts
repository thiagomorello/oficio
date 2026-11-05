// Documento em edição: aplica operações, desfaz/refaz (até 200), marca sujo e gera ids. Sem DOM.
import type { OfficeMapDoc } from '../../../shared/map/doc';
import { apply, invert, isNoop, propOp, type EditOp } from './ops';

export const UNDO_LIMIT = 200;

export type StoreEvent = { kind: 'load' } | { kind: 'exec' | 'undo' | 'redo'; op: EditOp };
export type StoreListener = (doc: OfficeMapDoc, ev: StoreEvent) => void;

/** Maior sufixo numérico de qualquer id do documento (para nunca reusar ids). */
function maxIdNumber(doc: OfficeMapDoc): number {
  let max = -1;
  const see = (id: string) => {
    const m = /(\d+)$/.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  };
  for (const a of doc.areas) {
    see(a.id);
    for (const f of a.furniture) see(f.id);
    for (const w of a.wallItems) see(w.id);
    for (const r of a.rugs) see(r.id);
  }
  for (const z of doc.zones) see(z.id);
  for (const s of doc.spots) see(s.id);
  return max;
}

export class DocStore {
  private current: OfficeMapDoc;
  private undoStack: EditOp[] = [];
  private redoStack: EditOp[] = [];
  private listeners = new Set<StoreListener>();
  /** Revisão do conteúdo (muda a cada alteração). */
  rev = 0;
  /** Revisão gravada no servidor. */
  savedRev = 0;

  constructor(
    doc: OfficeMapDoc,
    readonly limit = UNDO_LIMIT,
  ) {
    this.current = doc;
  }

  get doc(): OfficeMapDoc {
    return this.current;
  }

  get dirty(): boolean {
    return this.rev !== this.savedRev;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoSize(): number {
    return this.undoStack.length;
  }

  get redoSize(): number {
    return this.redoStack.length;
  }

  /** Rótulo da próxima operação a desfazer/refazer. */
  peek(which: 'undo' | 'redo'): EditOp | undefined {
    const s = which === 'undo' ? this.undoStack : this.redoStack;
    return s[s.length - 1];
  }

  subscribe(fn: StoreListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(ev: StoreEvent): void {
    for (const fn of [...this.listeners]) fn(this.current, ev);
  }

  /** Troca o documento inteiro (carregar/recarregar): zera o histórico e marca como salvo. */
  load(doc: OfficeMapDoc): void {
    this.current = doc;
    this.undoStack = [];
    this.redoStack = [];
    this.rev++;
    this.savedRev = this.rev;
    this.emit({ kind: 'load' });
  }

  /** Aplica uma operação (lança `OpError` se ela não se aplica; nada muda nesse caso). */
  exec(op: EditOp): boolean {
    if (isNoop(op)) return false;
    this.current = apply(this.current, op);
    this.undoStack.push(op);
    if (this.undoStack.length > this.limit) this.undoStack.splice(0, this.undoStack.length - this.limit);
    this.redoStack = [];
    this.rev++;
    this.emit({ kind: 'exec', op });
    return true;
  }

  undo(): boolean {
    const op = this.undoStack.pop();
    if (!op) return false;
    this.current = apply(this.current, invert(op));
    this.redoStack.push(op);
    this.rev++;
    this.emit({ kind: 'undo', op });
    return true;
  }

  redo(): boolean {
    const op = this.redoStack.pop();
    if (!op) return false;
    this.current = apply(this.current, op);
    this.undoStack.push(op);
    this.rev++;
    this.emit({ kind: 'redo', op });
    return true;
  }

  /** O servidor gravou o conteúdo da revisão `rev`. */
  markSaved(rev: number): void {
    this.savedRev = rev;
  }

  /**
   * Reserva `n` números de id a partir de `doc.seq` (nunca abaixo de ids já usados). Devolve os números
   * e a operação que avança `seq` — inclua-a no mesmo lote que cria os itens.
   */
  allocIds(n: number, doc: OfficeMapDoc = this.current): { nums: number[]; op: EditOp } {
    const start = Math.max(doc.seq, maxIdNumber(doc) + 1);
    const nums = Array.from({ length: n }, (_, i) => start + i);
    return { nums, op: propOp(doc, 'seq', start + n) };
  }
}
