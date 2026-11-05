// GET /metrics: contadores e gauges do escritório no formato de texto do Prometheus (0.0.4).
// Sem METRICS_TOKEN é público (só números agregados); com ele, exige `Authorization: Bearer <token>`.
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ServerConfig } from '../config';
import type { Office } from '../world/office';
import type { RouteHandler } from './routes';

export interface MetricsDeps {
  office: Office;
  config: Pick<ServerConfig, 'metricsToken'>;
}

function tokenOk(header: string | undefined, token: string): boolean {
  const m = /^Bearer\s+(.+)$/i.exec(header ?? '');
  if (!m) return false;
  const given = Buffer.from(m[1]!.trim());
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

type Sample = [labels: string, value: number];

function render(office: Office): string {
  const lines: string[] = [];
  const metric = (name: string, type: 'gauge' | 'counter', help: string, samples: Sample[]): void => {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
    for (const [labels, value] of samples) lines.push(`${name}${labels} ${value}`);
  };
  metric('office_online_users', 'gauge', 'People connected right now.', [['', office.online]]);
  metric('office_ws_connections', 'gauge', 'Open WebSocket connections.', [['', office.conns.size]]);
  metric('office_tick_duration_ms', 'gauge', 'World tick duration in ms (last and max since boot).', [
    ['{stat="last"}', round(office.lastTickMs)],
    ['{stat="max"}', round(office.maxTickMs)],
  ]);
  metric('office_chat_messages_total', 'counter', 'Chat messages accepted since boot.', [['', office.counters.chat]]);
  metric('office_logins_total', 'counter', 'Successful local logins since boot.', [['', office.counters.logins]]);
  metric('process_uptime_seconds', 'gauge', 'Seconds since the process booted.', [['', round(process.uptime())]]);
  metric('nodejs_heap_used_bytes', 'gauge', 'V8 heap memory in use, in bytes.', [['', process.memoryUsage().heapUsed]]);
  return lines.join('\n') + '\n';
}

const round = (n: number): number => Math.round(n * 1000) / 1000;

export function createMetricsRoutes({ office, config }: MetricsDeps): RouteHandler {
  return async (req: IncomingMessage, res: ServerResponse, url: URL) => {
    if (url.pathname !== '/metrics') return false;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' });
      res.end();
      return true;
    }
    if (config.metricsToken && !tokenOk(req.headers.authorization, config.metricsToken)) {
      res.writeHead(401, { 'WWW-Authenticate': 'Bearer', 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('unauthorized\n');
      return true;
    }
    const body = render(office);
    res.writeHead(200, {
      'Content-Type': 'text/plain; version=0.0.4',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  };
}
