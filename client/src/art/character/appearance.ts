// Geração determinística de aparência a partir de uma semente (puro, sem DOM).
// `look` apenas enviesa as probabilidades de estilos; nada é exclusivo de um look, exceto barba ('m').
import { mulberry32 } from '../../../../shared/hash';
import type { Appearance } from '../api';
import {
  ACC_COLORS, ACC_W, BOTTOMS, BOTTOM_W, EYES_GENERATED, FACIAL_W, HAIR_FUN, HAIR_NATURAL, HAIR_STYLE_PICK_WEIGHTS, HAIR_W, JACKET_COLORS,
  LANYARDS, LIGHT_ACCENTS, SHIRT_COLORS, SHOES, SKINS_GENERATED, TIE_COLORS, TOP_COLORS, TOP_W,
} from '../../../../shared/validate/appearance-options';

export { SKINS } from '../../../../shared/validate/appearance-options';
/** Pesos de sorteio de penteado com os estilos novos incluídos (randomizer do editor). */
export { HAIR_STYLE_PICK_WEIGHTS };

type Weights<T extends string> = Readonly<Record<T, number>>;
export type FacialHair = NonNullable<Appearance['facialHair']>;
export type BottomStyle = NonNullable<Appearance['bottomStyle']>;

/** Mistura a semente (sementes consecutivas viram sequências bem diferentes). */
function scramble(seed: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export function appearanceFromSeed(seed: number, opts: { look?: 'f' | 'm'; sub?: boolean } = {}): Appearance {
  const rnd = mulberry32(scramble(seed));
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length) % arr.length];
  const weighted = <T extends string>(w: Weights<T>): T => {
    const entries = Object.entries(w) as [T, number][];
    const total = entries.reduce((s, [, v]) => s + v, 0);
    let x = rnd() * total;
    for (const [k, v] of entries) {
      x -= v;
      if (x < 0) return k;
    }
    return entries[entries.length - 1][0];
  };
  const weightedPair = (arr: readonly (readonly [string, number])[]): string =>
    weighted(Object.fromEntries(arr) as Weights<string>);

  // A ordem dos sorteios é fixa: mudar a ordem muda todas as aparências.
  const lookRoll = rnd();
  const look: 'f' | 'm' = opts.look ?? (lookRoll < 0.5 ? 'f' : 'm');
  const skin = pick(SKINS_GENERATED);
  const fun = rnd() < 0.08;
  const hair = fun ? pick(HAIR_FUN) : weightedPair(HAIR_NATURAL);
  let hairStyle = weighted(HAIR_W[look]);
  const eyes = pick(EYES_GENERATED);
  const topStyle = weighted(TOP_W[look]);

  let top: string;
  let topAccent: string;
  switch (topStyle) {
    case 'shirt_tie':
      top = pick(SHIRT_COLORS);
      topAccent = pick(TIE_COLORS);
      break;
    case 'jacket':
      top = pick(JACKET_COLORS);
      topAccent = rnd() < 0.7 ? pick(LIGHT_ACCENTS) : pick(TOP_COLORS);
      break;
    case 'hoodie':
    case 'polo':
      top = pick(TOP_COLORS);
      topAccent = rnd() < 0.6 ? pick(LIGHT_ACCENTS) : pick(TOP_COLORS);
      break;
    default:
      top = pick(TOP_COLORS);
      topAccent = pick(TOP_COLORS);
  }
  if (topAccent === top) topAccent = pick(LIGHT_ACCENTS);

  const bottom = weightedPair(BOTTOMS);
  const shoes = weightedPair(SHOES);
  let accessory = weighted(ACC_W[look]);
  // Bonés e gorros não combinam com penteados volumosos no topo.
  if ((accessory === 'cap' || accessory === 'beanie') && (hairStyle === 'afro' || hairStyle === 'bun' || hairStyle === 'mohawk' || hairStyle === 'pigtails')) {
    accessory = 'glasses';
  }
  if (accessory === 'bow' && (hairStyle === 'bald' || hairStyle === 'buzz')) accessory = 'earrings';
  const accessoryColor = pick(ACC_COLORS[accessory]);
  const lanyardRoll = rnd();
  const facialRoll = weighted(FACIAL_W);
  const facialHair: FacialHair = look === 'm' ? facialRoll : 'none';
  const bottomStyle = weighted(BOTTOM_W[look]);
  // Cabelos raros e grisalhos pedem menos careca/raspado em looks femininos.
  if (look === 'f' && hairStyle === 'bald') hairStyle = 'buzz';

  return {
    skin,
    hair,
    hairStyle,
    eyes,
    top,
    topAccent,
    topStyle,
    bottom,
    shoes,
    accessory,
    accessoryColor,
    lanyard: opts.sub ? LANYARDS[Math.floor(lanyardRoll * LANYARDS.length) % LANYARDS.length] : null,
    look,
    facialHair,
    bottomStyle,
  };
}

/** Chave estável de uma aparência (para cache de sprites). */
export function appearanceKey(a: Appearance): string {
  return [
    a.skin, a.hair, a.hairStyle, a.eyes, a.top, a.topAccent, a.topStyle, a.bottom, a.shoes, a.accessory,
    a.accessoryColor, a.lanyard ?? '-', a.look, a.facialHair ?? '-', a.bottomStyle ?? '-',
    ...(a.makeup && a.makeup !== 'none' ? [`mk:${a.makeup}`] : []),
    ...(a.freckles ? ['fr'] : []),
  ].join('|');
}
