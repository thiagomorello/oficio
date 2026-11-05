import { describe, expect, it } from 'vitest';
import { buildDefaultMap } from '../../../shared/map/default-map';
import { DocStore, UNDO_LIMIT } from './doc-store';
import { batch, propOp } from './ops';

const rename = (s: DocStore, name: string) => s.exec(propOp(s.doc, 'name', name));

describe('DocStore', () => {
  it('desfaz e refaz na ordem certa', () => {
    const s = new DocStore(buildDefaultMap());
    const original = JSON.stringify(s.doc);
    rename(s, 'A');
    rename(s, 'B');
    expect(s.doc.name).toBe('B');
    expect(s.undo()).toBe(true);
    expect(s.doc.name).toBe('A');
    expect(s.undo()).toBe(true);
    expect(JSON.stringify(s.doc)).toBe(original);
    expect(s.undo()).toBe(false);
    expect(s.redo()).toBe(true);
    expect(s.redo()).toBe(true);
    expect(s.doc.name).toBe('B');
    expect(s.redo()).toBe(false);
  });

  it(`guarda no máximo ${UNDO_LIMIT} passos`, () => {
    const s = new DocStore(buildDefaultMap());
    for (let i = 0; i < UNDO_LIMIT + 50; i++) rename(s, `n${i}`);
    expect(s.undoSize).toBe(UNDO_LIMIT);
    let n = 0;
    while (s.undo()) n++;
    expect(n).toBe(UNDO_LIMIT);
    // os 50 primeiros saíram do histórico: para em n49
    expect(s.doc.name).toBe('n49');
    expect(s.redoSize).toBe(UNDO_LIMIT);
  });

  it('limite configurável', () => {
    const s = new DocStore(buildDefaultMap(), 3);
    for (let i = 0; i < 10; i++) rename(s, `x${i}`);
    expect(s.undoSize).toBe(3);
  });

  it('nova edição apaga o refazer', () => {
    const s = new DocStore(buildDefaultMap());
    rename(s, 'A');
    rename(s, 'B');
    s.undo();
    expect(s.canRedo).toBe(true);
    rename(s, 'C');
    expect(s.canRedo).toBe(false);
    expect(s.redo()).toBe(false);
  });

  it('lote vazio não entra no histórico nem suja', () => {
    const s = new DocStore(buildDefaultMap());
    expect(s.exec(batch('editor.op.change', []))).toBe(false);
    expect(s.canUndo).toBe(false);
    expect(s.dirty).toBe(false);
  });

  it('sujo até gravar a revisão atual', () => {
    const s = new DocStore(buildDefaultMap());
    expect(s.dirty).toBe(false);
    rename(s, 'A');
    expect(s.dirty).toBe(true);
    const rev = s.rev;
    rename(s, 'B'); // editou durante a gravação
    s.markSaved(rev);
    expect(s.dirty).toBe(true);
    s.markSaved(s.rev);
    expect(s.dirty).toBe(false);
    s.undo();
    expect(s.dirty).toBe(true);
  });

  it('load zera histórico e marca salvo; avisa quem escuta', () => {
    const s = new DocStore(buildDefaultMap());
    const evs: string[] = [];
    s.subscribe((_d, ev) => evs.push(ev.kind));
    rename(s, 'A');
    s.undo();
    s.redo();
    s.load(buildDefaultMap());
    expect(evs).toEqual(['exec', 'undo', 'redo', 'load']);
    expect(s.canUndo || s.canRedo || s.dirty).toBe(false);
  });

  it('allocIds nunca reusa ids existentes e avança seq', () => {
    const doc = buildDefaultMap();
    const s = new DocStore({ ...doc, seq: 0 });
    const { nums, op } = s.allocIds(3);
    const used = new Set<string>();
    for (const a of doc.areas) for (const f of [...a.furniture, ...a.wallItems, ...a.rugs]) used.add(f.id);
    for (const n of nums) expect(used.has(`f${n}`)).toBe(false);
    expect(nums[1]).toBe(nums[0] + 1);
    s.exec(op);
    expect(s.doc.seq).toBe(nums[2] + 1);
    expect(s.allocIds(1).nums[0]).toBe(nums[2] + 1);
  });
});
