// Placa da marca em pixel art (procedural, pura): caixa na cor de destaque com o texto configurado
// (OFFICE_SIGN_TEXT) numa fonte 5x7, e um ícone 16x16 com a primeira letra. Determinístico.
import { accentPalette, DEFAULT_BRANDING, MAX_SIGN_TEXT } from '../../../shared/branding';
import { PixelBuf } from './core/pixbuf';
import type { BufSprite } from './core/sprite';

export const BRAND_OUTLINE = '#1a1a1a';

/** Fonte 5x7 maiúscula (A-Z, 0-9 e alguns sinais). Caracteres desconhecidos viram espaço estreito. */
export const FONT_5X7: Readonly<Record<string, readonly string[]>> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.####', '#....', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  '4': ['#...#', '#...#', '#...#', '#####', '....#', '....#', '....#'],
  '5': ['#####', '#....', '#....', '####.', '....#', '....#', '####.'],
  '6': ['.####', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '....#', '####.'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  '&': ['.##..', '#..#.', '#..#.', '.##..', '#.#.#', '#..#.', '.##.#'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
};

export const GLYPH_W = 5;
export const GLYPH_H = 7;

/** Texto da placa: sem acentos, maiúsculo, no máximo MAX_SIGN_TEXT caracteres. */
export function normalizeSignText(text: string): string {
  const t = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SIGN_TEXT);
  return t || DEFAULT_BRANDING.signText.toUpperCase();
}

/** Desenha `text` com a fonte 5x7 em escala inteira `k`; devolve a largura em px. */
export function drawText5x7(buf: PixelBuf, text: string, x: number, y: number, c: string, k = 1, gap = 1): number {
  let cx = x;
  for (const ch of text) {
    const rows = FONT_5X7[ch] ?? FONT_5X7[' ']!;
    rows.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) if (row[rx] === '#') buf.rect(cx + rx * k, y + ry * k, k, k, c);
    });
    cx += (GLYPH_W + gap) * k;
  }
  return Math.max(0, cx - x - gap * k);
}

export function textWidth5x7(text: string, k = 1, gap = 1): number {
  const n = [...text].length;
  return n === 0 ? 0 : (n * GLYPH_W + (n - 1) * gap) * k;
}

/** Caixa de cantos arredondados (corte de `cut` px nas bordas). */
function roundedBox(buf: PixelBuf, x: number, y: number, w: number, h: number, c: string, cut = 2): void {
  for (let r = 0; r < h; r++) {
    const edge = Math.min(r, h - 1 - r);
    const inset = edge < cut ? cut - edge : 0;
    buf.rect(x + inset, y + r, w - inset * 2, 1, c);
  }
}

/** Contorno de 1 px (8 vizinhos) em volta de tudo que já foi desenhado. */
function outlineAll(buf: PixelBuf, c: string): void {
  const edge: [number, number][] = [];
  for (let y = 0; y < buf.h; y++) {
    for (let x = 0; x < buf.w; x++) {
      if (buf.alpha(x, y) > 0) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx || dy) && buf.alpha(x + dx, y + dy) > 0) {
            edge.push([x, y]);
            dy = 2;
            break;
          }
        }
      }
    }
  }
  for (const [x, y] of edge) buf.set(x, y, c);
}

/**
 * Placa da marca: caixa na cor de destaque com o texto em 5x7 (escala 2 até 8 caracteres, senão 1),
 * contorno escuro de 1 px. Âncora no centro da base (como os outros itens de parede).
 */
export function renderBrandSignage(text: string = DEFAULT_BRANDING.signText, accent: string = DEFAULT_BRANDING.accentColor): BufSprite {
  const label = normalizeSignText(text);
  const pal = accentPalette(accent);
  const k = [...label].length <= 8 ? 2 : 1;
  const pad = 4;
  const tw = textWidth5x7(label, k);
  const boxW = tw + pad * 2;
  const boxH = GLYPH_H * k + pad * 2;
  const buf = new PixelBuf(boxW + 2, boxH + 2);
  roundedBox(buf, 1, 1, boxW, boxH, pal.accent, 2);
  drawText5x7(buf, label, 1 + pad, 1 + pad, pal.on, k);
  outlineAll(buf, BRAND_OUTLINE);
  return { buf, ax: Math.floor(buf.w / 2), ay: buf.h };
}

/** Ícone 16x16: caixa na cor de destaque com a primeira letra do texto da placa. */
export function renderBrandMark(text: string = DEFAULT_BRANDING.signText, accent: string = DEFAULT_BRANDING.accentColor): BufSprite {
  const label = normalizeSignText(text);
  const pal = accentPalette(accent);
  const buf = new PixelBuf(16, 16);
  roundedBox(buf, 0, 0, 16, 16, pal.accent, 2);
  const first = [...label].find((ch) => ch !== ' ' && FONT_5X7[ch]) ?? 'O';
  drawText5x7(buf, first, 5, 4, pal.on, 1);
  return { buf, ax: 8, ay: 16 };
}
