// Telemetria no servidor: validação do lote do cliente, limite por usuário e o "sink" dos eventos
// do próprio servidor (moved_reject, kick, ws_*), gravados em lote para não pesar no tick.
import { z } from 'zod';
import { SERVER_SESSION, TELEMETRY_KIND_RE, TELEMETRY_MAX_BATCH, TELEMETRY_MAX_DATA_BYTES, type TelemetryBatch } from '../../shared/telemetry';
import type { NewTelemetryEvent, TelemetryRepo } from '../db/repos/index';
import { errMsg, log } from '../log';

/** Tolerância do relógio do cliente: eventos com `at` fora disso usam a hora do servidor. */
export const MAX_CLOCK_SKEW_MS = 24 * 3_600_000;

const itemSchema = z.object({
  kind: z.string().regex(TELEMETRY_KIND_RE, 'invalid kind'),
  at: z.number().finite(),
  data: z
    .record(z.string(), z.unknown())
    .refine((d) => {
      try {
        return Buffer.byteLength(JSON.stringify(d)) <= TELEMETRY_MAX_DATA_BYTES;
      } catch {
        return false;
      }
    }, `data larger than ${TELEMETRY_MAX_DATA_BYTES} bytes`),
});

export const telemetryBatchSchema = z.object({
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{8,40}$/, 'invalid sessionId'),
  items: z.array(itemSchema).min(1).max(TELEMETRY_MAX_BATCH),
});

export type ParseResult = { ok: true; batch: TelemetryBatch } | { ok: false; error: string };

export function parseTelemetryBatch(raw: unknown): ParseResult {
  const r = telemetryBatchSchema.safeParse(raw);
  if (!r.success) {
    const i = r.error.issues[0];
    return { ok: false, error: i ? `${i.path.join('.') || 'batch'}: ${i.message}` : 'invalid batch' };
  }
  if (r.data.sessionId === SERVER_SESSION) return { ok: false, error: 'reserved sessionId' };
  return { ok: true, batch: r.data as TelemetryBatch };
}

/** Converte o lote em linhas (hora do cliente, corrigida se estiver absurda). */
export function batchRows(userId: number, batch: TelemetryBatch, now: number): NewTelemetryEvent[] {
  return batch.items.map((it) => ({
    user_id: userId,
    session_id: batch.sessionId,
    kind: it.kind,
    at: new Date(Math.abs(it.at - now) > MAX_CLOCK_SKEW_MS ? now : it.at),
    data: it.data,
  }));
}

/**
 * Limite por chave (token bucket): `burst` requisições de uma vez, recarga de 1 a cada `everyMs`.
 * O padrão (1 a cada 2 s, rajada de 3) deixa passar o envio do `pagehide` logo após um envio periódico.
 */
export function createRateLimiter(everyMs = 2000, burst = 3, now: () => number = Date.now) {
  const buckets = new Map<number, { tokens: number; at: number }>();
  return {
    take(key: number): boolean {
      const t = now();
      const b = buckets.get(key) ?? { tokens: burst, at: t };
      b.tokens = Math.min(burst, b.tokens + (t - b.at) / everyMs);
      b.at = t;
      buckets.set(key, b);
      if (buckets.size > 10_000) buckets.clear();
      if (b.tokens < 1) return false;
      b.tokens -= 1;
      return true;
    },
  };
}

/** Destino dos eventos do servidor (injetado no Office; opcional). */
export interface TelemetrySink {
  server(userId: number | null, kind: string, data: Record<string, unknown>): void;
}

export interface BufferedSink extends TelemetrySink {
  flush(): Promise<void>;
  close(): Promise<void>;
}

/** Junta os eventos do servidor e grava a cada `everyMs` (ou ao chegar em `maxBuffer`). Nunca lança. */
export function createServerSink(repo: TelemetryRepo, opts: { everyMs?: number; maxBuffer?: number; now?: () => number } = {}): BufferedSink {
  const now = opts.now ?? Date.now;
  const maxBuffer = opts.maxBuffer ?? 200;
  let buf: NewTelemetryEvent[] = [];
  let flushing: Promise<void> | null = null;
  const flush = async (): Promise<void> => {
    if (flushing) await flushing;
    if (!buf.length) return;
    const rows = buf;
    buf = [];
    flushing = repo
      .insertMany(rows)
      .then(() => undefined)
      .catch((err: unknown) => log.warn(`telemetry: failed to store ${rows.length} server events: ${errMsg(err)}`))
      .finally(() => {
        flushing = null;
      });
    await flushing;
  };
  const timer = setInterval(() => void flush(), opts.everyMs ?? 5000);
  timer.unref?.();
  return {
    server(userId, kind, data) {
      try {
        if (buf.length >= 5000) return; // banco fora: não incha a memória
        buf.push({ user_id: userId, session_id: SERVER_SESSION, kind, at: new Date(now()), data });
        if (buf.length >= maxBuffer) void flush();
      } catch {
        // telemetria nunca derruba o mundo
      }
    },
    flush,
    async close() {
      clearInterval(timer);
      await flush();
    },
  };
}
