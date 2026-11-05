// Marca da instância (whitelabel): nome, logo, cor de destaque e texto da placa do mapa.
// Puro (sem DOM): usado pelo servidor (config/env, /api/config, e-mails) e pelo cliente (tema, placa, títulos).

export interface BrandingConfig {
  /** Nome do app: título das páginas, e-mails, manifest (OFFICE_APP_NAME). */
  appName: string;
  /** URL do logo mostrado na barra superior, no login e no admin (OFFICE_LOGO_URL). */
  logoUrl: string;
  /** Cor de destaque em hex `#rrggbb` (OFFICE_ACCENT_COLOR). */
  accentColor: string;
  /** Texto da placa da recepção no mapa (OFFICE_SIGN_TEXT; padrão = appName). */
  signText: string;
}

/** Idiomas da interface. A ordem importa: o primeiro é o fallback universal e a ordem é a dos seletores. */
export const SUPPORTED_LOCALES = ['en', 'pt-BR', 'es'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(v);
}

export const DEFAULT_BRANDING: BrandingConfig = {
  appName: 'Oficio',
  logoUrl: '/assets/brand/logo.svg',
  accentColor: '#7c9cff',
  signText: 'Oficio',
};

/** Rótulo especial de placa no mapa: desenha o logo/placa da marca em vez de texto. */
export const BRAND_SIGN_LABEL = '{brand}';

/** Login único (OIDC) como o cliente o vê: só o que a página de login precisa, nunca segredos. */
export interface PublicOidcConfig {
  enabled: boolean;
  /** Rótulo do botão ("Continue with {label}"). */
  label: string;
  /** Falso quando OIDC_PASSWORD_LOGIN=0: o formulário de e-mail/senha fica escondido e desativado. */
  passwordLogin: boolean;
}

export const DEFAULT_PUBLIC_OIDC: PublicOidcConfig = { enabled: false, label: '', passwordLogin: true };

/** O que o servidor expõe em `GET /api/config` (público, sem segredos). */
export interface PublicConfig extends BrandingConfig {
  defaultLocale: Locale;
  locales: readonly Locale[];
  version: string;
  oidc: PublicOidcConfig;
}

export const MAX_APP_NAME = 40;
export const MAX_SIGN_TEXT = 14;

const HEX_RE = /^#([0-9a-f]{6})$/i;

export function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && HEX_RE.test(v.trim());
}

export function normalizeHex(hex: string): string {
  return hex.trim().toLowerCase();
}

export function parseHex(hex: string): [number, number, number] | null {
  const m = HEX_RE.exec(hex.trim());
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Mistura `a` em direção a `b` (k em [0,1]). Cores inválidas devolvem `a`. */
export function mixHex(a: string, b: string, k: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  if (!pa || !pb) return a;
  const t = Math.max(0, Math.min(1, k));
  return toHex(pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t, pa[2] + (pb[2] - pa[2]) * t);
}

/** Luminância relativa (WCAG), 0 = preto, 1 = branco. */
export function luminance(hex: string): number {
  const p = parseHex(hex);
  if (!p) return 0;
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2]);
}

/** Cor de texto legível sobre `hex`: escuro em fundos claros, branco em fundos escuros. */
export function onColor(hex: string): string {
  return luminance(hex) > 0.35 ? '#121212' : '#ffffff';
}

export interface AccentPalette {
  accent: string;
  /** Hover/estado ativo: um pouco mais escuro. */
  strong: string;
  /** Realces discretos e bordas. */
  dark: string;
  /** Fundos suaves. */
  light: string;
  /** Texto sobre a cor de destaque. */
  on: string;
}

export function accentPalette(accent: string): AccentPalette {
  const a = isHexColor(accent) ? normalizeHex(accent) : DEFAULT_BRANDING.accentColor;
  return {
    accent: a,
    strong: mixHex(a, '#000000', 0.12),
    dark: mixHex(a, '#000000', 0.5),
    light: mixHex(a, '#ffffff', 0.5),
    on: onColor(a),
  };
}

/** Variáveis CSS do tema derivadas da cor de destaque (aplicadas em `:root` pelo cliente). */
export function accentCssVars(accent: string): Record<string, string> {
  const p = accentPalette(accent);
  return { '--accent': p.accent, '--accent-strong': p.strong, '--accent-dark': p.dark, '--accent-light': p.light, '--on-accent': p.on };
}

/** Sanitiza valores vindos de fora (env ou /api/config); o que for inválido cai no padrão. */
export function sanitizeBranding(raw: Partial<Record<keyof BrandingConfig, unknown>> | null | undefined): BrandingConfig {
  const o = raw ?? {};
  const appName = typeof o.appName === 'string' && o.appName.trim() ? o.appName.trim().slice(0, MAX_APP_NAME) : DEFAULT_BRANDING.appName;
  const logoUrl = typeof o.logoUrl === 'string' && /^(\/|https?:\/\/)/.test(o.logoUrl.trim()) ? o.logoUrl.trim() : DEFAULT_BRANDING.logoUrl;
  const accentColor = isHexColor(o.accentColor) ? normalizeHex(o.accentColor) : DEFAULT_BRANDING.accentColor;
  const signText = typeof o.signText === 'string' && o.signText.trim() ? o.signText.trim().slice(0, MAX_SIGN_TEXT) : appName.slice(0, MAX_SIGN_TEXT);
  return { appName, logoUrl, accentColor, signText };
}
