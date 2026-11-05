import { describe, expect, it } from 'vitest';
import { DESK_ITEMS, DESK_ITEM_KINDS, deskDecorPlacements, deskDecorSchema, deskItemSchema, isEmptyDecor, normalizeDecor, type DeskDecor, type DeskSlot } from './desk-decor';

describe('desk-decor', () => {
  it('aceita todas as combinações kind x variant x slot válidas', () => {
    let n = 0;
    for (const kind of DESK_ITEM_KINDS) {
      for (const variant of DESK_ITEMS[kind].variants) {
        for (const slot of DESK_ITEMS[kind].slots as readonly DeskSlot[]) {
          const r = deskDecorSchema.safeParse({ slots: { [slot]: { kind, variant } } });
          expect(r.success, `${kind}/${variant}/${slot}`).toBe(true);
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(60);
  });

  it('rejeita variante errada, slot proibido, chave extra e > 512 B', () => {
    expect(deskItemSchema.safeParse({ kind: 'mug', variant: 'fern' }).success).toBe(false);
    expect(deskDecorSchema.safeParse({ slots: { left: { kind: 'lamp', variant: 'yellow' } } }).success).toBe(false);
    expect(deskDecorSchema.safeParse({ slots: {}, extra: 1 }).success).toBe(false);
    expect(deskDecorSchema.safeParse({ slots: { left: { kind: 'mug', variant: 'red', x: 1 } } }).success).toBe(false);
    expect(deskDecorSchema.safeParse({ slots: { top: { kind: 'mug', variant: 'red' } } }).success).toBe(false);
    expect(deskDecorSchema.safeParse({ slots: { left: { kind: 'toString', variant: 'red' } } }).success).toBe(false);
    expect(deskDecorSchema.safeParse({ slots: { left: { kind: 'mug', variant: 'x'.repeat(600) } } }).success).toBe(false);
  });

  it('placements: ordem back -> left -> right e âncoras da tabela D.3', () => {
    const d: DeskDecor = { slots: { right: { kind: 'mug', variant: 'red' }, left: { kind: 'plant', variant: 'fern' }, back: { kind: 'lamp', variant: 'black' } } };
    const p = deskDecorPlacements(d);
    expect(p.map((x) => x.slot)).toEqual(['back', 'left', 'right']);
    expect(p[0]).toMatchObject({ x: 24, baseY: -2, w: 6, h: 9 });
    expect(p[1]).toMatchObject({ x: 1, baseY: 5 });
    expect(p[2]).toMatchObject({ x: 31 - 5, baseY: 5 });
    expect(deskDecorPlacements(null)).toEqual([]);
    expect(deskDecorPlacements({ slots: {} })).toEqual([]);
  });

  it('todo item fica dentro do footprint 32 px', () => {
    for (const kind of DESK_ITEM_KINDS) {
      for (const slot of DESK_ITEMS[kind].slots as readonly DeskSlot[]) {
        const [p] = deskDecorPlacements({ slots: { [slot]: { kind, variant: DESK_ITEMS[kind].variants[0] } } });
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x + p.w).toBeLessThanOrEqual(33);
      }
    }
  });

  it('normalizeDecor/isEmptyDecor', () => {
    expect(normalizeDecor(null)).toBeNull();
    expect(normalizeDecor('x')).toBeNull();
    expect(normalizeDecor({ slots: {} })).toBeNull();
    expect(normalizeDecor({ slots: { left: { kind: 'lamp', variant: 'black' } } })).toBeNull();
    expect(normalizeDecor({ slots: { left: { kind: 'mug', variant: 'red', junk: 1 }, back: { kind: 'lamp', variant: 'zzz' } }, extra: 1 })).toEqual({
      slots: { left: { kind: 'mug', variant: 'red' } },
    });
    expect(isEmptyDecor(null)).toBe(true);
    expect(isEmptyDecor({ slots: {} })).toBe(true);
    expect(isEmptyDecor({ slots: { back: { kind: 'lamp', variant: 'black' } } })).toBe(false);
  });
});
