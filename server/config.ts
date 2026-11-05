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
