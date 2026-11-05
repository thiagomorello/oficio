import { describe, expect, it } from 'vitest';
import { hasMessage, tFor } from '../../../shared/i18n';
import { INCOMPATIBLE } from '../../../shared/validate/appearance-options';
import { appearanceFromSeed } from './character/appearance';
import { ACCESSORIES, ACC_COLORS, BOTTOM_COLORS, BOTTOM_STYLES, HAIR_NATURAL, HAIR_NATURAL_COLORS, HAIR_STYLES, SKINS } from '../../../shared/validate/appearance-options';
import { appearanceSchema, displayNameSchema, normalizeAppearance, type AppearanceLike } from '../../../shared/validate/appearance';
import { luminance } from '../../../shared/validate/color';

const base = (): AppearanceLike => ({ ...appearanceFromSeed(7, { look: 'm' }), accessory: 'none', accessoryColor: '#2b2b33', hairStyle: 'short', facialHair: 'none' });
const fails = (a: unknown): boolean => !appearanceSchema.safeParse(a).success;

describe('appearance-options', () => {
  it('tamanhos esperados', () => {
    expect(SKINS).toHaveLength(10);
    expect(HAIR_NATURAL_COLORS).toHaveLength(HAIR_NATURAL.length);
    expect(BOTTOM_COLORS.length).toBe(11);
  });
});

describe('luminance', () => {
  it('extremos', () => {
    expect(luminance('#000000')).toBe(0);
    expect(luminance('#ffffff')).toBeCloseTo(1, 5);
    expect(luminance('zzz')).toBeNaN();
  });
});

describe('appearanceSchema', () => {
  it('2000 sementes x 2 looks passam', () => {
    for (let i = 0; i < 2000; i++) {
      for (const look of ['f', 'm'] as const) {
        const a = appearanceFromSeed(i, { look, sub: i % 3 === 0 });
        const r = appearanceSchema.safeParse(a);
        if (!r.success) throw new Error(`seed ${i} ${look}: ${JSON.stringify(r.error.issues)}`);
      }
    }
  });

  it('base válida; campos opcionais aceitos', () => {
    expect(appearanceSchema.safeParse(base()).success).toBe(true);
    expect(appearanceSchema.safeParse({ ...base(), makeup: 'both', freckles: true, bottomStyle: 'skirt' }).success).toBe(true);
  });

  it('casos negativos', () => {
    expect(fails({ ...base(), look: 'x' })).toBe(true);
    expect(fails({ ...base(), skin: '#123456' })).toBe(true);
    expect(fails({ ...base(), eyes: '#123456' })).toBe(true);
    expect(fails({ ...base(), hairStyle: 'mullet' })).toBe(true);
    expect(fails({ ...base(), topStyle: 'cape' })).toBe(true);
    expect(fails({ ...base(), bottomStyle: 'tutu' })).toBe(true);
    expect(fails({ ...base(), facialHair: 'monobrow' })).toBe(true);
    expect(fails({ ...base(), makeup: 'glitter' })).toBe(true);
    expect(fails({ ...base(), freckles: 'yes' })).toBe(true);
    expect(fails({ ...base(), hair: 'red' })).toBe(true);
    expect(fails({ ...base(), hair: '#AABBCC' })).toBe(true); // maiúsculas
    expect(fails({ ...base(), top: '#050505' })).toBe(true); // escuro demais
    expect(fails({ ...base(), top: '#fefefe' })).toBe(true); // claro demais
    expect(fails({ ...base(), top: '#808080' })).toBe(false); // livre dentro da faixa
    expect(fails({ ...base(), lanyard: '#123456' })).toBe(true);
    expect(fails({ ...base(), lanyard: '#ffd800' })).toBe(false);
    expect(fails({ ...base(), accessory: 'glasses', accessoryColor: '#ffffff' })).toBe(true);
    expect(fails({ ...base(), accessory: 'cap', accessoryColor: ACC_COLORS.cap[0], hairStyle: 'afro' })).toBe(true);
    expect(fails({ ...base(), accessory: 'beanie', accessoryColor: ACC_COLORS.beanie[0], hairStyle: 'pigtails' })).toBe(true);
    expect(fails({ ...base(), accessory: 'bow', accessoryColor: ACC_COLORS.bow[0], hairStyle: 'bald' })).toBe(true);
    expect(fails({ ...base(), accessory: 'bow', accessoryColor: ACC_COLORS.bow[0], hairStyle: 'short' })).toBe(false);
    expect(fails({ ...base(), extra: 1 })).toBe(true);
    expect(fails({ ...base(), hair: undefined })).toBe(true);
  });

  it('aceita os valores novos (penteados, vestido, óculos redondos, hijab)', () => {
    expect(HAIR_STYLES).toHaveLength(17);
    expect(ACCESSORIES).toHaveLength(10);
    expect(BOTTOM_STYLES).toHaveLength(4);
    for (const hairStyle of ['braids', 'undercut', 'locs']) expect(fails({ ...base(), hairStyle })).toBe(false);
    expect(fails({ ...base(), bottomStyle: 'dress' })).toBe(false);
    for (const accessoryColor of ACC_COLORS.glasses_round) {
      expect(fails({ ...base(), accessory: 'glasses_round', accessoryColor })).toBe(false);
    }
    expect(ACC_COLORS.glasses_round).toEqual(ACC_COLORS.glasses);
    expect(ACC_COLORS.hijab).toHaveLength(8);
    for (const accessoryColor of ACC_COLORS.hijab) expect(fails({ ...base(), accessory: 'hijab', accessoryColor, facialHair: 'none' })).toBe(false);
    expect(fails({ ...base(), accessory: 'hijab', accessoryColor: '#123456' })).toBe(true);
  });

  it('hijab com pelo facial é rejeitado', () => {
    expect(fails({ ...base(), accessory: 'hijab', accessoryColor: ACC_COLORS.hijab[0], facialHair: 'beard' })).toBe(true);
  });

  it('rejeita JSON acima de 2 KB', () => {
    expect(fails({ ...base(), makeup: 'both', freckles: true, hair: '#aabbcc'.padEnd(2200, 'c') })).toBe(true);
  });

  it('as mensagens dos issues são chaves de i18n traduzíveis', () => {
    const issuesOf = (a: unknown): string[] => {
      const r = appearanceSchema.safeParse(a);
      return r.success ? [] : r.error.issues.map((i) => i.message);
    };
    const samples = [
      { ...base(), hair: 'red' },
      { ...base(), top: '#050505' },
      { ...base(), hairStyle: 'mullet' },
      { ...base(), lanyard: '#123456' },
      { ...base(), accessory: 'glasses', accessoryColor: '#ffffff' },
      { ...base(), accessory: 'cap', accessoryColor: ACC_COLORS.cap[0], hairStyle: 'afro' },
      { ...base(), hair: '#aabbcc'.padEnd(2200, 'c') },
    ];
    for (const s of samples) {
      const msgs = issuesOf(s);
      expect(msgs.length).toBeGreaterThan(0);
      for (const m of msgs) expect(hasMessage(m), m).toBe(true);
    }
    expect(issuesOf({ ...base(), hair: 'red' })).toContain('avatar.validate.invalidColor');
    expect(tFor('pt-BR', 'avatar.validate.invalidColor')).toBe('cor inválida');
    expect(tFor('en', 'avatar.validate.invalidColor')).toBe('invalid color');
    // Toda regra de incompatibilidade tem o texto que o editor mostra e que o schema devolve.
    for (const r of INCOMPATIBLE) expect(hasMessage(`avatar.incompat.${r.id}`), r.id).toBe(true);
  });
});

describe('normalizeAppearance', () => {
  it('preenche padrões e minúsculas', () => {
    const { facialHair, bottomStyle, makeup, freckles, ...rest } = base();
    void facialHair; void bottomStyle; void makeup; void freckles;
    const n = normalizeAppearance({ ...rest, hair: '#AABBCC' });
    expect(n).toMatchObject({ facialHair: 'none', bottomStyle: 'pants', makeup: 'none', freckles: false, hair: '#aabbcc' });
  });
  it('reseta cor de acessório inválida', () => {
    const n = normalizeAppearance({ ...base(), accessory: 'headphones', accessoryColor: '#123456' });
    expect(n.accessoryColor).toBe(ACC_COLORS.headphones[0]);
  });
  it('resolve incompatibilidades', () => {
    const cap = normalizeAppearance({ ...base(), accessory: 'cap', accessoryColor: ACC_COLORS.cap[0], hairStyle: 'bun' });
    expect(cap.accessory).toBe('glasses');
    expect(cap.accessoryColor).toBe(ACC_COLORS.glasses[0]);
    const bow = normalizeAppearance({ ...base(), accessory: 'bow', accessoryColor: ACC_COLORS.bow[0], hairStyle: 'buzz' });
    expect(bow.accessory).toBe('earrings');
    expect(bow.accessoryColor).toBe(ACC_COLORS.earrings[0]);
    expect(appearanceSchema.safeParse(cap).success).toBe(true);
  });
  it('hijab zera os pelos faciais em vez de trocar o acessório', () => {
    const n = normalizeAppearance({ ...base(), accessory: 'hijab', accessoryColor: ACC_COLORS.hijab[2], facialHair: 'beard' });
    expect(n.accessory).toBe('hijab');
    expect(n.facialHair).toBe('none');
    expect(appearanceSchema.safeParse(n).success).toBe(true);
  });
  it('sementes normalizadas continuam válidas', () => {
    for (let i = 0; i < 200; i++) expect(appearanceSchema.safeParse(normalizeAppearance(appearanceFromSeed(i))).success).toBe(true);
  });
});

describe('displayNameSchema', () => {
  it('aceita', () => {
    for (const n of ['Ana', "D'Ávila Jr.", 'João-Pedro 2', '  Maria Silva  ']) expect(displayNameSchema.safeParse(n).success).toBe(true);
    expect(displayNameSchema.parse('  Maria Silva  ')).toBe('Maria Silva');
  });
  it('rejeita', () => {
    for (const n of ['A', '', ' x ', 'a'.repeat(25), 'Ana  Maria', 'Ana<script>', 'Ana_Maria', 'Ana😀']) {
      expect(displayNameSchema.safeParse(n).success, n).toBe(false);
    }
  });
  it('mensagens de rejeição são chaves de i18n', () => {
    const first = (n: string): string => {
      const r = displayNameSchema.safeParse(n);
      return r.success ? '' : r.error.issues[0]!.message;
    };
    expect(first('A')).toBe('avatar.validate.nameTooShort');
    expect(first('a'.repeat(25))).toBe('avatar.validate.nameTooLong');
    expect(first('Ana_Maria')).toBe('avatar.validate.nameChars');
    expect(first('Ana  Maria')).toBe('avatar.validate.nameDoubleSpaces');
    for (const n of ['A', 'a'.repeat(25), 'Ana_Maria', 'Ana  Maria']) expect(hasMessage(first(n)), n).toBe(true);
  });
});
