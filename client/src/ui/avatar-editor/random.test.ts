import { describe, expect, it } from 'vitest';
import { appearanceSchema } from '../../../../shared/validate/appearance';
import { mulberry32 } from '../../../../shared/hash';
import type { Appearance } from '../../art/api';
import { randomAll, randomSection, type SectionId } from './random';

const FIELDS: Record<SectionId, (keyof Appearance)[]> = {
  body: ['skin'],
  face: ['eyes', 'facialHair', 'makeup', 'freckles'],
  hair: ['hairStyle', 'hair'],
  top: ['topStyle', 'top', 'topAccent'],
  bottom: ['bottomStyle', 'bottom'],
  shoes: ['shoes'],
  accessories: ['accessory', 'accessoryColor'],
  badge: ['lanyard'],
};

describe('randomSection', () => {
  it('altera só os campos da seção e mantém o resultado válido', () => {
    const rnd = mulberry32(7);
    for (const look of ['f', 'm'] as const) {
      for (let i = 0; i < 150; i++) {
        const base = randomAll(look, 1000 + i);
        expect(appearanceSchema.safeParse(base).success).toBe(true);
        for (const section of Object.keys(FIELDS) as SectionId[]) {
          const next = randomSection(section, base, look, rnd);
          const own = new Set<string>(FIELDS[section]);
          for (const k of Object.keys(base) as (keyof Appearance)[]) {
            if (!own.has(k)) expect(next[k], `${section} mexeu em ${k}`).toEqual(base[k]);
          }
          const parsed = appearanceSchema.safeParse(next);
          expect(parsed.success, `${section}: ${JSON.stringify(parsed.success ? '' : parsed.error.issues)}`).toBe(true);
        }
      }
    }
  });
});

describe('randomAll', () => {
  it('respeita o look e é determinístico por semente', () => {
    for (const look of ['f', 'm'] as const) {
      const a = randomAll(look, 42);
      expect(a.look).toBe(look);
      expect(randomAll(look, 42)).toEqual(a);
      expect(appearanceSchema.safeParse(a).success).toBe(true);
    }
  });
  it('sem semente usa crypto.getRandomValues', () => {
    expect(appearanceSchema.safeParse(randomAll('f')).success).toBe(true);
  });
});
