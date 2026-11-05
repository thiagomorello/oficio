// Partes puras do coletor de telemetria (sem DOM): fila com limites, corte do `data`, estatística de
// quadros e detector de saltos do próprio avatar. O `index.ts` liga isso ao navegador.
import { TELEMETRY_KIND_RE, TELEMETRY_MAX_BATCH, TELEMETRY_MAX_DATA_BYTES, type TelemetryItem } from '../../../shared/telemetry';

/** Máximo de eventos esperando envio (os mais antigos saem primeiro). */
export const MAX_QUEUED = 200;
/** Envia assim que a fila chegar a isso. */
export const FLUSH_AT = 50;
/** Intervalo do envio e das amostras. */
export const FLUSH_EVERY_MS = 10_000;
/** Salto do próprio avatar num único quadro (px de mundo). */
export const JUMP_PX = 24;
/** Tamanho máximo de mensagens/pilhas de erro guardadas. */
export const MAX_TEXT = 1024;

/** Corta textos longos e garante `data` serializável e <= 4 KB (senão, um resumo). */
export function clipData(data: Record<string, unknown>, maxBytes = TELEMETRY_MAX_DATA_BYTES): Record<string, unknown> {
  let json: string;
  try {
    json = JSON.stringify(data, (_k, v: unknown) => (typeof v === 'string' && v.length > MAX_TEXT ? v.slice(0, MAX_TEXT) : typeof v === 'bigint' ? String(v) : v));
  } catch {
    return { unserializable: true };
  }
  if (json === undefined) return {};
  const bytes = new TextEncoder().encode(json).length;
  if (bytes <= maxBytes) return JSON.parse(json) as Record<string, unknown>;
  return { truncated: true, bytes, head: json.slice(0, Math.floor(maxBytes / 2)) };
}

/** Fila de eventos com teto; nunca lança. */
export class TelemetryQueue {
  private items: TelemetryItem[] = [];
  /** Eventos descartados por excesso desde o último `take` (vai junto na próxima amostra). */
  dropped = 0;

  constructor(
    private readonly max = MAX_QUEUED,
    private readonly flushAt = FLUSH_AT,
  ) {}

  get size(): number {
    return this.items.length;
  }

  push(kind: string, data: Record<string, unknown>, at: number): void {
    if (!TELEMETRY_KIND_RE.test(kind)) return;
    this.items.push({ kind, at, data: clipData(data) });
    while (this.items.length > this.max) {
      this.items.shift();
      this.dropped++;
    }
  }

  /** Já vale enviar antes do intervalo? */
  get due(): boolean {
    return this.items.length >= this.flushAt;
  }

  /** Tira até `n` eventos (os mais antigos) para um lote. */
  take(n = TELEMETRY_MAX_BATCH): TelemetryItem[] {
    return this.items.splice(0, Math.max(0, Math.min(n, TELEMETRY_MAX_BATCH)));
  }

  /** Lote que falhou volta para a frente (respeitando o teto: os mais antigos caem). */
  requeue(batch: TelemetryItem[]): void {
    this.items = [...batch, ...this.items];
    while (this.items.length > this.max) {
      this.items.shift();
      this.dropped++;
    }
  }

  clear(): void {
    this.items = [];
  }
}

/** FPS médio e pior quadro numa janela. Quadros > `gapMs` (aba oculta) não entram. */
export class FrameStats {
  private frames = 0;
  private total = 0;
  private worst = 0;

  constructor(private readonly gapMs = 1000) {}

  add(dtMs: number): void {
    if (!(dtMs > 0) || dtMs > this.gapMs) return;
    this.frames++;
    this.total += dtMs;
    if (dtMs > this.worst) this.worst = dtMs;
  }

  /** Resumo da janela e zera. `fps` null se não houve quadros (aba oculta). */
  take(): { fps: number | null; worstMs: number | null; frames: number } {
    const out = {
      fps: this.frames && this.total > 0 ? Math.round((this.frames * 1000 * 10) / this.total) / 10 : null,
      worstMs: this.frames ? Math.round(this.worst * 10) / 10 : null,
      frames: this.frames,
    };
    this.frames = 0;
    this.total = 0;
    this.worst = 0;
    return out;
  }
}

export interface JumpInfo {
  dist: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
}

/** Detecta saltos do próprio avatar entre quadros consecutivos. */
export class JumpDetector {
  private last: { x: number; y: number } | null = null;

  constructor(private readonly threshold = JUMP_PX) {}

  /** Esquece a última posição (troca de mapa, reconexão, aba voltando). */
  reset(): void {
    this.last = null;
  }

  /** Posição do quadro; devolve o salto se passou do limite. `null` = sem avatar. */
  feed(p: { x: number; y: number } | null): JumpInfo | null {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      this.last = null;
      return null;
    }
    const prev = this.last;
    this.last = { x: p.x, y: p.y };
    if (!prev) return null;
    const dist = Math.hypot(p.x - prev.x, p.y - prev.y);
    if (dist <= this.threshold) return null;
    const r = (n: number) => Math.round(n * 10) / 10;
    return { dist: r(dist), from: { x: r(prev.x), y: r(prev.y) }, to: { x: r(p.x), y: r(p.y) } };
  }
}

/** Id aleatório da sessão (aba). */
export function newSessionId(rand: () => number = Math.random): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID().replace(/-/g, '').slice(0, 24);
  } catch {
    // segue para o fallback
  }
  let s = '';
  for (let i = 0; i < 24; i++) s += Math.floor(rand() * 36).toString(36);
  return s;
}

/** Telemetria desligada por `localStorage['oficio:telemetry'] = 'off'`. */
export function telemetryDisabled(storage: Pick<Storage, 'getItem'> | null | undefined): boolean {
  try {
    return storage?.getItem('oficio:telemetry') === 'off';
  } catch {
    return false;
  }
}

/** Resume um erro (mensagem + começo da pilha). */
export function errorData(err: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
  if (err instanceof Error) {
    return { name: err.name, message: err.message.slice(0, MAX_TEXT), stack: (err.stack ?? '').slice(0, MAX_TEXT), ...extra };
  }
  let message: string;
  try {
    message = typeof err === 'string' ? err : JSON.stringify(err) ?? String(err);
  } catch {
    message = String(err);
  }
  return { message: message.slice(0, MAX_TEXT), ...extra };
}

/** Teto do corpo no envio do `pagehide` (limite de keepalive/sendBeacon é 64 KiB). */
export const BEACON_MAX_BYTES = 60_000;

/** Resultado de um envio: status HTTP ou 0 (falha de rede). */
export type PostFn = (body: string, opts: { beacon: boolean }) => Promise<number>;

export interface Flusher {
  /** Envia um lote (até 100). Sem rede/offline: devolve à fila. Nunca rejeita. */
  flush(opts?: { beacon?: boolean }): Promise<void>;
  /** Para de enviar de vez (ex.: 401). */
  readonly stopped: boolean;
}

/**
 * Política de envio: um lote por vez; offline não tenta; 2xx descarta; 400/413 descarta (lote ruim);
 * 401/403 para de vez; 429/5xx/rede devolvem o lote à fila. No `pagehide` (beacon) manda o que couber, sem esperar.
 */
export function createFlusher(opts: { queue: TelemetryQueue; sessionId: string; post: PostFn; online?: () => boolean; beaconMax?: number }): Flusher {
  let inFlight = false;
  let stopped = false;
  const online = opts.online ?? (() => true);
  return {
    get stopped() {
      return stopped;
    },
    async flush(f = {}) {
      if (stopped || !opts.queue.size || !online()) return;
      if (inFlight && !f.beacon) return;
      const items = opts.queue.take(f.beacon ? (opts.beaconMax ?? 50) : TELEMETRY_MAX_BATCH);
      if (!items.length) return;
      let body = JSON.stringify({ sessionId: opts.sessionId, items });
      // keepalive/sendBeacon aceitam ~64 KB: corta o fim do lote (a página está fechando de qualquer jeito)
      while (f.beacon && body.length > BEACON_MAX_BYTES && items.length > 1) {
        items.splice(Math.ceil(items.length / 2));
        body = JSON.stringify({ sessionId: opts.sessionId, items });
      }
      let status = 0;
      inFlight = !f.beacon || inFlight;
      try {
        status = await opts.post(body, { beacon: !!f.beacon });
      } catch {
        status = 0;
      } finally {
        if (!f.beacon) inFlight = false;
      }
      if (status >= 200 && status < 300) return;
      if (status === 401 || status === 403) {
        stopped = true;
        opts.queue.clear();
        return;
      }
      if (status === 400 || status === 413) return;
      if (!f.beacon) opts.queue.requeue(items);
    },
  };
}
