// Idioma da interface no navegador: escolha salva (localStorage e configurações do usuário) > idioma do navegador
// > padrão da instância (/api/config). Reexporta `t`/`tn` para o cliente importar de um lugar só.
import { getLocale, onLocaleChange, resolveLocale, setLocale, type Locale } from '../../shared/i18n';
import { isLocale } from '../../shared/branding';

export { getLocale, onLocaleChange, setLocale, t, tn, LOCALE_NAMES, SUPPORTED_LOCALES, type Locale, type MessageKey } from '../../shared/i18n';

export const LOCALE_KEY = 'oficio:locale';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Escolha explícita salva no navegador (null = automático). */
export function storedLocale(): Locale | null {
  const v = storage()?.getItem(LOCALE_KEY);
  return isLocale(v) ? v : null;
}

/**
 * Resolve o idioma no boot (síncrono): escolha salva > idiomas do navegador > `fallback` (padrão da instância,
 * quando já conhecido). Chame de novo quando o /api/config chegar, passando `defaultLocale`.
 */
export function initLocale(fallback?: Locale, userChoice?: Locale | null): Locale {
  const stored = userChoice ?? storedLocale();
  const nav = typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language];
  const locale = stored ?? resolveLocale(nav, fallback ?? getLocale());
  setLocale(locale);
  applyLocaleToDocument(locale);
  return locale;
}

/** Escolha explícita da pessoa (null = voltar ao automático). Persiste no navegador e aplica na hora. */
export function chooseLocale(locale: Locale | null): Locale {
  const st = storage();
  try {
    if (locale) st?.setItem(LOCALE_KEY, locale);
    else st?.removeItem(LOCALE_KEY);
  } catch {
    // armazenamento bloqueado: vale só nesta sessão
  }
  return initLocale(undefined, locale);
}

export function applyLocaleToDocument(locale: Locale, doc: Document | undefined = typeof document === 'undefined' ? undefined : document): void {
  if (doc && doc.documentElement.lang !== locale) doc.documentElement.lang = locale;
}

onLocaleChange((l) => applyLocaleToDocument(l));
