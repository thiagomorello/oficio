import { describe, expect, it } from 'vitest';
import { buildDefaultMap } from '../../../shared/map/default-map';
import { createDocBuilder } from '../../../shared/map/doc-builder';
import type { OfficeMapDoc } from '../../../shared/map/doc';
import { validateMap } from '../../../shared/map/validate';
import { t } from '../i18n';
import { DocStore } from './doc-store';
import { apply, invert } from './ops';
import { buildStamp, MEETING_ROOM_SIZE, STAMPS } from './stamps-ui';
import type { StampSpec } from './state';

/** Primeira posição (varredura por linhas) em que o carimbo cabe e o mapa continua sem erros. */
function firstValid(doc: OfficeMapDoc, spec: StampSpec, maxTries = 30): { x: number; y: number; doc: OfficeMapDoc } | null {
  let tries = 0;
  for (let y = 0; y < doc.size.h; y++) {
    for (let x = 0; x < doc.size.w; x++) {
      const r = buildStamp(doc, spec, x, y);
      if (!r.op) continue;
      if (++tries > maxTries) return null;
      const next = apply(doc, r.op);
      if (!validateMap(next).errors.length) return { x, y, doc: next };
    }
  }
  return null;
}

describe('carimbos → lote de operações → validateMap sem erros', () => {
  const doc = buildDefaultMap();
  expect(validateMap(doc).errors).toEqual([]);

  for (const s of STAMPS.filter((x) => x.spec.kind !== 'meeting')) {
    it(`${t(s.label)} no mapa padrão`, () => {
      const found = firstValid(doc, s.spec);
      expect(found, `nenhuma posição válida para ${t(s.label)}`).not.toBeNull();
      const v = validateMap(found!.doc);
      expect(v.errors).toEqual([]);
      // mais mesas reivindicáveis quando é ilha
      if (s.spec.kind === 'island') expect(v.assembly!.desks.length).toBe(72 + 2 * (s.spec.size ?? 3));
    });
  }

  it('um único desfazer remove o carimbo inteiro', () => {
    const r = buildStamp(doc, { kind: 'island', size: 3 }, 0, 12); // corredor norte, livre
    expect(r.op).not.toBeNull();
    expect(r.op!.t).toBe('batch');
    const store = new DocStore(doc);
    store.exec(r.op!);
    expect(store.undoSize).toBe(1);
    store.undo();
    expect(JSON.stringify(store.doc)).toBe(JSON.stringify(doc));
    expect(JSON.stringify(apply(apply(doc, r.op!), invert(r.op!)))).toBe(JSON.stringify(doc));
  });

  it('ids novos a partir de seq, sem colidir', () => {
    const r = buildStamp(doc, { kind: 'booth', size: 1 }, 2, 1);
    expect(r.op).not.toBeNull();
    const next = apply(doc, r.op!);
    expect(next.seq).toBeGreaterThan(doc.seq);
    for (const a of next.areas) {
      const ids = [...a.furniture, ...a.wallItems, ...a.rugs].map((x) => x.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
    expect(new Set(next.zones.map((z) => z.id)).size).toBe(next.zones.length);
  });

  it('recusa posição inválida (sobreposição / fora de área)', () => {
    const ilha = doc.areas.find((a) => a.id === 'ilha-a1')!;
    expect(buildStamp(doc, { kind: 'island', size: 3 }, ilha.rect.x + 2, ilha.rect.y + 2).problem).toMatch(/sobrepõe/);
    expect(buildStamp(doc, { kind: 'booth', size: 1 }, -5, -5).problem).toBe('fora de uma área');
    expect(buildStamp(doc, { kind: 'meeting', size: 4 }, 0, 0).problem).toMatch(/sobrepõe/);
  });
});

describe('sala de reunião', () => {
  function corridorDoc(): OfficeMapDoc {
    const b = createDocBuilder({ w: 40, h: 20 }, 'teste');
    b.area('corredor', { x: 0, y: 12, w: 40, h: 5 }, { kind: 'corridor', walls: false, floor: { kind: 'concrete', tint: '#50515a', tintK: 0.9 } });
    b.spawn(2, 14);
    return b.build();
  }

  for (const seats of [4, 8, 12] as const) {
    it(`${seats} lugares com porta para o corredor`, () => {
      const doc = corridorDoc();
      const r = buildStamp(doc, { kind: 'meeting', size: seats }, 4, 0);
      expect(r.problem).toBeNull();
      const next = apply(doc, r.op!);
      const v = validateMap(next);
      expect(v.errors).toEqual([]);
      const area = next.areas.find((a) => a.id.startsWith('sala-'))!;
      expect(area.rect).toEqual({ x: 4, y: 0, ...MEETING_ROOM_SIZE });
      const zone = v.assembly!.zones.find((z) => z.kind === 'meeting')!;
      expect(zone).toMatchObject({ private: true, lockable: true, capacity: seats });
      expect(v.assembly!.spots.filter((s) => s.seated && zone.tiles[s.ty * next.size.w + s.tx]).length).toBe(seats);
    });
  }
});
