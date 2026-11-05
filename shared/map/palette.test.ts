// C.1: pisos/tapetes da marca respeitam a regra de luminância e as variantes existem no catálogo.
import { describe, expect, it } from 'vitest';
import { luminance } from './color';
import { mapDocSchema } from './doc';
import { FURNITURE, type FurnitureKind } from './furniture';
import { FLOORS, FURNITURE_VARIANTS, MIN_FLOOR_LUMINANCE, ROOM_TINTS, RUGS, WALLS } from './palette';
import { floorColor } from './validate';

const lum = (k: keyof typeof FLOORS) => {
  const f = FLOORS[k] as { kind: Parameters<typeof floorColor>[0]; tint?: string; tintK?: number };
  return luminance(floorColor(f.kind, f.tint, f.tintK));
};

describe('paleta da marca', () => {
  it('pisos não-carpete: luminância estimada entre 0,28 e 0,40', () => {
    for (const k of ['corridor', 'praca', 'kitchen', 'restroom', 'lounge'] as const) {
      expect(lum(k), k).toBeGreaterThanOrEqual(0.28);
      expect(lum(k), k).toBeLessThanOrEqual(0.4);
    }
  });

  it('carpetes: luminância (tint e tint2) entre 0,27 e 0,32', () => {
    for (const k of ['openCarpet', 'roomCarpet', 'zenCarpet', 'reception'] as const) {
      const f = FLOORS[k];
      expect(f.kind).toBe('carpet');
      for (const c of [f.tint, f.tint2]) {
        expect(luminance(c), `${k} ${c}`).toBeGreaterThanOrEqual(0.27);
        expect(luminance(c), `${k} ${c}`).toBeLessThanOrEqual(0.32);
      }
    }
  });

  it('todo piso e tapete passa na regra dura (≥ MIN_FLOOR_LUMINANCE)', () => {
    for (const k of Object.keys(FLOORS) as (keyof typeof FLOORS)[]) expect(lum(k), k).toBeGreaterThanOrEqual(MIN_FLOOR_LUMINANCE);
    for (const [k, c] of Object.entries(RUGS)) expect(luminance(c), k).toBeGreaterThanOrEqual(MIN_FLOOR_LUMINANCE);
  });

  it('cores e estilos aceitos pelo schema do documento', () => {
    const area = (walls: (typeof WALLS)[keyof typeof WALLS], floor: (typeof FLOORS)[keyof typeof FLOORS]) => ({
      id: 'a',
      name: 'A',
      kind: 'room',
      rect: { x: 0, y: 0, w: 4, h: 4 },
      walls: { style: walls, north: true, south: true, west: true, east: true },
      doorways: [],
      floors: [{ ...floor, lx: 0, ly: 0, w: 4, h: 4 }],
      rugs: Object.values(RUGS).map((color, i) => ({ id: `r${i}`, lx: 0, ly: 0, w: 1, h: 1, color })),
      furniture: [],
      wallItems: [],
      floorTint: Object.values(ROOM_TINTS)[0],
    });
    const floors = Object.values(FLOORS);
    Object.values(WALLS).forEach((w, i) => {
      const doc = { schema: 1, name: 't', size: { w: 4, h: 4 }, seq: 0, areas: [area(w, floors[i % floors.length])], zones: [], spawn: [], spots: [] };
      const r = mapDocSchema.safeParse(doc);
      expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    });
  });

  it('variantes de móveis existem no catálogo', () => {
    const has = (kind: FurnitureKind, v: string) => expect(FURNITURE[kind].variants, `${kind}:${v}`).toContain(v);
    has('desk', FURNITURE_VARIANTS.desk);
    has('desk_back', FURNITURE_VARIANTS.desk);
    for (const v of [FURNITURE_VARIANTS.chairOpen, FURNITURE_VARIANTS.chairMeeting, FURNITURE_VARIANTS.chairHub]) {
      has('office_chair', v);
      has('office_chair_front', v);
    }
    for (const v of FURNITURE_VARIANTS.beanbags) has('beanbag', v);
    for (const v of FURNITURE_VARIANTS.plantsTall) has('plant_tall', v);
    for (const v of FURNITURE_VARIANTS.posters) has('poster', v);
  });
});
