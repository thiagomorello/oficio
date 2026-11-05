// Stamps isolados: cada um gera um documento válido (sem erros nem avisos) com o que promete.
import { describe, expect, it } from 'vitest';
import { createDocBuilder } from './doc-builder';
import { islandSize, stampIsland, stampLunchTable, stampMeetingRoom, stampPhoneBooth } from './stamps';
import { validateMap } from './validate';

describe('stamps', () => {
  it('stampIsland: 2·pairs × 4, uma mesa reivindicável por cadeira', () => {
    for (const pairs of [1, 2, 3] as const) {
      const b = createDocBuilder({ w: 12, h: 8 });
      const a = b.area('ilha', { x: 0, y: 0, w: 12, h: 8 }, { code: 'I', kind: 'open', walls: false });
      const desks = stampIsland(a, 2, 2, { pairs });
      expect(islandSize(pairs)).toEqual({ w: 2 * pairs, h: 4 });
      expect(desks).toHaveLength(2 * pairs);
      b.spawn(0, 0);
      const v = validateMap(b.build());
      expect(v.errors).toEqual([]);
      expect(v.warnings).toEqual([]);
      expect(v.assembly!.desks.map((d) => d.code)).toEqual(Array.from({ length: 2 * pairs }, (_, i) => `I-0${i + 1}`));
    }
  });

  it('stampMeetingRoom: 4/8/12 lugares, zona meeting com capacidade e porta únicas', () => {
    for (const seats of [4, 8, 12] as const) {
      const b = createDocBuilder({ w: 16, h: 16 });
      stampMeetingRoom(b, 'sala', 'Sala', undefined, { x: 0, y: 0, w: 16, h: 12 }, { seats, tv: true, whiteboard: true });
      b.area('corr', { x: 0, y: 12, w: 16, h: 4 }, { kind: 'corridor', walls: false });
      b.spawn(1, 13);
      const v = validateMap(b.build());
      expect(v.errors).toEqual([]);
      expect(v.warnings).toEqual([]);
      const z = v.assembly!.zoneById.get('sala')!;
      expect(z).toMatchObject({ kind: 'meeting', private: true, lockable: true, capacity: seats });
      expect(z.doorTiles).toHaveLength(2);
    }
  });

  it('stampLunchTable e stampPhoneBooth: zonas com 12 e 1 lugares', () => {
    const b = createDocBuilder({ w: 20, h: 10 });
    const a = b.area('copa', { x: 0, y: 0, w: 20, h: 10 }, { kind: 'cafe', walls: false });
    stampLunchTable(b, a, 2, 1, { zone: { id: 'mesa', name: 'Mesa' } });
    stampPhoneBooth(b, a, 15, 1, { zone: { id: 'cabine', name: 'Cabine' } });
    b.spawn(0, 9);
    const v = validateMap(b.build());
    expect(v.errors).toEqual([]);
    expect(v.warnings).toEqual([]);
    expect(v.assembly!.zoneById.get('mesa')).toMatchObject({ kind: 'lunch', capacity: 12, private: true, lockable: false });
    expect(v.assembly!.zoneById.get('cabine')).toMatchObject({ kind: 'phone', capacity: 1, private: true });
  });
});
