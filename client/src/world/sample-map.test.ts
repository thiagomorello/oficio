import { describe, expect, it } from 'vitest';
import { assembleOffice } from '../../../shared/map/assemble';
import { migrateDoc } from '../../../shared/map/doc';
import { validateMap } from '../../../shared/map/validate';
import { buildSampleMap } from './sample-map';

describe('mapa de exemplo', () => {
  it('passa no zod e na validação, com 8 mesas alcançáveis do spawn', () => {
    const doc = migrateDoc(buildSampleMap());
    const a = assembleOffice(doc, 1);
    expect(a.desks).toHaveLength(8);
    for (const d of a.desks) {
      const s = a.spotById.get(d.spotId)!;
      expect(a.reach[s.ty * a.w + s.tx]).toBe(1);
    }
    expect(validateMap(doc).errors.map((e) => e.message)).toEqual([]);
  });
});
