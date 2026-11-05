import { describe, expect, it } from 'vitest';
import { assembleOffice } from './assemble';
import { clone, twoAreaDoc } from './test-fixtures';
import { TILE } from './tile';
import { audibleSet, canHear, chebyshev, volumeAt, volumeFor, zoneAt, type Person } from './zones';

const base = twoAreaDoc();
const as = assembleOffice(base);
const p = (id: string, tx: number, ty: number, extra: Partial<Person> = {}): Person => ({ id, tx, ty, ...extra });

describe('zones', () => {
  it('zoneAt / chebyshev', () => {
    expect(zoneAt(as, 3, 3)?.id).toBe('sala');
    expect(zoneAt(as, 10, 10)).toBeNull();
    expect(zoneAt(as, -1, 0)).toBeNull();
    expect(chebyshev({ tx: 1, ty: 1 }, { tx: 4, ty: -1 })).toBe(3);
  });

  it('zona privada: ouve exatamente os membros, de qualquer distância', () => {
    const a = p('a', 1, 2);
    const b = p('b', 8, 6); // mesma zona, longe
    const c = p('c', 4, 9); // corredor, junto da porta
    const d = p('d', 5, 8); // corredor, distância 2 de b
    const all = [a, b, c, d];
    expect([...audibleSet(a, all, as)]).toEqual(['b']);
    expect([...audibleSet(b, all, as)]).toEqual(['a']);
    expect(audibleSet(d, all, as).has('b')).toBe(false);
    expect([...audibleSet(d, all, as)]).toEqual(['c']);
  });

  it('fora de zona privada: Chebyshev ≤ 4', () => {
    const a = p('a', 10, 10);
    expect(canHear(a, p('b', 14, 13), as)).toBe(true);
    expect(canHear(a, p('b', 15, 10), as)).toBe(false);
    expect(canHear(a, a, as)).toBe(false);
  });

  it('zona não privada não isola', () => {
    const d = clone(base);
    d.zones.push({ id: 'praca', name: 'Praça', kind: 'open', rects: [{ x: 12, y: 9, w: 4, h: 4 }], private: false, lockable: false });
    const a2 = assembleOffice(d);
    expect(canHear(p('a', 13, 10), p('b', 10, 10), a2)).toBe(true);
  });

  it('simetria em todos os pares', () => {
    const people: Person[] = [];
    let n = 0;
    for (const [x, y] of [
      [1, 2], [8, 6], [4, 6], [4, 7], [4, 8], [5, 9], [10, 10], [13, 12], [19, 13], [0, 8], [3, 11],
    ]) people.push(p(`p${n++}`, x, y, { x: x * TILE + 8, y: y * TILE + 11 }));
    for (const a of people) {
      for (const b of people) {
        expect(audibleSet(a, people, as).has(b.id)).toBe(audibleSet(b, people, as).has(a.id));
        expect(volumeFor(a, b, as)).toBeCloseTo(volumeFor(b, a, as), 12);
      }
    }
  });

  it('curva de volume: 1 até 1,5 tile, linear até 0,15 em 4, 0 além', () => {
    expect(volumeAt(0)).toBe(1);
    expect(volumeAt(1.5)).toBe(1);
    expect(volumeAt(2.75)).toBeCloseTo(0.575, 10);
    expect(volumeAt(4)).toBeCloseTo(0.15, 10);
    expect(volumeAt(4.01)).toBe(0);
    const a = p('a', 10, 10);
    expect(volumeFor(a, p('b', 11, 11), as)).toBe(1);
    expect(volumeFor(a, p('b', 13, 10), as)).toBeCloseTo(1 - (1.5 / 2.5) * 0.85, 10);
    expect(volumeFor(a, p('b', 14, 10), as)).toBeCloseTo(0.15, 10);
    expect(volumeFor(a, p('b', 15, 10), as)).toBe(0);
    // px contínuo: 2,5 tiles
    expect(volumeFor(p('a', 10, 10, { x: 168, y: 171 }), p('b', 12, 10, { x: 208, y: 171 }), as)).toBeCloseTo(1 - (1 / 2.5) * 0.85, 10);
  });

  it('volume em zona privada: 1 para membros, 0 para quem está fora', () => {
    expect(volumeFor(p('a', 1, 2), p('b', 8, 6), as)).toBe(1);
    expect(volumeFor(p('a', 4, 6), p('b', 4, 8), as)).toBe(0);
  });
});
