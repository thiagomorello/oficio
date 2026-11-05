// Regras puras do painel de telemetria (cores, rótulos, resumo do `data`, série da sparkline).
import type { TelemetryEventView } from '../../../shared/telemetry';
import { t, type MessageKey } from '../i18n';

export type Level = 'ok' | 'warn' | 'bad' | 'none';

/** RTT: < 80 verde, < 200 amarelo, senão vermelho. */
export function rttLevel(ms: number | null): Level {
  if (ms === null || !Number.isFinite(ms)) return 'none';
  return ms < 80 ? 'ok' : ms < 200 ? 'warn' : 'bad';
}

/** FPS: >= 50 bom, >= 30 atenção, senão ruim. */
export function fpsLevel(fps: number | null): Level {
  if (fps === null || !Number.isFinite(fps)) return 'none';
  return fps >= 50 ? 'ok' : fps >= 30 ? 'warn' : 'bad';
}

/** Contagens: 0 neutro, até `warnMax` atenção, acima ruim. */
export function countLevel(n: number, warnMax = 5): Level {
  return n <= 0 ? 'none' : n <= warnMax ? 'warn' : 'bad';
}

/** Tipos de evento conhecidos (ordem do filtro) e a chave de mensagem de cada um. */
export const EVENT_KINDS = [
  'session_start',
  'sample',
  'socket',
  'kick',
  'moved_reject',
  'pos_jump',
  'av_status',
  'av_error',
  'js_error',
  'visibility',
  'map_fallback',
  'avatar_editor_error',
  'ws_connect',
  'ws_disconnect',
  'ws_drop',
] as const;
const KIND_KEYS: Readonly<Record<string, MessageKey>> = Object.fromEntries(EVENT_KINDS.map((k) => [k, `telemetry.kind.${k}` as MessageKey]));

const AV_STATES = ['idle', 'connecting', 'connected', 'reconnecting', 'left', 'unavailable'] as const;
const AV_KEYS: Readonly<Record<string, MessageKey>> = Object.fromEntries(AV_STATES.map((k) => [k, `telemetry.av.${k}` as MessageKey]));

/** Rótulo do tipo de evento no idioma atual (tipos desconhecidos ficam como vieram). */
export const kindLabel = (k: string): string => {
  const key = KIND_KEYS[k];
  return key ? t(key) : k;
};

/** Rótulo do estado de áudio/vídeo no idioma atual (estados desconhecidos ficam como vieram). */
export const avLabel = (status: string): string => {
  const key = AV_KEYS[status];
  return key ? t(key) : status;
};

const fmt = (v: unknown): string => {
  if (v === null || v === undefined) return '–';
  if (typeof v === 'number') return String(Math.round(v * 10) / 10);
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? t('telemetry.data.yes') : t('telemetry.data.no');
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
};
const pos = (p: unknown): string => {
  const o = p as { x?: unknown; y?: unknown } | null;
  return o && typeof o === 'object' ? `(${fmt(o.x)}, ${fmt(o.y)})` : '–';
};

/** Resumo de uma linha do `data` por tipo de evento. */
export function shortData(kind: string, data: Record<string, unknown> | null, max = 160): string {
  const d = data ?? {};
  let s: string;
  switch (kind) {
    case 'sample': {
      const av = d.av as { status?: unknown; mic?: unknown; cam?: unknown } | null;
      s = t('telemetry.data.sample', { rtt: fmt(d.rtt), fps: fmt(d.fps), worst: fmt(d.worstFrameMs), online: fmt(d.online), av: av ? fmt(av.status) : '–' }) + (d.hidden ? t('telemetry.data.hiddenTab') : '');
      break;
    }
    case 'moved_reject':
      s = t('telemetry.data.movedReject', { reason: fmt(d.reason), server: pos(d.server), client: pos(d.client) }) + (d.dist !== undefined ? ` · ${fmt(d.dist)} px` : '');
      break;
    case 'pos_jump':
      s = t('telemetry.data.posJump', { dist: fmt(d.dist), from: pos(d.from), to: pos(d.to), dt: fmt(d.dtMs), cause: fmt(d.cause) });
      break;
    case 'socket':
      s =
        fmt(d.state) +
        (d.attempt !== undefined ? t('telemetry.data.socket.attempt', { n: fmt(d.attempt) }) : '') +
        (d.inMs !== undefined ? t('telemetry.data.socket.inMs', { ms: fmt(d.inMs) }) : '') +
        (d.afterRetries ? t('telemetry.data.socket.afterRetries', { n: fmt(d.afterRetries) }) : '');
      break;
    case 'ws_connect':
    case 'ws_disconnect':
    case 'ws_drop':
      s =
        t('telemetry.data.ws.code', { code: fmt(d.code) }) +
        (typeof d.durationMs === 'number' ? t('telemetry.data.ws.connectedFor', { s: Math.round(d.durationMs / 1000) }) : '') +
        (d.resumed ? t('telemetry.data.ws.resumed') : '');
      break;
    case 'av_status':
      s = t('telemetry.data.avStatus', { status: AV_KEYS[String(d.status)] ? avLabel(String(d.status)) : fmt(d.status), mic: fmt(d.mic), cam: fmt(d.cam), screen: fmt(d.screen) });
      break;
    case 'av_error':
      s = `${fmt(d.where)}: ${fmt(d.name ? `${String(d.name)} ` : '')}${fmt(d.message)}`;
      break;
    case 'js_error':
      s = `${fmt(d.message)}${d.source ? ` @ ${fmt(d.source)}` : ''}`;
      break;
    case 'session_start': {
      const c = d.connection as { type?: unknown } | null;
      const sc = d.screen as { w?: unknown; h?: unknown } | null;
      s = t('telemetry.data.sessionStart', { ua: fmt(d.ua), screen: sc ? `${fmt(sc.w)}×${fmt(sc.h)}` : '–', dpr: fmt(d.dpr), network: c ? fmt(c.type) : '–', build: fmt(d.build) });
      break;
    }
    case 'kick':
      s = t('telemetry.data.kick', { reason: fmt(d.reason) });
      break;
    case 'visibility':
      s = d.pagehide ? t('telemetry.data.visibility.pagehide') : d.hidden ? t('telemetry.data.visibility.hidden') : t('telemetry.data.visibility.visible');
      break;
    default:
      s = fmt(d);
  }
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export interface SparkPoint {
  t: number;
  rtt: number | null;
  fps: number | null;
}

/** Série ordenada no tempo a partir dos eventos `sample` (a API devolve do mais novo ao mais velho). */
export function sparkSeries(events: readonly TelemetryEventView[]): SparkPoint[] {
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return events
    .filter((e) => e.kind === 'sample')
    .map((e) => ({ t: Date.parse(e.at), rtt: num(e.data?.rtt), fps: num(e.data?.fps) }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
}

/** Escala [min, max] com folga e mínimo de faixa (evita linha "pulando" com variação pequena). */
export function niceRange(values: readonly number[], minSpan = 10): [number, number] {
  if (!values.length) return [0, minSpan];
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi - lo < minSpan) {
    const mid = (hi + lo) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  return [Math.max(0, Math.floor(lo)), Math.ceil(hi)];
}
