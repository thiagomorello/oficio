// Coletor de telemetria do escritório: amostras a cada 10 s (RTT, relógio, FPS, posição, A/V, memória)
// e eventos na hora (socket, kick, recusas de movimento, saltos do avatar, A/V, erros de JS, visibilidade).
// Envia em lote para POST /api/telemetry; no `pagehide` usa keepalive/sendBeacon. Nunca lança.
// Desligar: localStorage['oficio:telemetry'] = 'off'.
import type { MediaHandle } from '../av/index';
import type { OfficeSocket } from '../net/socket';
import type { OfficeClientStore } from '../net/world-store';
import type { WorldApi } from '../world/api';
import { TILE } from '../../../shared/map/tile';
import { FLUSH_EVERY_MS, FrameStats, JumpDetector, TelemetryQueue, createFlusher, errorData, newSessionId, telemetryDisabled, type PostFn } from './core';

export { clipData, createFlusher, FrameStats, JumpDetector, TelemetryQueue } from './core';

/** Evento anterior ao início do coletor (ex.: falha no editor de avatar durante o boot). */
export interface EarlyEvent {
  kind: string;
  data: Record<string, unknown>;
  at: number;
}

export interface TelemetryDeps {
  store: OfficeClientStore;
  socket: OfficeSocket;
  world: WorldApi;
  media: MediaHandle | null;
  early?: EarlyEvent[];
}

export interface TelemetryHandle {
  sessionId: string;
  /** Registra um evento avulso. */
  track(kind: string, data?: Record<string, unknown>): void;
  /** Envia agora (depuração). */
  flush(): Promise<void>;
  stop(): void;
}

interface SelfLike {
  x: number;
  y: number;
  tx: number;
  ty: number;
  moving: boolean;
  seated?: boolean;
}

const NOOP: TelemetryHandle = { sessionId: '', track: () => undefined, flush: async () => undefined, stop: () => undefined };

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Nome do bundle principal (/bundle/main-<hash>.js) como "versão" do build. */
function buildId(): string | null {
  try {
    const s = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/bundle/"]');
    return s ? (s.src.split('/').pop() ?? null) : 'dev';
  } catch {
    return null;
  }
}

const post: PostFn = async (body, { beacon }) => {
  if (beacon) {
    try {
      // keepalive aceita Content-Type JSON (exigido pela API contra CSRF)
      void fetch('/api/telemetry', { method: 'POST', body, keepalive: true, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }).catch(() => undefined);
      return 204;
    } catch {
      const ok = typeof navigator.sendBeacon === 'function' && navigator.sendBeacon('/api/telemetry', new Blob([body], { type: 'application/json' }));
      return ok ? 204 : 0;
    }
  }
  try {
    const res = await fetch('/api/telemetry', { method: 'POST', body, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } });
    return res.status;
  } catch {
    return 0;
  }
};

function countSubscribed(media: MediaHandle | null): number | null {
  const room = media?.manager.room as unknown as { remoteParticipants?: Map<string, { trackPublications?: Map<string, { isSubscribed?: boolean }> }> } | null | undefined;
  if (!room?.remoteParticipants) return null;
  let n = 0;
  for (const p of room.remoteParticipants.values()) for (const pub of p.trackPublications?.values() ?? []) if (pub.isSubscribed) n++;
  return n;
}

export function startTelemetry(deps: TelemetryDeps): TelemetryHandle {
  try {
    if (typeof window === 'undefined' || telemetryDisabled(safeStorage())) return NOOP;
    return start(deps);
  } catch (err) {
    console.warn('[telemetria] não iniciou', err);
    return NOOP;
  }
}

function start({ store, socket, world, media, early }: TelemetryDeps): TelemetryHandle {
  const sessionId = newSessionId();
  const queue = new TelemetryQueue();
  const flusher = createFlusher({ queue, sessionId, post, online: () => navigator.onLine !== false });
  const frames = new FrameStats();
  const jumps = new JumpDetector();
  const offs: (() => void)[] = [];
  let stopped = false;

  const track = (kind: string, data: Record<string, unknown> = {}): void => {
    if (stopped) return;
    try {
      queue.push(kind, data, Date.now());
      if (queue.due) void flusher.flush();
    } catch {
      // nunca lança
    }
  };

  const replica = world.__replica as { self?: SelfLike | null } | null;
  const self = (): SelfLike | null => replica?.self ?? null;
  const selfPos = (): Record<string, number> | null => {
    const s = self();
    return s ? { x: Math.round(s.x * 10) / 10, y: Math.round(s.y * 10) / 10, tx: s.tx, ty: s.ty } : null;
  };
  const avState = (): Record<string, unknown> | null => {
    const st = media?.manager.state;
    return st ? { status: st.status, mic: st.mic, cam: st.cam, screen: st.screen, micBlocked: st.micBlocked, camBlocked: st.camBlocked, audioLocked: st.audioLocked } : null;
  };

  // ------------------------------------------------------------ início da sessão
  const nav = navigator as Navigator & { connection?: { effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean }; deviceMemory?: number };
  track('session_start', {
    ua: navigator.userAgent,
    lang: navigator.language,
    screen: { w: screen.width, h: screen.height },
    viewport: { w: window.innerWidth, h: window.innerHeight },
    dpr: window.devicePixelRatio || 1,
    cores: navigator.hardwareConcurrency ?? null,
    deviceMemory: nav.deviceMemory ?? null,
    connection: nav.connection ? { type: nav.connection.effectiveType ?? null, downlink: nav.connection.downlink ?? null, rtt: nav.connection.rtt ?? null, saveData: !!nav.connection.saveData } : null,
    build: buildId(),
    path: location.pathname,
  });
  for (const e of early ?? []) {
    try {
      queue.push(e.kind, e.data, e.at);
    } catch {
      // ignora
    }
  }

  // ------------------------------------------------------------ socket e mundo
  let retries = 0;
  offs.push(
    socket.on('state', (s) => {
      if (s === 'open') {
        track('socket', { state: 'open', afterRetries: retries });
        retries = 0;
        jumps.reset();
      } else if (s !== 'reconnecting') track('socket', { state: s });
    }),
    socket.on('retry', (ms) => {
      retries++;
      track('socket', { state: 'retry', attempt: retries, inMs: ms, online: navigator.onLine });
    }),
    socket.on('kick', (reason) => track('kick', { reason })),
    store.on('reject', (m) => {
      // servidor manda em tiles; aqui vai em px de mundo (como `client`) + o tile
      const r1 = (n: number) => Math.round(n * 10) / 10;
      track('moved_reject', { reason: m.reason, seq: m.seq ?? null, server: { x: r1(m.x * TILE), y: r1(m.y * TILE), tx: Math.floor(m.x), ty: Math.floor(m.y) }, client: selfPos() });
    }),
    store.on('reset', () => jumps.reset()),
    store.on('map', () => jumps.reset()),
  );
  // Teletransporte do próprio avatar anunciado pelo servidor: o próximo salto tem causa conhecida.
  let lastTpAt = 0;
  let lastRejectAt = 0;
  offs.push(
    store.on('entity', (e) => {
      if (e.tp && e.id === store.selfId) lastTpAt = performance.now();
    }),
    store.on('reject', () => {
      lastRejectAt = performance.now();
    }),
  );

  // ------------------------------------------------------------ A/V
  if (media) {
    let lastStatus = media.manager.state.status;
    track('av_status', { ...avState(), initial: true });
    offs.push(
      media.manager.on('change', (st) => {
        if (st.status === lastStatus) return;
        lastStatus = st.status;
        track('av_status', avState() ?? { status: st.status });
      }),
      media.manager.on('error', (e) => track('av_error', { ...e, status: media.manager.state.status })),
    );
  }

  // ------------------------------------------------------------ erros e visibilidade
  let lastFrame = 0;
  const onError = (ev: ErrorEvent): void => {
    track('js_error', errorData(ev.error ?? ev.message, { source: ev.filename ? `${ev.filename.split('/').pop()}:${ev.lineno}:${ev.colno}` : null, type: 'error' }));
  };
  const onRejection = (ev: PromiseRejectionEvent): void => {
    track('js_error', errorData(ev.reason, { type: 'unhandledrejection' }));
  };
  const onVisibility = (): void => {
    track('visibility', { hidden: document.hidden });
    jumps.reset();
    lastFrame = 0;
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  document.addEventListener('visibilitychange', onVisibility);

  // ------------------------------------------------------------ quadros (rAF próprio)
  let raf = 0;
  const loop = (ts: number): void => {
    raf = requestAnimationFrame(loop);
    try {
      const dt = lastFrame ? ts - lastFrame : 0;
      lastFrame = ts;
      if (dt) frames.add(dt);
      const s = self();
      const j = jumps.feed(s);
      if (j && dt <= 1000) {
        const now = performance.now();
        const cause = now - lastRejectAt < 1000 ? 'reject' : now - lastTpAt < 1000 ? 'tp' : 'unknown';
        track('pos_jump', { ...j, dtMs: Math.round(dt), moving: s?.moving ?? null, seated: s?.seated ?? null, cause });
      }
    } catch {
      // nunca lança
    }
  };
  raf = requestAnimationFrame(loop);

  // ------------------------------------------------------------ amostra + envio a cada 10 s
  const sample = (): void => {
    const f = frames.take();
    const s = self();
    const perf = performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } };
    const data: Record<string, unknown> = {
      socket: socket.state,
      offset: Math.round(socket.offset),
      fpsFrames: f.frames,
      hidden: document.hidden,
      online: store.users.size,
      pos: selfPos(),
      moving: s?.moving ?? null,
      av: avState(),
      subscribed: countSubscribed(media),
      queued: queue.size,
    };
    // rtt/fps só quando medidos (o resumo ignora ausentes)
    if (socket.rtt > 0 && socket.state === 'open') data.rtt = Math.round(socket.rtt);
    if (f.fps !== null) data.fps = f.fps;
    if (f.worstMs !== null) data.worstFrameMs = f.worstMs;
    if (perf.memory) data.memory = { usedMB: Math.round(perf.memory.usedJSHeapSize / 1048576), limitMB: Math.round(perf.memory.jsHeapSizeLimit / 1048576) };
    if (queue.dropped) {
      data.dropped = queue.dropped;
      queue.dropped = 0;
    }
    track('sample', data);
  };
  const timer = window.setInterval(() => {
    try {
      sample();
    } catch {
      // nunca lança
    }
    void flusher.flush();
  }, FLUSH_EVERY_MS);

  const onPageHide = (): void => {
    try {
      track('visibility', { hidden: true, pagehide: true });
      void flusher.flush({ beacon: true });
    } catch {
      // nunca lança
    }
  };
  window.addEventListener('pagehide', onPageHide);

  return {
    sessionId,
    track,
    flush: () => flusher.flush(),
    stop() {
      stopped = true;
      window.clearInterval(timer);
      cancelAnimationFrame(raf);
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
      for (const off of offs) off();
    },
  };
}
