// Utilitários de cor mínimos para validação (sem dependências).

export const HEX_RE = /^#[0-9a-f]{6}$/;

/** Luminância relativa WCAG (0..1) de `#rrggbb`. Retorna NaN se o hex for inválido. */
export function luminance(hex: string): number {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return NaN;
  const ch = (i: number): number => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(0) + 0.7152 * ch(1) + 0.0722 * ch(2);
}
