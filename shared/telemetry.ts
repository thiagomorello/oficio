// Telemetria (cliente -> POST /api/telemetry; servidor grava os próprios eventos na mesma tabela).
// Só tipos e limites aqui: a validação (zod) fica no servidor, o coletor no cliente.

/** Itens por lote (o servidor recusa acima disso). */
export const TELEMETRY_MAX_BATCH = 100;
/** Tamanho máximo do `data` de um item, em bytes de JSON. */
export const TELEMETRY_MAX_DATA_BYTES = 4096;
/** Dias de retenção (purga de hora em hora). */
export const TELEMETRY_RETENTION_DAYS = 14;
/** `session_id` dos eventos gravados pelo próprio servidor. */
export const SERVER_SESSION = 'server';
/** Formato de `kind`: minúsculas, dígitos e `_`, até 32. */
export const TELEMETRY_KIND_RE = /^[a-z][a-z0-9_]{0,31}$/;

/**
 * Tipos conhecidos (o servidor aceita qualquer `kind` no formato acima; estes são os que o painel entende).
 * Cliente: session_start, sample, socket, kick, moved_reject, pos_jump, av_status, av_error, js_error,
 * visibility, map_fallback, avatar_editor_error.
 * Servidor (session_id = 'server'): moved_reject, kick, ws_connect, ws_disconnect, ws_drop.
 */
export type TelemetryKind =
  | 'session_start'
  | 'sample'
  | 'socket'
  | 'kick'
  | 'moved_reject'
  | 'pos_jump'
  | 'av_status'
  | 'av_error'
  | 'js_error'
  | 'visibility'
  | 'map_fallback'
  | 'avatar_editor_error'
  | 'ws_connect'
  | 'ws_disconnect'
  | 'ws_drop';

export interface TelemetryItem {
  kind: string;
  /** Epoch ms (relógio do cliente). */
  at: number;
  data: Record<string, unknown>;
}

export interface TelemetryBatch {
  sessionId: string;
  items: TelemetryItem[];
}

/** Linha do resumo por usuário (GET /api/admin/telemetry/summary). */
export interface TelemetryUserSummary {
  userId: number;
  name: string | null;
  online: boolean;
  lastSeen: string;
  sessions: number;
  samples: number;
  rttAvg: number | null;
  rttP95: number | null;
  fpsAvg: number | null;
  rejects: number;
  jumps: number;
  disconnects: number;
  errors: number;
  lastAv: string | null;
}

/** Evento como o admin vê (GET /api/admin/telemetry/events). */
export interface TelemetryEventView {
  id: number;
  userId: number | null;
  sessionId: string;
  kind: string;
  at: string;
  data: Record<string, unknown> | null;
}

/** Janela `since` aceita pelas rotas do admin: `24h`, `7d`, `90m`... (máx. a retenção). */
export function parseSince(raw: string | null | undefined, now: number, def = '24h'): Date {
  const floor = now - TELEMETRY_RETENTION_DAYS * 86_400_000;
  if (raw && /^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const t = Date.parse(raw);
    if (Number.isFinite(t)) return new Date(Math.max(floor, t));
  }
  const m = /^(\d{1,4})([mhd])$/.exec((raw ?? def).trim()) ?? /^(\d{1,4})([mhd])$/.exec(def)!;
  const unit = m[2] === 'm' ? 60_000 : m[2] === 'h' ? 3_600_000 : 86_400_000;
  const ms = Math.min(Number(m[1]) * unit, TELEMETRY_RETENTION_DAYS * 86_400_000);
  return new Date(now - ms);
}
