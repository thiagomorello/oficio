import { describe, expect, it } from 'vitest';
import { accentPalette, DEFAULT_BRANDING } from '../../../shared/branding';
import { BRAND_OUTLINE, normalizeSignText, renderBrandMark, renderBrandSignage, textWidth5x7 } from './brand';
import type { BufSprite } from './core/sprite';

function colors(s: BufSprite): Set<string> {
  const set = new Set<string>();
  const d = s.buf.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    set.add('#' + [d[i], d[i + 1], d[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join(''));
  }
  return set;
}

describe('brand sprites', () => {
  it('placa padrão: tamanho, cores e âncora na base', () => {
    const s = renderBrandSignage();
    const pal = accentPalette(DEFAULT_BRANDING.accentColor);
    // "OFICIO" em escala 2: 6 letras de 10 px + 5 espaços de 2 px + 8 de padding + 2 de contorno = 80
    expect(s.buf.w).toBe(textWidth5x7('OFICIO', 2) + 8 + 2);
    expect(s.buf.h).toBe(7 * 2 + 8 + 2);
    const c = colors(s);
    expect(c.has(pal.accent)).toBe(true);
    expect(c.has(pal.on)).toBe(true);
    expect(c.has(BRAND_OUTLINE)).toBe(true);
    expect(c.size).toBe(3);
    expect(s.buf.countOpaque()).toBeGreaterThan(500);
    expect([s.ax, s.ay]).toEqual([Math.floor(s.buf.w / 2), s.buf.h]);
  });

  it('texto longo cai para escala 1 e respeita o limite de 14 caracteres', () => {
    const s = renderBrandSignage('Minha Empresa Ltda', '#ff0066');
    expect(s.buf.h).toBe(7 + 8 + 2);
    expect(s.buf.w).toBe(textWidth5x7('MINHA EMPRESA ', 1) + 8 + 2);
    const c = colors(s);
    expect(c.has('#ff0066')).toBe(true);
    expect(c.has('#ffffff')).toBe(true); // texto branco sobre cor escura
  });

  it('normaliza acentos, espaços e vazio', () => {
    expect(normalizeSignText('  Escritório   Ágil ')).toBe('ESCRITORIO AGI');
    expect(normalizeSignText('')).toBe('OFICIO');
  });

  it('cor inválida cai no padrão; cor clara usa texto escuro', () => {
    expect(colors(renderBrandSignage('X', 'azul')).has(DEFAULT_BRANDING.accentColor)).toBe(true);
    expect(colors(renderBrandSignage('X', '#ffd800')).has('#121212')).toBe(true);
  });

  it('ícone 16x16 com a primeira letra', () => {
    const s = renderBrandMark('oficio', '#7c9cff');
    expect([s.buf.w, s.buf.h]).toEqual([16, 16]);
    const c = colors(s);
    expect(c.has('#7c9cff')).toBe(true);
    expect(c.size).toBe(2);
  });

  it('é determinístico', () => {
    expect(Array.from(renderBrandSignage('Acme', '#22aa66').buf.data)).toEqual(Array.from(renderBrandSignage('Acme', '#22aa66').buf.data));
  });
});
