// Estado do escritório no cliente, alimentado pelas mensagens do servidor (`ServerMsg`).
// Guarda usuários, entidades (com um buffer de amostras por entidade para a interpolação),
// zonas, mesas, chat (anel de 300), o próprio usuário, a conexão, o conjunto de A/V e o mapa.
// Sem DOM: testável no node.
import { entityFromDelta, unpackEntity, type ServerMsg } from '../../../shared/protocol';
import {
  FLAG_MOVING, FLAG_RUN, FLAG_SEATED, FLAG_TP,
  type ChatMessage, type DeskState, type Dir, type EntityState, type Pose, type UserPublic, type UserPublicSelf, type UserStatus, type ZoneState,
} from '../../../shared/model';
import { BROADCAST_EVERY, TICK_MS, TILE } from '../../../shared/map/tile';
import type { ConnectionState } from './socket';

/** Amostra de posição recebida do servidor (px de mundo, pés; `ts` no relógio do servidor). */
export interface Sample {
  ts: number;
  x: number;
  y: number;
  dir: Dir;
  pose: Pose;
  flags: number;
}

export const CHAT_RING = 300;
/** Janela do buffer de amostras (ms). */
export const SAMPLE_KEEP_MS = 1000;
/** Intervalo dos deltas (ms). */
export const BROADCAST_MS = TICK_MS * BROADCAST_EVERY;
/**
 * Sem amostra por mais que isto: a entidade estava parada (insere uma amostra de "espera"). Piso de
 * 250 ms: a 20 Hz, 2,5 intervalos (125 ms) confundiria um atraso de rede com parada e travaria o avatar.
 */
export const STALE_GAP_MS = Math.max(250, 2.5 * BROADCAST_MS);
/** Deltas considerados na medida de latência (~5 s a 20 Hz). */
export const ARRIVAL_WINDOW = 100;

export type AvSet = Extract<ServerMsg, { t: 'av_set' }>;

/** Campos tolerados que o protocolo ainda não define (ver relatório do WP5). */
interface Extras {
  ghost?: boolean | number;
  media?: { mic?: boolean; cam?: boolean; screen?: boolean; speaking?: boolean };
}

export interface MediaState {
  mic: boolean;
  cam: boolean;
  /** (WP8) Compartilhando a tela (só em sala de reunião). */
  screen?: boolean;
}

export interface StoreEvents {
  /** Carga inicial (welcome) ou snapshot completo (state). */
  reset: { reason: 'welcome' | 'state' };
  join: number;
  leave: number;
  /** Entidade mudou (delta). `tp` = teleporte. */
  entity: { id: number; tp: boolean };
  user: number;
  status: { id: number; status: UserStatus };
  appearance: number;
  chat: ChatMessage;
  zone: ZoneState;
  desk: DeskState;
  map: { id: number; version: number };
  knock: Extract<ServerMsg, { t: 'knock' }>;
  knock_result: Extract<ServerMsg, { t: 'knock_result' }>;
  av: AvSet;
  ack: Extract<ServerMsg, { t: 'ack' }>;
  reject: Extract<ServerMsg, { t: 'moved_reject' }>;
  notice: Extract<ServerMsg, { t: 'notice' }>;
  kick: Extract<ServerMsg, { t: 'kick' }>;
  error: Extract<ServerMsg, { t: 'error' }>;
  connection: ConnectionState;
  speaking: { id: number; speaking: boolean };
  media: { id: number; media: MediaState };
}

type Listener<T> = (v: T) => void;

/**
 * Acrescenta uma amostra ao buffer (ordenado por `ts`). Teleporte zera o buffer. Depois de um
 * silêncio (entidade parada), insere uma cópia da última amostra logo antes da nova, para a
 * interpolação não "arrastar" o avatar pelo intervalo inteiro. Mantém ~`keepMs` (no mínimo 2).
 */
export function pushSample(buf: Sample[], s: Sample, keepMs = SAMPLE_KEEP_MS): void {
  if (s.flags & FLAG_TP) {
    buf.length = 0;
    buf.push(s);
    return;
  }
  const last = buf[buf.length - 1];
  if (last) {
    if (s.ts < last.ts) return;
    if (s.ts === last.ts) {
      buf[buf.length - 1] = s;
      return;
    }
    if (s.ts - last.ts > STALE_GAP_MS) buf.push({ ...last, ts: s.ts - BROADCAST_MS });
  }
  buf.push(s);
  while (buf.length > 2 && buf[1].ts < s.ts - keepMs) buf.shift();
}

export function sampleOf(e: EntityState, ts: number): Sample {
  const flags = (e.moving ? FLAG_MOVING : 0) | (e.run ? FLAG_RUN : 0) | (e.seat ? FLAG_SEATED : 0) | (e.tp ? FLAG_TP : 0);
  return { ts, x: e.x * TILE, y: e.y * TILE, dir: e.dir, pose: e.pose, flags };
}

export interface OfficeClientStoreOptions {
  /** Relógio do servidor (ms epoch); normalmente `socket.serverNow`. */
  serverNow?: () => number;
}

export class OfficeClientStore {
  readonly users = new Map<number, UserPublic>();
  readonly entities = new Map<number, EntityState>();
  readonly samples = new Map<number, Sample[]>();
  readonly zones = new Map<string, ZoneState>();
  readonly desks = new Map<string, DeskState>();
  /** Usuários "fantasma" (conexão caiu, entidade ainda no mundo). */
  readonly ghosts = new Set<number>();
  /** Quem está falando (alimentado pelo A/V, WP8). */
  readonly speaking = new Set<number>();
  /** Microfone/câmera por usuário (alimentado pelo A/V, WP8, ou por um campo `media` do servidor). */
  readonly media = new Map<number, MediaState>();
  readonly chat: ChatMessage[] = [];
  self: UserPublicSelf | null = null;
  connection: ConnectionState = 'idle';
  avSet: AvSet | null = null;
  map: { id: number; version: number; etag?: string } | null = null;
  /** Último tick aplicado (guarda de ordem dos deltas). */
  lastTick = -1;
  private tickBase: { tick: number; ts: number } | null = null;
  /** Atraso de chegada dos últimos deltas (serverNow na chegada - instante do tick), ms. */
  readonly arrivalLags: number[] = [];
  private readonly listeners = new Map<keyof StoreEvents, Set<Listener<never>>>();
  serverNow: () => number;

  constructor(opts: OfficeClientStoreOptions = {}) {
    this.serverNow = opts.serverNow ?? (() => Date.now());
  }

  get selfId(): number | null {
    return this.self?.id ?? null;
  }

  on<K extends keyof StoreEvents>(ev: K, cb: Listener<StoreEvents[K]>): () => void {
    let set = this.listeners.get(ev);
    if (!set) this.listeners.set(ev, (set = new Set()));
    set.add(cb as Listener<never>);
    return () => void set!.delete(cb as Listener<never>);
  }

  private emit<K extends keyof StoreEvents>(ev: K, v: StoreEvents[K]): void {
    const set = this.listeners.get(ev);
    if (!set) return;
    for (const cb of [...set]) {
      try {
        (cb as Listener<StoreEvents[K]>)(v);
      } catch (err) {
        console.error(`[store] erro no ouvinte de ${String(ev)}`, err);
      }
    }
  }

  setConnection(s: ConnectionState): void {
    if (this.connection === s) return;
    this.connection = s;
    this.emit('connection', s);
  }

  setSpeaking(id: number, on: boolean): void {
    if (on === this.speaking.has(id)) return;
    if (on) this.speaking.add(id);
    else this.speaking.delete(id);
    this.emit('speaking', { id, speaking: on });
  }

  setMedia(id: number, media: MediaState): void {
    this.media.set(id, media);
    this.emit('media', { id, media });
  }

  /** Nome exibido de um usuário. */
  nameOf(id: number): string {
    return this.users.get(id)?.name ?? `#${id}`;
  }

  /** Instante (relógio do servidor) de um tick. Rebaseia quando a estimativa se afasta do relógio. */
  tickTime(tick: number): number {
    const now = this.serverNow();
    const b = this.tickBase;
    if (!b) {
      this.tickBase = { tick, ts: now };
      return now;
    }
    const est = b.ts + (tick - b.tick) * TICK_MS;
    if (est > now + 50 || est < now - 400) {
      this.tickBase = { tick, ts: now };
      return now;
    }
    return est;
  }

  // ------------------------------------------------------------------ aplicação das mensagens

  apply(msg: ServerMsg): void {
    switch (msg.t) {
      case 'welcome': {
        this.self = msg.you;
        this.map = { ...msg.map };
        this.users.clear();
        for (const u of msg.users) this.addUser(u);
        this.addUser(msg.you);
        this.tickBase = { tick: msg.tick, ts: msg.now };
        this.lastTick = msg.tick;
        this.resetWorld(msg.entities, msg.zones, msg.desks, msg.now);
        this.chat.length = 0;
        for (const m of msg.chat) this.pushChat(m);
        this.emit('reset', { reason: 'welcome' });
        return;
      }
      case 'state': {
        if (msg.tick < this.lastTick) return;
        this.lastTick = msg.tick;
        this.resetWorld(msg.entities, msg.zones, msg.desks, this.tickTime(msg.tick));
        this.emit('reset', { reason: 'state' });
        return;
      }
      case 'delta': {
        if (msg.tick <= this.lastTick) return;
        this.lastTick = msg.tick;
        const ts = this.tickTime(msg.tick);
        this.arrivalLags.push(Math.max(0, this.serverNow() - ts));
        if (this.arrivalLags.length > ARRIVAL_WINDOW) this.arrivalLags.shift();
        for (const d of msg.e) {
          const id = d[0];
          let e = this.entities.get(id);
          if (e) unpackEntity(d, e);
          else this.entities.set(id, (e = entityFromDelta(d)));
          const s: Sample = { ts, x: d[1] * (TILE / 16), y: d[2] * (TILE / 16), dir: e.dir, pose: e.pose, flags: d[4] };
          pushSample(this.bufferOf(id), s);
          this.emit('entity', { id, tp: (d[4] & FLAG_TP) !== 0 });
        }
        return;
      }
      case 'join': {
        this.addUser(msg.user);
        this.setEntity(msg.entity, this.serverNow());
        this.emit('join', msg.user.id);
        return;
      }
      case 'leave': {
        this.entities.delete(msg.id);
        this.samples.delete(msg.id);
        this.ghosts.delete(msg.id);
        this.speaking.delete(msg.id);
        // o usuário continua conhecido (nome no histórico do chat)
        this.emit('leave', msg.id);
        return;
      }
      case 'status': {
        const u = this.users.get(msg.id);
        if (u) u.status = msg.status;
        if (this.self && this.self.id === msg.id) this.self.status = msg.status;
        this.readGhost(msg.id, msg as Extras);
        this.emit('status', { id: msg.id, status: msg.status });
        return;
      }
      case 'appearance': {
        const u = this.users.get(msg.id);
        if (u) {
          u.appearance = msg.appearance;
          u.name = msg.displayName;
        }
        if (this.self && this.self.id === msg.id) {
          this.self.appearance = msg.appearance;
          this.self.name = msg.displayName;
        }
        this.emit('appearance', msg.id);
        this.emit('user', msg.id);
        return;
      }
      case 'chat':
        this.pushChat(msg.msg);
        this.emit('chat', msg.msg);
        return;
      case 'zone':
        this.zones.set(msg.zone.id, msg.zone);
        this.emit('zone', msg.zone);
        return;
      case 'desk': {
        const d: DeskState = { id: msg.desk, userId: msg.userId, decor: msg.decor };
        this.desks.set(d.id, d);
        this.emit('desk', d);
        return;
      }
      case 'map':
        this.map = { id: msg.id, version: msg.version };
        this.emit('map', { id: msg.id, version: msg.version });
        return;
      case 'knock':
        this.emit('knock', msg);
        return;
      case 'knock_result':
        this.emit('knock_result', msg);
        return;
      case 'media':
        this.setMedia(msg.id, { mic: msg.mic, cam: msg.cam, screen: msg.screen });
        this.setSpeaking(msg.id, msg.speaking);
        return;
      case 'av_set':
        this.avSet = msg;
        this.emit('av', msg);
        return;
      case 'ack':
        this.emit('ack', msg);
        return;
      case 'moved_reject':
        this.emit('reject', msg);
        return;
      case 'notice':
        this.emit('notice', msg);
        return;
      case 'kick':
        this.emit('kick', msg);
        return;
      case 'error':
        this.emit('error', msg);
        return;
      case 'pong':
        return;
    }
  }

  /** Mesa reivindicada por um usuário (ou null). */
  deskOf(userId: number): DeskState | null {
    for (const d of this.desks.values()) if (d.userId === userId) return d;
    return null;
  }

  private bufferOf(id: number): Sample[] {
    let b = this.samples.get(id);
    if (!b) this.samples.set(id, (b = []));
    return b;
  }

  private addUser(u: UserPublic): void {
    const prev = this.users.get(u.id);
    this.users.set(u.id, prev && this.self?.id === u.id ? Object.assign(prev, u) : { ...u });
    this.readGhost(u.id, u as Extras);
    const m = (u as Extras).media;
    if (m && typeof m === 'object') {
      this.media.set(u.id, { mic: m.mic !== false, cam: m.cam === true, screen: m.screen === true });
      if (m.speaking) this.speaking.add(u.id);
      else this.speaking.delete(u.id);
    }
    this.emit('user', u.id);
  }

  private readGhost(id: number, x: Extras): void {
    if (x.ghost === undefined) return;
    if (x.ghost) this.ghosts.add(id);
    else this.ghosts.delete(id);
  }

  private setEntity(e: EntityState, ts: number): void {
    const copy = { ...e };
    this.entities.set(e.id, copy);
    this.readGhost(e.id, e as Extras);
    const buf = this.bufferOf(e.id);
    buf.length = 0;
    buf.push(sampleOf(copy, ts));
  }

  private resetWorld(entities: EntityState[], zones: ZoneState[], desks: DeskState[], ts: number): void {
    this.entities.clear();
    this.samples.clear();
    for (const e of entities) this.setEntity(e, ts);
    this.zones.clear();
    for (const z of zones) this.zones.set(z.id, z);
    this.desks.clear();
    for (const d of desks) this.desks.set(d.id, d);
  }

  private pushChat(m: ChatMessage): void {
    this.chat.push(m);
    if (this.chat.length > CHAT_RING) this.chat.splice(0, this.chat.length - CHAT_RING);
  }
}
