// Sorteios do montador (puros, sem DOM): por seção e geral. Respeitam as incompatibilidades.
import {
  ACCESSORIES,
  ACC_COLORS,
  ACC_W,
  BOTTOMS,
  BOTTOM_STYLES,
  BOTTOM_W,
  EYES,
  FACIAL_HAIR,
  FACIAL_W,
  HAIR_FUN,
  HAIR_NATURAL,
  HAIR_STYLES,
  HAIR_W,
  LANYARDS,
  LANYARD_DEFAULT,
  LIGHT_ACCENTS,
  MAKEUP,
  SHOES,
  SKINS,
  TOP_STYLES,
  TOP_W,
} from '../../../../shared/validate/appearance-options';
import { findIncompatibility, normalizeAppearance } from '../../../../shared/validate/appearance';
import type { Appearance } from '../../art/api';
import { appearanceFromSeed } from '../../art/character/appearance';
import { accentColorsFor, topColorsFor } from './swatches';

export type SectionId = 'body' | 'face' | 'hair' | 'top' | 'bottom' | 'shoes' | 'accessories' | 'badge';
export type Rnd = () => number;
type Look = 'f' | 'm';

const pick = <T,>(arr: readonly T[], rnd: Rnd): T => arr[Math.min(arr.length - 1, Math.floor(rnd() * arr.length))];

export function pickWeighted<T>(items: readonly T[], weight: (t: T) => number, rnd: Rnd): T {
  const ws = items.map((i) => Math.max(0, weight(i)));
  const total = ws.reduce((s, w) => s + w, 0);
  if (total <= 0) return pick(items, rnd);
  let x = rnd() * total;
  for (let i = 0; i < items.length; i++) {
    x -= ws[i];
    if (x < 0) return items[i];
  }
  return items[items.length - 1];
}

/** Peso de uma opção (opções novas sem peso na tabela contam 1). */
const weightFn = (table: Readonly<Record<string, number>>) => (k: string): number => table[k] ?? 1;
const accColors = (acc: string): readonly string[] => (ACC_COLORS as Record<string, readonly string[]>)[acc] ?? ACC_COLORS.none;

/** Sorteia só os campos da seção; o resto do rascunho é preservado (já normalizado). */
export function randomSection(section: SectionId, draft: Appearance, look: Look, rnd: Rnd = Math.random): Appearance {
  const d = { ...draft } as Appearance;
  switch (section) {
    case 'body':
      d.skin = pick(SKINS, rnd);
      break;
    case 'face':
      d.eyes = pick(EYES, rnd);
      d.facialHair = (d.accessory as string) === 'hijab' || look === 'f' ? 'none' : pickWeighted(FACIAL_HAIR, weightFn(FACIAL_W), rnd);
      d.makeup = look === 'f' ? pick(MAKEUP, rnd) : 'none';
      d.freckles = rnd() < 0.2;
      break;
    case 'hair': {
      const ok = HAIR_STYLES.filter((s) => !findIncompatibility({ ...d, hairStyle: s }));
      d.hairStyle = pickWeighted(ok.length ? ok : HAIR_STYLES, weightFn(HAIR_W[look]), rnd);
      d.hair = rnd() < 0.08 ? pick(HAIR_FUN, rnd) : pickWeighted(HAIR_NATURAL, (p) => p[1], rnd)[0];
      break;
    }
    case 'top':
      d.topStyle = pickWeighted(TOP_STYLES, weightFn(TOP_W[look]), rnd);
      d.top = pick(topColorsFor(d.topStyle), rnd);
      d.topAccent = d.topStyle === 'jacket' && rnd() < 0.7 ? pick(LIGHT_ACCENTS, rnd) : pick(accentColorsFor(d.topStyle), rnd);
      break;
    case 'bottom':
      d.bottomStyle = pickWeighted(BOTTOM_STYLES, weightFn(BOTTOM_W[look]), rnd) as Appearance['bottomStyle'];
      d.bottom = pickWeighted(BOTTOMS, (p) => p[1], rnd)[0];
      break;
    case 'shoes':
      d.shoes = pickWeighted(SHOES, (p) => p[1], rnd)[0];
      break;
    case 'accessories': {
      const ok = ACCESSORIES.filter((a) => !findIncompatibility({ ...d, accessory: a }));
      d.accessory = pickWeighted(ok.length ? ok : ACCESSORIES, weightFn(ACC_W[look]), rnd);
      d.accessoryColor = pick(accColors(d.accessory), rnd);
      break;
    }
    case 'badge':
      d.lanyard = rnd() < 0.5 ? null : pick([...LANYARDS, LANYARD_DEFAULT], rnd);
      break;
  }
  return normalizeAppearance(d);
}

function randomSeed(): number {
  const c = globalThis.crypto;
  if (c?.getRandomValues) return c.getRandomValues(new Uint32Array(1))[0];
  return Math.floor(Math.random() * 0x100000000);
}

/** Aparência totalmente nova para o `look` dado (semente do `crypto.getRandomValues`). */
export function randomAll(look: Look, seed: number = randomSeed()): Appearance {
  return normalizeAppearance(appearanceFromSeed(seed, { look }));
}
