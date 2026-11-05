import { describe, expect, it } from 'vitest';
import { tFor } from '../i18n';
import { formatZodIssues, MAP_LIMITS, MapDocError, mapDocSchema, migrateDoc, type OfficeMapDoc } from './doc';
import { clone, twoAreaDoc } from './test-fixtures';

// as mensagens do schema são chaves de i18n; aqui conferimos o texto em pt-BR (idioma original)
function issues(d: unknown): string[] {
  const r = mapDocSchema.safeParse(d);
  return r.success ? [] : formatZodIssues(r.error, 'pt-BR');
}

function mutated(fn: (d: OfficeMapDoc) => void): OfficeMapDoc {
  const d = clone(twoAreaDoc());
  fn(d);
  return d;
}

describe('mapDocSchema / migrateDoc', () => {
  it('aceita o documento de teste e migrateDoc devolve os mesmos dados', () => {
    const d = twoAreaDoc();
    expect(issues(d)).toEqual([]);
    expect(migrateDoc(clone(d))).toEqual(d);
  });

  it('rejeita variante que não existe no catálogo do kind', () => {
    expect(issues(mutated((d) => (d.areas[0].furniture[0].variant = 'rosa')))).toEqual([expect.stringMatching(/^areas\.0\.furniture\.0\.variant: variante "rosa" inválida para desk_back/)]);
    expect(issues(mutated((d) => (d.areas[0].furniture.push({ id: 'pl', kind: 'printer', lx: 6, ly: 4, variant: 'x' }))))).toEqual([expect.stringContaining('printer não tem variantes')]);
  });

  it('rejeita item de parede como móvel e móvel como item de parede (mount)', () => {
    expect(issues(mutated((d) => d.areas[0].furniture.push({ id: 'wb', kind: 'whiteboard', lx: 6, ly: 4 })))).toEqual([expect.stringContaining("mount 'wall'")]);
    expect(issues(mutated((d) => d.areas[0].wallItems.push({ id: 'pl', kind: 'plant_tall', lcx: 3, on: 'face' })))).toEqual([expect.stringContaining("mount 'floor'")]);
  });

  it('rejeita mapa grande demais e excesso de áreas/móveis/itens de parede', () => {
    expect(issues(mutated((d) => (d.size.w = MAP_LIMITS.size + 1)))).toEqual([expect.stringContaining('mapa até 200×200')]);
    const many = mutated((d) => {
      for (let i = 0; i < MAP_LIMITS.areas; i++) d.areas.push({ ...clone(d.areas[1]), id: `a${i}` });
    });
    expect(issues(many)).toEqual([expect.stringContaining('até 64 áreas')]);
    const furn = mutated((d) => {
      for (let a = 0; a < 11; a++) {
        const area = { ...clone(d.areas[1]), id: `f${a}`, furniture: [] as OfficeMapDoc['areas'][number]['furniture'] };
        for (let i = 0; i < 380; i++) area.furniture.push({ id: `p${i}`, kind: 'plant_small', lx: i % 20, ly: 0 });
        d.areas.push(area);
      }
    });
    expect(issues(furn)).toEqual([expect.stringContaining('até 4000 móveis')]);
    const walls = mutated((d) => {
      for (let a = 0; a < 7; a++) {
        const area = { ...clone(d.areas[0]), id: `w${a}`, wallItems: [] as OfficeMapDoc['areas'][number]['wallItems'] };
        for (let i = 0; i < 90; i++) area.wallItems.push({ id: `c${i}`, kind: 'clock', lcx: 2, on: 'face' });
        d.areas.push(area);
      }
    });
    expect(issues(walls)).toEqual([expect.stringContaining('até 600 itens de parede')]);
  });

  it('rejeita ids e cores fora do padrão', () => {
    expect(issues(mutated((d) => (d.areas[0].id = 'Sala Um')))).toHaveLength(1);
    expect(issues(mutated((d) => (d.areas[0].furniture[0].id = '-f0')))).toHaveLength(1);
    expect(issues(mutated((d) => (d.areas[0].floorTint = '#FFD800')))).toHaveLength(1);
    expect(issues(mutated((d) => (d.areas[0].walls.style.base = 'red')))).toHaveLength(1);
    expect(issues(mutated((d) => (d.zones[0].signId = 'sem-barra')))).toHaveLength(1);
    expect(issues(mutated((d) => d.areas[0].rugs.push({ id: 'r', lx: 1.1, ly: 2, w: 2, h: 2, color: '#ffd800' })))).toHaveLength(1);
  });

  it('migrateDoc lança erro legível (no idioma pedido; padrão en)', () => {
    expect(() => migrateDoc(null)).toThrow(MapDocError);
    expect(() => migrateDoc({ schema: 2 }, 'pt-BR')).toThrow('schema 2 desconhecido');
    expect(() => migrateDoc({ schema: 2 })).toThrow(tFor('en', 'map.doc.unknownSchema', { schema: '2', expected: 1 }));
    try {
      migrateDoc(mutated((d) => (d.areas[0].furniture[0].variant = 'rosa')), 'pt-BR');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(MapDocError);
      expect((e as Error).message).toMatch(/^mapa inválido: areas\.0\.furniture\.0\.variant: variante "rosa"/);
      expect((e as MapDocError).issues).toHaveLength(1);
    }
  });
});
