// Paleta da marca para o mundo em pixel art (Adendo C.1). Puro, sem DOM.
// Regra dura: piso/tapete com `luminance >= 0.26` (o contorno dos personagens é ~0,17).
// FLOORS/RUGS/WALLS/... alimentam o mapa padrão (`default-map.ts`) e o editor.
import { BRAND_SIGN_LABEL } from '../branding';
import type { MessageKey } from '../i18n';
import type { FloorKind, WallStyle } from './furniture';

export const BRAND = {
  bg: '#121212',
  s1: '#1c1c1c',
  s2: '#201f23',
  s3: '#2a292e',
  line: '#33333a',
  text: '#c8c5ca',
  yellow: '#ffd800',
  yellowHover: '#ffc300',
  yellowLogo: '#fed714',
  yellowDeep: '#b79303',
  red: '#e30b2f',
  green: '#048c22',
  info: '#4970fc',
  pink: '#e810b3',
  cyan: '#04d1d1',
  blue: '#2600ff',
} as const;

/** Luminância mínima de piso/tapete. */
export const MIN_FLOOR_LUMINANCE = 0.26;

/** Cor base (média) de cada piso SEM tint. Carpet não entra: usa `tint ?? CARPET_DEFAULT`. */
export const FLOOR_BASE: Readonly<Record<Exclude<FloorKind, 'carpet'>, string>> = {
  wood: '#b98a5e',
  // C.1 sugeria #b9bcc2, mas o cimento da arte é bem mais claro (média medida #dde0e2; teste ±0,06)
  concrete: '#dde0e2',
  marble: '#e6e4e0',
  tile_check: '#e2e3e1',
  tile_white: '#eef2f5',
  sidewalk: '#c4c0b8',
  grass: '#6cab57',
  street: '#55575c',
};

/** Cor padrão do carpete quando não há tint (igual a `art/surfaces/floor.ts`). */
export const CARPET_DEFAULT = '#c9d1dc';
/** Intensidade do tint aplicado aos pisos não-carpete (A.7). */
export const FLOOR_TINT_K = 0.45;

// ------------------------------------------------------------------ mapa padrão (C.1)

/** Piso pronto para `MapFloor` (sem o retângulo). */
export type FloorPreset = Readonly<{ kind: FloorKind; tint?: string; tint2?: string; tintK?: number }>;

/**
 * Pisos da marca: grafite escuro, mas legível. Os não-carpete usam `tintK` forte (o tint de 45 % sobre
 * a arte clara dá cinza-claro); a luminância estimada (`floorColor`) fica em 0,28–0,40 e a dos
 * carpetes em 0,27–0,32 (ver `palette.test.ts`).
 */
export const FLOORS = {
  openCarpet: { kind: 'carpet', tint: '#45454e', tint2: '#4c4c56' },
  // C.1 sugeria #43444c (luminância 0,268); um tom acima para ficar ≥ 0,27
  roomCarpet: { kind: 'carpet', tint: '#45464e', tint2: '#4c4d56' },
  zenCarpet: { kind: 'carpet', tint: '#3f4a44', tint2: '#46524b' },
  reception: { kind: 'carpet', tint: '#48484f', tint2: '#505058' },
  corridor: { kind: 'concrete', tint: '#50515a', tintK: 0.9 },
  praca: { kind: 'concrete', tint: '#4a4b55', tintK: 0.9 },
  kitchen: { kind: 'tile_check', tint: '#3b3b42', tintK: 0.85 },
  restroom: { kind: 'tile_white', tint: '#3a3f46', tintK: 0.85 },
  lounge: { kind: 'wood', tint: '#3d3530', tintK: 0.65 },
} as const satisfies Record<string, FloorPreset>;

/** Tapetes (escalas amarela/rosa/verde do tema). */
export const RUGS = {
  /** yellow.900 — sob as ilhas do open plan. */
  open: '#b79303',
  /** yellow.500 — recepção. */
  reception: '#ffd800',
  /** pink.600 — lounge. */
  lounge: '#c9149d',
  /** green.300 — sala zen. */
  zen: '#048c22',
  copa: '#b79303',
} as const;

export const WALLS = {
  office: { base: '#2a292e', trim: '#b79303', pattern: 'plain' },
  reception: { base: '#201f23', trim: '#ffd800', pattern: 'stripes' },
  meeting: { base: '#2f3340', trim: '#5a6070', pattern: 'glass' },
  amarela: { base: '#2f3340', trim: '#ffd800', pattern: 'glass' },
  kitchen: { base: '#33333a', trim: '#04d1d1', pattern: 'tiles' },
  restroom: { base: '#30343a', trim: '#4970fc', pattern: 'tiles' },
  lounge: { base: '#2a292e', trim: '#e810b3', pattern: 'plain' },
  zen: { base: '#2d3230', trim: '#048c22', pattern: 'wood_panel' },
} as const satisfies Record<string, WallStyle>;

/** Variantes de móveis do mapa padrão (todas existem em `FURNITURE[kind].variants`; ver o teste). */
export const FURNITURE_VARIANTS = {
  desk: 'dark',
  chairOpen: 'black',
  chairMeeting: 'gray',
  chairHub: 'blue',
  beanbags: ['yellow', 'blue', 'yellow', 'green'],
  plantsTall: ['monstera', 'ficus', 'palm', 'bonsai'],
  posters: ['rocket', 'code', 'ship_it'],
} as const;

/** Tom de identidade (`MapArea.floorTint`) das salas de reunião. */
export const ROOM_TINTS = {
  'sala-rosa': '#e810b3',
  'sala-azul': '#4970fc',
  'sala-amarela': '#ffd800',
  hub: '#04d1d1',
} as const;

/**
 * Placas das áreas do mapa padrão: chave de mensagem (`map.default.*`, traduzida na geração pelo
 * `buildDefaultMap(locale)`) ou `{brand}` = placa da marca configurada (literal, nunca traduzido).
 */
export const SIGNS = {
  recepcao: BRAND_SIGN_LABEL,
  'sala-rosa': 'map.default.salaRosa',
  'sala-azul': 'map.default.salaAzul',
  'sala-amarela': 'map.default.salaAmarela',
  hub: 'map.default.hub',
  copa: 'map.default.copa',
  lounge: 'map.default.lounge',
  'sala-zen': 'map.default.zen',
} as const satisfies Record<string, MessageKey | typeof BRAND_SIGN_LABEL>;
