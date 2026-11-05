// Eventos de telemetria (telemetry_events): gravação em lote, consulta do admin, resumo por usuário e retenção.
//
// Regras do resumo (iguais no MySQL e no fake — `summarizeTelemetry` é a referência):
// - sessions: sessões distintas do cliente (exclui 'server');
// - rtt/fps: de `sample` (`data.rtt`/`data.fps` numéricos; ausentes não contam); p95 = nearest-rank (ceil(0.95·n)º menor);
// - rejects: `moved_reject` do servidor; jumps: `pos_jump`; disconnects: `ws_drop` (queda anormal, vista pelo servidor);
// - errors: `js_error`; lastAv: status do `sample`/`av_status` mais recente.
import { SERVER_SESSION } from '../../../shared/telemetry';
import type { Db } from '../pool';
import { date, num, parseJson } from './util';

export interface TelemetryEventRow {
  id: number;
  user_id: number | null;
  session_id: string;
  kind: string;
  at: Date;
  data: Record<string, unknown> | null;
}

export type NewTelemetryEvent = Omit<TelemetryEventRow, 'id'>;

export interface TelemetryQuery {
  userId?: number;
  kind?: string;
  sessionId?: string;
  since: Date;
  limit: number;
}

export interface TelemetrySummaryRow {
  user_id: number;
  last_seen: Date;
  sessions: number;
  samples: number;
  rtt_avg: number | null;
  rtt_p95: number | null;
  fps_avg: number | null;
  rejects: number;
  jumps: number;
  disconnects: number;
  errors: number;
  last_av: string | null;
}

export interface TelemetryRepo {
  insertMany(rows: NewTelemetryEvent[]): Promise<number>;
  /** Mais recentes primeiro, no máximo `limit` (1..1000). */
  query(q: TelemetryQuery): Promise<TelemetryEventRow[]>;
  /** Uma linha por usuário com eventos desde `since`, ordenadas por `last_seen` desc. */
  summary(since: Date): Promise<TelemetrySummaryRow[]>;
  purgeOlderThan(days: number): Promise<number>;
}

export const clampLimit = (n: number): number => Math.min(Math.max(Math.trunc(n) || 1, 1), 1000);

const numOf = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Percentil nearest-rank (0 < p <= 1). */
export function percentile(xs: readonly number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(p * s.length) - 1)]!;
}

const avg = (xs: readonly number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function avStatusOf(r: TelemetryEventRow): string | null {
  const d = r.data ?? {};
  if (r.kind === 'av_status') return typeof d.status === 'string' ? d.status : null;
  const av = d.av as { status?: unknown } | undefined;
  return av && typeof av.status === 'string' ? av.status : null;
}

/** Resumo por usuário a partir das linhas (referência do SQL; usado pelo fake). */
export function summarizeTelemetry(rows: readonly TelemetryEventRow[], since: Date): TelemetrySummaryRow[] {
  const by = new Map<number, TelemetryEventRow[]>();
  for (const r of rows) {
    if (r.user_id === null || r.at.getTime() < since.getTime()) continue;
    let list = by.get(r.user_id);
    if (!list) by.set(r.user_id, (list = []));
    list.push(r);
  }
  const out: TelemetrySummaryRow[] = [];
  for (const [userId, list] of by) {
    const rtts: number[] = [];
    const fpss: number[] = [];
    const sessions = new Set<string>();
    let lastSeen = 0;
    let samples = 0;
    let rejects = 0;
    let jumps = 0;
    let disconnects = 0;
    let errors = 0;
    let lastAv: { id: number; s: string } | null = null;
    for (const r of list) {
      lastSeen = Math.max(lastSeen, r.at.getTime());
      if (r.session_id !== SERVER_SESSION) sessions.add(r.session_id);
      if (r.kind === 'sample') {
        samples++;
        const rtt = numOf(r.data?.rtt);
        const fps = numOf(r.data?.fps);
        if (rtt !== null) rtts.push(rtt);
        if (fps !== null) fpss.push(fps);
      }
      if (r.kind === 'moved_reject' && r.session_id === SERVER_SESSION) rejects++;
      if (r.kind === 'pos_jump') jumps++;
      if (r.kind === 'ws_drop') disconnects++;
      if (r.kind === 'js_error') errors++;
      if (r.kind === 'sample' || r.kind === 'av_status') {
        const s = avStatusOf(r);
        if (s !== null && (!lastAv || r.id > lastAv.id)) lastAv = { id: r.id, s };
      }
    }
    out.push({
      user_id: userId,
      last_seen: new Date(lastSeen),
      sessions: sessions.size,
      samples,
      rtt_avg: avg(rtts),
      rtt_p95: percentile(rtts, 0.95),
      fps_avg: avg(fpss),
      rejects,
      jumps,
      disconnects,
      errors,
      last_av: lastAv?.s ?? null,
    });
  }
  return out.sort((a, b) => b.last_seen.getTime() - a.last_seen.getTime() || a.user_id - b.user_id);
}

function eventFromDb(r: Record<string, unknown>): TelemetryEventRow {
  return {
    id: num(r.id),
    user_id: r.user_id == null ? null : num(r.user_id),
    session_id: String(r.session_id),
    kind: String(r.kind),
    at: date(r.at) ?? new Date(0),
    data: parseJson<Record<string, unknown>>(r.data),
  };
}

const nOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export function createMysqlTelemetryRepo(db: Db): TelemetryRepo {
  return {
    async insertMany(rows) {
      if (!rows.length) return 0;
      const ph = rows.map(() => '(?, ?, ?, ?, ?)').join(', ');
      const params: unknown[] = [];
      for (const r of rows) params.push(r.user_id, r.session_id.slice(0, 40), r.kind.slice(0, 32), r.at, r.data === null ? null : JSON.stringify(r.data));
      const res = await db.exec(`INSERT INTO telemetry_events (user_id, session_id, kind, at, data) VALUES ${ph}`, params);
      return res.affectedRows;
    },

    async query(q) {
      const where = ['at >= ?'];
      const params: unknown[] = [q.since];
      if (q.userId !== undefined) {
        where.push('user_id = ?');
        params.push(q.userId);
      }
      if (q.kind) {
        where.push('kind = ?');
        params.push(q.kind);
      }
      if (q.sessionId) {
        where.push('session_id = ?');
        params.push(q.sessionId);
      }
      const rows = await db.query<Record<string, unknown>>(
        `SELECT id, user_id, session_id, kind, at, data FROM telemetry_events WHERE ${where.join(' AND ')} ORDER BY at DESC, id DESC LIMIT ?`,
        [...params, clampLimit(q.limit)],
      );
      return rows.map(eventFromDb);
    },

    async summary(since) {
      // Contagens e médias numa passada; p95 com ROW_NUMBER (MySQL 8); último status de A/V pela maior id.
      const base = await db.query<Record<string, unknown>>(
        `SELECT user_id,
            MAX(at) AS last_seen,
            COUNT(DISTINCT CASE WHEN session_id <> ? THEN session_id END) AS sessions,
            SUM(kind = 'sample') AS samples,
            AVG(CASE WHEN kind = 'sample' AND JSON_TYPE(JSON_EXTRACT(data, '$.rtt')) IN ('INTEGER', 'DOUBLE', 'DECIMAL', 'UNSIGNED INTEGER') THEN JSON_EXTRACT(data, '$.rtt') + 0 END) AS rtt_avg,
            AVG(CASE WHEN kind = 'sample' AND JSON_TYPE(JSON_EXTRACT(data, '$.fps')) IN ('INTEGER', 'DOUBLE', 'DECIMAL', 'UNSIGNED INTEGER') THEN JSON_EXTRACT(data, '$.fps') + 0 END) AS fps_avg,
            SUM(kind = 'moved_reject' AND session_id = ?) AS rejects,
            SUM(kind = 'pos_jump') AS jumps,
            SUM(kind = 'ws_drop') AS disconnects,
            SUM(kind = 'js_error') AS errors
         FROM telemetry_events
         WHERE at >= ? AND user_id IS NOT NULL
         GROUP BY user_id`,
        [SERVER_SESSION, SERVER_SESSION, since],
      );
      const p95 = await db.query<Record<string, unknown>>(
        `SELECT user_id, MIN(rtt) AS rtt_p95 FROM (
           SELECT user_id, rtt, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY rtt) AS rn, COUNT(*) OVER (PARTITION BY user_id) AS n
           FROM (
             SELECT user_id, JSON_EXTRACT(data, '$.rtt') + 0 AS rtt FROM telemetry_events
             WHERE kind = 'sample' AND at >= ? AND user_id IS NOT NULL
               AND JSON_TYPE(JSON_EXTRACT(data, '$.rtt')) IN ('INTEGER', 'DOUBLE', 'DECIMAL', 'UNSIGNED INTEGER')
           ) s
         ) ranked
         WHERE rn = CEIL(0.95 * n)
         GROUP BY user_id`,
        [since],
      );
      const av = await db.query<Record<string, unknown>>(
        `SELECT t.user_id, COALESCE(JSON_UNQUOTE(JSON_EXTRACT(t.data, '$.av.status')), JSON_UNQUOTE(JSON_EXTRACT(t.data, '$.status'))) AS last_av
         FROM telemetry_events t
         JOIN (
           SELECT user_id, MAX(id) AS id FROM telemetry_events
           WHERE kind IN ('sample', 'av_status') AND at >= ? AND user_id IS NOT NULL
           GROUP BY user_id
         ) m ON m.id = t.id`,
        [since],
      );
      const p95By = new Map(p95.map((r) => [num(r.user_id), nOrNull(r.rtt_p95)]));
      const avBy = new Map(av.map((r) => [num(r.user_id), r.last_av == null || r.last_av === 'null' ? null : String(r.last_av)]));
      return base
        .map(
          (r): TelemetrySummaryRow => ({
            user_id: num(r.user_id),
            last_seen: date(r.last_seen) ?? new Date(0),
            sessions: num(r.sessions ?? 0),
            samples: num(r.samples ?? 0),
            rtt_avg: nOrNull(r.rtt_avg),
            rtt_p95: p95By.get(num(r.user_id)) ?? null,
            fps_avg: nOrNull(r.fps_avg),
            rejects: num(r.rejects ?? 0),
            jumps: num(r.jumps ?? 0),
            disconnects: num(r.disconnects ?? 0),
            errors: num(r.errors ?? 0),
            last_av: avBy.get(num(r.user_id)) ?? null,
          }),
        )
        .sort((a, b) => b.last_seen.getTime() - a.last_seen.getTime() || a.user_id - b.user_id);
    },

    async purgeOlderThan(days) {
      const cutoff = new Date(Date.now() - days * 86_400_000);
      // Em fatias: um DELETE gigante seguraria locks por muito tempo.
      let total = 0;
      for (let i = 0; i < 100; i++) {
        const res = await db.exec('DELETE FROM telemetry_events WHERE at < ? LIMIT 10000', [cutoff]);
        total += res.affectedRows;
        if (res.affectedRows < 10000) break;
      }
      return total;
    },
  };
}
