// Núcleo do i18n (puro, sem DOM): dicionários por área, interpolação `{nome}`, plural simples e resolução de idioma.
// As mensagens ficam em shared/i18n/messages/*.ts; o ponto de entrada é shared/i18n/index.ts.
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from '../branding';

export type { Locale };
export { DEFAULT_LOCALE, SUPPORTED_LOCALES };

export type Params = Readonly<Record<string, string | number>>;

/** Mensagens de uma área, em todos os idiomas, com as chaves já prefixadas (`area.chave`). */
export type AreaMessages<K extends string> = { readonly [L in Locale]: Readonly<Record<K, string>> };

type Prefixed<P extends string, K> = K extends string ? `${P}.${K}` : never;

/**
 * Dicionários de uma área por idioma. `en` é a fonte das chaves; cada outro idioma de SUPPORTED_LOCALES é
 * obrigatório e precisa ter exatamente as mesmas chaves (erro de tipo se faltar ou sobrar).
 */
export type LocaleDicts<T extends Readonly<Record<string, string>>> = { readonly en: T } & {
  readonly [L in Exclude<Locale, 'en'>]: { readonly [K in keyof T]: string };
};

/**
 * Define as mensagens de uma área a partir de um mapa `{ en, 'pt-BR', es, ... }`. Devolve os dicionários com as
 * chaves prefixadas por `area.`. Para adicionar um idioma: inclua-o em SUPPORTED_LOCALES e o compilador aponta
 * cada área que ainda não o tem.
 */
export function defineMessages<P extends string, const T extends Readonly<Record<string, string>>>(
  area: P,
  dicts: LocaleDicts<T>,
): AreaMessages<Prefixed<P, keyof T>> {
  const prefix = (d: Readonly<Record<string, string>>): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(d)) out[`${area}.${k}`] = v;
    return out;
  };
  const out: Partial<Record<Locale, Record<string, string>>> = {};
  for (const locale of SUPPORTED_LOCALES) out[locale] = prefix((dicts as Record<Locale, Readonly<Record<string, string>>>)[locale]);
  return out as AreaMessages<Prefixed<P, keyof T>>;
}

/** Substitui `{nome}` pelos parâmetros; chaves ausentes ficam como estão (visível, para corrigir). */
export function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

/**
 * Escolhe o idioma suportado mais próximo de uma lista de candidatos (`localStorage`, `navigator.languages`,
 * `Accept-Language`...). Casa por igualdade, depois pelo idioma base (`pt-PT` -> `pt-BR`, `en-GB` -> `en`, `es-MX` -> `es`).
 */
export function resolveLocale(candidates: ReadonlyArray<string | null | undefined>, fallback: Locale = DEFAULT_LOCALE): Locale {
  const supported = SUPPORTED_LOCALES as readonly string[];
  for (const raw of candidates) {
    if (!raw) continue;
    const c = raw.trim();
    if (!c) continue;
    const exact = supported.find((s) => s.toLowerCase() === c.toLowerCase());
    if (exact) return exact as Locale;
    const base = c.toLowerCase().split(/[-_]/)[0]!;
    const byBase = supported.find((s) => s.toLowerCase().split('-')[0] === base);
    if (byBase) return byBase as Locale;
  }
  return fallback;
}

/** Lê o cabeçalho `Accept-Language` na ordem de preferência (q), já casado com os idiomas suportados. */
export function localeFromAcceptLanguage(header: string | undefined | null, fallback: Locale = DEFAULT_LOCALE): Locale {
  if (!header) return fallback;
  const parts = header
    .split(',')
    .map((p, i) => {
      const [tag, ...params] = p.trim().split(';');
      const q = params.map((x) => x.trim()).find((x) => x.startsWith('q='));
      const weight = q ? Number.parseFloat(q.slice(2)) : 1;
      return { tag: (tag ?? '').trim(), weight: Number.isFinite(weight) ? weight : 0, i };
    })
    .filter((p) => p.tag && p.tag !== '*' && p.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.i - b.i);
  return resolveLocale(
    parts.map((p) => p.tag),
    fallback,
  );
}

export interface Translator<K extends string> {
  /** Mensagem no idioma dado; cai para `en` e, por fim, para a própria chave. */
  tFor(locale: Locale, key: K, params?: Params): string;
  /** Plural simples: `chave.one` quando n === 1, senão `chave.other`; `{n}` já vai nos parâmetros. */
  tnFor(locale: Locale, key: string, n: number, params?: Params): string;
  has(key: string): key is K;
}

export function createTranslator<K extends string>(dicts: { readonly [L in Locale]: Readonly<Record<string, string>> }): Translator<K> {
  const lookup = (locale: Locale, key: string): string | undefined => dicts[locale]?.[key] ?? dicts[DEFAULT_LOCALE][key];
  return {
    tFor: (locale, key, params) => interpolate(lookup(locale, key) ?? key, params),
    tnFor: (locale, key, n, params) => {
      const k = `${key}.${n === 1 ? 'one' : 'other'}`;
      return interpolate(lookup(locale, k) ?? lookup(locale, key) ?? k, { n, ...params });
    },
    has: (key): key is K => lookup(DEFAULT_LOCALE, key) !== undefined,
  };
}
