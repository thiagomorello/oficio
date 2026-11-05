// Itens de decoração de mesa (Adendo D) e modo clean da mesa.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DESK_ITEMS, DESK_ITEM_KINDS, type DeskItemKind } from '../../../shared/desk-decor';
import { FURNITURE } from './api';
import type { PixelBuf } from './core/pixbuf';
import { renderDeskItem } from './furniture/desk-items';
import { normalizeFurniture, renderFurniture } from './furniture/index';
import { deskBare } from './furniture/office';

function px(buf: PixelBuf, x: number, y: number): string {
  if (x < 0 || y < 0 || x >= buf.w || y >= buf.h) return 'out';
  const i = (y * buf.w + x) * 4;
  return `${buf.data[i]},${buf.data[i + 1]},${buf.data[i + 2]},${buf.data[i + 3]}`;
}

describe('renderDeskItem', () => {
  for (const kind of DESK_ITEM_KINDS) {
    for (const variant of DESK_ITEMS[kind].variants) {
      it(`${kind}/${variant}: tamanho, âncora e contorno`, () => {
        const { w, h } = DESK_ITEMS[kind].size;
        const s = renderDeskItem(kind as DeskItemKind, variant);
        expect(s.buf.w).toBe(w);
        expect(s.buf.h).toBe(h);
        expect([s.ax, s.ay]).toEqual([0, h - 1]);
        expect(s.buf.countOpaque()).toBeGreaterThan(w);
        // Ocupa o buffer inteiro: sem pixels fora e com conteúdo em todas as bordas.
        expect(s.buf.bounds()).toEqual({ x: 0, y: 0, w, h });
        // Contorno: pixels da borda do buffer são todos contorno (arte fica na área interna).
        let outline = 0;
        for (let x = 0; x < w; x++) for (const y of [0, h - 1]) if (s.buf.alpha(x, y) === 255) outline++;
        for (let y = 0; y < h; y++) for (const x of [0, w - 1]) if (s.buf.alpha(x, y) === 255) outline++;
        expect(outline).toBeGreaterThan(0);
        // A arte interna nunca é totalmente contorno.
        let inner = 0;
        for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) if (s.buf.alpha(x, y) === 255) inner++;
        expect(inner).toBeGreaterThan(3);
      });
    }
  }

  it('bandeirinha: "W" legível na cor de contraste', () => {
    const s = renderDeskItem('pennant', 'yellow');
    const dark = [18, 18, 18, 255].join(',');
    let n = 0;
    for (let y = 0; y < s.buf.h; y++) for (let x = 0; x < s.buf.w; x++) if (px(s.buf, x, y) === dark) n++;
    expect(n).toBeGreaterThanOrEqual(7);
  });

  it('adesivo 2×2 amarelo só na variante sticker', () => {
    const yellow = '255,216,0,255';
    const count = (v: string) => {
      const b = renderDeskItem('laptop', v).buf;
      let n = 0;
      for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (px(b, x, y) === yellow) n++;
      return n;
    };
    expect(count('sticker')).toBe(4);
    expect(count('silver')).toBe(0);
    expect(count('black')).toBe(0);
  });
});

describe('mesa clean', () => {
  const deskVariants = FURNITURE.desk.variants ?? [undefined];
  const backVariants = FURNITURE.desk_back.variants ?? [undefined];

  /** Origem do footprint 32×16 no sprite (a âncora é o centro inferior do footprint). */
  const origin = (s: { ax: number; ay: number }) => ({ ox: s.ax - 16, oy: s.ay - 16 });
  const at = (b: PixelBuf, x: number, y: number) => (x < 0 || y < 0 || x >= b.w || y >= b.h ? '0,0,0,0' : px(b, x, y));

  interface Box { x0: number; x1: number; y0: number; y1: number }
  /** Pixels (coords do footprint) em `areas` onde o clean difere da mesa vazia, fora de `allowed`. */
  function strayPixels(kind: 'desk' | 'desk_back', variant: string | undefined, areas: Box[], allowed: Box[]): string[] {
    const s = renderFurniture(kind, variant, 0, 3, true).base;
    const ref = deskBare(variant, kind === 'desk_back');
    const o = origin(s);
    const r = origin(ref);
    const out: string[] = [];
    for (const a of areas) {
      for (let y = a.y0; y <= a.y1; y++) {
        for (let x = a.x0; x <= a.x1; x++) {
          if (at(s.buf, o.ox + x, o.oy + y) === at(ref.buf, r.ox + x, r.oy + y)) continue;
          if (allowed.some((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1)) continue;
          out.push(`${x},${y}`);
        }
      }
    }
    return out;
  }

  // Slots de D.3, relativos ao canto superior esquerdo do footprint.
  const SLOTS: Box[] = [
    { x0: 24, x1: 31, y0: -10, y1: -2 },
    { x0: 1, x1: 9, y0: -3, y1: 5 },
    { x0: 22, x1: 31, y0: -3, y1: 5 },
  ];

  it('clean ignora a semente (vseed = 0)', () => {
    expect(normalizeFurniture('desk', 'wood', 0, 13, true).vseed).toBe(0);
    expect(normalizeFurniture('desk', 'wood', 0, 13).vseed).toBe(1);
    expect(normalizeFurniture('desk_back', 'wood', 0, 3, true).vseed).toBe(0);
    for (const kind of ['desk', 'desk_back'] as const) {
      for (const v of kind === 'desk' ? deskVariants : backVariants) {
        const ref = renderFurniture(kind, v, 0, 0, true).base.buf.data;
        for (const seed of [1, 2, 3, 4, 5, 11]) {
          expect(renderFurniture(kind, v, 0, seed, true).base.buf.data).toEqual(ref);
        }
      }
    }
  });

  it('desk clean: tela em x 8..24 e slots sem itens soltos', () => {
    for (const v of deskVariants) {
      const s = renderFurniture('desk', v, 0, 3, true).base;
      const { ox } = origin(s);
      const scr = s.rects?.screen;
      expect(scr).toBeDefined();
      expect(scr!.x - ox).toBeGreaterThanOrEqual(8);
      expect(scr!.x - ox + scr!.w).toBeLessThanOrEqual(24);
      expect(s.rects?.screen2).toBeUndefined();
      // Só monitor (com contorno e sombra) e teclado podem diferir da mesa vazia; nunca caneca etc.
      const mon: Box = { x0: 7, x1: 24, y0: -18, y1: -3 };
      const kbd: Box = { x0: 10, x1: 21, y0: -2, y1: 3 };
      expect(strayPixels('desk', v, SLOTS, [mon, kbd])).toEqual([]);
      // Os slots esquerdo e direito não têm nenhum pixel diferente da mesa vazia (exceto a sombra do monitor).
      expect(strayPixels('desk', v, [SLOTS[1]], [])).toEqual([]);
      expect(strayPixels('desk', v, [SLOTS[2]], [{ x0: 22, x1: 22, y0: -3, y1: -3 }])).toEqual([]);
    }
  });

  it('desk_back clean: verso do monitor em x 8..23 e sem itens soltos', () => {
    for (const v of backVariants) {
      const mon: Box = { x0: 7, x1: 24, y0: -8, y1: 6 };
      expect(strayPixels('desk_back', v, SLOTS, [mon])).toEqual([]);
      expect(strayPixels('desk_back', v, [{ x0: 25, x1: 31, y0: -10, y1: 5 }, { x0: 1, x1: 7, y0: -3, y1: 5 }], [])).toEqual([]);
    }
  });

  it('o modo normal continua com itens soltos (clean é diferente)', () => {
    const a = renderFurniture('desk', 'wood', 0, 0, true).base.buf.data;
    const b = renderFurniture('desk', 'wood', 0, 0, false).base.buf.data;
    expect(a).not.toEqual(b);
  });
});

describe('cache do modo clean', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('furnitureSprites clean tem entrada própria e ignora a semente', async () => {
    const canvases: unknown[] = [];
    vi.stubGlobal('document', {
      createElement: () => {
        const c = { width: 0, height: 0, getContext: () => ({ putImageData: () => undefined }) };
        canvases.push(c);
        return c;
      },
    });
    vi.stubGlobal('ImageData', class {
      constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
    });
    const art = await import('./index');
    const a = art.furnitureSprites('desk', 'wood', 0, { seed: 3 });
    const c1 = art.furnitureSprites('desk', 'wood', 0, { seed: 3, clean: true });
    const c2 = art.furnitureSprites('desk', 'wood', 0, { seed: 5, clean: true });
    expect(c1).toBe(c2);
    expect(c1).not.toBe(a);
    expect(art.furnitureSprites('desk', 'wood', 0, { seed: 3 })).toBe(a);
    const d = art.deskItemSprite('mug', 'red');
    expect(art.deskItemSprite('mug', 'red')).toBe(d);
    expect(d.ax).toBe(0);
    expect(d.ay).toBe(DESK_ITEMS.mug.size.h - 1);
  });
});
