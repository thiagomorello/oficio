// Rotas do login único (OpenID Connect): GET /api/auth/oidc/start redireciona ao provedor; GET /api/auth/oidc/callback
// recebe o código, cria a sessão normal e volta para o app. Erros viram `/login?error=<código>` (a página traduz).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseCookie } from 'cookie';
import { OIDC_COOKIE, OIDC_PENDING_TTL_S, oidcErrorCode, oidcErrorDetail, safeNextPath, type OidcErrorCode, type OidcService } from '../auth/oidc';
import { clientIp, createRateLimiter } from '../auth/ratelimit';
import { appendCookie } from '../auth/session';
import type { ServerConfig } from '../config';
import { log } from '../log';
import { HttpError, sendJson } from './app';
import type { RouteContext, RouteHandler } from './routes';

export const OIDC_START_PATH = '/api/auth/oidc/start';
export const OIDC_CALLBACK_PATH = '/api/auth/oidc/callback';

/** URL pública do callback: OFFICE_PUBLIC_URL, senão o Host da requisição (esquema do proxy quando TRUST_PROXY=1). */
export function callbackUrl(req: Pick<IncomingMessage, 'headers'>, config: Pick<ServerConfig, 'publicUrl' | 'trustProxy' | 'cookieSecure'>): string {
  const fromEnv = config.publicUrl?.replace(/\/+$/, '');
  if (fromEnv) return `${fromEnv}${OIDC_CALLBACK_PATH}`;
  const xfp = req.headers['x-forwarded-proto'];
  const forwarded = config.trustProxy ? (Array.isArray(xfp) ? xfp[0] : xfp)?.split(',')[0]?.trim() : undefined;
  const proto = forwarded === 'http' || forwarded === 'https' ? forwarded : config.cookieSecure ? 'https' : 'http';
  const host = typeof req.headers.host === 'string' && req.headers.host ? req.headers.host : 'localhost';
  return `${proto}://${host}${OIDC_CALLBACK_PATH}`;
}

function redirect(res: ServerResponse, to: string): void {
  res.writeHead(302, { Location: to, 'Cache-Control': 'no-store' });
  res.end();
}

const loginWithError = (res: ServerResponse, code: OidcErrorCode): void => redirect(res, `/login?error=${code}`);

export function createOidcRoutes(ctx: RouteContext, oidc: OidcService): RouteHandler {
  const { config, session } = ctx;
  // Toda ida ao provedor conta; no callback só as falhas. Por IP, janela de 10 minutos.
  const limiter = createRateLimiter({ max: 30, windowMs: 10 * 60_000 });

  const pendingCookie = (value: string, maxAge: number): string => {
    const attrs = [`${OIDC_COOKIE}=${value}`, 'Path=/api/auth/oidc', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
    if (config.cookieSecure) attrs.push('Secure');
    return attrs.join('; ');
  };

  return async (req, res, url, tr) => {
    const path = url.pathname;
    if (path !== OIDC_START_PATH && path !== OIDC_CALLBACK_PATH) return false;
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'server.http.methodNotAllowed');
    if (!oidc.enabled) {
      sendJson(res, 404, { error: tr.t('server.auth.oidcNotConfigured') });
      return true;
    }
    const ip = clientIp(req, config.trustProxy);
    const redirectUri = callbackUrl(req, config);

    if (path === OIDC_START_PATH) {
      if (limiter.blockedFor(ip)) {
        loginWithError(res, 'oidc_rate_limited');
        return true;
      }
      limiter.fail(ip);
      try {
        const { url: to, cookieToken } = await oidc.start({ redirectUri, next: safeNextPath(url.searchParams.get('next')) });
        appendCookie(res, pendingCookie(cookieToken, OIDC_PENDING_TTL_S));
        redirect(res, to);
      } catch (err) {
        log.warn(`oidc: could not start sign-in: ${oidcErrorDetail(err)}`);
        loginWithError(res, oidcErrorCode(err));
      }
      return true;
    }

    // Callback: o cookie transitório é de uso único, apagado em qualquer desfecho.
    const cookieHeader = typeof req.headers.cookie === 'string' ? req.headers.cookie : undefined;
    const cookieToken = cookieHeader ? parseCookie(cookieHeader)[OIDC_COOKIE] : undefined;
    appendCookie(res, pendingCookie('', 0));
    if (limiter.blockedFor(ip)) {
      loginWithError(res, 'oidc_rate_limited');
      return true;
    }
    // A URL atual precisa ter a mesma origem do redirect_uri registrado; só a query da requisição interessa.
    const currentUrl = new URL(redirectUri);
    currentUrl.search = url.search;
    try {
      const { user, next, outcome } = await oidc.callback({ redirectUri, currentUrl, cookieToken });
      ctx.hooks.onLogin?.();
      session.invalidate(user.id);
      session.setCookie(res, session.issue(user));
      log.info(`oidc: user ${user.id} signed in (${outcome})`);
      redirect(res, next);
    } catch (err) {
      limiter.fail(ip);
      log.warn(`oidc: sign-in failed: ${oidcErrorDetail(err)}`);
      loginWithError(res, oidcErrorCode(err));
    }
    return true;
  };
}
