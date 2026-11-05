// Listas e pesos de aparência compartilhados (cliente: gerador/editor; servidor: validação).
// Puro, sem dependências. Ordem das listas importa para `appearanceFromSeed` (determinismo).

export type HairStyleName =
  | 'short' | 'buzz' | 'spiky' | 'side_part' | 'curly' | 'afro' | 'bob' | 'long' | 'ponytail' | 'bun' | 'pigtails'
  | 'mohawk' | 'bald' | 'wavy' | 'braids' | 'undercut' | 'locs';
export type TopStyleName = 'tshirt' | 'hoodie' | 'shirt_tie' | 'sweater' | 'jacket' | 'blouse' | 'polo';
export type AccessoryName =
  | 'none' | 'glasses' | 'sunglasses' | 'headphones' | 'cap' | 'beanie' | 'earrings' | 'bow' | 'glasses_round' | 'hijab';
export type FacialHairName = 'none' | 'stubble' | 'beard' | 'mustache' | 'goatee';
export type BottomStyleName = 'pants' | 'shorts' | 'skirt' | 'dress';
export type MakeupName = 'none' | 'lipstick' | 'blush' | 'both';
export type LookName = 'f' | 'm';

export const LOOKS = ['f', 'm'] as const;

/** Os 8 primeiros são os originais (o gerador sorteia só entre eles); os 2 últimos são novos. */
export const SKINS = [
  '#ffe2cc', '#f6cfb0', '#eab894', '#d69f78', '#bd8560', '#9a6444', '#7a4a31', '#5a3623', '#ffd9c0', '#d4a384',
] as const;
export const SKINS_GENERATED = SKINS.slice(0, 8);

/** Opções do editor/validação (6 cores). */
export const EYES = ['#2b2236', '#4a2f22', '#5a3b22', '#2f5f9e', '#3c7a52', '#6b6f7a'] as const;
/** Lista que o gerador sorteia (a cor escura repetida preserva as probabilidades históricas). */
export const EYES_GENERATED = ['#2b2236', '#2b2236', '#4a2f22', '#5a3b22', '#2f5f9e', '#3c7a52'] as const;

export const HAIR_NATURAL: readonly (readonly [string, number])[] = [
  ['#2b2530', 5], // preto
  ['#3f2c22', 5], // castanho-escuro
  ['#5f3c28', 4], // castanho
  ['#87593a', 2.5], // castanho-claro
  ['#b0703c', 1.2], // ruivo-acobreado
  ['#8e3b2b', 1], // acaju
  ['#d6ae68', 1.8], // loiro
  ['#ebdcb0', 0.7], // platinado
  ['#8f929b', 0.7], // grisalho
  ['#d9dbe0', 0.5], // branco
];
export const HAIR_NATURAL_COLORS: string[] = HAIR_NATURAL.map(([c]) => c);
export const HAIR_FUN = ['#e47aa8', '#5b8fe0', '#8f6ad8', '#3fb3a0', '#e0584e', '#7cc45a', '#f0a24a'] as const;
export const HAIR_BRAND = ['#ffd800', '#e810b3', '#04d1d1'] as const;

export const TOP_COLORS = [
  '#e2604f', '#4a86d8', '#4bab72', '#efb54a', '#8d66cf', '#36b0b0', '#e47aa8', '#3d4352', '#f1efe9',
  '#8a96a3', '#2f4c7d', '#c9713f', '#76913f', '#e3d3b2', '#f29b72', '#5bc0de', '#b04a5a', '#f2d16b',
] as const;
export const SHIRT_COLORS = ['#f4f4f0', '#d3e3f4', '#f3d6de', '#dfe3e8', '#e9f1dc', '#fbf0d6'] as const;
export const TIE_COLORS = ['#c0392b', '#2f4c7d', '#7b2d44', '#2e7d4f', '#d9a42e', '#5b3a8c', '#3d4352'] as const;
export const JACKET_COLORS = ['#2f3b55', '#3d4352', '#6b4a35', '#55613b', '#262a33', '#b08a5e', '#7a2f3a', '#4a6a8a'] as const;
export const LIGHT_ACCENTS = ['#f4f4f0', '#e8e3d6', '#dfe7ef', '#f6e7c8', '#c9ced6'] as const;

export const BOTTOMS: readonly (readonly [string, number])[] = [
  ['#3f5f8c', 5], ['#2e3e5e', 4], ['#2c2c35', 4], ['#b49c72', 2], ['#6d7480', 2], ['#6e4c38', 1.5],
  ['#5f6845', 1.2], ['#2c3655', 2], ['#7f9cc4', 1.5], ['#e2ded5', 0.5], ['#9b3b3b', 0.4],
];
export const BOTTOM_COLORS: string[] = BOTTOMS.map(([c]) => c);
export const SHOES: readonly (readonly [string, number])[] = [
  ['#2b2b33', 5], ['#6b4630', 3], ['#ececec', 3], ['#d04848', 1], ['#3f63a8', 1], ['#b88752', 1.5], ['#7d8592', 1],
];
export const SHOE_COLORS: string[] = SHOES.map(([c]) => c);

const GLASSES_COLORS = ['#2b2b33', '#5a3a28', '#3f63a8', '#b03a3a', '#8a8f99'] as const;

export const ACC_COLORS: Record<AccessoryName, readonly string[]> = {
  none: ['#2b2b33'],
  glasses: GLASSES_COLORS,
  sunglasses: ['#22232b'],
  headphones: ['#2b2b33', '#f1efe9', '#e2604f', '#4a86d8', '#efb54a', '#36b0b0'],
  cap: ['#e2604f', '#4a86d8', '#2b2b33', '#4bab72', '#efb54a', '#f1efe9', '#2f4c7d'],
  beanie: ['#e2604f', '#efb54a', '#4bab72', '#8d66cf', '#3d4352', '#36b0b0'],
  earrings: ['#f2c14e', '#d9dde3'],
  bow: ['#e2604f', '#e47aa8', '#efb54a', '#4a86d8', '#8d66cf'],
  glasses_round: GLASSES_COLORS,
  hijab: ['#ffd800', '#e810b3', '#2b2b33', '#f4f2ee', '#4a86d8', '#8d66cf', '#36b0b0', '#e2604f'],
};

export const LANYARDS = ['#f2b33d', '#e2604f', '#4a86d8', '#4bab72', '#8d66cf', '#36b0b0'] as const;
/** Cor padrão do crachá (aceita além de LANYARDS). */
export const LANYARD_DEFAULT = '#ffd800';

export const HAIR_STYLES: readonly HairStyleName[] = [
  'short', 'buzz', 'spiky', 'side_part', 'curly', 'afro', 'bob', 'long', 'ponytail', 'bun', 'pigtails', 'mohawk', 'bald', 'wavy',
  'braids', 'undercut', 'locs',
];
export const TOP_STYLES: readonly TopStyleName[] = ['tshirt', 'hoodie', 'shirt_tie', 'sweater', 'jacket', 'blouse', 'polo'];
export const ACCESSORIES: readonly AccessoryName[] = [
  'none', 'glasses', 'sunglasses', 'headphones', 'cap', 'beanie', 'earrings', 'bow', 'glasses_round', 'hijab',
];
export const FACIAL_HAIR: readonly FacialHairName[] = ['none', 'stubble', 'beard', 'mustache', 'goatee'];
export const BOTTOM_STYLES: readonly string[] = ['pants', 'shorts', 'skirt', 'dress'];
export const MAKEUP: readonly MakeupName[] = ['none', 'lipstick', 'blush', 'both'];

/** Regras de incompatibilidade (dados). `replacement` é o acessório de troca. */
export interface IncompatibleRule {
  id: 'hat_volume' | 'bow_short' | 'hijab_facial';
  accessories: readonly string[];
  /** Estilos de cabelo que conflitam (se definido). */
  hairStyles?: readonly string[];
  /** Conflita com qualquer pelo facial diferente de 'none'. */
  facialHairNotNone?: boolean;
  replacement: AccessoryName;
}
export const INCOMPATIBLE: readonly IncompatibleRule[] = [
  { id: 'hat_volume', accessories: ['cap', 'beanie'], hairStyles: ['afro', 'bun', 'mohawk', 'pigtails'], replacement: 'glasses' },
  { id: 'bow_short', accessories: ['bow'], hairStyles: ['bald', 'buzz'], replacement: 'earrings' },
  { id: 'hijab_facial', accessories: ['hijab'], facialHairNotNone: true, replacement: 'glasses' },
];

type Weights<T extends string> = Readonly<Record<T, number>>;
type ByLook<T extends string> = Record<LookName, Weights<T>>;

export const HAIR_W: ByLook<HairStyleName> = {
  m: {
    short: 16, buzz: 9, spiky: 9, side_part: 12, curly: 9, afro: 6, bob: 2, long: 4, ponytail: 3, bun: 4,
    pigtails: 0.4, mohawk: 4, bald: 5, wavy: 9, braids: 0, undercut: 0, locs: 0,
  },
  f: {
    short: 4, buzz: 1.2, spiky: 2, side_part: 4, curly: 9, afro: 7, bob: 13, long: 16, ponytail: 13, bun: 10,
    pigtails: 6, mohawk: 1, bald: 0.4, wavy: 13, braids: 0, undercut: 0, locs: 0,
  },
};

/**
 * Pesos "reais" dos penteados novos, só para o sorteio do editor. O gerador por semente usa HAIR_W,
 * onde os novos pesam 0 para não alterar as aparências já geradas.
 */
export const HAIR_STYLE_PICK_WEIGHTS: ByLook<HairStyleName> = {
  m: { ...HAIR_W.m, braids: 1.5, undercut: 6, locs: 3 },
  f: { ...HAIR_W.f, braids: 7, undercut: 2, locs: 4 },
};
export const TOP_W: ByLook<TopStyleName> = {
  m: { tshirt: 20, hoodie: 16, shirt_tie: 10, sweater: 13, jacket: 13, blouse: 2, polo: 14 },
  f: { tshirt: 17, hoodie: 14, shirt_tie: 5, sweater: 14, jacket: 12, blouse: 20, polo: 8 },
};
export const ACC_W: ByLook<AccessoryName> = {
  m: { none: 40, glasses: 18, sunglasses: 4, headphones: 13, cap: 7, beanie: 6, earrings: 2, bow: 0.3, glasses_round: 0, hijab: 0 },
  f: { none: 36, glasses: 16, sunglasses: 4, headphones: 11, cap: 4, beanie: 5, earrings: 13, bow: 7, glasses_round: 0, hijab: 0 },
};
export const FACIAL_W: Weights<FacialHairName> = { none: 62, stubble: 12, beard: 13, mustache: 7, goatee: 6 };
export const BOTTOM_W: ByLook<BottomStyleName> = {
  m: { pants: 88, shorts: 12, skirt: 0, dress: 0 },
  f: { pants: 62, shorts: 10, skirt: 28, dress: 0 },
};
