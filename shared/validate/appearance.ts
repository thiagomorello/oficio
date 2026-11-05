// Validação e normalização de aparência (servidor e editor). Regras: Adendo B.4.
import { z } from 'zod';
import {
  ACCESSORIES,
  ACC_COLORS,
  BOTTOM_COLORS,
  BOTTOM_STYLES,
  EYES,
  FACIAL_HAIR,
  HAIR_BRAND,
  HAIR_FUN,
  HAIR_NATURAL_COLORS,
  HAIR_STYLES,
  INCOMPATIBLE,
  JACKET_COLORS,
  LANYARDS,
  LANYARD_DEFAULT,
  LIGHT_ACCENTS,
  MAKEUP,
  SHIRT_COLORS,
  SHOE_COLORS,
  SKINS,
  TIE_COLORS,
  TOP_COLORS,
  TOP_STYLES,
  type IncompatibleRule,
} from './appearance-options';
import { HEX_RE, luminance } from './color';

/** Forma estrutural da aparência (independe de onde o tipo `Appearance` vive). */
export interface AppearanceLike {
  skin: string;
  hair: string;
  hairStyle: string;
  eyes: string;
  top: string;
  topAccent: string;
  topStyle: string;
  bottom: string;
  shoes: string;
  accessory: string;
  accessoryColor: string;
  lanyard: string | null;
  look: 'f' | 'm';
  facialHair?: string;
  bottomStyle?: string;
  makeup?: string;
  freckles?: boolean;
}

export const LUMINANCE_MIN = 0.1;
export const LUMINANCE_MAX = 0.97;
export const APPEARANCE_MAX_JSON_BYTES = 2048;

const lc = (s: string): string => s.toLowerCase();
const KNOWN_COLORS = new Set<string>([
  ...SKINS, ...EYES, ...HAIR_NATURAL_COLORS, ...HAIR_FUN, ...HAIR_BRAND, ...TOP_COLORS, ...SHIRT_COLORS, ...TIE_COLORS,
  ...JACKET_COLORS, ...LIGHT_ACCENTS, ...BOTTOM_COLORS, ...SHOE_COLORS,
]);

export function isFreeColor(c: string): boolean {
  if (!HEX_RE.test(c)) return false;
  const l = luminance(c);
  return l >= LUMINANCE_MIN && l <= LUMINANCE_MAX;
}

// As mensagens dos issues são CHAVES de shared/i18n (área "avatar"), não texto: este módulo roda no servidor e no
// cliente, e cada um traduz na exibição (`hasMessage(msg) ? t(msg) : msg`). Mantém o arquivo puro, sem DOM nem i18n.
const hex = z.string().regex(HEX_RE, 'avatar.validate.invalidColor');
/** Cor livre: hex dentro da faixa de luminância OU qualquer cor das paletas oficiais. */
const freeColor = hex.refine((c) => KNOWN_COLORS.has(c) || isFreeColor(c), 'avatar.validate.luminanceOutOfRange');
const oneOf = <T extends string>(list: readonly T[]) => z.string().refine((v): v is T => (list as readonly string[]).includes(v), 'avatar.validate.invalidValue');

/** Primeira regra de incompatibilidade violada (ou null). */
export function findIncompatibility(a: Pick<AppearanceLike, 'accessory' | 'hairStyle' | 'facialHair'>): IncompatibleRule | null {
  for (const r of INCOMPATIBLE) {
    if (!r.accessories.includes(a.accessory)) continue;
    if (r.hairStyles?.includes(a.hairStyle)) return r;
    if (r.facialHairNotNone && (a.facialHair ?? 'none') !== 'none') return r;
  }
  return null;
}

function accColorsFor(accessory: string): readonly string[] {
  return (ACC_COLORS as Record<string, readonly string[]>)[accessory] ?? ACC_COLORS.none;
}

export const appearanceSchema = z
  .object({
    skin: oneOf(SKINS),
    hair: freeColor,
    hairStyle: oneOf(HAIR_STYLES),
    eyes: oneOf(EYES),
    top: freeColor,
    topAccent: freeColor,
    topStyle: oneOf(TOP_STYLES),
    bottom: freeColor,
    shoes: freeColor,
    accessory: oneOf(ACCESSORIES),
    accessoryColor: hex,
    lanyard: z.union([z.null(), z.string().refine((c) => (LANYARDS as readonly string[]).includes(c) || c === LANYARD_DEFAULT, 'avatar.validate.invalidBadge')]),
    look: z.enum(['f', 'm']),
    facialHair: oneOf(FACIAL_HAIR).optional(),
    bottomStyle: oneOf(BOTTOM_STYLES).optional(),
    makeup: oneOf(MAKEUP).optional(),
    freckles: z.boolean().optional(),
  })
  .strict()
  .superRefine((a, ctx) => {
    if (!accColorsFor(a.accessory).includes(a.accessoryColor)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['accessoryColor'], message: 'avatar.validate.invalidAccessoryColor' });
    }
    const bad = findIncompatibility(a);
    // A regra violada vira a chave `avatar.incompat.<id>`, a mesma que o editor mostra na dica da opção.
    if (bad) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['accessory'], message: `avatar.incompat.${bad.id}` });
    if (new TextEncoder().encode(JSON.stringify(a)).length > APPEARANCE_MAX_JSON_BYTES) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'avatar.validate.tooLarge' });
    }
  });

// Garante em tempo de compilação que o schema produz algo estruturalmente igual a AppearanceLike.
type _Check = z.infer<typeof appearanceSchema> extends AppearanceLike ? true : never;
const _check: _Check = true;
void _check;

/**
 * Preenche padrões, normaliza hex para minúsculas, reseta cor de acessório inválida e resolve
 * incompatibilidades (troca o acessório; hijab zera os pelos faciais). Não valida o resto: use `appearanceSchema` depois.
 */
export function normalizeAppearance<T extends AppearanceLike>(a: T): T {
  const out: AppearanceLike = { ...a };
  for (const k of ['skin', 'hair', 'eyes', 'top', 'topAccent', 'bottom', 'shoes', 'accessoryColor'] as const) {
    if (typeof out[k] === 'string') out[k] = lc(out[k]);
  }
  if (typeof out.lanyard === 'string') out.lanyard = lc(out.lanyard);
  out.facialHair = out.facialHair ?? 'none';
  out.bottomStyle = out.bottomStyle ?? 'pants';
  out.makeup = out.makeup ?? 'none';
  out.freckles = out.freckles ?? false;

  const bad = findIncompatibility(out);
  if (bad?.id === 'hijab_facial') out.facialHair = 'none';
  else if (bad) out.accessory = bad.replacement;
  if (!accColorsFor(out.accessory).includes(out.accessoryColor)) out.accessoryColor = accColorsFor(out.accessory)[0];
  return out as T;
}

export const displayNameSchema = z
  .string()
  .trim()
  .min(2, 'avatar.validate.nameTooShort')
  .max(24, 'avatar.validate.nameTooLong')
  .regex(/^[\p{L}\p{N} .'-]+$/u, 'avatar.validate.nameChars')
  .refine((s) => !/ {2}/.test(s), 'avatar.validate.nameDoubleSpaces');
