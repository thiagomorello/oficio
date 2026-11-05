// Itens de decoração da mesa (Adendo D): 12 tipos × variantes, desenhados em PixelBuf (puro).
//
// Cada sprite tem EXATAMENTE o tamanho de DESK_ITEMS[kind].size: a arte ocupa a área interna
// (w-2)×(h-2), deslocada em (1,1), e o contorno automático de 1 px preenche a borda do buffer. A linha
// de baixo do buffer (contorno inferior) é a base do item: âncora inferior esquerda (ax=0, ay=h-1),
// colocada por `deskDecorPlacements` em (x, baseY) relativos ao footprint da mesa. Sem sombra.
// Os modelos são pequenos demais para reaproveitar kit.ts (mug 4×4, suculenta 4×6 + contorno não cabem
// nos tamanhos do catálogo); as cores seguem a especificação D.1.
import { DESK_ITEMS, type DeskItemKind } from '../../../../shared/desk-decor';
import { shade } from '../core/color';
import { PixelBuf, type Palette } from '../core/pixbuf';
import type { BufSprite } from '../core/sprite';

interface Model {
  /** Linhas da arte (largura w-2, altura h-2). '.' = transparente. */
  rows: readonly string[];
  pal: Palette;
}

const LEAF = '#4bab72';
const LEAF_DK = '#3f8a62';
const POT = '#c9713f';
const POT_DK = shade(POT, -0.18);
const STEEL = '#565d6b';

function pick<T>(table: Readonly<Record<string, T>>, variant: string): T {
  return table[variant] ?? Object.values(table)[0];
}

function plant(variant: string): Model {
  const pal: Palette = { g: LEAF, d: LEAF_DK, p: POT, q: POT_DK, f: '#f26d8a', y: '#ffd800' };
  switch (variant) {
    case 'succulent':
      return { rows: ['.gg.', 'gdgg', 'gdgd', 'pppp', '.qq.'], pal };
    case 'flower':
      return { rows: ['.f..', 'fyf.', '.dg.', 'pppp', '.qq.'], pal };
    default:
      return { rows: ['g.dg', '.gd.', 'dg.g', 'pppp', '.qq.'], pal };
  }
}

function mug(variant: string): Model {
  const c = pick({ red: '#e2604f', blue: '#3f7fd8', yellow: '#ffd800', white: '#f4f2ee' }, variant);
  return {
    rows: ['wk.', 'acH', 'cc.', 'ddH'],
    pal: { w: '#f4f2ee', k: '#6b4226', c, a: shade(c, 0.18), d: shade(c, -0.15), H: shade(c, -0.22) },
  };
}

function photo(variant: string): Model {
  const f = pick({ wood: '#b98a5e', black: '#2b2b33', white: '#f4f2ee' }, variant);
  return { rows: ['FFFF', 'FPPF', 'FPGF', 'FFFF'], pal: { F: f, P: '#8fc8f0', G: '#6fbf6a' } };
}

function figure(variant: string): Model {
  switch (variant) {
    case 'robot':
      return { rows: ['.c.', 'ggg', 'cgc', '.g.', 'ggg', 'g.g'], pal: { g: '#aeb6c2', c: '#04d1d1' } };
    case 'dino':
      return { rows: ['.gg', '.gk', 'dg.', 'ggg', 'dgg', 'g.g'], pal: { g: LEAF, d: LEAF_DK, k: '#121212' } };
    default:
      return { rows: ['.s.', 'rrr', '.r.', '.r.', 'b.b', 'b.b'], pal: { s: '#f2c9a0', r: '#e2604f', b: '#3f7fd8' } };
  }
}

function lamp(variant: string): Model {
  const c = pick({ yellow: '#ffd800', black: '#2b2b33', white: '#f4f2ee' }, variant);
  return {
    rows: ['.SS.', 'SsSS', '.tl.', '.t..', '.t..', '.t..', 'tttt'],
    pal: { S: c, s: shade(c, 0.2), t: STEEL, l: '#fff6c4' },
  };
}

function headset(variant: string): Model {
  const c = pick({ black: '#2b2b33', white: '#f1efe9', red: '#e2604f' }, variant);
  return {
    rows: ['.hh.', 'h..h', 'cttc', 'cttc', '.tt.', 'tttt'],
    pal: { h: c, c: shade(c, -0.12), t: STEEL },
  };
}

function books(variant: string): Model {
  const [a, b, c] = pick(
    { warm: ['#e2604f', '#3f7fd8', '#f2c14e'], cool: ['#4bab72', '#f4f2ee', '#8d66cf'], accent: ['#7c9cff', '#121212', '#c8c5ca'] },
    variant,
  );
  return {
    rows: ['AaAA.', '.BbBB', 'CCCCC', 'CcCCC'],
    pal: { A: a, a: shade(a, 0.25), B: b, b: shade(b, 0.25), C: c, c: shade(c, -0.2) },
  };
}

function cactus(variant: string): Model {
  const pal: Palette = { g: LEAF, d: LEAF_DK, p: POT, q: POT_DK, f: '#e810b3' };
  switch (variant) {
    case 'tall':
      return { rows: ['.g.', 'gg.', '.gg', '.d.', 'ppp'], pal };
    case 'flowering':
      return { rows: ['.f.', 'gdg', 'ggg', 'ppp', '.q.'], pal };
    default:
      return { rows: ['.g.', 'gdg', 'ggg', 'ppp', '.q.'], pal };
  }
}

function pennant(variant: string): Model {
  const [flag, w] = pick({ yellow: ['#ffd800', '#121212'], black: ['#121212', '#ffd800'], pink: ['#e810b3', '#ffffff'] }, variant);
  return {
    rows: ['pFFFFF', 'pWFFFW', 'pWFWFW', 'pFWFWF', 'pFF.FF', 'p.....', 'ppp...'],
    pal: { p: STEEL, F: flag, W: w },
  };
}

function mousepad(variant: string): Model {
  const c = pick({ yellow: '#b79303', pink: '#c9149d', cyan: '#04d1d1', black: '#2b2f3a' }, variant);
  return {
    rows: ['PPPPPP', 'PPPmmP', 'dddddd'],
    pal: { P: c, d: shade(c, -0.22), m: '#d9dce2' },
  };
}

function trophy(variant: string): Model {
  const c = pick({ gold: '#f2c14e', silver: '#d9dde3', bronze: '#b88752' }, variant);
  return {
    rows: ['LCCC', 'hCCh', '.CC.', '.ss.', 'dddd', 'dddd'],
    pal: { L: shade(c, 0.3), C: c, h: shade(c, -0.12), s: shade(c, -0.2), d: shade(c, -0.38) },
  };
}

function laptop(variant: string): Model {
  const c = variant === 'black' ? '#2b2f3a' : '#aeb6c2';
  const rows = variant === 'sticker' ? ['LLLLLLL', 'LLYYLLL', 'bbbbbbb'] : ['LLLLLLL', 'LLLLLLL', 'bbbbbbb'];
  // O adesivo ocupa 2×2: usa também a linha de cima.
  if (variant === 'sticker') rows[0] = 'LLYYLLL';
  return { rows, pal: { L: c, b: shade(c, -0.28), Y: '#ffd800' } };
}

const MODELS: Record<DeskItemKind, (variant: string) => Model> = {
  plant, mug, photo, figure, lamp, headset, books, cactus, pennant, mousepad, trophy, laptop,
};

/** Desenha um item de decoração de mesa. Tamanho = DESK_ITEMS[kind].size; âncora (0, h-1). */
export function renderDeskItem(kind: DeskItemKind, variant: string): BufSprite {
  const { w, h } = DESK_ITEMS[kind].size;
  const buf = new PixelBuf(w, h);
  const m = MODELS[kind](variant);
  buf.stamp(m.rows, 1, 1, m.pal);
  buf.outline();
  return { buf, ax: 0, ay: h - 1 };
}
