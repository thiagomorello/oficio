// Decoração da própria mesa (Adendo D): tipos, catálogo, validação e posicionamento.
import { z } from 'zod';
import type { MessageKey } from './i18n';

export type DeskItemKind =
  | 'plant' | 'mug' | 'photo' | 'figure' | 'lamp' | 'headset' | 'books' | 'cactus' | 'pennant' | 'mousepad' | 'trophy' | 'laptop';
export type DeskSlot = 'left' | 'right' | 'back';
export interface DeskItem { kind: DeskItemKind; variant: string }
export interface DeskDecor { slots: { left?: DeskItem; right?: DeskItem; back?: DeskItem } }

export const DESK_SLOTS: readonly DeskSlot[] = ['left', 'right', 'back'];

/** Catálogo dos itens. `label` é a chave da mensagem (`shell.decor.<kind>`), traduzida com `t()` na hora de mostrar. */
export const DESK_ITEMS = {
  plant: { label: 'shell.decor.plant', variants: ['fern', 'succulent', 'flower'], size: { w: 6, h: 7 }, slots: ['left', 'right', 'back'] },
  mug: { label: 'shell.decor.mug', variants: ['red', 'blue', 'yellow', 'white'], size: { w: 5, h: 6 }, slots: ['left', 'right'] },
  photo: { label: 'shell.decor.photo', variants: ['wood', 'black', 'white'], size: { w: 6, h: 6 }, slots: ['left', 'right', 'back'] },
  figure: { label: 'shell.decor.figure', variants: ['hero', 'robot', 'dino'], size: { w: 5, h: 8 }, slots: ['left', 'right', 'back'] },
  lamp: { label: 'shell.decor.lamp', variants: ['yellow', 'black', 'white'], size: { w: 6, h: 9 }, slots: ['back'] },
  headset: { label: 'shell.decor.headset', variants: ['black', 'white', 'red'], size: { w: 6, h: 8 }, slots: ['left', 'right', 'back'] },
  books: { label: 'shell.decor.books', variants: ['warm', 'cool', 'accent'], size: { w: 7, h: 6 }, slots: ['left', 'right', 'back'] },
  cactus: { label: 'shell.decor.cactus', variants: ['round', 'tall', 'flowering'], size: { w: 5, h: 7 }, slots: ['left', 'right', 'back'] },
  pennant: { label: 'shell.decor.pennant', variants: ['yellow', 'black', 'pink'], size: { w: 8, h: 9 }, slots: ['back'] },
  mousepad: { label: 'shell.decor.mousepad', variants: ['yellow', 'pink', 'cyan', 'black'], size: { w: 8, h: 5 }, slots: ['left', 'right'] },
  trophy: { label: 'shell.decor.trophy', variants: ['gold', 'silver', 'bronze'], size: { w: 6, h: 8 }, slots: ['left', 'right', 'back'] },
  laptop: { label: 'shell.decor.laptop', variants: ['silver', 'black', 'sticker'], size: { w: 9, h: 5 }, slots: ['left', 'right'] },
} as const satisfies Record<DeskItemKind, { label: MessageKey; variants: readonly string[]; size: { w: number; h: number }; slots: readonly DeskSlot[] }>;

export const DESK_ITEM_KINDS = Object.keys(DESK_ITEMS) as DeskItemKind[];
export const MAX_DECOR_BYTES = 512;

interface ItemInfo { variants: readonly string[]; slots: readonly string[]; size: { w: number; h: number } }
function info(kind: string): ItemInfo | undefined {
  return Object.prototype.hasOwnProperty.call(DESK_ITEMS, kind) ? (DESK_ITEMS as unknown as Record<string, ItemInfo>)[kind] : undefined;
}

export const deskItemSchema = z
  .object({ kind: z.enum(DESK_ITEM_KINDS as [DeskItemKind, ...DeskItemKind[]]), variant: z.string().max(24) })
  .strict()
  .refine((i) => info(i.kind)?.variants.includes(i.variant) === true, { message: 'server.decor.invalidVariant' });

export const deskDecorSchema = z
  .object({
    slots: z.object({ left: deskItemSchema.optional(), right: deskItemSchema.optional(), back: deskItemSchema.optional() }).strict(),
  })
  .strict()
  .refine(
    (d) => DESK_SLOTS.every((s) => { const it = d.slots[s]; return !it || info(it.kind)?.slots.includes(s) === true; }),
    { message: 'server.decor.slotMismatch' },
  )
  .refine((d) => JSON.stringify(d).length <= MAX_DECOR_BYTES, { message: 'server.decor.tooLarge' });

export function isEmptyDecor(d: DeskDecor | null | undefined): boolean {
  return !d || DESK_SLOTS.every((s) => !d.slots[s]);
}

/**
 * Sanea qualquer entrada (JSON do banco, etc.): descarta slots inválidos e chaves extras.
 * Devolve `null` quando não sobra nada.
 */
export function normalizeDecor(input: unknown): DeskDecor | null {
  if (!input || typeof input !== 'object') return null;
  const raw = (input as { slots?: unknown }).slots;
  if (!raw || typeof raw !== 'object') return null;
  const slots: DeskDecor['slots'] = {};
  for (const s of DESK_SLOTS) {
    const cand = (raw as Record<string, unknown>)[s];
    if (!cand || typeof cand !== 'object') continue;
    const parsed = deskItemSchema.safeParse({ kind: (cand as DeskItem).kind, variant: (cand as DeskItem).variant });
    if (parsed.success && info(parsed.data.kind)?.slots.includes(s)) slots[s] = { kind: parsed.data.kind, variant: parsed.data.variant };
  }
  const out: DeskDecor = { slots };
  return isEmptyDecor(out) ? null : out;
}

export interface DeskPlacement {
  slot: DeskSlot;
  kind: DeskItemKind;
  variant: string;
  /** px relativos ao canto superior esquerdo do footprint 32×16. */
  x: number;
  /** y da base do item (âncora inferior esquerda). */
  baseY: number;
  w: number;
  h: number;
}

/** Ordem de desenho: back, left, right (tabela D.3). */
export function deskDecorPlacements(decor: DeskDecor | null | undefined): DeskPlacement[] {
  if (!decor) return [];
  const out: DeskPlacement[] = [];
  for (const slot of ['back', 'left', 'right'] as const) {
    const it = decor.slots[slot];
    if (!it) continue;
    const meta = info(it.kind);
    if (!meta) continue;
    const { w, h } = meta.size;
    const x = slot === 'back' ? 24 : slot === 'left' ? 1 : 31 - w;
    const baseY = slot === 'back' ? -2 : 5;
    out.push({ slot, kind: it.kind, variant: it.variant, x, baseY, w, h });
  }
  return out;
}
