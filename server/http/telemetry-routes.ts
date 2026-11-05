// Telemetria: POST /api/telemetry (qualquer usuário logado) e as leituras do admin
// (GET /api/admin/telemetry/summary, GET /api/admin/telemetry/events).
import { TELEMETRY_KIND_RE, parseSince, type TelemetryEventView, type TelemetryUserSummary } from '../../shared/telemetry';
import { batchRows, createRateLimiter, parseTelemetryBatch } from '../telemetry/index';
import { errMsg, log } from '../log';
import { HttpError, readJson, sendJson } from './app';
import type { RouteContext, RouteHandler } from './routes';

/** 100 itens x 4 KB + envelope. */
const MAX_TELEMETRY_BODY = 512 * 1024;

const round = (n: number | null, d = 1): number | null => (n === null ? null : Math.round(n * 10 ** d) / 10 ** d);

export function createTelemetryRoutes(ctx: RouteContext, opts: { now?: () => number; limiter?: ReturnType<typeof createRateLimiter> } = {}): RouteHandler {
  const { repos, session, hooks } = ctx;
  const now = opts.now ?? Date.now;
  const limiter = opts.limiter ?? createRateLimiter();

  return async (req, res, url, tr) => {
    const path = url.pathname;

    if (path === '/api/telemetry') {
      if (req.method !== 'POST') throw new HttpError(405, 'server.http.methodNotAllowed');
      const me = await session.requireUser(req);
      if (!limiter.take(me.id)) {
        req.resume();
        throw new HttpError(429, 'server.http.tooManyRequests');
      }
      const parsed = parseTelemetryBatch(await readJson(req, MAX_TELEMETRY_BODY));
      if (!parsed.ok) throw new HttpError(400, parsed.error);
      try {
        await repos.telemetry.insertMany(batchRows(me.id, parsed.batch, now()));
      } catch (err) {
        log.warn(`telemetry: failed to store batch from user ${me.id}: ${errMsg(err)}`);
        throw new HttpError(503, 'server.telemetry.unavailable');
      }
      res.writeHead(204, { 'Cache-Control': 'no-store' });
      res.end();
      return true;
    }

    if (!path.startsWith('/api/admin/telemetry/')) return false;
    await session.requireAdmin(req);
    if (req.method !== 'GET') throw new HttpError(405, 'server.http.methodNotAllowed');

    if (path === '/api/admin/telemetry/summary') {
      const since = parseSince(url.searchParams.get('since'), now());
      const rows = await repos.telemetry.summary(since);
      const online = new Set(hooks.onlineUserIds?.() ?? []);
      const names = new Map<number, string | null>();
      await Promise.all(
        rows.map(async (r) => {
          const u = await repos.users.byId(r.user_id).catch(() => null);
          names.set(r.user_id, u ? u.display_name?.trim() || u.name : null);
        }),
      );
      const out: TelemetryUserSummary[] = rows.map((r) => ({
        userId: r.user_id,
        name: names.get(r.user_id) ?? null,
        online: online.has(r.user_id),
        lastSeen: r.last_seen.toISOString(),
        sessions: r.sessions,
        samples: r.samples,
        rttAvg: round(r.rtt_avg),
        rttP95: round(r.rtt_p95),
        fpsAvg: round(r.fps_avg),
        rejects: r.rejects,
        jumps: r.jumps,
        disconnects: r.disconnects,
        errors: r.errors,
        lastAv: r.last_av,
      }));
      sendJson(res, 200, { since: since.toISOString(), rows: out });
      return true;
    }

    if (path === '/api/admin/telemetry/events') {
      const q = url.searchParams;
      const userRaw = q.get('user');
      const userId = userRaw ? Number.parseInt(userRaw, 10) : undefined;
      if (userRaw && !Number.isFinite(userId)) throw new HttpError(400, 'server.telemetry.invalidUser');
      const kind = q.get('kind') || undefined;
      if (kind && !TELEMETRY_KIND_RE.test(kind)) throw new HttpError(400, 'server.telemetry.invalidKind');
      const sessionId = q.get('session') || undefined;
      if (sessionId && !/^[A-Za-z0-9_-]{1,40}$/.test(sessionId)) throw new HttpError(400, 'server.telemetry.invalidSession');
      const limit = Number.parseInt(q.get('limit') ?? '', 10);
      const since = parseSince(q.get('since'), now());
      const rows = await repos.telemetry.query({ userId, kind, sessionId, since, limit: Number.isFinite(limit) ? limit : 200 });
      const out: TelemetryEventView[] = rows.map((r) => ({ id: r.id, userId: r.user_id, sessionId: r.session_id, kind: r.kind, at: r.at.toISOString(), data: r.data }));
      sendJson(res, 200, { since: since.toISOString(), rows: out });
      return true;
    }

    return false;
  };
}
