// Conexão WebSocket com o servidor do escritório: reconexão com backoff, sincronização de relógio
// (ping/pong, mediana das últimas 5 medidas) e eventos tipados. O protocolo não tem "hello": o
// servidor autentica pelo cookie do upgrade e manda `welcome` sozinho.
import { decodeServer, type ClientMsg, type ServerMsg } from '../../../shared/protocol';

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface SocketEvents {
  message: ServerMsg;
  state: ConnectionState;
  /** Servidor expulsou a sessão (`kick`). Para `replaced` não há reconexão automática. */
  kick: Extract<ServerMsg, { t: 'kick' }>['reason'];
  /** Próxima tentativa agendada (ms a partir de agora). */
  retry: number;
}

type Listener<T> = (v: T) => void;

/** Mínimo necessário de um WebSocket (permite injetar um falso nos testes). */
export interface WebSocketLike {
  readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface OfficeSocketOptions {
  url?: string;
  /** Fábrica do socket (padrão: `new WebSocket(url)`). */
  create?: (url: string) => WebSocketLike;
  /** Relógio local (ms epoch). */
  now?: () => number;
  /** Redireciona para outra página (padrão: `location.assign`). */
  redirect?: (path: string) => void;
  /** Agenda (padrão: setTimeout); devolve um cancelador. */
  schedule?: (fn: () => void, ms: number) => () => void;
  /** Intervalo do ping de relógio (ms). */
  pingEveryMs?: number;
}

export const BACKOFF_MIN_MS = 2000;
export const BACKOFF_MAX_MS = 30000;
const OPEN = 1;
/** Códigos de fechamento tratados como "sessão inválida" (vai para o login). */
const AUTH_CLOSE_CODES = new Set([4001, 4401, 4403]);

/** Atraso da n-ésima tentativa (0 = primeira): 2 s, 4 s, 8 s, 16 s, 30 s, 30 s... */
export function backoffDelay(attempt: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** Math.max(0, attempt));
}

/** Mediana (para o offset do relógio: robusta a um pong atrasado). */
export function median(xs: readonly number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function defaultWsUrl(): string {
  if (typeof location === 'undefined') return 'ws://localhost/ws';
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

export class OfficeSocket {
  state: ConnectionState = 'idle';
  /** Diferença servidor - cliente (ms). */
  offset = 0;
  /** Último RTT medido (ms). */
  rtt = 0;
  private ws: WebSocketLike | null = null;
  private attempt = 0;
  private cancelRetry: (() => void) | null = null;
  private cancelPing: (() => void) | null = null;
  private offsets: number[] = [];
  private stopped = false;
  private readonly listeners = new Map<keyof SocketEvents, Set<Listener<never>>>();
  private readonly opts: Required<Omit<OfficeSocketOptions, 'url'>> & { url: string };
  private readonly onOnline = () => {
    if (this.state === 'reconnecting') this.retryNow();
  };

  constructor(opts: OfficeSocketOptions = {}) {
    this.opts = {
      url: opts.url ?? defaultWsUrl(),
      create: opts.create ?? ((url) => new WebSocket(url) as unknown as WebSocketLike),
      now: opts.now ?? (() => Date.now()),
      redirect: opts.redirect ?? ((p) => location.assign(p)),
      schedule:
        opts.schedule ??
        ((fn, ms) => {
          const h = setTimeout(fn, ms);
          return () => clearTimeout(h);
        }),
      pingEveryMs: opts.pingEveryMs ?? 10000,
    };
  }

  on<K extends keyof SocketEvents>(ev: K, cb: Listener<SocketEvents[K]>): () => void {
    let set = this.listeners.get(ev);
    if (!set) this.listeners.set(ev, (set = new Set()));
    set.add(cb as Listener<never>);
    return () => void set!.delete(cb as Listener<never>);
  }

  private emit<K extends keyof SocketEvents>(ev: K, v: SocketEvents[K]): void {
    const set = this.listeners.get(ev);
    if (!set) return;
    for (const cb of [...set]) {
      try {
        (cb as Listener<SocketEvents[K]>)(v);
      } catch (err) {
        console.error('[socket] erro num ouvinte', err);
      }
    }
  }

  private setState(s: ConnectionState): void {
    if (this.state === s) return;
    this.state = s;
    this.emit('state', s);
  }

  /** Relógio do servidor estimado (ms epoch). */
  serverNow(): number {
    return this.opts.now() + this.offset;
  }

  connect(): void {
    this.stopped = false;
    if (typeof window !== 'undefined') window.addEventListener('online', this.onOnline);
    this.open();
  }

  /** Encerra de vez (sem reconectar). */
  close(): void {
    this.stopped = true;
    this.cancelRetry?.();
    this.cancelRetry = null;
    this.stopPing();
    if (typeof window !== 'undefined') window.removeEventListener('online', this.onOnline);
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      try {
        ws.close(1000, 'bye');
      } catch {
        // já fechado
      }
    }
    this.setState('closed');
  }

  /** Envia uma intenção. Retorna false se não há conexão aberta (a intenção é descartada). */
  send(msg: ClientMsg): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== OPEN) return false;
    try {
      ws.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  /** Reconecta imediatamente (botão "tentar agora", evento `online`). */
  retryNow(): void {
    if (this.stopped || this.state === 'open' || this.state === 'connecting') return;
    this.cancelRetry?.();
    this.cancelRetry = null;
    this.open();
  }

  private open(): void {
    if (this.stopped) return;
    this.setState(this.attempt === 0 ? 'connecting' : 'reconnecting');
    let ws: WebSocketLike;
    try {
      ws = this.opts.create(this.opts.url);
    } catch (err) {
      console.warn('[socket] não foi possível abrir', err);
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.attempt = 0;
      this.setState('open');
      this.startPing();
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws || typeof ev.data !== 'string') return;
      const msg = decodeServer(ev.data);
      if (!msg) return;
      this.handle(msg);
    };
    ws.onerror = () => {
      // o navegador sempre chama onclose depois: a reconexão é tratada lá
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopPing();
      if (this.stopped) return;
      if (AUTH_CLOSE_CODES.has(ev?.code)) {
        this.stopped = true;
        this.setState('closed');
        this.opts.redirect('/login');
        return;
      }
      this.scheduleRetry();
    };
  }

  private scheduleRetry(): void {
    if (this.stopped) return;
    const ms = backoffDelay(this.attempt++);
    this.setState('reconnecting');
    this.emit('retry', ms);
    this.cancelRetry?.();
    this.cancelRetry = this.opts.schedule(() => {
      this.cancelRetry = null;
      this.open();
    }, ms);
  }

  private handle(msg: ServerMsg): void {
    if (msg.t === 'pong') {
      this.onPong(msg.ts, msg.now);
      return;
    }
    if (msg.t === 'welcome') {
      // primeira estimativa do relógio (refinada pelos pings)
      if (!this.offsets.length) this.offset = msg.now - this.opts.now();
    }
    if (msg.t === 'kick') {
      this.emit('kick', msg.reason);
      this.emit('message', msg);
      if (msg.reason === 'disabled' || msg.reason === 'session') {
        this.close();
        this.opts.redirect('/login');
      } else if (msg.reason === 'replaced') {
        // outra aba/dispositivo assumiu: não briga por ela
        this.close();
      }
      return;
    }
    this.emit('message', msg);
  }

  /** Mede o relógio: offset = agora do servidor - ponto médio da ida e volta. Mediana das últimas 5. */
  onPong(ts: number, serverNow: number): void {
    const now = this.opts.now();
    const rtt = Math.max(0, now - ts);
    this.rtt = rtt;
    this.offsets.push(serverNow - (ts + rtt / 2));
    if (this.offsets.length > 5) this.offsets.shift();
    this.offset = median(this.offsets);
  }

  ping(): void {
    this.send({ t: 'ping', ts: this.opts.now() });
  }

  private startPing(): void {
    this.stopPing();
    // rajada inicial curta para o relógio convergir, depois o ritmo normal
    let n = 0;
    const tick = () => {
      this.ping();
      n++;
      this.cancelPing = this.opts.schedule(tick, n < 5 ? 400 : this.opts.pingEveryMs);
    };
    tick();
  }

  private stopPing(): void {
    this.cancelPing?.();
    this.cancelPing = null;
  }
}
