// Rotas do próprio usuário: GET /api/me, PUT /api/me/appearance, PUT /api/me/settings.
import { z } from 'zod';
import { SUPPORTED_LOCALES } from '../../shared/branding';
import type { Appearance, UserPublicSelf } from '../../shared/model';
import { appearanceSchema, displayNameSchema, normalizeAppearance, type AppearanceLike } from '../../shared/validate/appearance';
import { deskDecorSchema, normalizeDecor } from '../../shared/desk-decor';
import { toSessionUser } from '../auth/session';
import { HttpError, readJson, sendJson, translateMaybe } from './app';
import { toPublicSelf } from './auth-routes';
import type { RouteContext, RouteHandler } from './routes';

export type MeResponse = UserPublicSelf & { needsAvatar: boolean; deskId: string | null };

const settingsPatch = z
  .object({
    sounds: z.boolean(),
    showNames: z.boolean(),
    autoAway: z.boolean(),
    volume: z.number().min(0).max(1),
    minimap: z.boolean(),
    // null = volta ao automático (navegador / padrão da instância)
    locale: z.enum(SUPPORTED_LOCALES).nullable(),
  })
  .partial()
  .strict();

export function createMeRoutes(ctx: RouteContext): RouteHandler {
  const { repos, session, hooks } = ctx;

  const meOf = async (row: NonNullable<Awaited<ReturnType<typeof repos.users.byId>>>): Promise<MeResponse> => {
    const self = toPublicSelf(toSessionUser(row));
    const desk = await repos.desks.ownedBy(row.id);
    return { ...self, needsAvatar: row.appearance === null, deskId: desk?.desk_id ?? null };
  };

  return async (req, res, url, tr) => {
    const path = url.pathname;
    if (path !== '/api/me' && !path.startsWith('/api/me/')) return false;
    const me = await session.requireUser(req);

    if (path === '/api/me') {
      if (req.method !== 'GET') throw new HttpError(405, 'server.http.methodNotAllowed');
      const row = await repos.users.byId(me.id);
      if (!row) throw new HttpError(401, 'server.http.unauthenticated');
      sendJson(res, 200, await meOf(row));
      return true;
    }

    if (path === '/api/me/appearance') {
      if (req.method !== 'PUT') throw new HttpError(405, 'server.http.methodNotAllowed');
      const raw = (await readJson(req)) as { appearance?: unknown; displayName?: unknown } | null;
      if (!raw || typeof raw !== 'object' || !raw.appearance || typeof raw.appearance !== 'object') throw new HttpError(400, 'server.me.appearanceMissing');
      const name = displayNameSchema.safeParse(raw.displayName);
      if (!name.success) throw new HttpError(400, 'server.me.invalidName', { detail: translateMaybe(name.error.issues[0]?.message ?? '', tr) });
      const parsed = appearanceSchema.safeParse(normalizeAppearance(raw.appearance as AppearanceLike));
      if (!parsed.success) {
        sendJson(res, 400, { error: tr.t('server.me.invalidAppearance'), issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: translateMaybe(i.message, tr) })) });
        return true;
      }
      const appearance = parsed.data as unknown as Appearance;
      const saved = await repos.users.update(me.id, { appearance, display_name: name.data });
      if (!saved) throw new HttpError(401, 'server.http.unauthenticated');
      session.invalidate(me.id);
      hooks.onAppearanceChanged?.(me.id, appearance, name.data);
      sendJson(res, 200, await meOf(saved));
      return true;
    }

    if (path === '/api/me/settings') {
      if (req.method !== 'PUT') throw new HttpError(405, 'server.http.methodNotAllowed');
      const raw = (await readJson(req)) as { patch?: unknown } | null;
      const parsed = settingsPatch.safeParse(raw?.patch);
      if (!parsed.success) throw new HttpError(400, 'server.me.invalidSettings');
      const row = await repos.users.byId(me.id);
      if (!row) throw new HttpError(401, 'server.http.unauthenticated');
      const { locale, ...rest } = parsed.data;
      const merged: Record<string, unknown> = { ...(row.settings ?? {}), ...rest };
      if (locale === null) delete merged.locale;
      else if (locale !== undefined) merged.locale = locale;
      const saved = await repos.users.update(me.id, { settings: merged });
      if (!saved) throw new HttpError(401, 'server.http.unauthenticated');
      session.invalidate(me.id);
      sendJson(res, 200, await meOf(saved));
      return true;
    }

    if (path === '/api/me/desk/decor') {
      if (req.method !== 'PUT' && req.method !== 'DELETE') throw new HttpError(405, 'server.http.methodNotAllowed');
      let decor = null as ReturnType<typeof normalizeDecor>;
      if (req.method === 'PUT') {
        const raw = (await readJson(req)) as { decor?: unknown } | null;
        const parsed = deskDecorSchema.safeParse(raw?.decor);
        if (!parsed.success) {
          sendJson(res, 400, { error: tr.t('server.me.invalidDecor'), issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: translateMaybe(i.message, tr) })) });
          return true;
        }
        decor = normalizeDecor(parsed.data);
      }
      const desk = await repos.desks.ownedBy(me.id);
      if (!desk) throw new HttpError(409, 'server.me.noDesk');
      await repos.desks.setDecor(desk.desk_id, decor);
      hooks.onDeskDecor?.(desk.desk_id, me.id, decor);
      sendJson(res, 200, { deskId: desk.desk_id, decor });
      return true;
    }

    return false;
  };
}
