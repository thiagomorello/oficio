import { describe, expect, it } from 'vitest';
import { hasMessage, tFor } from '../../../../shared/i18n';
import { appearanceSchema } from '../../../../shared/validate/appearance';
import { SKINS } from '../../../../shared/validate/appearance-options';
import { randomAll } from './random';
import { PRESETS, applyPreset } from './presets';

describe('presets', () => {
  it('são 6 com ids únicos', () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(6);
  });
  it('rótulo e descrição são chaves de i18n cadastradas nos dois idiomas', () => {
    for (const p of PRESETS) {
      expect(p.label).toBe(`avatar.preset.${p.id}.label`);
      expect(p.description).toBe(`avatar.preset.${p.id}.description`);
      expect(hasMessage(p.label), p.label).toBe(true);
      expect(hasMessage(p.description), p.description).toBe(true);
      // Resolveu de verdade (não caiu no fallback que devolve a própria chave).
      expect(tFor('en', p.label)).not.toBe(p.label);
      expect(tFor('pt-BR', p.description)).not.toBe(p.description);
    }
    expect(tFor('pt-BR', 'avatar.preset.classico.label')).toBe('Clássico');
    expect(tFor('en', 'avatar.preset.classico.label')).toBe('Classic');
  });
  it.each(PRESETS.map((p) => [p.id, p] as const))('%s passa no schema com qualquer look/pele', (_id, preset) => {
    for (const look of ['f', 'm'] as const) {
      for (const skin of SKINS) {
        const base = { ...randomAll(look, 5), skin };
        const out = applyPreset(base, preset);
        expect(out.look).toBe(look);
        expect(out.skin).toBe(skin);
        const r = appearanceSchema.safeParse(out);
        expect(r.success, JSON.stringify(r.success ? '' : r.error.issues)).toBe(true);
      }
    }
  });
});
