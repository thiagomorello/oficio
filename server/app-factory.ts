// Monta o servidor HTTP: guarda de Host/Origin -> /api/health -> rotas /api (auth, me, admin, mapa, livekit)
// -> portão de páginas -> estáticos (prod) ou Vite (--dev). Também sobe o mundo (Office) e o hub WebSocket em /ws.
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { join } from 'node:path';
import { createMailer, type Mailer } from './auth/mailer';
import { effectiveMasterPassword } from './auth/password';
import { createSession, type SessionService } from './auth/session';
import type { ServerConfig } from './config';
import { HttpError, httpErrorMessage, sendJson } from './http/app';
import { localeFromRequest, translatorFor, type ReqTranslator } from './i18n';
import { createAdminRoutes } from './http/admin-routes';
import { createMapRoutes } from './http/admin-maps-routes';
import { createAuthRoutes } from './http/auth-routes';
import { createRequestGuard } from './http/guard';
import { createMeRoutes } from './http/me-routes';
import { createMetricsRoutes } from './http/metrics-routes';
import { createTelemetryRoutes } from './http/telemetry-routes';
import { createServerSink } from './telemetry/index';
import { TELEMETRY_RETENTION_DAYS } from '../shared/telemetry';
import type { AppHooks, RouteContext, RouteHandler } from './http/routes';
import { createStaticHandler } from './http/static';
import { publicConfig, webManifest } from './http/public-config';
import { createDbHealth } from './db/health';
import type { Db } from './db/pool';
import type { Repos } from './db/repos/index';
import { errMsg, log } from './log';
import type { SessionLike } from './auth/session-types';
import { assembleOffice } from '../shared/map/assemble';
import type { OfficeMapDoc } from '../shared/map/doc';
import { Office } from './world/office';
import { fallbackMapDoc } from './world/fallback-map';
import { attachHub } from './ws/hub';
import { mintToken } from './livekit/tokens';
import { createScreenControl, type RoomServiceLike } from './livekit/control';

export interface AppDeps {
  config: ServerConfig;
  repos: Repos;
  /** Ausente quando rodando com os repos em memória (dev sem DATABASE_URL). */
  db?: Db;
  /** Para testes: substitui o mailer SendGrid. */
  mailer?: Mailer;
  /** Gancho de aparência alterada (o escritório já é ligado aqui; este é um extra para testes). */
  onAppearanceChanged?: AppHooks['onAppearanceChanged'];
  /** Só para testes: sessão falsa usada pelo mundo e pelo hub WebSocket (as rotas HTTP usam a sessão real). */
  session?: SessionLike | null;
  /** Documento do mapa no boot (sem ele, um mapa mínimo embutido). */
  mapDoc?: OfficeMapDoc;
  /** `office_maps.id` do documento (0 = embutido/injetado). */
  mapId?: number;
  /** RoomService do LiveKit injetável (testes). */
  roomService?: RoomServiceLike;
}

export interface App {
  server: http.Server;
  /** Sessão (cookie -> usuário); o upgrade do WebSocket reusa `session.userFromRequest`. */
  session: SessionService;
  /** Mundo autoritativo. */
  office: Office;
  /** Ganchos mutáveis preenchidos por outros pacotes. */
  hooks: AppHooks;
  close(): Promise<void>;
}

function parseUrl(req: http.IncomingMessage): URL {
  try {
    return new URL(req.url ?? '/', 'http://localhost');
  } catch {
    return new URL('/', 'http://localhost');
  }
}

const escHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function sendHtml(res: http.ServerResponse, status: number, html: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(html), 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' });
  res.end(html);
}

function redirect(res: http.ServerResponse, to: string): void {
  res.writeHead(302, { Location: to, 'Cache-Control': 'no-store' });
  res.end();
}

const GATED_PAGES = new Set(['/', '/index.html', '/admin', '/admin.html']);
const isGatedPage = (p: string): boolean => GATED_PAGES.has(p) || p.startsWith('/admin/');

export async function createApp({ config, db, repos, mailer, onAppearanceChanged, session: sessionOverride, mapDoc, mapId, roomService }: AppDeps): Promise<App> {
  const startedAt = Date.now();
  const server = http.createServer();
  let closeVite: (() => Promise<void>) | undefined;

  let fallback: (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => void;
  if (config.dev) {
    // Import dinâmico: o bundle de produção nunca carrega o Vite.
    const { createServer } = await import('vite');
    const vite = await createServer({
      configFile: join(config.rootDir, 'vite.config.ts'),
      server: { middlewareMode: true, ws: { server } },
      appType: 'mpa',
    });
    closeVite = () => vite.close();
    fallback = (req, res, url) => {
      // appType 'mpa' não faz o fallback de SPA: reescreve as rotas conhecidas para a página certa.
      if (!url.pathname.includes('.') && !url.pathname.startsWith('/@') && !url.pathname.startsWith('/src/')) {
        const page = url.pathname === '/login' ? '/login.html' : url.pathname === '/admin' || url.pathname.startsWith('/admin/') ? '/admin.html' : '/index.html';
        req.url = page + url.search;
      }
      vite.middlewares(req, res);
    };
  } else {
    const serveStatic = createStaticHandler(join(config.rootDir, 'dist', 'client'), config.defaultLocale);
    fallback = (req, res, url) => serveStatic(req, res, url.pathname);
  }

  const dbHealth = createDbHealth(db);
  const guard = createRequestGuard({ allowedHosts: config.allowedHosts, defaultLocale: config.defaultLocale });

  effectiveMasterPassword(config); // avisa no boot se LOGIN_MASTER_PASSWORD está definido fora do --dev
  let secret = config.jwtSecret;
  if (!secret) {
    if (config.dev || config.inMemory) {
      secret = randomBytes(32).toString('hex');
      log.warn('OFFICE_JWT_SECRET missing: using an ephemeral secret (sessions are lost on restart).');
    } else {
      log.error('OFFICE_JWT_SECRET not set: login will respond 503.');
    }
  }
  const session = createSession({ config, repos, secret: secret ?? randomBytes(32).toString('hex') });

  // Mundo + hub WebSocket (nos testes, uma sessão falsa pode substituir a real)
  const worldSession: SessionLike | null = sessionOverride !== undefined ? sessionOverride : secret ? session : null;
  const doc = mapDoc ?? fallbackMapDoc(config.defaultLocale);
  // Telemetria: eventos do servidor em lote + purga de hora em hora (retenção de 14 dias).
  const telemetrySink = createServerSink(repos.telemetry);
  const purgeTelemetry = (): void =>
    void repos.telemetry
      .purgeOlderThan(TELEMETRY_RETENTION_DAYS)
      .then((n) => {
        if (n) log.info(`telemetry: ${n} old events purged`);
      })
      .catch((err: unknown) => log.warn(`telemetry: purge failed: ${errMsg(err)}`));
  const purgeTimer = setInterval(purgeTelemetry, 3_600_000);
  purgeTimer.unref?.();
  const purgeBoot = setTimeout(purgeTelemetry, 60_000);
  purgeBoot.unref?.();
  const office = new Office({
    repos,
    assembly: assembleOffice(doc, 1),
    mapId: mapId ?? 0,
    session: worldSession,
    mintLiveKit: (u) => mintToken(config.livekit, u),
    screen: createScreenControl(config.livekit, roomService),
    telemetry: telemetrySink,
    defaultLocale: config.defaultLocale,
  });
  await office.load();
  const hub = attachHub(server, { office, session: worldSession, allowedHosts: config.allowedHosts, trustProxy: config.trustProxy, defaultLocale: config.defaultLocale });
  server.on('listening', () => office.start());
  server.on('close', () => office.stop());

  const hooks: AppHooks = {
    onAppearanceChanged: (userId, appearance, displayName) => {
      office.appearanceChanged(userId, appearance, displayName);
      onAppearanceChanged?.(userId, appearance, displayName);
    },
    onUserDisabled: (userId) => office.kickUser(userId, 'disabled'),
    onDeskReleased: (deskId) => office.applyDesk(deskId, null, null),
    onDeskDecor: (deskId, userId, decor) => office.applyDesk(deskId, userId, decor),
    onlineCount: () => office.online,
    onlineUserIds: () => [...office.conns.keys()],
  };
  const ctx: RouteContext = { config, repos, session, mailer: mailer ?? createMailer(config), hooks };
  const routes: RouteHandler[] = [createAuthRoutes(ctx), createMeRoutes(ctx), createTelemetryRoutes(ctx), createAdminRoutes(ctx)];

  const authed = async (req: http.IncomingMessage, res: http.ServerResponse, tr: ReqTranslator) => {
    const user = await (worldSession ?? session).userFromRequest(req);
    if (!user) sendJson(res, 401, { error: tr.t('server.http.unauthenticated') });
    return user;
  };
  /** Rotas do mundo: mapa publicado (ETag) e token do LiveKit. */
  const worldRoutes: RouteHandler = async (req, res, url, tr) => {
    if (url.pathname === '/api/map' && (req.method === 'GET' || req.method === 'HEAD')) {
      if (!(await authed(req, res, tr))) return true;
      const etag = office.etag;
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' });
        res.end();
        return true;
      }
      const body = JSON.stringify({ id: office.mapId, version: office.layoutVersion, doc: office.assembly.doc });
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        ETag: etag,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'same-origin',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
      return true;
    }
    if (url.pathname === '/api/livekit/token' && req.method === 'GET') {
      const user = await authed(req, res, tr);
      if (!user) return true;
      const info = await mintToken(config.livekit, { id: user.id, displayName: user.displayName?.trim() || user.name });
      if (!info) sendJson(res, 503, { error: tr.t('server.http.livekitNotConfigured') });
      else sendJson(res, 200, info);
      return true;
    }
    return false;
  };
  routes.push(worldRoutes);
  routes.push(createMapRoutes(ctx, office));
  const metrics = createMetricsRoutes({ office, config }); routes.push(metrics); hooks.onLogin = () => { office.counters.logins++; };

  /** Portão das páginas: sem sessão -> /login; troca de senha pendente -> /login?change=1; /admin só para admins. */
  async function gatePage(req: http.IncomingMessage, res: http.ServerResponse, url: URL, tr: ReqTranslator): Promise<boolean> {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || !isGatedPage(url.pathname)) return false;
    const user = secret ? await session.userFromRequest(req) : null;
    if (!user) {
      redirect(res, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
      return true;
    }
    if (user.needsPasswordChange) {
      redirect(res, '/login?change=1');
      return true;
    }
    if (url.pathname.startsWith('/admin') && !user.isAdmin) {
      sendHtml(
        res,
        403,
        `<!doctype html><html lang="${tr.locale}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escHtml(tr.t('server.page.accessDeniedTitle'))} · ${escHtml(config.branding.appName)}</title><body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#121212;color:#c8c5ca;font-family:Poppins,system-ui,sans-serif;text-align:center"><div><h1 style="color:#fff;font-size:24px">${escHtml(tr.t('server.page.restricted'))}</h1><p>${escHtml(tr.t('server.page.adminsOnly', { name: user.displayName }))}</p><p><a href="/" style="color:${config.branding.accentColor}">${escHtml(tr.t('server.page.backToOffice'))}</a></p></div></body></html>`,
      );
      return true;
    }
    return false;
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL, tr: ReqTranslator): Promise<void> {
    if (guard(req, res)) return;
    if (url.pathname === '/api/health') {
      const dbState = await dbHealth();
      if (res.writableEnded) return;
      sendJson(res, dbState === 'error' ? 503 : 200, {
        ok: dbState !== 'error',
        db: dbState,
        version: config.version,
        uptime: Math.round((Date.now() - startedAt) / 1000),
        online: office.online,
        livekit: Boolean(config.livekit?.apiKey),
      });
      return;
    }
    if (url.pathname === '/api/config' && (req.method === 'GET' || req.method === 'HEAD')) return sendJson(res, 200, publicConfig(config));
    if (url.pathname === '/manifest.webmanifest' && (req.method === 'GET' || req.method === 'HEAD')) {
      const body = JSON.stringify(webManifest(config));
      res.writeHead(200, { 'Content-Type': 'application/manifest+json', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-cache' });
      return void res.end(req.method === 'HEAD' ? undefined : body);
    }
    if (url.pathname === '/metrics') { if (await metrics(req, res, url, tr)) return; }
    if (url.pathname.startsWith('/api/')) {
      if (!secret && sessionOverride === undefined) return sendJson(res, 503, { error: tr.t('server.http.authNotConfigured') });
      for (const route of routes) if (await route(req, res, url, tr)) return;
      return sendJson(res, 404, { error: tr.t('server.http.notFound') });
    }
    if (await gatePage(req, res, url, tr)) return;
    fallback(req, res, url);
  }

  server.on('request', (req, res) => {
    const url = parseUrl(req);
    // Idioma resolvido uma vez por requisição (?lang= > Accept-Language > OFFICE_DEFAULT_LOCALE) e passado às rotas.
    const tr = translatorFor(localeFromRequest(req, config.defaultLocale));
    handle(req, res, url, tr).catch((err: unknown) => {
      if (err instanceof HttpError && !res.headersSent) return sendJson(res, err.status, { error: httpErrorMessage(err, tr) });
      log.warn(`Error handling ${req.method} ${url.pathname}: ${errMsg(err)}`);
      if (!res.headersSent) sendJson(res, 500, { error: tr.t('server.http.internalError') });
      else res.destroy();
    });
  });

  return {
    server,
    session,
    office,
    hooks,
    close: async () => {
      hub.close();
      clearInterval(purgeTimer);
      clearTimeout(purgeBoot);
      await telemetrySink.close();
      office.stop();
      await closeVite?.();
      server.closeAllConnections?.();
      await new Promise<void>((ok) => (server.listening ? server.close(() => ok()) : ok()));
    },
  };
}
