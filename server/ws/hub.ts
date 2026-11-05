// Hub WebSocket em /ws no mesmo servidor HTTP: Host/Origin -> sessão (cookie) -> upgrade -> mundo.
// Heartbeat a cada 20 s (2 pings sem resposta = derruba), limite de 30 mensagens/s por socket
// (excesso -> `error` e close 1008) e frames de no máximo 8 KiB.
import type http from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { DEFAULT_LOCALE, type Locale } from '../../shared/branding';
import { decodeClient } from '../../shared/protocol';
import type { SessionLike, SessionUser } from '../auth/session-types';
import { hostAllowed, wsOriginAllowed } from '../http/guard';
import { localeFromRequest, tFor } from '../i18n';
import { errMsg, log } from '../log';
import type { Office } from '../world/office';
import { send, wsConn, type Conn } from './outbox';

export const WS_PATH = '/ws';
export const MAX_PAYLOAD = 8192;
export const HEARTBEAT_MS = 20_000;
export const MAX_MISSED_PONGS = 2;
export const MAX_MSGS_PER_SEC = 30;

export interface HubOptions {
  office: Office;
  session: SessionLike | null | undefined;
  allowedHosts: ReadonlySet<string>;
  trustProxy?: boolean;
  heartbeatMs?: number;
  /** Idioma de quem não diz o seu no upgrade (OFFICE_DEFAULT_LOCALE). */
  defaultLocale?: Locale;
}

export interface Hub {
  wss: WebSocketServer;
  close(): void;
}

interface Client {
  ws: WebSocket;
  conn: Conn;
  /** Idioma da conexão: preferência salva do usuário > Accept-Language do upgrade > padrão da instância. */
  locale: Locale;
  userId: number;
  missed: number;
  windowStart: number;
  count: number;
}

function refuse(socket: Duplex, status: number, text: string): void {
  if (!socket.writable) return void socket.destroy();
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: 0\r\n\r\n`);
}

function clientIp(req: http.IncomingMessage, trustProxy: boolean): string | null {
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? null;
}

export function attachHub(server: http.Server, opts: HubOptions): Hub {
  const { office } = opts;
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });
  const clients = new Set<Client>();

  const onUpgrade = (req: http.IncomingMessage, socket: Duplex, head: Buffer): void => {
    let path = '/';
    try {
      path = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      // url inválida: cai no "não é nosso"
    }
    if (path !== WS_PATH) {
      // Outros upgrades (HMR do Vite em --dev) têm o próprio listener; sem ninguém, fecha.
      if (server.listenerCount('upgrade') <= 1) socket.destroy();
      return;
    }
    socket.on('error', () => undefined);
    if (!hostAllowed(req.headers.host, opts.allowedHosts) || !wsOriginAllowed(req, { allowedHosts: opts.allowedHosts })) {
      return refuse(socket, 403, 'Forbidden');
    }
    const session = opts.session;
    if (!session) return refuse(socket, 401, 'Unauthorized');
    void Promise.resolve()
      .then(() => session.userFromRequest(req))
      .then(
        (user) => {
          if (!user) return refuse(socket, 401, 'Unauthorized');
          if (socket.destroyed) return;
          wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, req, user));
        },
        (err: unknown) => {
          log.warn(`Failed to validate the WebSocket session: ${errMsg(err)}`);
          refuse(socket, 500, 'Internal Server Error');
        },
      );
  };

  const onConnection = (ws: WebSocket, req: http.IncomingMessage, user: SessionUser): void => {
    const conn = wsConn(ws, clientIp(req, !!opts.trustProxy));
    const locale: Locale = user.settings?.locale ?? localeFromRequest(req, opts.defaultLocale ?? DEFAULT_LOCALE);
    const client: Client = { ws, conn, locale, userId: user.id, missed: 0, windowStart: Date.now(), count: 0 };
    clients.add(client);
    ws.on('pong', () => {
      client.missed = 0;
    });
    ws.on('message', (data: RawData, isBinary: boolean) => {
      const now = Date.now();
      if (now - client.windowStart >= 1000) {
        client.windowStart = now;
        client.count = 0;
      }
      if (++client.count > MAX_MSGS_PER_SEC) {
        if (client.count === MAX_MSGS_PER_SEC + 1) {
          send(conn, { t: 'error', code: 'rate_limited' });
          ws.close(1008, 'rate limit');
        }
        return;
      }
      const msg = isBinary ? null : decodeClient(data.toString());
      if (!msg) return send(conn, { t: 'error', code: 'bad_message' });
      if (!office.isCurrent(client.userId, conn)) return;
      office.handle(client.userId, msg).catch((err: unknown) => log.warn(`Error handling '${msg.t}': ${errMsg(err)}`));
    });
    ws.on('error', () => undefined);
    ws.on('close', (code: number) => {
      clients.delete(client);
      office.leave(client.userId, conn, code);
    });
    office.join(user, conn, locale).catch((err: unknown) => {
      log.warn(`Failed to join the world: ${errMsg(err)}`);
      ws.close(1011, tFor(locale, 'server.ws.error'));
    });
  };

  server.on('upgrade', onUpgrade);
  const heartbeat = setInterval(() => {
    for (const c of clients) {
      if (c.missed >= MAX_MISSED_PONGS) {
        c.ws.terminate();
        continue;
      }
      c.missed++;
      try {
        c.ws.ping();
      } catch {
        // socket já fechando
      }
    }
  }, opts.heartbeatMs ?? HEARTBEAT_MS);
  heartbeat.unref?.();

  return {
    wss,
    close() {
      clearInterval(heartbeat);
      server.off('upgrade', onUpgrade);
      for (const c of clients) c.ws.close(1001, tFor(c.locale, 'server.ws.restarting'));
      for (const c of clients) c.ws.terminate();
      clients.clear();
      wss.close();
    },
  };
}
