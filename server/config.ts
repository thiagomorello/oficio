// Configuração do servidor a partir das variáveis de ambiente (ver .env.example e docs/configuration.md).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAllowedHosts } from './http/guard';
import { DEFAULT_LOCALE, isHexColor, isLocale, sanitizeBranding, SUPPORTED_LOCALES, type BrandingConfig, type Locale } from '../shared/branding';

export interface ServerConfig {
  port: number;
  host: string;
  /** `--dev` / OFFICE_DEV: Vite em middleware mode (HMR) no mesmo servidor. */
  dev: boolean;
  /** OFFICE_IN_MEMORY: modo demonstração sem banco (repositórios em memória, usuário demo, segredo efêmero). Nunca em produção. */
  inMemory: boolean;
  inDocker: boolean;
  publicUrl?: string;
  /** Nomes extras aceitos no Host/Origin; localhost e IPs sempre valem. */
  allowedHosts: Set<string>;
  jwtSecret?: string;
  cookieSecure: boolean;
  trustProxy: boolean;
  databaseUrl?: string;
  livekit: { url?: string; internalUrl?: string; apiKey?: string; apiSecret?: string; room: string };
  mail: { sendgridApiKey?: string; from?: string };
  loginMasterPassword?: string;
  /** METRICS_TOKEN: se definido, `/metrics` exige `Authorization: Bearer <token>`. */
  metricsToken?: string;
  /** Login único por OpenID Connect (OIDC_*); `enabled` só com issuer, client id e secret definidos. */
  oidc: OidcConfig;
  /** Marca da instância: OFFICE_APP_NAME, OFFICE_LOGO_URL, OFFICE_ACCENT_COLOR, OFFICE_SIGN_TEXT. */
  branding: BrandingConfig;
  /** OFFICE_DEFAULT_LOCALE: idioma padrão da interface, dos e-mails e das mensagens do servidor. */
  defaultLocale: Locale;
  /** Raiz do projeto (onde fica o package.json); serve dist/client a partir daqui. */
  rootDir: string;
  version: string;
  /** Avisos de configuração (segredos ausentes etc.), para o index.ts registrar. */
  warnings: string[];
}

export interface OidcConfig {
  /** Verdadeiro só quando OIDC_ISSUER, OIDC_CLIENT_ID e OIDC_CLIENT_SECRET estão definidos (e o issuer é uma URL válida). */
  enabled: boolean;
  /** Issuer (base da descoberta `/.well-known/openid-configuration`), sem barra final. */
  issuer?: string;
  clientId?: string;
  clientSecret?: string;
  /** OIDC_SCOPES (padrão `openid email profile`). */
  scopes: string;
  /** Rótulo do botão de login: OIDC_BUTTON_LABEL, senão o nome do provedor derivado do host do issuer. */
  label: string;
  /** OIDC_AUTO_CREATE (padrão 1): cria a conta no primeiro login. */
  autoCreate: boolean;
  /** OIDC_ALLOWED_DOMAINS: domínios de e-mail aceitos (minúsculos); vazio = qualquer. */
  allowedDomains: string[];
  /** OIDC_ADMIN_CLAIM / OIDC_ADMIN_VALUES: claim cujo valor (ou lista) torna a pessoa administradora. */
  adminClaim?: string;
  adminValues: string[];
  /** OIDC_PASSWORD_LOGIN (padrão 1): 0 esconde e desativa o formulário de senha quando o OIDC está ativo. */
  passwordLogin: boolean;
}

export const OIDC_DEFAULT_SCOPES = 'openid email profile';
export const OIDC_DEFAULT_LABEL = 'Single sign-on';

/** Nomes conhecidos pelo host do issuer; o resto vira o domínio registrável com inicial maiúscula. */
const KNOWN_PROVIDERS: [RegExp, string][] = [
  [/(^|\.)google\.com$/, 'Google'],
  [/(^|\.)(microsoftonline\.com|microsoft\.com|windows\.net)$/, 'Microsoft'],
  [/keycloak/, 'Keycloak'],
  [/authentik/, 'Authentik'],
  [/(^|\.)okta\.com$/, 'Okta'],
  [/(^|\.)auth0\.com$/, 'Auth0'],
  [/(^|\.)gitlab\.com$/, 'GitLab'],
  [/(^|\.)github\.com$/, 'GitHub'],
  [/zitadel/, 'ZITADEL'],
  [/authelia/, 'Authelia'],
];

/** Rótulo padrão do botão de SSO a partir do issuer (`https://accounts.google.com` -> `Google`, `https://sso.acme.com` -> `Acme`). */
export function providerLabelFromIssuer(issuer: string | undefined): string {
  if (!issuer) return OIDC_DEFAULT_LABEL;
  let host: string;
  try {
    host = new URL(issuer).hostname.toLowerCase();
  } catch {
    return OIDC_DEFAULT_LABEL;
  }
  if (!host || /^[\d.]+$/.test(host) || host.includes(':')) return OIDC_DEFAULT_LABEL;
  for (const [re, name] of KNOWN_PROVIDERS) if (re.test(host)) return name;
  const parts = host.split('.').filter(Boolean);
  // Último rótulo com 3+ letras antes do TLD (sso.acme.com -> acme; id.acme.com.br -> acme; localhost -> localhost).
  const candidates = parts.length > 1 ? parts.slice(0, -1) : parts;
  const pick = [...candidates].reverse().find((p) => p.length >= 3 && !/^(com|org|net|gov|edu|co)$/.test(p)) ?? candidates[candidates.length - 1] ?? '';
  if (!pick) return OIDC_DEFAULT_LABEL;
  return pick.charAt(0).toUpperCase() + pick.slice(1);
}

function csv(v: string | undefined): string[] {
  return (v ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Lê OIDC_* e registra avisos de configuração parcial ou inválida. */
export function parseOidcConfig(env: NodeJS.ProcessEnv, warnings: string[]): OidcConfig {
  const rawIssuer = str(env.OIDC_ISSUER);
  const clientId = str(env.OIDC_CLIENT_ID);
  const clientSecret = str(env.OIDC_CLIENT_SECRET);
  let issuer = rawIssuer?.replace(/\/+$/, '');
  if (issuer) {
    try {
      const u = new URL(issuer);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('scheme');
    } catch {
      warnings.push(`Invalid OIDC_ISSUER (${issuer}); use the provider's issuer URL (https://...). Single sign-on disabled.`);
      issuer = undefined;
    }
  }
  const anySet = !!(rawIssuer || clientId || clientSecret);
  const enabled = !!(issuer && clientId && clientSecret);
  if (anySet && !enabled) {
    const missing = [!rawIssuer && 'OIDC_ISSUER', !clientId && 'OIDC_CLIENT_ID', !clientSecret && 'OIDC_CLIENT_SECRET'].filter(Boolean).join(', ');
    if (missing) warnings.push(`Single sign-on partially configured: missing ${missing}. OIDC login disabled.`);
  }
  if (enabled && issuer!.startsWith('http://')) warnings.push('OIDC_ISSUER uses plain http: only accepted in --dev; production providers must use https.');
  const passwordLoginRaw = str(env.OIDC_PASSWORD_LOGIN);
  const passwordLogin = passwordLoginRaw === undefined ? true : isTruthy(passwordLoginRaw);
  if (!passwordLogin && !enabled) warnings.push('OIDC_PASSWORD_LOGIN=0 ignored: single sign-on is not enabled, password login stays on.');
  const adminClaim = str(env.OIDC_ADMIN_CLAIM);
  const adminValues = csv(env.OIDC_ADMIN_VALUES);
  if (enabled && !!adminClaim !== adminValues.length > 0) warnings.push('OIDC_ADMIN_CLAIM and OIDC_ADMIN_VALUES must be set together; admin mapping disabled.');
  const scopes = csv(str(env.OIDC_SCOPES)?.replace(/,/g, ' ').replace(/\s+/g, ','));
  if (scopes.length && !scopes.includes('openid')) scopes.unshift('openid');
  return {
    enabled,
    issuer: enabled ? issuer : undefined,
    clientId: enabled ? clientId : undefined,
    clientSecret: enabled ? clientSecret : undefined,
    scopes: scopes.length ? scopes.join(' ') : OIDC_DEFAULT_SCOPES,
    label: (str(env.OIDC_BUTTON_LABEL) ?? providerLabelFromIssuer(issuer)).slice(0, 40),
    autoCreate: str(env.OIDC_AUTO_CREATE) === undefined ? true : isTruthy(env.OIDC_AUTO_CREATE),
    allowedDomains: csv(env.OIDC_ALLOWED_DOMAINS).map((d) => d.toLowerCase().replace(/^@/, '')),
    adminClaim: adminClaim && adminValues.length ? adminClaim : undefined,
    adminValues: adminClaim && adminValues.length ? adminValues : [],
    passwordLogin: enabled ? passwordLogin : true,
  };
}

export function isTruthy(v: string | undefined): boolean {
  return !!v && /^(1|true|yes|sim|on)$/i.test(v.trim());
}

/** Sobe a partir de `from` até achar o package.json do projeto. */
export function findRoot(from: string): string {
  let dir = from;
  for (let i = 0; i < 6; i++) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        const name = (JSON.parse(readFileSync(pkg, 'utf8')) as { name?: unknown }).name;
        if (name === 'oficio') return dir;
      } catch {
        // package.json ilegível: continua subindo
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(from, '..');
}

function readVersion(rootDir: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function str(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

/** DATABASE_URL, ou montada a partir de MYSQL_HOST/PORT/USER/PASSWORD/DATABASE. */
function databaseUrl(env: NodeJS.ProcessEnv): string | undefined {
  const url = str(env.DATABASE_URL);
  if (url) return url;
  const host = str(env.MYSQL_HOST);
  if (!host) return undefined;
  const user = encodeURIComponent(str(env.MYSQL_USER) ?? 'root');
  const pass = encodeURIComponent(env.MYSQL_PASSWORD ?? '');
  return `mysql://${user}:${pass}@${host}:${str(env.MYSQL_PORT) ?? '3306'}/${str(env.MYSQL_DATABASE) ?? 'oficio'}`;
}

export function loadConfig(argv: string[] = process.argv, env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const inDocker = isTruthy(env.OFFICE_IN_DOCKER);
  const port = Number.parseInt(env.OFFICE_PORT ?? '', 10);
  const rootDir = findRoot(dirname(fileURLToPath(import.meta.url)));
  const dev = argv.includes('--dev') || isTruthy(env.OFFICE_DEV);
  const warnings: string[] = [];
  const accentRaw = str(env.OFFICE_ACCENT_COLOR);
  if (accentRaw && !isHexColor(accentRaw)) warnings.push(`Invalid OFFICE_ACCENT_COLOR (${accentRaw}); use #rrggbb. Using the default color.`);
  const localeRaw = str(env.OFFICE_DEFAULT_LOCALE);
  if (localeRaw && !isLocale(localeRaw)) warnings.push(`Unknown OFFICE_DEFAULT_LOCALE (${localeRaw}); supported: ${SUPPORTED_LOCALES.join(', ')}. Using ${DEFAULT_LOCALE}.`);
  const cfg: ServerConfig = {
    port: Number.isFinite(port) && port > 0 && port < 65536 ? port : 4747,
    host: str(env.OFFICE_HOST) ?? (inDocker ? '0.0.0.0' : '127.0.0.1'),
    dev,
    inMemory: isTruthy(env.OFFICE_IN_MEMORY),
    inDocker,
    publicUrl: str(env.OFFICE_PUBLIC_URL),
    allowedHosts: parseAllowedHosts(env.OFFICE_ALLOWED_HOSTS),
    jwtSecret: str(env.OFFICE_JWT_SECRET),
    cookieSecure: env.OFFICE_COOKIE_SECURE === undefined || str(env.OFFICE_COOKIE_SECURE) === undefined ? true : isTruthy(env.OFFICE_COOKIE_SECURE),
    trustProxy: isTruthy(env.TRUST_PROXY),
    databaseUrl: databaseUrl(env),
    livekit: {
      url: str(env.LIVEKIT_URL),
      internalUrl: str(env.LIVEKIT_INTERNAL_URL),
      apiKey: str(env.LIVEKIT_API_KEY),
      apiSecret: str(env.LIVEKIT_API_SECRET),
      room: str(env.LIVEKIT_ROOM) ?? 'oficio',
    },
    mail: { sendgridApiKey: str(env.SENDGRID_API_KEY), from: str(env.MAIL_FROM) },
    loginMasterPassword: str(env.LOGIN_MASTER_PASSWORD),
    metricsToken: str(env.METRICS_TOKEN),
    oidc: parseOidcConfig(env, warnings),
    branding: sanitizeBranding({ appName: str(env.OFFICE_APP_NAME), logoUrl: str(env.OFFICE_LOGO_URL), accentColor: accentRaw, signText: str(env.OFFICE_SIGN_TEXT) }),
    defaultLocale: isLocale(localeRaw) ? localeRaw : DEFAULT_LOCALE,
    rootDir,
    version: readVersion(rootDir),
    warnings,
  };
  if (!cfg.jwtSecret) cfg.warnings.push('OFFICE_JWT_SECRET not set (required in production: login responds 503 without it).');
  if (cfg.inMemory) cfg.warnings.push('OFFICE_IN_MEMORY=1: demo mode, all data is lost on restart. Never use it in production.');
  if (!cfg.databaseUrl && !cfg.inMemory && !cfg.dev) cfg.warnings.push('DATABASE_URL not set (required unless OFFICE_DEV=1 or OFFICE_IN_MEMORY=1).');
  if (cfg.mail.sendgridApiKey && !cfg.mail.from) cfg.warnings.push('SENDGRID_API_KEY set without MAIL_FROM: e-mails will not be sent.');
  if (!cfg.livekit.url || !cfg.livekit.apiKey || !cfg.livekit.apiSecret) cfg.warnings.push('LiveKit not configured (LIVEKIT_URL/API_KEY/API_SECRET).');
  return cfg;
}
