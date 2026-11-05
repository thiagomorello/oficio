// Ponto de entrada do i18n. Cliente: `t(key)` usa o idioma atual (setLocale). Servidor: `tFor(locale, key)`
// com o idioma de cada requisição (server/i18n.ts), porque o processo atende várias pessoas ao mesmo tempo.
//
// Adicionar uma mensagem: escolha a área em shared/i18n/messages/, acrescente a chave em `en` e em cada outro
// idioma do mapa (`pt-BR`, `es`; o tipo obriga todos) e use `t('area.chave')`. Parâmetros: `t('x.y', { name })` com `{name}` no texto.
// Plural: chaves `x.y.one` e `x.y.other` com `tn('x.y', n)`.
import { createTranslator, DEFAULT_LOCALE, interpolate, resolveLocale, SUPPORTED_LOCALES, type Locale, type Params } from './core';
import { admin } from './messages/admin';
import { av } from './messages/av';
import { avatar } from './messages/avatar';
import { common } from './messages/common';
import { editor } from './messages/editor';
import { login } from './messages/login';
import { map } from './messages/map';
import { server } from './messages/server';
import { shell } from './messages/shell';
import { telemetry } from './messages/telemetry';

export { DEFAULT_LOCALE, SUPPORTED_LOCALES, interpolate, localeFromAcceptLanguage, resolveLocale } from './core';
export type { Locale, Params } from './core';

const AREAS = [common, login, admin, telemetry, shell, av, avatar, editor, map, server] as const;

type KeysOf<A> = A extends { readonly en: Readonly<Record<infer K, string>> } ? K : never;
/** Todas as chaves conhecidas (união das áreas). */
export type MessageKey = KeysOf<(typeof AREAS)[number]> & string;
/** Chaves com plural (`x.one` / `x.other`), usadas por `tn`. */
export type PluralKey = MessageKey extends infer K ? (K extends `${infer B}.other` ? B : never) : never;

function merge(locale: Locale): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of AREAS) Object.assign(out, a[locale]);
  return out;
}

export const MESSAGES: { readonly [L in Locale]: Readonly<Record<string, string>> } = Object.fromEntries(
  SUPPORTED_LOCALES.map((l) => [l, merge(l)]),
) as Record<Locale, Readonly<Record<string, string>>>;

const translator = createTranslator<MessageKey>(MESSAGES);

/** Tradução explícita por idioma (servidor, e-mails, testes). */
export function tFor(locale: Locale, key: MessageKey, params?: Params): string {
  return translator.tFor(locale, key, params);
}
export function tnFor(locale: Locale, key: PluralKey, n: number, params?: Params): string {
  return translator.tnFor(locale, key, n, params);
}
export const hasMessage = translator.has;

// ------------------------------------------------------------------ idioma atual (cliente)

let current: Locale = DEFAULT_LOCALE;
const listeners = new Set<(locale: Locale) => void>();

export function getLocale(): Locale {
  return current;
}

/** Troca o idioma atual e avisa os ouvintes (a interface se redesenha). */
export function setLocale(locale: Locale): void {
  if (locale === current) return;
  current = locale;
  for (const fn of listeners) fn(locale);
}

export function onLocaleChange(fn: (locale: Locale) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Mensagem no idioma atual. */
export function t(key: MessageKey, params?: Params): string {
  return translator.tFor(current, key, params);
}
export function tn(key: PluralKey, n: number, params?: Params): string {
  return translator.tnFor(current, key, n, params);
}

/** Nome do idioma para seletores, no próprio idioma. */
export const LOCALE_NAMES: Readonly<Record<Locale, string>> = { en: 'English', 'pt-BR': 'Português (Brasil)', es: 'Español' };

/** Só para testes: volta ao padrão sem avisar ouvintes. */
export function resetLocaleForTests(locale: Locale = DEFAULT_LOCALE): void {
  current = locale;
  listeners.clear();
}

export { resolveLocale as pickLocale };
