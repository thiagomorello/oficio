// Login único por OpenID Connect: descoberta (com cache), PKCE, troca do código, validação do ID token e as
// regras de conta (vincular pelo e-mail, criar no primeiro acesso, mapear claim de administrador).
// O cookie transitório do fluxo (state, nonce, verifier, next) é um JWT curto assinado com o segredo da sessão.
import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import * as client from 'openid-client';
import type { OidcConfig, ServerConfig } from '../config';
import type { Repos } from '../db/repos/index';
import type { UserRow } from '../db/types';
import { errMsg, log } from '../log';
import { hash } from './password';

export const OIDC_COOKIE = 'office_oidc';
/** Validade do cookie transitório (ida ao provedor e volta). */
export const OIDC_PENDING_TTL_S = 10 * 60;
const PENDING_AUDIENCE = 'oficio-oidc-login';
/** Prefixo do `external_id` das contas vinculadas a um provedor OIDC. */
const EXTERNAL_PREFIX = 'oidc:';
const MAX_NAME = 120;

export const OIDC_ERROR_CODES = [
  'oidc_state',
  'oidc_denied',
  'oidc_failed',
  'oidc_unavailable',
  'oidc_no_email',
  'oidc_email_unverified',
  'oidc_domain',
  'oidc_no_account',
  'oidc_disabled',
  'oidc_rate_limited',
  'oidc_not_configured',
] as const;
export type OidcErrorCode = (typeof OIDC_ERROR_CODES)[number];

/** Falha do fluxo com um código que a página de login traduz (`/login?error=<code>`). `detail` só vai para o log. */
export class OidcError extends Error {
  constructor(
    readonly code: OidcErrorCode,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

export const oidcErrorCode = (err: unknown): OidcErrorCode => (err instanceof OidcError ? err.code : 'oidc_failed');

/** Texto curto para o log: prefere a mensagem (o `errMsg` genérico prefere `code`, que aqui é só a categoria). */
export function oidcErrorDetail(err: unknown): string {
  const m = (err as { message?: unknown } | null)?.message;
  return typeof m === 'string' && m ? m.slice(0, 200) : errMsg(err);
}

export function externalIdFor(issuer: string, sub: string): string {
  return `${EXTERNAL_PREFIX}${issuer}|${sub}`;
}

export function isOidcExternalId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(EXTERNAL_PREFIX);
}

/** Só caminhos internos (mesma regra do cliente): evita open redirect via `?next=//evil.com`. */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\') || raw.startsWith('/login') || raw.startsWith('/api/')) return '/';
  return raw.length > 2048 ? '/' : raw;
}

/** `OIDC_ALLOWED_DOMAINS` vazio aceita qualquer domínio; a comparação ignora maiúsculas. */
export function emailDomainAllowed(email: string, allowed: readonly string[]): boolean {
  if (!allowed.length) return true;
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  const domain = email.slice(at + 1).toLowerCase();
  return allowed.some((d) => d.toLowerCase() === domain);
}

/** Valores de uma claim como lista de strings (string, número ou array; `groups` costuma ser array). */
export function claimValues(claims: Readonly<Record<string, unknown>>, claim: string): string[] {
  const v = claims[claim];
  if (v === undefined || v === null) return [];
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[\s,]+/) : [v];
  return list.filter((x): x is string | number | boolean => typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean').map((x) => String(x).trim()).filter(Boolean);
}

/** Verdadeiro quando a claim configurada contém um dos valores configurados. Sem configuração: falso. */
export function claimGrantsAdmin(claims: Readonly<Record<string, unknown>>, oidc: Pick<OidcConfig, 'adminClaim' | 'adminValues'>): boolean {
  if (!oidc.adminClaim || !oidc.adminValues.length) return false;
  const have = new Set(claimValues(claims, oidc.adminClaim));
  return oidc.adminValues.some((v) => have.has(v));
}

/** Nome para a conta nova: `name`, senão nome+sobrenome, senão `preferred_username`, senão a parte local do e-mail. */
export function displayNameFromClaims(claims: Readonly<Record<string, unknown>>, email: string): string {
  const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const candidates = [s(claims.name), `${s(claims.given_name)} ${s(claims.family_name)}`.trim(), s(claims.preferred_username), s(claims.nickname), email.split('@')[0] ?? ''];
  const picked = candidates.find((c) => c.length >= 2) ?? email;
  return picked.slice(0, MAX_NAME);
}

/** O que atravessa a ida ao provedor dentro do cookie `office_oidc`. */
export interface PendingLogin {
  state: string;
  nonce: string;
  verifier: string;
  next: string;
}

export function signPending(p: PendingLogin, secret: string): string {
  return jwt.sign({ st: p.state, n: p.nonce, v: p.verifier, nx: p.next }, secret, { algorithm: 'HS256', audience: PENDING_AUDIENCE, expiresIn: OIDC_PENDING_TTL_S });
}

export function verifyPending(token: string | undefined, secret: string): PendingLogin | null {
  if (!token) return null;
  try {
    const p = jwt.verify(token, secret, { algorithms: ['HS256'], audience: PENDING_AUDIENCE });
    if (typeof p === 'string') return null;
    const { st, n, v, nx } = p as Record<string, unknown>;
    if (typeof st !== 'string' || typeof n !== 'string' || typeof v !== 'string') return null;
    return { state: st, nonce: n, verifier: v, next: safeNextPath(typeof nx === 'string' ? nx : null) };
  } catch {
    return null;
  }
}

export type OidcOutcome = 'created' | 'linked' | 'existing';

export interface OidcService {
  readonly enabled: boolean;
  /** Monta a URL de autorização (PKCE S256 + state + nonce) e o token do cookie transitório. */
  start(opts: { redirectUri: string; next: string }): Promise<{ url: string; cookieToken: string }>;
  /** Valida state/nonce, troca o código, aplica as regras de conta e devolve a linha fresca do usuário. */
  callback(opts: { redirectUri: string; currentUrl: URL; cookieToken: string | undefined }): Promise<{ user: UserRow; next: string; outcome: OidcOutcome }>;
}

export interface OidcDeps {
  config: Pick<ServerConfig, 'oidc' | 'dev'>;
  repos: Pick<Repos, 'users'>;
  /** Segredo que assina o cookie transitório (o mesmo da sessão). */
  secret: string;
}

export function createOidcService({ config, repos, secret }: OidcDeps): OidcService {
  const oidc = config.oidc;

  // Descoberta preguiçosa com cache: a primeira requisição paga a ida ao provedor; uma falha limpa o cache para
  // a próxima tentativa refazer a descoberta em vez de ficar presa num erro transitório.
  let discovered: Promise<client.Configuration> | undefined;
  const configuration = (): Promise<client.Configuration> => {
    if (!oidc.enabled || !oidc.issuer || !oidc.clientId) return Promise.reject(new OidcError('oidc_not_configured'));
    if (!discovered) {
      const issuer = new URL(oidc.issuer);
      const execute = issuer.protocol === 'http:' && config.dev ? [client.allowInsecureRequests] : undefined;
      discovered = client
        .discovery(issuer, oidc.clientId, oidc.clientSecret, undefined, { execute, timeout: 10 } as client.DiscoveryRequestOptions)
        .then((c) => {
          c.timeout = 10;
          return c;
        })
        .catch((err: unknown) => {
          discovered = undefined;
          throw new OidcError('oidc_unavailable', oidcErrorDetail(err));
        });
    }
    return discovered;
  };

  /** Encontra, vincula ou cria a conta e aplica o mapeamento de administrador. */
  async function resolveUser(issuer: string, claims: Record<string, unknown>): Promise<{ user: UserRow; outcome: OidcOutcome }> {
    const sub = typeof claims.sub === 'string' ? claims.sub : '';
    if (!sub) throw new OidcError('oidc_failed', 'ID token without sub');
    const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
    if (!email || !email.includes('@')) throw new OidcError('oidc_no_email');
    if (claims.email_verified === false || claims.email_verified === 'false') throw new OidcError('oidc_email_unverified');
    if (!emailDomainAllowed(email, oidc.allowedDomains)) throw new OidcError('oidc_domain', email.slice(email.indexOf('@')));
    const externalId = externalIdFor(issuer, sub);
    const grantsAdmin = claimGrantsAdmin(claims, oidc);

    let outcome: OidcOutcome = 'existing';
    let user = await repos.users.byExternalId(externalId);
    if (!user) {
      const byEmail = await repos.users.byEmail(email);
      if (byEmail) {
        // Conta já existente (local ou importada): vincula sem tocar na senha.
        if (byEmail.external_id === null || isOidcExternalId(byEmail.external_id)) {
          user = (await repos.users.update(byEmail.id, { external_id: externalId })) ?? byEmail;
        } else {
          // Importada de outro sistema: mantém o external_id de origem e aceita pelo e-mail.
          user = byEmail;
        }
        outcome = 'linked';
      } else {
        if (!oidc.autoCreate) throw new OidcError('oidc_no_account', email);
        // Senha aleatória inutilizável: a pessoa entra pelo provedor; um admin pode redefinir se precisar da senha.
        user = await repos.users.createLocal({
          email,
          name: displayNameFromClaims(claims, email),
          password_hash: await hash(randomBytes(32).toString('base64url')),
          is_admin: grantsAdmin,
          must_change_password: false,
          external_id: externalId,
        });
        outcome = 'created';
      }
    }
    if (user.status !== 'active') throw new OidcError('oidc_disabled', String(user.id));
    // A claim só concede: quem virou admin localmente não perde o acesso quando a claim não vem.
    if (grantsAdmin && !user.is_admin) user = (await repos.users.update(user.id, { is_admin: true })) ?? user;
    return { user, outcome };
  }

  return {
    get enabled() {
      return oidc.enabled;
    },

    async start({ redirectUri, next }) {
      const cfg = await configuration();
      const verifier = client.randomPKCECodeVerifier();
      const codeChallenge = await client.calculatePKCECodeChallenge(verifier);
      const state = client.randomState();
      const nonce = client.randomNonce();
      const url = client.buildAuthorizationUrl(cfg, {
        redirect_uri: redirectUri,
        scope: oidc.scopes,
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });
      return { url: url.href, cookieToken: signPending({ state, nonce, verifier, next: safeNextPath(next) }, secret) };
    },

    async callback({ currentUrl, cookieToken }) {
      const pending = verifyPending(cookieToken, secret);
      if (!pending) throw new OidcError('oidc_state', 'missing or expired pending cookie');
      const providerError = currentUrl.searchParams.get('error');
      if (providerError) throw new OidcError(providerError === 'access_denied' ? 'oidc_denied' : 'oidc_failed', providerError);
      if (currentUrl.searchParams.get('state') !== pending.state) throw new OidcError('oidc_state', 'state mismatch');
      const cfg = await configuration();
      let tokens: Awaited<ReturnType<typeof client.authorizationCodeGrant>>;
      try {
        tokens = await client.authorizationCodeGrant(cfg, currentUrl, {
          expectedState: pending.state,
          expectedNonce: pending.nonce,
          pkceCodeVerifier: pending.verifier,
          idTokenExpected: true,
        });
      } catch (err) {
        // Nunca registra tokens nem o código: só a mensagem do erro.
        throw new OidcError('oidc_failed', oidcErrorDetail(err));
      }
      let claims: Record<string, unknown> = { ...(tokens.claims() ?? {}) };
      const sub = typeof claims.sub === 'string' ? claims.sub : '';
      const wantsMore = typeof claims.email !== 'string' || (oidc.adminClaim !== undefined && claims[oidc.adminClaim] === undefined);
      if (sub && wantsMore && cfg.serverMetadata().userinfo_endpoint && tokens.access_token) {
        // Provedores que não põem e-mail/grupos no ID token (ou só com escopos extras) os entregam no userinfo.
        try {
          const info = (await client.fetchUserInfo(cfg, tokens.access_token, sub)) as Record<string, unknown>;
          claims = { ...info, ...claims };
        } catch (err) {
          log.warn(`oidc: userinfo request failed (continuing with ID token claims): ${oidcErrorDetail(err)}`);
        }
      }
      const { user, outcome } = await resolveUser(cfg.serverMetadata().issuer, claims);
      return { user, next: pending.next, outcome };
    },
  };
}
