// Rotas de autenticação: login, logout, esqueci a senha, redefinição e troca de senha.
import { z } from 'zod';
import type { UserPublicSelf } from '../../shared/model';
import { DUMMY_HASH, effectiveMasterPassword, hash, sha256Hex, tokenPair, verify } from '../auth/password';
import { clientIp, createRateLimiter } from '../auth/ratelimit';
import { templates } from '../auth/mailer';
import { toSessionUser, type SessionUser } from '../auth/session';
import { localeFromRequest, type MessageKey, type ReqTranslator } from '../i18n';
import { HttpError, readJson, sendJson } from './app';
import type { RouteContext, RouteHandler } from './routes';

const RESET_TTL_MS = 60 * 60_000;

export function toPublicSelf(u: SessionUser): UserPublicSelf {
  return {
    id: u.id,
    name: u.displayName,
    role: u.roleName,
    appearance: u.appearance,
    status: 'available',
    email: u.email,
    isAdmin: u.isAdmin,
    mustChangePassword: u.needsPasswordChange,
    settings: u.settings,
  };
}

const emailSchema = z.string().trim().toLowerCase().min(3).max(254);

/** Política: mínimo de 8 caracteres e diferente do e-mail. Devolve a chave da mensagem (i18n) ou null. */
export function passwordPolicy(password: string, email: string): MessageKey | null {
  if (password.length < 8) return 'server.auth.passwordMin';
  if (password.length > 200) return 'server.auth.passwordTooLong';
  if (password.trim().toLowerCase() === email.trim().toLowerCase()) return 'server.auth.passwordEqualsEmail';
  return null;
}

const loginBody = z.object({ email: emailSchema, password: z.string().min(1).max(200) });
const forgotBody = z.object({ email: emailSchema });
// As mensagens do zod são chaves do i18n: app-factory traduz o HttpError no idioma da requisição.
const resetBody = z.object({ token: z.string().min(10).max(200), password: z.string().min(8, 'server.auth.passwordMin').max(200) });
const changeBody = z.object({ current: z.string().max(200).optional(), password: z.string().min(8, 'server.auth.passwordMin').max(200) });

async function body<T>(req: Parameters<RouteHandler>[0], schema: z.ZodType<T>): Promise<T> {
  const r = schema.safeParse(await readJson(req));
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'server.http.invalidData');
  return r.data;
}

function tooMany(res: Parameters<RouteHandler>[1], tr: ReqTranslator, seconds: number): true {
  res.setHeader('Retry-After', String(seconds));
  sendJson(res, 429, { error: tr.t('server.auth.tooManyAttempts'), retryAfter: seconds });
  return true;
}

export function createAuthRoutes(ctx: RouteContext): RouteHandler {
  const { config, repos, session, mailer } = ctx;
  const master = effectiveMasterPassword(config);
  const loginLimiter = createRateLimiter({ max: 10, windowMs: 10 * 60_000 });
  const forgotLimiter = createRateLimiter({ max: 10, windowMs: 10 * 60_000 });
  const changeLimiter = createRateLimiter({ max: 10, windowMs: 10 * 60_000 });

  return async (req, res, url, tr) => {
    const path = url.pathname;
    if (!path.startsWith('/api/auth/')) return false;
    if (req.method !== 'POST') throw new HttpError(405, 'server.http.methodNotAllowed');

    if (path === '/api/auth/login') {
      const { email, password } = await body(req, loginBody);
      const key = `${clientIp(req, config.trustProxy)}|${email}`;
      const wait = loginLimiter.blockedFor(key);
      if (wait) return tooMany(res, tr, wait);
      // OIDC_PASSWORD_LOGIN=0: só a senha mestra de desenvolvimento passa (create-admin e LOGIN_MASTER_PASSWORD continuam úteis).
      if (config.oidc.enabled && !config.oidc.passwordLogin && !(master !== undefined && (await verify(password, DUMMY_HASH, master)))) {
        sendJson(res, 403, { code: 'password_login_disabled', error: tr.t('server.auth.passwordLoginDisabled') });
        return true;
      }
      const user = await repos.users.byEmail(email);
      const ok = await verify(password, user?.password_hash ?? DUMMY_HASH, user ? master : undefined);
      if (!user || !ok) {
        loginLimiter.fail(key);
        sendJson(res, 401, { error: tr.t('server.auth.invalidCredentials') });
        return true;
      }
      if (user.status !== 'active') {
        sendJson(res, 403, { code: 'disabled', error: tr.t('server.auth.accountDisabled') });
        return true;
      }
      loginLimiter.reset(key);
      ctx.hooks.onLogin?.();
      session.setCookie(res, session.issue(user));
      sendJson(res, 200, { user: toPublicSelf(toSessionUser(user)) });
      return true;
    }

    if (path === '/api/auth/logout') {
      session.clearCookie(res);
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (path === '/api/auth/forgot') {
      const { email } = await body(req, forgotBody);
      const key = clientIp(req, config.trustProxy);
      const wait = forgotLimiter.blockedFor(key);
      if (wait) return tooMany(res, tr, wait);
      forgotLimiter.fail(key); // cada pedido conta; 10 por 10 min por IP
      const manual = !mailer.configured;
      const user = await repos.users.byEmail(email);
      if (user && user.status === 'active' && mailer.configured) {
        const pair = tokenPair();
        await repos.tokens.create('reset', user.id, pair.hash, new Date(Date.now() + RESET_TTL_MS));
        const base = config.publicUrl?.replace(/\/+$/, '') ?? `http://${req.headers.host ?? 'localhost'}`;
        // Idioma do e-mail: o que a pessoa escolheu no app; senão, o da requisição. O `?lang=` mantém a
        // página de login no mesmo idioma ao abrir o link.
        const locale = user.settings?.locale ?? localeFromRequest(req, config.defaultLocale);
        await mailer.sendMail({ to: user.email, ...templates.reset(`${base}/login?reset=${pair.raw}&lang=${locale}`, config.branding, locale) });
      }
      sendJson(res, 200, manual ? { ok: true, manual: true } : { ok: true });
      return true;
    }

    if (path === '/api/auth/reset') {
      const { token, password } = await body(req, resetBody);
      const row = await repos.tokens.consume(sha256Hex(token));
      const user = row ? await repos.users.byId(row.user_id) : null;
      if (!row || !user) throw new HttpError(400, 'server.auth.resetLinkInvalid');
      if (user.status !== 'active') {
        sendJson(res, 403, { code: 'disabled', error: tr.t('server.auth.accountDisabled') });
        return true;
      }
      const bad = passwordPolicy(password, user.email);
      if (bad) throw new HttpError(400, 'server.auth.requestNewLink', { reason: tr.t(bad) });
      await repos.users.setPassword(user.id, await hash(password), { needsChange: false });
      session.invalidate(user.id);
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (path === '/api/auth/change-password') {
      const me = await session.requireUser(req);
      const { current, password } = await body(req, changeBody);
      const bad = passwordPolicy(password, me.email);
      if (bad) throw new HttpError(400, bad);
      const row = await repos.users.byId(me.id);
      if (!row) throw new HttpError(401, 'server.http.unauthenticated');
      if (!me.needsPasswordChange) {
        const key = `chpw:${me.id}`;
        const wait = changeLimiter.blockedFor(key);
        if (wait) return tooMany(res, tr, wait);
        if (!current || !(await verify(current, row.password_hash, master))) {
          changeLimiter.fail(key);
          throw new HttpError(400, 'server.auth.currentPasswordWrong');
        }
        changeLimiter.reset(key);
      }
      await repos.users.setPassword(row.id, await hash(password), { needsChange: false });
      session.invalidate(row.id);
      const fresh = await repos.users.byId(row.id);
      if (!fresh) throw new HttpError(401, 'server.http.unauthenticated');
      session.setCookie(res, session.issue(fresh));
      sendJson(res, 200, { user: toPublicSelf(toSessionUser(fresh)) });
      return true;
    }

    return false;
  };
}
