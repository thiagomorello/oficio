// Área administrativa (somente admins): usuários, papéis, mesas e estatísticas.
import { z } from 'zod';
import { hash, tempPassword } from '../auth/password';
import { templates } from '../auth/mailer';
import type { Locale } from '../i18n';
import type { UserRow } from '../db/types';
import { HttpError, readJson, sendJson } from './app';
import type { RouteContext, RouteHandler } from './routes';

export interface AdminUserRow {
  id: number;
  name: string;
  email: string;
  roleName: string | null;
  isAdmin: boolean;
  status: 'active' | 'disabled';
  source: 'imported' | 'local';
  lastSeen: string | null;
  hasAvatar: boolean;
  deskId: string | null;
  needsPasswordChange: boolean;
}

const createBody = z.object({
  name: z.string().trim().min(2, 'server.admin.nameRequired').max(120),
  email: z.string().trim().toLowerCase().email('server.admin.invalidEmail').max(254),
  roleName: z.string().trim().max(80).optional(),
  isAdmin: z.boolean().optional(),
});

const patchBody = z
  .object({
    status: z.enum(['active', 'disabled']),
    isAdmin: z.boolean(),
    roleName: z.string().trim().max(80),
    name: z.string().trim().min(2, 'server.admin.nameRequired').max(120),
  })
  .partial()
  .strict();

async function body<T>(req: Parameters<RouteHandler>[0], schema: z.ZodType<T>): Promise<T> {
  const r = schema.safeParse(await readJson(req));
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'server.http.invalidData');
  return r.data;
}

const intParam = (s: string | null, def: number, min: number, max: number): number => {
  const n = Number.parseInt(s ?? '', 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def;
};

export function createAdminRoutes(ctx: RouteContext): RouteHandler {
  const { config, repos, session, mailer, hooks } = ctx;

  const toRow = (u: UserRow, deskByUser: Map<number, string>): AdminUserRow => ({
    id: u.id,
    name: u.name,
    email: u.email,
    roleName: u.role_name,
    isAdmin: u.is_admin,
    status: u.status,
    source: u.external_id === null ? 'local' : 'imported',
    lastSeen: u.last_seen_at ? u.last_seen_at.toISOString() : null,
    hasAvatar: u.appearance !== null,
    deskId: deskByUser.get(u.id) ?? null,
    needsPasswordChange: u.must_change_password,
  });

  const deskMap = async (): Promise<Map<number, string>> => new Map((await repos.desks.all()).map((d) => [d.user_id, d.desk_id]));
  const one = async (id: number): Promise<AdminUserRow> => {
    const u = await repos.users.byId(id);
    if (!u) throw new HttpError(404, 'server.admin.userNotFound');
    return toRow(u, await deskMap());
  };

  /** Envia a senha temporária por e-mail (no idioma da pessoa) se o mailer estiver configurado; senão devolve para exibir uma vez. */
  async function deliver(email: string, temp: string, locale: Locale): Promise<{ emailed: true } | { emailed: false; tempPassword: string }> {
    if (mailer.configured) {
      const loginUrl = config.publicUrl ? `${config.publicUrl.replace(/\/+$/, '')}/login?lang=${locale}` : undefined;
      const r = await mailer.sendMail({ to: email, ...templates.invite(temp, loginUrl, config.branding, locale) });
      if (r.sent) return { emailed: true };
    }
    return { emailed: false, tempPassword: temp };
  }

  return async (req, res, url, tr) => {
    const path = url.pathname;
    if (!path.startsWith('/api/admin/')) return false;
    const me = await session.requireAdmin(req);
    const method = req.method ?? 'GET';

    if (path === '/api/admin/users') {
      if (method === 'GET') {
        const pageSize = intParam(url.searchParams.get('pageSize'), 50, 1, 200);
        const page = intParam(url.searchParams.get('page'), 1, 1, 100000);
        const st = url.searchParams.get('status');
        const { rows, total } = await repos.users.list({
          search: url.searchParams.get('search') ?? undefined,
          status: st === 'active' || st === 'disabled' ? st : 'all',
          limit: pageSize,
          offset: (page - 1) * pageSize,
        });
        const desks = await deskMap();
        sendJson(res, 200, { rows: rows.map((u) => toRow(u, desks)), total });
        return true;
      }
      if (method === 'POST') {
        const b = await body(req, createBody);
        if (await repos.users.byEmail(b.email)) throw new HttpError(409, 'server.admin.emailTaken');
        const temp = tempPassword();
        const created = await repos.users.createLocal({
          email: b.email,
          name: b.name,
          password_hash: await hash(temp),
          role_name: b.roleName || null,
          is_admin: b.isAdmin ?? false,
          must_change_password: true,
        });
        // Conta nova ainda não tem idioma salvo: o convite sai no idioma da requisição.
        const out = await deliver(b.email, temp, tr.locale);
        sendJson(res, 201, { user: await one(created.id), ...out });
        return true;
      }
      throw new HttpError(405, 'server.http.methodNotAllowed');
    }

    const m = /^\/api\/admin\/users\/(\d+)(\/reset-password|\/desk)?$/.exec(path);
    if (m) {
      const id = Number(m[1]);
      const target = await repos.users.byId(id);
      if (!target) throw new HttpError(404, 'server.admin.userNotFound');

      if (!m[2]) {
        if (method !== 'PATCH') throw new HttpError(405, 'server.http.methodNotAllowed');
        const b = await body(req, patchBody);
        if (id === me.id && b.status === 'disabled') throw new HttpError(409, 'server.admin.cannotDisableSelf');
        if (id === me.id && b.isAdmin === false) throw new HttpError(409, 'server.admin.cannotDropOwnAdmin');
        const losesAdmin = target.is_admin && target.status === 'active' && (b.isAdmin === false || b.status === 'disabled');
        if (losesAdmin && (await repos.users.countAdmins()) <= 1) throw new HttpError(409, 'server.admin.lastAdmin');
        const saved = await repos.users.update(id, {
          status: b.status,
          is_admin: b.isAdmin,
          role_name: b.roleName === undefined ? undefined : b.roleName || null,
          name: b.name,
        });
        if (!saved) throw new HttpError(404, 'server.admin.userNotFound');
        session.invalidate(id);
        if (b.status === 'disabled' && target.status !== 'disabled') hooks.onUserDisabled?.(id);
        sendJson(res, 200, { user: await one(id) });
        return true;
      }

      if (m[2] === '/reset-password') {
        if (method !== 'POST') throw new HttpError(405, 'server.http.methodNotAllowed');
        const temp = tempPassword();
        await repos.users.setPassword(id, await hash(temp), { needsChange: true });
        session.invalidate(id);
        const out = await deliver(target.email, temp, target.settings?.locale ?? tr.locale);
        sendJson(res, 200, { user: await one(id), ...out });
        return true;
      }

      if (method !== 'DELETE') throw new HttpError(405, 'server.http.methodNotAllowed');
      const desk = await repos.desks.ownedBy(id);
      if (!desk) throw new HttpError(404, 'server.admin.userHasNoDesk');
      await repos.desks.release(desk.desk_id);
      hooks.onDeskReleased?.(desk.desk_id, id);
      sendJson(res, 200, { ok: true, deskId: desk.desk_id });
      return true;
    }

    if (path === '/api/admin/roles') {
      if (method !== 'GET') throw new HttpError(405, 'server.http.methodNotAllowed');
      sendJson(res, 200, { roles: await repos.users.roleNames() });
      return true;
    }

    if (path === '/api/admin/stats') {
      if (method !== 'GET') throw new HttpError(405, 'server.http.methodNotAllowed');
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const [loginsToday, desks, active] = await Promise.all([repos.sessions.countSince(start), repos.desks.all(), repos.users.list({ status: 'active', limit: 1 })]);
      sendJson(res, 200, { online: hooks.onlineCount?.() ?? 0, loginsToday, desksClaimed: desks.length, usersActive: active.total });
      return true;
    }

    return false;
  };
}
