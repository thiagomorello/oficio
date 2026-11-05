// Idioma por requisição no servidor: cookie/escolha do usuário não chega aqui (fica no navegador), então
// usamos `Accept-Language` com fallback no padrão da instância (OFFICE_DEFAULT_LOCALE).
import type { IncomingMessage } from 'node:http';
import { localeFromAcceptLanguage, tFor, tnFor, type Locale, type MessageKey, type Params, type PluralKey } from '../shared/i18n';
import { isLocale } from '../shared/branding';

export { tFor, tnFor };
export type { Locale, MessageKey };

/** Idioma da requisição: `?lang=` (links de e-mail) > Accept-Language > padrão da instância. */
export function localeFromRequest(req: Pick<IncomingMessage, 'headers' | 'url'>, fallback: Locale): Locale {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const q = url.searchParams.get('lang');
    if (isLocale(q)) return q;
  } catch {
    // url inválida: ignora
  }
  const h = req.headers['accept-language'];
  return localeFromAcceptLanguage(Array.isArray(h) ? h[0] : h, fallback);
}

/** Tradutor preso a um idioma, para passar adiante dentro de uma requisição. */
export interface ReqTranslator {
  locale: Locale;
  t(key: MessageKey, params?: Params): string;
  tn(key: PluralKey, n: number, params?: Params): string;
}

export function translatorFor(locale: Locale): ReqTranslator {
  return { locale, t: (k, p) => tFor(locale, k, p), tn: (k, n, p) => tnFor(locale, k, n, p) };
}
