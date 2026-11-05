// Sessão: cookie `office_session` (JWT) -> usuário ativo, com cache LRU curto para não ir ao banco a cada requisição.
import type { RevalidateResult } from './session-types';
import { parseCookie } from 'cookie';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { DEFAULT_SETTINGS, type Appearance, type UserSettings } from '../../shared/model';
import type { ServerConfig } from '../config';
import type { Repos } from '../db/repos/index';
import type { UserRow } from '../db/types';
import { HttpError } from '../http/app';
import { SESSION_MAX_AGE_S, signSession, verifySession } from './jwt';

export const SESSION_COOKIE = 'office_session';
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX = 500;

export interface SessionUser {
  id: number;
  /** Nome do cadastro. */
  name: string;
  email: string;
  /** display_name ou, na falta dele, o nome do cadastro. */
  displayName: string;
  isAdmin: boolean;
  needsPasswordChange: boolean;
  appearance: Appearance | null;
  settings: UserSettings;
  roleName: string | null;
}

export function toSessionUser(r: UserRow): SessionUser {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    displayName: r.display_name ?? r.name,
    isAdmin: r.is_admin,
    needsPasswordChange: r.must_change_password,
    appearance: r.appearance,
    settings: { ...DEFAULT_SETTINGS, ...(r.settings ?? {}) },
    roleName: r.role_name,
  };
}

type ReqLike = Pick<IncomingMessage, 'headers'>;

export interface SessionService {
  /** Usuário da requisição (cookie válido, conta ativa, password_version igual) ou null. */
  userFromRequest(req: ReqLike): Promise<SessionUser | null>;
  /** Idem, a partir do valor do cabeçalho Cookie. */
  userFromCookieHeader(header: string | undefined): Promise<SessionUser | null>;
  /** Emite o JWT de sessão do usuário. */
  issue(user: UserRow): string;
  setCookie(res: ServerResponse, token: string): void;
  clearCookie(res: ServerResponse): void;
  invalidate(userId: number): void;
  invalidateAll(): void;
  /** Revalidação periódica dos conectados (lê o banco, ignora o cache). */
  revalidate(userId: number): Promise<RevalidateResult>;
  /** Lança HttpError 401. */
  requireUser(req: ReqLike): Promise<SessionUser>;
  /** Lança HttpError 401/403. */
  requireAdmin(req: ReqLike): Promise<SessionUser>;
}

export interface SessionDeps {
  config: Pick<ServerConfig, 'cookieSecure'>;
  repos: Pick<Repos, 'users'>;
  secret: string;
  now?: () => number;
}

export function createSession({ config, repos, secret, now = Date.now }: SessionDeps): SessionService {
  const cache = new Map<number, { row: UserRow; at: number }>();

  async function load(id: number): Promise<UserRow | null> {
    const hit = cache.get(id);
    if (hit && now() - hit.at < CACHE_TTL_MS) {
      cache.delete(id);
      cache.set(id, hit); // LRU: reinsere no fim
      return hit.row;
    }
    cache.delete(id);
    const row = await repos.users.byId(id);
    if (row) {
      cache.set(id, { row, at: now() });
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as number);
    }
    return row;
  }

  const cookieAttrs = (value: string, maxAge: number): string => {
    const attrs = [`${SESSION_COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
    if (config.cookieSecure) attrs.push('Secure');
    return attrs.join('; ');
  };

  const svc: SessionService = {
    async userFromCookieHeader(header) {
      if (!header) return null;
      const token = parseCookie(header)[SESSION_COOKIE];
      if (!token) return null;
      const claims = verifySession(token, secret);
      if (!claims) return null;
      const row = await load(claims.userId);
      if (!row || row.status !== 'active' || row.password_version !== claims.pv) return null;
      return toSessionUser(row);
    },
    userFromRequest(req) {
      const c = req.headers.cookie;
      return svc.userFromCookieHeader(typeof c === 'string' ? c : undefined);
    },
    issue(user) {
      return signSession({ sub: String(user.id), pv: user.password_version, adm: user.is_admin }, secret);
    },
    setCookie(res, token) {
      appendCookie(res, cookieAttrs(token, SESSION_MAX_AGE_S));
    },
    clearCookie(res) {
      appendCookie(res, cookieAttrs('', 0));
    },
    async revalidate(userId) {
      cache.delete(userId);
      const row = await repos.users.byId(userId);
      if (!row) return { ok: false, reason: 'auth' };
      if (row.status !== 'active') return { ok: false, reason: 'disabled' };
      cache.set(userId, { row, at: now() });
      return { ok: true, user: toSessionUser(row) };
    },
    invalidate: (id) => void cache.delete(id),
    invalidateAll: () => cache.clear(),
    async requireUser(req) {
      const u = await svc.userFromRequest(req);
      if (!u) throw new HttpError(401, 'server.http.unauthenticated');
      return u;
    },
    async requireAdmin(req) {
      const u = await svc.requireUser(req);
      if (!u.isAdmin) throw new HttpError(403, 'server.http.adminOnly');
      return u;
    },
  };
  return svc;
}

function appendCookie(res: ServerResponse, value: string): void {
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', prev === undefined ? value : [...(Array.isArray(prev) ? prev : [String(prev)]), value]);
}
