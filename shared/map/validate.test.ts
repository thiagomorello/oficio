// Cada código de validateMap disparado por uma mutação mínima do documento base (limpo).
import { describe, expect, it } from 'vitest';
import type { OfficeMapDoc } from './doc';
import { clone, twoAreaDoc } from './test-fixtures';
import { validateMap, type MapIssueCode } from './validate';

function run(mut: (d: OfficeMapDoc) => void) {
  const d = clone(twoAreaDoc());
  mut(d);
  return validateMap(d);
}

function codes(mut: (d: OfficeMapDoc) => void): { errors: MapIssueCode[]; warnings: MapIssueCode[] } {
  const r = run(mut);
  return { errors: r.errors.map((i) => i.code), warnings: r.warnings.map((i) => i.code) };
}

const sala = (d: OfficeMapDoc) => d.areas[0];
const corr = (d: OfficeMapDoc) => d.areas[1];
/** Sala fechada (sem portas) em (12,0,6,6): interior (13..16, 2..4) inalcançável. */
const caixa = (d: OfficeMapDoc) => ({ ...clone(sala(d)), id: 'caixa', code: 'CX', rect: { x: 12, y: 0, w: 6, h: 6 }, doorways: [], furniture: [], wallItems: [], floors: [{ kind: 'concrete' as const, lx: 0, ly: 0, w: 6, h: 6 }] });

describe('validateMap', () => {
  it('documento base: sem erros nem avisos, devolve a montagem', () => {
    const r = validateMap(twoAreaDoc());
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.assembly?.desks).toHaveLength(2);
  });

  describe('erros', () => {
    const cases: [MapIssueCode, (d: OfficeMapDoc) => void][] = [
      ['schema', (d) => (sala(d).furniture[0].variant = 'rosa')],
      ['limits', (d) => (d.size.w = 201)],
      ['duplicate_id', (d) => (sala(d).furniture[1].id = sala(d).furniture[0].id)],
      ['area_outside', (d) => (corr(d).rect.w = 30)],
      ['area_outside', (d) => d.areas.push({ ...clone(corr(d)), id: 'mini', rect: { x: 12, y: 0, w: 3, h: 3 }, floors: [] })],
      ['area_overlap', (d) => d.areas.push({ ...clone(corr(d)), id: 'outra', rect: { x: 8, y: 2, w: 6, h: 6 } })],
      ['furniture_outside', (d) => corr(d).furniture.push({ id: 'p', kind: 'plant_small', lx: 20, ly: 1 })],
      ['furniture_overlap', (d) => corr(d).furniture.push({ id: 'p1', kind: 'plant_small', lx: 3, ly: 1 }, { id: 'p2', kind: 'trash_bin', lx: 3, ly: 1 })],
      ['furniture_overlap', (d) => corr(d).furniture.push({ id: 'm', kind: 'meeting_table', lx: 3, ly: 1 }, { id: 's', kind: 'stool', lx: 4, ly: 2 })],
      ['seat_on_wall', (d) => sala(d).furniture.push({ id: 's', kind: 'stool', lx: 0, ly: 3 })],
      ['seat_on_wall', (d) => sala(d).furniture.push({ id: 's', kind: 'stool', lx: 6, ly: 1 })],
      ['wall_item_no_wall', (d) => corr(d).wallItems.push({ id: 'w', kind: 'poster', lcx: 4, on: 'face' })],
      ['wall_item_outside', (d) => sala(d).wallItems.push({ id: 'w', kind: 'whiteboard', lcx: 1, on: 'face' })],
      ['doorway_not_on_wall', (d) => (sala(d).doorways[0].lx = 0)],
      ['doorway_not_on_wall', (d) => (sala(d).doorways[0].w = 5)],
      ['doorway_not_on_wall', (d) => corr(d).doorways.push({ side: 'north', lx: 3, w: 2 })],
      ['doorway_blocked', (d) => sala(d).furniture.push({ id: 'p', kind: 'plant_small', lx: 4, ly: 7 })],
      ['doorway_blocked', (d) => corr(d).furniture.push({ id: 'b', kind: 'reception_desk', lx: 3, ly: 0 })],
      ['spawn_missing', (d) => (d.spawn = [])],
      ['spawn_blocked', (d) => (d.spawn[0] = { x: 0, y: 0 })],
      ['spawn_blocked', (d) => (d.spawn[0] = { x: 2, y: 5 })],
      ['spawn_unreachable', (d) => (d.areas.push(caixa(d)), d.spawn.push({ x: 14, y: 3 }))],
      ['spot_unreachable', (d) => (sala(d).doorways = [])],
      ['spot_blocked', (d) => d.spots.push({ id: 'x', kind: 'talk', tx: 0, ty: 0, dir: 'down' })],
      ['zone_empty', (d) => d.zones.push({ id: 'z2', name: 'Z', kind: 'open', rects: [{ x: 30, y: 30, w: 2, h: 2 }], private: false, lockable: false })],
      ['zone_overlap', (d) => d.zones.push({ id: 'z2', name: 'Z', kind: 'open', rects: [{ x: 4, y: 4, w: 3, h: 6 }], private: false, lockable: false })],
      ['zone_no_door', (d) => (sala(d).doorways = [])],
      ['zone_sign_invalid', (d) => (d.zones[0].signId = 'sala/nada')],
      ['zone_sign_invalid', (d) => (d.zones[0].signId = `sala/${sala(d).furniture[0].id}`)],
    ];
    for (const [code, mut] of cases) {
      it(`${code}: ${mut.toString().replace(/\s+/g, ' ').slice(7, 90)}`, () => {
        const r = run(mut);
        expect(r.errors.map((i) => i.code)).toContain(code);
        expect(r.assembly).toBeNull();
        const issue = r.errors.find((i) => i.code === code)!;
        expect(issue.severity).toBe('error');
        expect(issue.message.length).toBeGreaterThan(5);
      });
    }

    it('spawn_unreachable não é disparado por spawn alcançável', () => {
      expect(codes((d) => d.spawn.push({ x: 5, y: 5 })).errors).toEqual([]);
    });
  });

  describe('avisos', () => {
    const cases: [MapIssueCode, (d: OfficeMapDoc) => void][] = [
      ['floor_missing', (d) => (corr(d).floors = [])],
      ['floor_dark', (d) => (sala(d).floors[0] = { kind: 'carpet', lx: 0, ly: 0, w: 10, h: 8, tint: '#2e2e34' })],
      ['floor_dark', (d) => (corr(d).floors[0] = { kind: 'street', lx: 0, ly: 0, w: 20, h: 6, tint: '#000000' })],
      ['floor_dark', (d) => corr(d).rugs.push({ id: 'r', lx: 2, ly: 1, w: 3, h: 2, color: '#202020' })],
      ['wall_item_overlap', (d) => sala(d).wallItems.push({ id: 'w1', kind: 'poster', lcx: 7.5, on: 'face' }, { id: 'w2', kind: 'clock', lcx: 7.5, on: 'face' })],
      ['wall_item_hidden', (d) => (sala(d).wallItems.push({ id: 'w1', kind: 'poster', lcx: 7.5, on: 'face' }), sala(d).furniture.push({ id: 'pl', kind: 'plant_tall', lx: 7, ly: 2 }))],
      ['tile_unreachable', (d) => d.areas.push(caixa(d))],
      ['zone_many_doors', (d) => sala(d).doorways.push({ side: 'south', lx: 7, w: 1 })],
      ['zone_capacity', (d) => (d.zones[0].capacity = 6)],
      ['desk_without_chair', (d) => corr(d).furniture.push({ id: 'd', kind: 'desk', lx: 12, ly: 2 })],
      ['chair_without_desk', (d) => corr(d).furniture.push({ id: 'c', kind: 'office_chair', lx: 12, ly: 2 })],
      ['desk_pair_mismatch', (d) => corr(d).furniture.push({ id: 'db', kind: 'desk_back', lx: 11, ly: 1 }, { id: 'd', kind: 'desk', lx: 12, ly: 2 }, { id: 'c', kind: 'office_chair', lx: 12, ly: 3 }, { id: 'cf', kind: 'office_chair_front', lx: 11, ly: 0 })],
      ['desk_pair_mismatch', (d) => corr(d).furniture.push({ id: 'd', kind: 'desk', lx: 12, ly: 2 }, { id: 'c1', kind: 'office_chair', lx: 12, ly: 3 }, { id: 'c2', kind: 'office_chair', lx: 13, ly: 3 })],
    ];
    for (const [code, mut] of cases) {
      it(`${code}: ${mut.toString().replace(/\s+/g, ' ').slice(7, 90)}`, () => {
        const r = run(mut);
        expect(r.errors).toEqual([]);
        expect(r.warnings.map((i) => i.code)).toContain(code);
        expect(r.assembly).not.toBeNull();
      });
    }
  });
});
