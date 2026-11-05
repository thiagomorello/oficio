import { describe, expect, it } from 'vitest';
import { buildDefaultMap } from '../../../shared/map/default-map';
import type { MapFloor, OfficeMapDoc } from '../../../shared/map/doc';
import { addOp, apply, batch, chain, invert, normalizeFloors, OpError, paintFloors, propOp, removeOp, updateOp, type EditOp } from './ops';

const json = (d: unknown) => JSON.stringify(d);

function roundTrip(doc: OfficeMapDoc, op: EditOp): void {
  const before = json(doc);
  const after = apply(doc, op);
  expect(json(doc)).toBe(before); // o original não muda (cópia-na-escrita)
  expect(json(after)).not.toBe(before);
  const back = apply(after, invert(op));
  expect(json(back)).toBe(before);
  // e refazer depois de desfazer dá o mesmo resultado
  expect(json(apply(back, op))).toBe(json(after));
}

describe('ops: apply(invert(op)) restaura o JSON', () => {
  const doc = buildDefaultMap();
  const area = doc.areas.find((a) => a.id === 'lounge')!;

  it('add (lista do doc e lista de área)', () => {
    roundTrip(doc, addOp(doc, { doc: 'spawn' }, { x: 4, y: 4 }));
    roundTrip(doc, { t: 'add', at: { doc: 'zones' }, index: 0, item: { id: 'z-nova', name: 'Nova', kind: 'open', rects: [{ x: 1, y: 1, w: 2, h: 2 }], private: false, lockable: false } });
    roundTrip(doc, addOp(doc, { area: area.id, list: 'furniture' }, { id: 'f9999', kind: 'plant_small', lx: 3, ly: 3 }));
    roundTrip(doc, { t: 'add', at: { area: area.id, list: 'rugs' }, index: 0, item: { id: 'f9998', lx: 1.25, ly: 2.5, w: 2, h: 1.75, color: '#ffd800' } });
  });

  it('remove (preserva o índice ao desfazer)', () => {
    roundTrip(doc, removeOp(doc, { area: area.id, list: 'furniture' }, 1));
    roundTrip(doc, removeOp(doc, { doc: 'areas' }, 3));
    roundTrip(doc, removeOp(doc, { doc: 'spots' }, 0));
    roundTrip(doc, removeOp(doc, { area: area.id, list: 'doorways' }, 0));
  });

  it('update (item de lista e campo do documento)', () => {
    const f = area.furniture[0];
    roundTrip(doc, updateOp(doc, { area: area.id, list: 'furniture' }, 0, { ...f, lx: f.lx + 1 }));
    roundTrip(doc, updateOp(doc, { doc: 'areas' }, 0, { ...doc.areas[0], name: 'Outra' }));
    roundTrip(doc, propOp(doc, 'name', 'Renomeado'));
    roundTrip(doc, propOp(doc, 'size', { w: 90, h: 60 }));
    roundTrip(doc, propOp(doc, 'seq', doc.seq + 10));
    roundTrip(doc, propOp(doc, 'deskLabels', { 'ilha-a1#f1': 'Thiago' }));
  });

  it('update de campo ausente volta a ficar ausente', () => {
    expect(doc.deskLabels).toBeUndefined();
    const op = propOp(doc, 'deskLabels', { x: 'y' });
    const back = apply(apply(doc, op), invert(op));
    expect('deskLabels' in back).toBe(false);
  });

  it('setFloors', () => {
    const after = paintFloors(area, [{ x: 2, y: 3, w: 4, h: 2 }], { kind: 'marble' });
    roundTrip(doc, { t: 'setFloors', area: area.id, before: area.floors, after });
  });

  it('batch (ordem inversa no desfazer)', () => {
    const { op } = chain(doc, 'editor.op.change', [
      (d) => addOp(d, { area: area.id, list: 'furniture' }, { id: 'f9000', kind: 'stool', lx: 2, ly: 3 }),
      (d) => removeOp(d, { area: area.id, list: 'furniture' }, 0),
      (d) => propOp(d, 'seq', d.seq + 1),
      (d) => updateOp(d, { doc: 'zones' }, 0, { ...d.zones[0], name: 'Z' }),
      (d) => ({ t: 'setFloors', area: area.id, before: d.areas.find((a) => a.id === area.id)!.floors, after: [] }),
    ]);
    expect(op.ops).toHaveLength(5);
    roundTrip(doc, op);
    roundTrip(doc, batch('editor.op.change', [op, propOp(doc, 'name', 'X')]));
  });

  it('copia só o que mudou', () => {
    const op = updateOp(doc, { area: area.id, list: 'furniture' }, 0, { ...area.furniture[0], lx: 9 });
    const after = apply(doc, op);
    const i = doc.areas.indexOf(area);
    expect(after.areas[i]).not.toBe(area);
    expect(after.areas[i - 1]).toBe(doc.areas[i - 1]);
    expect(after.zones).toBe(doc.zones);
  });

  it('índice inválido ou área inexistente lança OpError', () => {
    expect(() => apply(doc, { t: 'remove', at: { doc: 'spawn' }, index: 999, item: null })).toThrow(OpError);
    expect(() => apply(doc, { t: 'add', at: { area: 'nao-existe', list: 'rugs' }, index: 0, item: {} })).toThrow(OpError);
  });
});

describe('normalizeFloors', () => {
  const W = 10;
  const H = 6;
  const base: MapFloor = { kind: 'concrete', lx: 0, ly: 0, w: W, h: H, tint: '#50515a', tintK: 0.9 };

  it('o último vence e o resultado cobre os mesmos tiles', () => {
    const out = normalizeFloors([base, { kind: 'wood', lx: 2, ly: 1, w: 3, h: 2 }, { kind: 'marble', lx: 3, ly: 2, w: 3, h: 3 }], W, H);
    const at = (x: number, y: number) => out.find((f) => x >= f.lx && y >= f.ly && x < f.lx + f.w && y < f.ly + f.h)?.kind;
    expect(at(0, 0)).toBe('concrete');
    expect(at(2, 1)).toBe('wood');
    expect(at(3, 2)).toBe('marble'); // sobreposição: último vence
    expect(at(4, 1)).toBe('wood');
    expect(at(5, 4)).toBe('marble');
    expect(at(9, 5)).toBe('concrete');
    // retângulos disjuntos cobrindo a área inteira
    let area = 0;
    for (const f of out) area += f.w * f.h;
    expect(area).toBe(W * H);
    // mantém o estilo
    expect(out.find((f) => f.kind === 'concrete')).toMatchObject({ tint: '#50515a', tintK: 0.9 });
  });

  it('é idempotente e determinístico', () => {
    const input: MapFloor[] = [base, { kind: 'wood', lx: 2, ly: 1, w: 3, h: 2 }, { kind: 'carpet', lx: 6, ly: 0, w: 4, h: 6, tint: '#45454e', tint2: '#4c4c56' }, { kind: 'wood', lx: 0, ly: 4, w: 10, h: 1 }];
    const a = normalizeFloors(input, W, H);
    expect(normalizeFloors(a, W, H)).toEqual(a);
    expect(json(normalizeFloors(input, W, H))).toBe(json(a));
    expect(json(normalizeFloors([...a].reverse(), W, H))).toBe(json(a)); // retângulos disjuntos: ordem não importa
  });

  it('funde linhas iguais na vertical e recorta fora da área', () => {
    expect(normalizeFloors([{ kind: 'wood', lx: -2, ly: -2, w: 20, h: 20 }], W, H)).toEqual([{ kind: 'wood', lx: 0, ly: 0, w: W, h: H }]);
    const two = normalizeFloors([base, { ...base, kind: 'wood', lx: 0, ly: 2, w: W, h: 2 }], W, H);
    expect(two.map((f) => [f.kind, f.ly, f.h])).toEqual([
      ['concrete', 0, 2],
      ['wood', 2, 2],
      ['concrete', 4, 2],
    ]);
  });

  it('borracha remove tiles', () => {
    const area = buildDefaultMap().areas.find((a) => a.id === 'lounge')!;
    const out = paintFloors(area, [{ x: 0, y: 0, w: 2, h: area.rect.h }], null);
    let n = 0;
    for (const f of out) n += f.w * f.h;
    expect(n).toBe(area.rect.w * area.rect.h - 2 * area.rect.h);
    expect(out.every((f) => f.lx >= 2)).toBe(true);
  });
});
