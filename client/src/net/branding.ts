// Marca da instância no cliente: carrega GET /api/config (público) e aplica título, tema e logos.
// Antes do carregamento valem os padrões; `branding()` nunca devolve undefined.
import { accentCssVars, DEFAULT_BRANDING, DEFAULT_LOCALE, DEFAULT_PUBLIC_OIDC, sanitizeBranding, SUPPORTED_LOCALES, isLocale, type PublicConfig, type PublicOidcConfig } from '../../../shared/branding';

let current: PublicConfig = { ...DEFAULT_BRANDING, defaultLocale: DEFAULT_LOCALE, locales: SUPPORTED_LOCALES, version: '', oidc: DEFAULT_PUBLIC_OIDC };
let loaded: Promise<PublicConfig> | undefined;
const listeners = new Set<(cfg: PublicConfig) => void>();

export function branding(): PublicConfig {
  return current;
}

/** Avisa quando a configuração chega (útil para quem desenha antes do fetch terminar). */
export function onBranding(fn: (cfg: PublicConfig) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Aplica no documento: título, variáveis CSS do tema e `img[data-brand-logo]`. */
export function applyBranding(cfg: PublicConfig, doc: Document = document): void {
  const root = doc.documentElement;
  for (const [k, v] of Object.entries(accentCssVars(cfg.accentColor))) root.style.setProperty(k, v);
  for (const img of doc.querySelectorAll<HTMLImageElement>('img[data-brand-logo]')) {
    if (img.getAttribute('src') !== cfg.logoUrl) img.setAttribute('src', cfg.logoUrl);
    img.alt = cfg.appName;
  }
}

/** Título da aba: "Seção · Nome do app" ou só o nome do app. */
export function pageTitle(section?: string): string {
  return section ? `${section} · ${current.appName}` : current.appName;
}

function sanitizeOidc(raw: unknown): PublicOidcConfig {
  const o = (raw ?? {}) as Partial<Record<keyof PublicOidcConfig, unknown>>;
  const enabled = o.enabled === true;
  return {
    enabled,
    label: enabled && typeof o.label === 'string' ? o.label.slice(0, 40) : '',
    // Sem SSO o formulário de senha é o único caminho: nunca o escondemos nesse caso.
    passwordLogin: !enabled || o.passwordLogin !== false,
  };
}

function setCurrent(raw: Partial<PublicConfig>): PublicConfig {
  const b = sanitizeBranding(raw);
  const locales = Array.isArray(raw.locales) ? raw.locales.filter(isLocale) : [];
  current = {
    ...b,
    defaultLocale: isLocale(raw.defaultLocale) ? raw.defaultLocale : DEFAULT_LOCALE,
    locales: locales.length ? locales : SUPPORTED_LOCALES,
    version: typeof raw.version === 'string' ? raw.version : '',
    oidc: sanitizeOidc(raw.oidc),
  };
  return current;
}

/** Busca /api/config uma vez (idempotente). Em falha mantém os padrões e segue. */
export function loadBranding(fetchImpl: typeof fetch = fetch): Promise<PublicConfig> {
  if (loaded) return loaded;
  loaded = (async () => {
    try {
      const res = await fetchImpl('/api/config', { credentials: 'same-origin', headers: { accept: 'application/json' } });
      if (res.ok && (res.headers.get('content-type') ?? '').includes('json')) setCurrent((await res.json()) as Partial<PublicConfig>);
    } catch {
      // sem servidor: padrões
    }
    if (typeof document !== 'undefined') applyBranding(current);
    for (const fn of listeners) fn(current);
    return current;
  })();
  return loaded;
}

/** Só para testes. */
export function resetBrandingForTests(raw?: Partial<PublicConfig>): void {
  loaded = undefined;
  listeners.clear();
  current = { ...DEFAULT_BRANDING, defaultLocale: DEFAULT_LOCALE, locales: SUPPORTED_LOCALES, version: '', oidc: DEFAULT_PUBLIC_OIDC };
  if (raw) setCurrent(raw);
}
