// Mundo autoritativo do escritório: entidades, conexões, zonas (tranca/batida), assentos, mesas,
// chat com escopos, presença e o tick de 20 Hz. O cliente só manda intenções (`ClientMsg`); tudo é
// validado aqui contra a mesma grade/A* de `shared/map`.
import { PathFinder } from '../../shared/map/astar';
import { findPath, advance, placeAtTile, type PathState } from '../../shared/map/movement';
import { planRelocation, type RelocEntity } from '../../shared/map/relocate';
import { USE_SPOT_KINDS } from '../../shared/map/spots';
import { privateZoneAt } from '../../shared/map/zones';
import { BROADCAST_EVERY, CHAT_NEARBY_TILES, FOOT_DX, FOOT_DY, RUN_SPEED, TICK_MS, TILE, WALK_SPEED } from '../../shared/map/tile';
import { MAP_SCHEMA } from '../../shared/map/doc';
import { DEFAULT_LOCALE, type Locale } from '../../shared/branding';
import { tFor, type MessageKey } from '../../shared/i18n';
import type { OfficeAssembly, ZoneDef } from '../../shared/map/types';
import {
  DEFAULT_SETTINGS,
  type Appearance, type ChatMessage, type DeskState, type Dir, type Emote, type EntityState, type HeldItem, type MediaFlags, type Pose,
  type UserPublic, type UserPublicSelf, type UserSettings, type UserStatus, type ZoneState,
} from '../../shared/model';
import { PROTOCOL_VERSION, packEntity, type ClientMsg, type ErrorCode, type LiveKitInfo, type MoveRejectReason, type ServerMsg } from '../../shared/protocol';
import type { DeskDecor } from '../../shared/desk-decor';
import type { Repos } from '../db/repos/index';
import type { ChatRow } from '../db/types';
import type { SessionLike, SessionUser } from '../auth/session-types';
import type { ScreenControl } from '../livekit/control';
import { errMsg, log } from '../log';
import type { TelemetrySink } from '../telemetry/index';
import { broadcast as broadcastTo, send as sendTo, type Conn } from '../ws/outbox';
import { AvManager, type AvPerson } from './av';

// ------------------------------------------------------------------ regras (WP4)

export const MAX_MOVE_TILES = 60;
export const DEST_SNAP_RADIUS = 2;
export const EMOTE_COOLDOWN_MS = 1_500;
export const EMOTE_MS = 2_500;
export const RAISE_HAND_MS = 10_000;
export const CHAT_WINDOW_MS = 5_000;
export const CHAT_MAX_IN_WINDOW = 5;
export const AUTO_AWAY_MS = 5 * 60_000;
export const GHOST_MS = 30_000;
export const LAST_SEEN_EVERY_MS = 60_000;
export const REVALIDATE_EVERY_MS = 5 * 60_000;
export const KNOCK_COOLDOWN_MS = 5_000;
export const CHAT_HISTORY = 50;
/** (WP8) Intervalo mínimo entre difusões de `media` que só mudam a fala. */
export const MEDIA_SPEAKING_MS = 300;
/** Clamp do dt medido (pausas do event loop não viram teleporte). */
export const MAX_DT_S = 0.1;

/** Códigos de fechamento do WebSocket usados pelo mundo. */
export const CLOSE_REPLACED = 4000;
export const CLOSE_SESSION = 4001;

/** Duração do uso por tipo (ms); os ausentes duram até USE_MAX_MS ou até o usuário se mexer/apertar de novo. */
export const USE_MS: Record<string, number> = { coffee: 6000, water: 6000, snack: 3000, fridge: 3000, sink: 3000, stall: 8000 };
export const USE_MAX_MS = 120_000;
/** Café/água: tempo de "operar" a máquina antes de beber. */
export const USE_PREP_MS = 2500;
const DIR_STEP: Record<Dir, [number, number]> = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] };

// ------------------------------------------------------------------ tipos internos

interface UserInfo {
  id: number;
  name: string;
  email: string;
  role: string | null;
  appearance: Appearance | null;
  isAdmin: boolean;
  mustChangePassword: boolean;
  settings: UserSettings;
}

interface Ent {
  id: number;
  user: UserInfo;
  status: UserStatus;
  /** O `away` atual foi automático (volta a `available` no próximo input). */
  autoAway: boolean;
  // Mover (pés em px de mundo + tile lógico)
  x: number;
  y: number;
  tx: number;
  ty: number;
  dir: Dir;
  pose: Pose;
  held: HeldItem;
  run: boolean;
  path: PathState | null;
  /** Spot onde está sentado. */
  seat: string | null;
  /** Spot reservado, a caminho do encaixe. */
  seatTarget: string | null;
  /** Spot de uso (café, pia, arcade...) em que está. */
  using: string | null;
  /** Spot de uso reservado, a caminho do encaixe. */
  useTarget: string | null;
  useStart: number;
  useUntil: number;
  moveDir: Dir | null;
  moveRun: boolean;
  /** Movimento ditado pelo cliente (`pos`): andando agora? e quando chegou a última posição aceita. */
  clientMoving: boolean;
  lastPosAt: number;
  lastRejectAt: number;
  /** Último tile recusado no `move_dir` (não repete o aviso a cada tick). */
  dirBlocked: string | null;
  emote: Emote | null;
  emoteUntil: number;
  emoteCooldownUntil: number;
  /** Índice da zona (assembly.zones) ou -1. */
  zone: number;
  tp: boolean;
  dirty: boolean;
  lastInput: number;
  chatTimes: number[];
  knockAt: Map<string, number>;
  conn: Conn | null;
  /** Idioma das mensagens do servidor para esta pessoa (resolvido no upgrade do WebSocket). */
  locale: Locale;
  /** > 0: desconectado, some do mundo neste instante (epoch ms). */
  ghostUntil: number;
  sessionLogId: Promise<number | null> | null;
  /** (WP8) Estado de A/V atual (null = não entrou no A/V nesta conexão). */
  media: MediaFlags | null;
  /** Último `media` difundido e quando (a fala é limitada a 1 a cada MEDIA_SPEAKING_MS). */
  mediaSent: MediaFlags | null;
  mediaSentAt: number;
  mediaPending: boolean;
}

export interface ZoneRuntime {
  def: ZoneDef;
  locked: boolean;
  lockedBy: number | null;
  members: Set<number>;
  /** Liberados por um membro depois de bater (vale até entrar ou destrancar). */
  admitted: Set<number>;
  /** Bateram e aguardam resposta. */
  knocks: Set<number>;
}

export interface SwapResult {
  moved: number;
  releasedSeats: number;
  releasedDesks: number;
}

export interface OfficeOptions {
  repos: Repos;
  assembly: OfficeAssembly;
  /** `office_maps.id` do mapa em uso (0 = mapa embutido/injetado). */
  mapId?: number;
  session?: SessionLike | null;
  /** Gera o bloco `welcome.livekit` (null = LiveKit desligado). */
  mintLiveKit?: ((user: { id: number; displayName: string }) => Promise<LiveKitInfo | null>) | null;
  screen?: ScreenControl | null;
  /** Eventos de telemetria do servidor (moved_reject, kick, ws_*). Opcional. */
  telemetry?: TelemetrySink | null;
  /** Relógio injetável (testes). */
  now?: () => number;
  /** Idioma de quem entra sem informar o seu (OFFICE_DEFAULT_LOCALE). */
  defaultLocale?: Locale;
}

function settingsOf(s: Partial<UserSettings> | null | undefined): UserSettings {
  return { ...DEFAULT_SETTINGS, ...(s ?? {}) };
}

export function userInfoOf(u: SessionUser): UserInfo {
  return {
    id: u.id,
    name: u.displayName?.trim() || u.name,
    email: u.email,
    role: u.roleName,
    appearance: u.appearance,
    isAdmin: u.isAdmin,
    mustChangePassword: u.needsPasswordChange,
    settings: settingsOf(u.settings),
  };
}

export function chatFromRow(r: ChatRow): ChatMessage {
  return { id: r.id, scope: r.scope, zone: r.zone_id, from: r.user_id, name: r.name, text: r.text, ts: r.created_at.getTime() };
}

function cheb(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

/** Coordenada em px -> tiles em múltiplos de 1/16 (o que vai na rede). */
function netCoord(px: number): number {
  return Math.round((px / TILE) * 16) / 16;
}

// ------------------------------------------------------------------ Office

export class Office {
  readonly entities = new Map<number, Ent>();
  readonly conns = new Map<number, Conn>();
  readonly zones = new Map<string, ZoneRuntime>();
  /** Espelho de `repos.desks.all()` (só mesas com dono). */
  readonly desks = new Map<string, DeskState>();
  /** spotId -> userId (sentado ou a caminho do encaixe). */
  readonly seatOwners = new Map<string, number>();
  /** Spots de uso ocupados (ou reservados): spot -> usuário. */
  readonly useOwners = new Map<string, number>();
  /** Contadores de /metrics: chat = mensagens de chat aceitas; logins = logins locais bem-sucedidos (ver app-factory). */
  readonly counters = { chat: 0, logins: 0 };
  /** Duração do último tick e do maior tick desde o boot, em ms (/metrics). */
  lastTickMs = 0;
  maxTickMs = 0;

  private assemblyRef: OfficeAssembly;
  private finder: PathFinder;
  private zoneByIndex: ZoneRuntime[] = [];
  private mapIdRef: number;
  private layoutVersionRef: number;
  private tickCount = 0;
  private stateDirty = false;
  private urgent = false;
  private avChanged = false;
  private zoneChanged = new Set<string>();
  private nearSeq = 0;
  private timer: NodeJS.Timeout | null = null;
  private lastTickAt = 0;
  private lastHouse = 0;
  private lastSeenAt = 0;
  private lastRevalidate = 0;
  private readonly now: () => number;
  private readonly repos: Repos;
  private readonly av: AvManager;
  private readonly tmpPath: number[] = [];
  /** Quando cada conexão entrou (duração no `ws_disconnect`). */
  private readonly connStart = new WeakMap<Conn, number>();

  /** Grava um evento de telemetria do servidor (nunca lança). */
  private tel(userId: number, kind: string, data: Record<string, unknown>): void {
    const sink = this.opts.telemetry;
    if (!sink) return;
    try {
      sink.server(userId, kind, data);
    } catch {
      // telemetria nunca derruba o mundo
    }
  }

  constructor(private readonly opts: OfficeOptions) {
    this.repos = opts.repos;
    this.now = opts.now ?? Date.now;
    this.assemblyRef = opts.assembly;
    this.finder = new PathFinder(opts.assembly.grid);
    this.mapIdRef = opts.mapId ?? 0;
    this.layoutVersionRef = Math.max(1, opts.assembly.version);
    this.rebuildZones(new Map());
    this.av = new AvManager({ send: (id, msg) => this.sendTo(id, msg), now: this.now, screen: opts.screen ?? null });
    const t = this.now();
    this.lastHouse = t;
    this.lastSeenAt = t;
    this.lastRevalidate = t;
  }

  get assembly(): OfficeAssembly {
    return this.assemblyRef;
  }
  get layoutVersion(): number {
    return this.layoutVersionRef;
  }
  get mapId(): number {
    return this.mapIdRef;
  }
  get online(): number {
    return this.conns.size;
  }
  get tick(): number {
    return this.tickCount;
  }
  /** ETag do documento em uso (`GET /api/map` e `welcome.map.etag`). */
  get etag(): string {
    return `"m${this.mapIdRef}-${this.layoutVersionRef}-${MAP_SCHEMA}"`;
  }

  // ---------------------------------------------------------------- ciclo de vida

  /** Carrega o espelho das mesas do banco. */
  async load(): Promise<void> {
    const rows = await this.repos.desks.all();
    this.desks.clear();
    for (const r of rows) this.desks.set(r.desk_id, { id: r.desk_id, userId: r.user_id, decor: r.decor });
  }

  start(): void {
    if (this.timer) return;
    this.lastTickAt = this.now();
    this.timer = setInterval(() => {
      const t = this.now();
      const dt = Math.min(MAX_DT_S, Math.max(0, (t - this.lastTickAt) / 1000));
      this.lastTickAt = t;
      try {
        this.step(dt);
      } catch (err) {
        log.error(`World tick error: ${errMsg(err)}`);
      }
    }, TICK_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.opts.screen?.close();
    for (const e of this.entities.values()) this.closeSessionLog(e);
  }

  // ---------------------------------------------------------------- conexões

  /** Conexão atual do usuário é `conn`? (mensagens de sockets substituídos são ignoradas). */
  isCurrent(userId: number, conn: Conn): boolean {
    return this.conns.get(userId) === conn;
  }

  /** `locale`: idioma da conexão (hub resolve no upgrade); sem ele, o padrão da instância. */
  async join(user: SessionUser, conn: Conn, locale?: Locale): Promise<void> {
    const info = userInfoOf(user);
    const [chat, livekit] = await Promise.all([
      this.repos.chat.list('global', null, null, CHAT_HISTORY).then((rows) => rows.map(chatFromRow)).catch((err: unknown) => {
        log.warn(`Failed to read chat history: ${errMsg(err)}`);
        return [] as ChatMessage[];
      }),
      this.opts.mintLiveKit
        ? this.opts.mintLiveKit({ id: info.id, displayName: info.name }).catch((err: unknown) => {
            log.warn(`Failed to mint LiveKit token: ${errMsg(err)}`);
            return null;
          })
        : Promise.resolve(null),
    ]);
    if (!conn.isOpen()) return;
    const now = this.now();

    const old = this.conns.get(info.id);
    if (old && old !== conn) {
      sendTo(old, { t: 'kick', reason: 'replaced' });
      old.close(CLOSE_REPLACED, 'replaced');
      const at = this.connStart.get(old);
      this.tel(info.id, 'kick', { reason: 'replaced', durationMs: at === undefined ? null : now - at });
    }

    let e = this.entities.get(info.id);
    this.connStart.set(conn, now);
    this.tel(info.id, 'ws_connect', { resumed: !!e, replaced: !!(old && old !== conn), ip: conn.ip ?? null, online: this.conns.size + (old ? 0 : 1) });
    if (e) {
      // Reconexão dentro da carência (ou substituição): mantém posição/assento.
      this.closeSessionLog(e);
      // Substituição: a aba antiga sai do LiveKit; a nova manda seu `media` ao conectar.
      this.resetMedia(e);
      const changed = e.user.name !== info.name || JSON.stringify(e.user.appearance) !== JSON.stringify(info.appearance);
      e.user = info;
      e.locale = locale ?? e.locale;
      e.ghostUntil = 0;
      e.lastInput = now;
      if (changed && info.appearance) this.broadcast({ t: 'appearance', id: e.id, appearance: info.appearance, displayName: info.name });
    } else {
      e = this.spawnEntity(info, now, locale ?? this.opts.defaultLocale ?? DEFAULT_LOCALE);
      this.entities.set(e.id, e);
      this.updateZone(e);
      this.broadcast({ t: 'join', user: this.userPublic(e), entity: this.entityState(e) }, info.id);
    }
    e.conn = conn;
    this.conns.set(info.id, conn);
    e.sessionLogId = this.repos.sessions.open(info.id, conn.ip ?? null).catch((err: unknown) => {
      log.warn(`sessions_log: ${errMsg(err)}`);
      return null;
    });
    void this.repos.users.touchLastSeen(info.id).catch(() => undefined);
    this.av.remove(info.id);
    this.avChanged = true;

    const you: UserPublicSelf = {
      ...this.userPublic(e),
      email: info.email,
      isAdmin: info.isAdmin,
      mustChangePassword: info.mustChangePassword,
      settings: info.settings,
    };
    sendTo(conn, {
      t: 'welcome',
      v: PROTOCOL_VERSION,
      you,
      tick: this.tickCount,
      now,
      map: { id: this.mapIdRef, version: this.layoutVersionRef, etag: this.etag },
      entities: [...this.entities.values()].map((x) => this.entityState(x)),
      users: [...this.entities.values()].map((x) => this.userPublic(x)),
      zones: this.zoneStates(),
      desks: this.deskStates(),
      chat,
      livekit,
    });
  }

  /**
   * Socket fechou. A entidade fica 30 s como "fantasma" (reconexão recupera a posição).
   * `code` (close do WebSocket) separa saída normal (`ws_disconnect`) de queda (`ws_drop`) na telemetria.
   */
  leave(userId: number, conn: Conn, code?: number): void {
    if (this.conns.get(userId) !== conn) return;
    this.conns.delete(userId);
    const at = this.connStart.get(conn);
    const normal = code === 1000 || code === 1001 || code === CLOSE_REPLACED || code === CLOSE_SESSION;
    this.tel(userId, normal ? 'ws_disconnect' : 'ws_drop', { code: code ?? null, durationMs: at === undefined ? null : this.now() - at });
    const e = this.entities.get(userId);
    if (!e) return;
    e.conn = null;
    e.ghostUntil = this.now() + GHOST_MS;
    e.moveDir = null;
    this.closeSessionLog(e);
    this.resetMedia(e);
    this.av.remove(userId);
    this.avChanged = true;
  }

  /** Derruba o usuário (conta desativada, sessão inválida). Some do mundo na hora. */
  kickUser(userId: number, reason: 'disabled' | 'session' | 'server'): void {
    const conn = this.conns.get(userId);
    if (conn) {
      sendTo(conn, { t: 'kick', reason });
      this.conns.delete(userId);
      const at = this.connStart.get(conn);
      this.tel(userId, 'kick', { reason, durationMs: at === undefined ? null : this.now() - at });
      conn.close(CLOSE_SESSION, reason);
    }
    const e = this.entities.get(userId);
    if (e) this.removeEntity(e);
  }

  /** Avatar ou nome mudou (rota HTTP de perfil). */
  appearanceChanged(userId: number, appearance: Appearance, displayName: string): void {
    const e = this.entities.get(userId);
    if (!e) return;
    e.user.appearance = appearance;
    e.user.name = displayName;
    this.broadcast({ t: 'appearance', id: userId, appearance, displayName });
  }

  /** Atualiza o espelho de uma mesa (decoração, reatribuição pelo admin) e avisa todo mundo. */
  applyDesk(deskId: string, userId: number | null, decor: DeskDecor | null): void {
    if (userId === null) this.desks.delete(deskId);
    else {
      for (const [id, d] of this.desks) if (d.userId === userId && id !== deskId) {
        this.desks.delete(id);
        this.broadcast({ t: 'desk', desk: id, userId: null, decor: null });
      }
      this.desks.set(deskId, { id: deskId, userId, decor });
    }
    this.broadcast({ t: 'desk', desk: deskId, userId, decor: userId === null ? null : decor });
  }

  // ---------------------------------------------------------------- mensagens

  async handle(userId: number, msg: ClientMsg): Promise<void> {
    const e = this.entities.get(userId);
    if (!e || !e.conn) return;
    if (msg.t === 'ping') {
      this.sendTo(userId, { t: 'pong', ts: msg.ts, now: this.now() });
      return;
    }
    // A/V muda sozinho (entrar na sala do LiveKit, indicador de fala): não conta como input.
    if (msg.t === 'media') return this.setMedia(e, msg);
    this.touch(e);
    switch (msg.t) {
      case 'activity':
        return;
      case 'move_to':
        return this.moveTo(e, msg.x, msg.y, !!msg.run, msg.seq);
      case 'move_dir':
        return this.moveDir(e, msg.dir, !!msg.run, msg.seq);
      case 'pos':
        return this.clientPos(e, msg.x, msg.y, msg.dir, msg.moving, !!msg.run);
      case 'sit':
        return this.sit(e, msg.spot);
      case 'use':
        return this.use(e, msg.spot);
      case 'stand':
        return this.stand(e);
      case 'emote':
        return this.emote(e, msg.emote);
      case 'chat':
        return this.chat(e, msg.scope, msg.text);
      case 'status':
        e.autoAway = false;
        return this.setStatus(e, msg.status);
      case 'lock':
        return this.lock(e, msg.zone, msg.locked);
      case 'knock':
        return this.knock(e, msg.zone);
      case 'admit':
        return this.admit(e, msg.zone, msg.user, msg.allow);
      case 'desk_claim':
        return this.deskClaim(e, msg.desk);
      case 'desk_release':
        return this.deskRelease(e);
    }
  }

  private touch(e: Ent): void {
    e.lastInput = this.now();
    if (e.autoAway) {
      e.autoAway = false;
      if (e.status === 'away') this.setStatus(e, 'available');
    }
  }

  // ---------------------------------------------------------------- A/V (WP8)

  private inMeeting(e: Ent): boolean {
    return e.zone >= 0 && this.zoneByIndex[e.zone]?.def.kind === 'meeting';
  }

  /**
   * Guarda o estado de A/V e difunde quando muda. Tela só vale dentro de sala de reunião (o SFU já
   * barra a publicação; aqui só evita mostrar um ícone falso) e fala só com o microfone ligado.
   * Mudanças de mic/câmera/tela saem na hora; mudanças só de fala, no máximo 1 a cada 300 ms.
   */
  private setMedia(e: Ent, m: { mic: boolean; cam: boolean; screen: boolean; speaking?: boolean }): void {
    const next: MediaFlags = {
      mic: m.mic,
      cam: m.cam,
      screen: m.screen && this.inMeeting(e),
      speaking: m.mic && (m.speaking ?? e.media?.speaking ?? false),
    };
    e.media = next;
    this.queueMedia(e);
  }

  private queueMedia(e: Ent): void {
    const next = e.media;
    const sent = e.mediaSent;
    if (!next) return;
    if (sent && sent.mic === next.mic && sent.cam === next.cam && sent.screen === next.screen) {
      if (sent.speaking === next.speaking) {
        e.mediaPending = false;
        return;
      }
      if (this.now() - e.mediaSentAt < MEDIA_SPEAKING_MS) {
        e.mediaPending = true;
        return;
      }
    }
    this.flushMedia(e);
  }

  private flushMedia(e: Ent): void {
    if (!e.media) return;
    e.mediaSent = { ...e.media };
    e.mediaSentAt = this.now();
    e.mediaPending = false;
    this.broadcast({ t: 'media', id: e.id, ...e.media });
  }

  /** Desconectou: some do A/V para os outros (a reconexão manda o estado de novo). */
  private resetMedia(e: Ent): void {
    if (!e.media) return;
    e.media = { mic: false, cam: false, screen: false, speaking: false };
    this.flushMedia(e);
    e.media = null;
    e.mediaSent = null;
    e.mediaSentAt = -Infinity;
  }

  /** Estado de A/V atual (testes/diagnóstico). */
  mediaOf(userId: number): MediaFlags | null {
    const m = this.entities.get(userId)?.media;
    return m ? { ...m } : null;
  }

  private error(e: Ent, code: ErrorCode, message?: MessageKey): void {
    this.sendTo(e.id, message ? { t: 'error', code, message: tFor(e.locale, message) } : { t: 'error', code });
  }

  private reject(e: Ent, reason: MoveRejectReason, seq?: number): void {
    this.sendTo(e.id, seq !== undefined ? { t: 'moved_reject', seq, reason, x: e.tx, y: e.ty } : { t: 'moved_reject', reason, x: e.tx, y: e.ty });
  }

  // ---------------------------------------------------------------- movimento

  private canEnter(userId: number, z: ZoneRuntime | undefined): boolean {
    return !z || !z.locked || z.members.has(userId) || z.admitted.has(userId);
  }

  private zoneRtAt(tx: number, ty: number): ZoneRuntime | undefined {
    const a = this.assemblyRef;
    if (tx < 0 || ty < 0 || tx >= a.w || ty >= a.h) return undefined;
    const i = a.zoneAt[ty * a.w + tx];
    return i >= 0 ? this.zoneByIndex[i] : undefined;
  }

  /** Sai do assento (ou da reserva) sem teleporte: volta aos pés do tile. */
  private standUp(e: Ent): void {
    const spot = e.seat ?? e.seatTarget;
    if (!spot) return;
    if (this.seatOwners.get(spot) === e.id) this.seatOwners.delete(spot);
    const wasSeated = e.seat !== null;
    e.seat = null;
    e.seatTarget = null;
    e.path = { path: [], i: 0, fx: e.tx * TILE + FOOT_DX, fy: e.ty * TILE + FOOT_DY };
    e.dirty = true;
    if (wasSeated) this.stateDirty = true;
  }

  /** Larga o spot de uso (ou a reserva) sem teleporte: volta aos pés do tile. */
  private releaseUse(e: Ent): void {
    const spot = e.using ?? e.useTarget;
    if (!spot) return;
    if (this.useOwners.get(spot) === e.id) this.useOwners.delete(spot);
    const was = e.using !== null;
    e.using = null;
    e.useTarget = null;
    e.held = 'none';
    e.path = { path: [], i: 0, fx: e.tx * TILE + FOOT_DX, fy: e.ty * TILE + FOOT_DY };
    e.dirty = true;
    if (was) this.stateDirty = true;
  }

  private moveTo(e: Ent, x: number, y: number, run: boolean, seq?: number): void {
    const a = this.assemblyRef;
    const grid = a.grid;
    if (!grid.inside(x, y)) return this.reject(e, 'invalid', seq);
    if (cheb(e.tx, e.ty, x, y) > MAX_MOVE_TILES) return this.reject(e, 'far', seq);
    const goal = grid.nearestWalkable(x, y, DEST_SNAP_RADIUS);
    if (!goal) return this.reject(e, 'blocked', seq);
    // Em movimento: o tile lógico já é o próximo; recomeça de lá (sem cortar quinas).
    const atCenter = Math.abs(e.x - (e.tx * TILE + FOOT_DX)) < 0.01 && Math.abs(e.y - (e.ty * TILE + FOOT_DY)) < 0.01;
    const out = this.tmpPath;
    if (!findPath(grid, this.finder, e.tx, e.ty, goal.x, goal.y, out)) return this.reject(e, 'blocked', seq);
    for (let k = 0; k < out.length; k += 2) {
      const z = this.zoneRtAt(out[k], out[k + 1]);
      if (!this.canEnter(e.id, z)) {
        this.reject(e, 'locked', seq);
        this.knock(e, z!.def.id, true);
        return;
      }
    }
    const wasSeated = e.seat !== null || e.seatTarget !== null || e.using !== null || e.useTarget !== null;
    if (wasSeated) {
      this.standUp(e);
      this.releaseUse(e);
    }
    e.moveDir = null;
    e.emote = null;
    const path = !atCenter || wasSeated ? [e.tx, e.ty, ...out] : [...out];
    e.path = path.length ? { path, i: 0, run } : null;
    e.run = run;
    e.dirty = true;
    if (seq !== undefined) this.sendTo(e.id, { t: 'ack', seq, x: goal.x, y: goal.y });
  }

  /**
   * Posição ditada pelo cliente. O servidor só valida: dentro do mapa, tile caminhável, zona liberada
   * e velocidade plausível. Recusa = devolve o cliente para a última posição aceita (teleporte).
   */
  private clientPos(e: Ent, x: number, y: number, dir: Dir, moving: boolean, run: boolean): void {
    const a = this.assemblyRef;
    const now = this.now();
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    const correct = (reason: 'blocked' | 'locked' | 'far') => {
      if (now - e.lastRejectAt < 300) return;
      e.lastRejectAt = now;
      e.clientMoving = false;
      e.tp = true;
      e.dirty = true;
      this.urgent = true;
      this.sendTo(e.id, { t: 'moved_reject', reason, x: e.x / TILE, y: e.y / TILE, seq: 0 });
      const r1 = (n: number) => Math.round(n * 10) / 10;
      this.tel(e.id, 'moved_reject', {
        reason,
        server: { x: r1(e.x), y: r1(e.y) },
        client: { x: r1(x), y: r1(y) },
        dist: r1(Math.hypot(x - e.x, y - e.y)),
        sincePosMs: e.lastPosAt ? now - e.lastPosAt : null,
        moving,
      });
    };
    if (!a.grid.inside(tx, ty) || !a.grid.walkable(tx, ty)) return correct('blocked');
    const z = this.zoneRtAt(tx, ty);
    if (!this.canEnter(e.id, z)) {
      this.knock(e, z!.def.id, true);
      return correct('locked');
    }
    const dt = e.lastPosAt ? Math.min(2000, Math.max(50, now - e.lastPosAt)) : 2000;
    const maxDist = RUN_SPEED * 1.6 * (dt / 1000) + TILE * 1.5;
    if (Math.hypot(x - e.x, y - e.y) > maxDist) return correct('far');
    const moved = Math.abs(x - e.x) > 0.5 || Math.abs(y - e.y) > 0.5;
    if (moved && (e.seat !== null || e.seatTarget !== null)) this.standUp(e);
    if (moved && (e.using !== null || e.useTarget !== null)) this.releaseUse(e);
    if (moved) {
      e.path = null;
      e.moveDir = null;
      e.emote = null;
    }
    e.lastPosAt = now;
    e.x = x;
    e.y = y;
    e.dir = dir;
    e.clientMoving = moving;
    e.run = moving && run;
    e.pose = this.poseOf(e);
    e.dirty = true;
    if (tx !== e.tx || ty !== e.ty) {
      e.tx = tx;
      e.ty = ty;
      this.updateZone(e);
      this.avChanged = true;
    }
  }

  private moveDir(e: Ent, dir: Dir | null, run: boolean, seq?: number): void {
    e.moveDir = dir;
    e.moveRun = run;
    e.dirBlocked = null;
    if (!dir) return;
    if (e.seat !== null || e.seatTarget !== null) this.standUp(e);
    if (e.using !== null || e.useTarget !== null) this.releaseUse(e);
    e.emote = null;
    // Caminho longo em andamento (move_to): termina o tile atual e segue a direção.
    const ps = e.path;
    if (ps && ps.path.length > ps.i + 2) ps.path.length = ps.i + 2;
    if (ps) ps.run = run;
    e.run = run;
    this.extendDir(e);
    if (seq !== undefined) {
      const p = e.path?.path;
      const tx = p && p.length ? p[p.length - 2] : e.tx;
      const ty = p && p.length ? p[p.length - 1] : e.ty;
      this.sendTo(e.id, { t: 'ack', seq, x: tx, y: ty });
    }
  }

  /** `move_dir`: acrescenta um tile à frente quando o atual está acabando; parede = para virado para ela. */
  private extendDir(e: Ent): void {
    const d = e.moveDir;
    if (!d) return;
    const ps = e.path;
    if (ps && (ps.path.length > ps.i + 2 || (ps.fx !== undefined && !ps.fine))) return;
    if (ps && ps.i < ps.path.length) {
      // Só emenda o próximo tile quando o atual está quase no fim (soltar a tecla anda no máx. 1 tile).
      const gx = ps.path[ps.i] * TILE + FOOT_DX;
      const gy = ps.path[ps.i + 1] * TILE + FOOT_DY;
      const reach = (ps.run ? RUN_SPEED : WALK_SPEED) * MAX_DT_S;
      if (Math.hypot(gx - e.x, gy - e.y) > reach) return;
    }
    const bx = ps && ps.path.length ? ps.path[ps.path.length - 2] : e.tx;
    const by = ps && ps.path.length ? ps.path[ps.path.length - 1] : e.ty;
    const [dx, dy] = DIR_STEP[d];
    const nx = bx + dx;
    const ny = by + dy;
    const key = `${nx},${ny}`;
    let blocked = !this.assemblyRef.grid.walkable(nx, ny);
    if (!blocked) {
      const z = this.zoneRtAt(nx, ny);
      if (!this.canEnter(e.id, z)) {
        blocked = true;
        if (e.dirBlocked !== key) {
          this.reject(e, 'locked');
          this.knock(e, z!.def.id, true);
        }
      }
    }
    if (blocked) {
      e.dirBlocked = key;
      if (!ps && e.dir !== d) {
        e.dir = d;
        e.dirty = true;
      }
      return;
    }
    e.dirBlocked = null;
    if (ps) ps.path.push(nx, ny);
    else e.path = { path: [nx, ny], i: 0, run: e.moveRun };
  }

  // ---------------------------------------------------------------- assentos / poses

  private sit(e: Ent, spotId: string): void {
    const a = this.assemblyRef;
    const spot = a.spotById.get(spotId);
    if (!spot || !spot.seated) return this.reject(e, 'invalid');
    if (e.using !== null || e.useTarget !== null) this.releaseUse(e);
    if (e.seat === spotId || e.seatTarget === spotId) return;
    const owner = this.seatOwners.get(spotId);
    if (owner !== undefined && owner !== e.id) return this.reject(e, 'seat_taken');
    if (spot.deskId) {
      const desk = this.desks.get(spot.deskId);
      if (desk && desk.userId !== null && desk.userId !== e.id) return this.reject(e, 'desk_taken');
    }
    const z = this.zoneRtAt(spot.tx, spot.ty);
    if (!this.canEnter(e.id, z)) return this.reject(e, 'locked');
    if (cheb(e.tx, e.ty, spot.tx, spot.ty) > 1) {
      // Longe: vira intenção — anda até o assento (caminho do servidor) e senta ao chegar.
      const out: number[] = [];
      if (!findPath(a.grid, this.finder, e.tx, e.ty, spot.tx, spot.ty, out) || out.length / 2 > 60) return this.reject(e, 'far');
      for (let k = 0; k < out.length; k += 2) {
        if (!this.canEnter(e.id, this.zoneRtAt(out[k], out[k + 1]))) return this.reject(e, 'locked');
      }
      const wasSeated = e.seat !== null || e.seatTarget !== null;
      if (wasSeated) this.standUp(e);
      e.moveDir = null;
      e.emote = null;
      this.seatOwners.set(spotId, e.id);
      e.seatTarget = spotId;
      e.path = { path: wasSeated ? [e.tx, e.ty, ...out] : out, i: 0, fx: spot.x, fy: spot.y };
      e.run = false;
      e.dirty = true;
      return;
    }
    if (e.seat || e.seatTarget) {
      const old = e.seat ?? e.seatTarget!;
      if (this.seatOwners.get(old) === e.id) this.seatOwners.delete(old);
      if (e.seat) this.stateDirty = true;
      e.seat = null;
    }
    e.moveDir = null;
    e.emote = null;
    this.seatOwners.set(spotId, e.id);
    e.seatTarget = spotId;
    const atTile = e.tx === spot.tx && e.ty === spot.ty;
    e.path = { path: atTile ? [] : [spot.tx, spot.ty], i: 0, fx: spot.x, fy: spot.y };
    e.run = false;
    e.dirty = true;
  }

  private stand(e: Ent): void {
    if (e.using !== null || e.useTarget !== null) this.releaseUse(e);
    if (e.seat === null && e.seatTarget === null) return;
    this.standUp(e);
  }

  /** Intenção de usar um spot não-assento: perto, encaixa; longe, anda até lá e usa ao chegar. */
  private use(e: Ent, spotId: string): void {
    const a = this.assemblyRef;
    const spot = a.spotById.get(spotId);
    if (!spot || !USE_SPOT_KINDS.has(spot.kind)) return this.reject(e, 'invalid');
    if (e.useTarget === spotId) return;
    if (e.using === spotId) return this.releaseUse(e); // apertar de novo = parar
    const owner = this.useOwners.get(spotId);
    if (owner !== undefined && owner !== e.id) return this.reject(e, 'seat_taken');
    if (!this.canEnter(e.id, this.zoneRtAt(spot.tx, spot.ty))) return this.reject(e, 'locked');
    let route: number[] | null = null;
    if (cheb(e.tx, e.ty, spot.tx, spot.ty) > 1) {
      const out: number[] = [];
      if (!findPath(a.grid, this.finder, e.tx, e.ty, spot.tx, spot.ty, out) || out.length / 2 > 60) return this.reject(e, 'far');
      for (let k = 0; k < out.length; k += 2) {
        if (!this.canEnter(e.id, this.zoneRtAt(out[k], out[k + 1]))) return this.reject(e, 'locked');
      }
      route = out;
    }
    const was = e.seat !== null || e.seatTarget !== null || e.using !== null || e.useTarget !== null;
    if (e.seat !== null || e.seatTarget !== null) this.standUp(e);
    if (e.using !== null || e.useTarget !== null) this.releaseUse(e);
    e.moveDir = null;
    e.emote = null;
    this.useOwners.set(spotId, e.id);
    e.useTarget = spotId;
    const atTile = e.tx === spot.tx && e.ty === spot.ty;
    const out = route ?? (atTile ? [] : [spot.tx, spot.ty]);
    e.path = { path: route && was ? [e.tx, e.ty, ...out] : out, i: 0, fx: spot.x, fy: spot.y };
    e.run = false;
    e.dirty = true;
  }

  /** Pose e item na mão de quem está usando um spot. */
  private useLook(e: Ent, now: number): { pose: Pose; held: HeldItem } {
    const spot = e.using ? this.assemblyRef.spotById.get(e.using) : undefined;
    const t = now - e.useStart;
    switch (spot?.kind) {
      case 'coffee':
        return t < USE_PREP_MS ? { pose: 'use', held: 'none' } : { pose: 'drink', held: 'coffee' };
      case 'water':
        return t < USE_PREP_MS ? { pose: 'use', held: 'none' } : { pose: 'drink', held: 'water' };
      case 'arcade':
        return { pose: 'game', held: 'controller' };
      case 'pingpong':
        return { pose: 'play', held: 'paddle' };
      case 'shelf':
        return { pose: 'read', held: 'book' };
      default:
        return { pose: 'use', held: 'none' };
    }
  }

  private emote(e: Ent, emote: Emote): void {
    const now = this.now();
    if (now < e.emoteCooldownUntil) return;
    if (e.path && e.seatTarget === null && e.useTarget === null) return; // andando: emote não aparece
    e.emote = emote;
    e.emoteUntil = now + (emote === 'raise_hand' ? RAISE_HAND_MS : EMOTE_MS);
    e.emoteCooldownUntil = now + EMOTE_COOLDOWN_MS;
    e.dirty = true;
    this.urgent = true;
  }

  private poseOf(e: Ent): Pose {
    if (e.clientMoving) return e.run ? 'run' : 'walk';
    if (e.path && !((e.seatTarget || e.useTarget) && e.path.path.length === 0)) return e.run ? 'run' : 'walk';
    if (e.emote) return e.emote;
    if (e.using) return this.useLook(e, this.now()).pose;
    if (e.seat) {
      const spot = this.assemblyRef.spotById.get(e.seat);
      return spot?.deskId ? 'type' : 'sit';
    }
    return 'stand';
  }

  // ---------------------------------------------------------------- status / presença

  private setStatus(e: Ent, status: UserStatus): void {
    if (e.status === status) return;
    e.status = status;
    this.broadcast({ t: 'status', id: e.id, status });
  }

  // ---------------------------------------------------------------- chat

  private async chat(e: Ent, scope: 'global' | 'room' | 'near', text: string): Promise<void> {
    const now = this.now();
    e.chatTimes = e.chatTimes.filter((t) => now - t < CHAT_WINDOW_MS);
    if (e.chatTimes.length >= CHAT_MAX_IN_WINDOW) return this.error(e, 'rate_limited', 'server.world.chat');
    e.chatTimes.push(now);
    this.counters.chat++;

    if (scope === 'near') {
      const msg: ChatMessage = { id: -++this.nearSeq, scope, zone: null, from: e.id, name: e.user.name, text, ts: now };
      const a = this.assemblyRef;
      const mine = privateZoneAt(a, e.tx, e.ty);
      for (const o of this.entities.values()) {
        if (!o.conn) continue;
        if (o.id !== e.id && (cheb(o.tx, o.ty, e.tx, e.ty) > CHAT_NEARBY_TILES || privateZoneAt(a, o.tx, o.ty) !== mine)) continue;
        sendTo(o.conn, { t: 'chat', msg });
      }
      return;
    }

    let zone: ZoneRuntime | null = null;
    if (scope === 'room') {
      zone = e.zone >= 0 ? (this.zoneByIndex[e.zone] ?? null) : null;
      if (!zone) return this.error(e, 'forbidden', 'server.world.notInRoom');
    }
    let msg: ChatMessage;
    try {
      const row = await this.repos.chat.insert({ scope, zone_id: zone?.def.id ?? null, user_id: e.id, name: e.user.name, text, created_at: new Date(now) });
      msg = chatFromRow(row);
    } catch (err) {
      log.warn(`Failed to store chat message: ${errMsg(err)}`);
      msg = { id: -++this.nearSeq, scope, zone: zone?.def.id ?? null, from: e.id, name: e.user.name, text, ts: now };
    }
    if (scope === 'global') {
      this.broadcast({ t: 'chat', msg });
      return;
    }
    for (const id of zone!.members) {
      const c = this.conns.get(id);
      if (c) sendTo(c, { t: 'chat', msg });
    }
  }

  // ---------------------------------------------------------------- zonas: tranca / batida

  private lock(e: Ent, zoneId: string, locked: boolean): void {
    const z = this.zones.get(zoneId);
    if (!z) return this.error(e, 'not_found', 'server.world.room');
    if (!z.def.lockable) return this.error(e, 'forbidden', 'server.world.roomNotLockable');
    if (!z.members.has(e.id)) return this.error(e, 'forbidden', 'server.world.onlyMembersLock');
    if (z.locked === locked) return;
    z.locked = locked;
    z.lockedBy = locked ? e.id : null;
    if (!locked) this.clearKnocks(z, true);
    this.zoneChanged.add(z.def.id);
  }

  /** Bate na porta (explícito ou ao tentar entrar numa sala trancada). */
  private knock(e: Ent, zoneId: string, implicit = false): void {
    const z = this.zones.get(zoneId);
    if (!z) {
      if (!implicit) this.error(e, 'not_found', 'server.world.room');
      return;
    }
    if (!z.locked || z.members.has(e.id) || z.admitted.has(e.id)) {
      if (!implicit) this.sendTo(e.id, { t: 'knock_result', zone: zoneId, allow: true });
      return;
    }
    const now = this.now();
    if (now - (e.knockAt.get(zoneId) ?? -Infinity) < KNOCK_COOLDOWN_MS) return;
    e.knockAt.set(zoneId, now);
    z.knocks.add(e.id);
    for (const id of z.members) this.sendTo(id, { t: 'knock', zone: zoneId, from: e.id, name: e.user.name });
  }

  private admit(e: Ent, zoneId: string, userId: number, allow: boolean): void {
    const z = this.zones.get(zoneId);
    if (!z) return this.error(e, 'not_found', 'server.world.room');
    if (!z.members.has(e.id)) return this.error(e, 'forbidden', 'server.world.onlyMembersAnswer');
    if (!z.knocks.has(userId)) return this.error(e, 'not_found', 'server.world.nobodyKnocked');
    z.knocks.delete(userId);
    if (allow) z.admitted.add(userId);
    this.sendTo(userId, { t: 'knock_result', zone: zoneId, allow });
  }

  private clearKnocks(z: ZoneRuntime, allow: boolean): void {
    for (const id of z.knocks) this.sendTo(id, { t: 'knock_result', zone: z.def.id, allow });
    z.knocks.clear();
    z.admitted.clear();
  }

  /** Recalcula a zona da entidade pelo tile; entra/sai de `members`. */
  private updateZone(e: Ent): void {
    const a = this.assemblyRef;
    const inside = e.tx >= 0 && e.ty >= 0 && e.tx < a.w && e.ty < a.h;
    const idx = inside ? a.zoneAt[e.ty * a.w + e.tx] : -1;
    if (idx === e.zone) return;
    const old = e.zone >= 0 ? this.zoneByIndex[e.zone] : undefined;
    if (old) {
      old.members.delete(e.id);
      this.zoneChanged.add(old.def.id);
      if (old.locked && old.members.size === 0) {
        old.locked = false;
        old.lockedBy = null;
        this.clearKnocks(old, true);
      }
    }
    e.zone = idx;
    const nz = idx >= 0 ? this.zoneByIndex[idx] : undefined;
    if (nz) {
      nz.members.add(e.id);
      nz.admitted.delete(e.id);
      nz.knocks.delete(e.id);
      this.zoneChanged.add(nz.def.id);
    }
    this.avChanged = true;
    if (e.media?.screen && !this.inMeeting(e)) {
      e.media.screen = false;
      this.queueMedia(e);
    }
  }

  // ---------------------------------------------------------------- mesas

  private async deskClaim(e: Ent, deskId: string): Promise<void> {
    if (!this.assemblyRef.deskById.has(deskId)) return this.error(e, 'not_found', 'server.world.desk');
    let r: Awaited<ReturnType<Repos['desks']['claim']>>;
    try {
      r = await this.repos.desks.claim(deskId, e.id);
    } catch (err) {
      log.warn(`Failed to claim desk: ${errMsg(err)}`);
      return this.error(e, 'server');
    }
    if (!r.ok) return this.error(e, 'conflict', 'server.world.deskTaken');
    if (r.released && r.released !== deskId) {
      this.desks.delete(r.released);
      this.broadcast({ t: 'desk', desk: r.released, userId: null, decor: null });
    }
    const cur = this.desks.get(deskId);
    if (cur && cur.userId === e.id) return;
    this.desks.set(deskId, { id: deskId, userId: e.id, decor: null });
    this.broadcast({ t: 'desk', desk: deskId, userId: e.id, decor: null });
  }

  private async deskRelease(e: Ent): Promise<void> {
    let mine: string | null = null;
    for (const d of this.desks.values()) if (d.userId === e.id) mine = d.id;
    if (!mine) {
      const row = await this.repos.desks.ownedBy(e.id).catch(() => null);
      mine = row?.desk_id ?? null;
    }
    if (!mine) return this.error(e, 'not_found', 'server.world.noDesk');
    try {
      await this.repos.desks.release(mine);
    } catch (err) {
      log.warn(`Failed to release desk: ${errMsg(err)}`);
      return this.error(e, 'server');
    }
    this.desks.delete(mine);
    this.broadcast({ t: 'desk', desk: mine, userId: null, decor: null });
  }

  // ---------------------------------------------------------------- tick

  /** Um passo da simulação (`dt` em segundos). Público para os testes. */
  step(dt: number): void {
    const t0 = performance.now();
    const now = this.now();
    let tileChanged = false;
    for (const e of this.entities.values()) {
      const ptx = e.tx;
      const pty = e.ty;
      this.extendDir(e);
      if (e.path) {
        const r = advance(e, e.path, dt);
        if (r.moved) e.dirty = true;
        if (r.arrived) {
          e.path = null;
          e.dirty = true;
          if (e.seatTarget) {
            const spot = this.assemblyRef.spotById.get(e.seatTarget);
            e.seat = e.seatTarget;
            e.seatTarget = null;
            if (spot) e.dir = spot.dir;
            this.stateDirty = true;
          }
          if (e.useTarget) {
            const spot = this.assemblyRef.spotById.get(e.useTarget);
            e.using = e.useTarget;
            e.useTarget = null;
            e.useStart = now;
            e.useUntil = now + (spot ? (USE_MS[spot.kind] ?? USE_MAX_MS) : USE_MAX_MS);
            if (spot) e.dir = spot.dir;
            this.stateDirty = true;
          }
          this.extendDir(e);
        }
      }
      if (e.using && now >= e.useUntil) this.releaseUse(e);
      if (!e.path && !e.clientMoving && e.run) e.run = false;
      if (e.tx !== ptx || e.ty !== pty) {
        tileChanged = true;
        this.updateZone(e);
      }
      if (e.emote && now >= e.emoteUntil) {
        e.emote = null;
        e.dirty = true;
      }
      const pose = this.poseOf(e);
      if (pose !== e.pose) {
        e.pose = pose;
        e.dirty = true;
      }
      const held: HeldItem = e.using && !e.path ? this.useLook(e, now).held : 'none';
      if (held !== e.held) {
        e.held = held;
        e.dirty = true;
      }
    }
    if (tileChanged) this.avChanged = true;
    this.tickCount++;

    if (this.zoneChanged.size) {
      for (const id of this.zoneChanged) {
        const z = this.zones.get(id);
        if (z) this.broadcast({ t: 'zone', zone: this.zoneState(z) });
      }
      this.zoneChanged.clear();
    }
    if (this.stateDirty) {
      this.stateDirty = false;
      this.broadcastState();
    }
    if (this.urgent || this.tickCount % BROADCAST_EVERY === 0) this.flushDeltas();

    this.av.update(this.assemblyRef, this.avPeople(), this.avChanged);
    this.avChanged = false;
    for (const e of this.entities.values()) if (e.mediaPending && now - e.mediaSentAt >= MEDIA_SPEAKING_MS) this.flushMedia(e);

    if (now - this.lastHouse >= 1_000) this.housekeep();
    this.lastTickMs = performance.now() - t0;
    if (this.lastTickMs > this.maxTickMs) this.maxTickMs = this.lastTickMs;
  }

  private flushDeltas(): void {
    this.urgent = false;
    const out = [];
    for (const e of this.entities.values()) {
      if (!e.dirty) continue;
      out.push(packEntity(this.entityState(e)));
      e.dirty = false;
      e.tp = false;
    }
    if (out.length) this.broadcast({ t: 'delta', tick: this.tickCount, e: out });
  }

  private broadcastState(): void {
    this.broadcast({ t: 'state', tick: this.tickCount, entities: [...this.entities.values()].map((e) => this.entityState(e)), zones: this.zoneStates(), desks: this.deskStates() });
  }

  private avPeople(): AvPerson[] {
    const out: AvPerson[] = [];
    for (const e of this.entities.values()) if (e.conn) out.push({ id: e.id, tx: e.tx, ty: e.ty, x: e.x, y: e.y });
    return out;
  }

  /** Tarefas de 1 Hz: fantasmas, auto-away, last_seen (60 s), revalidação de sessão (5 min). */
  housekeep(): void {
    const now = this.now();
    this.lastHouse = now;
    for (const e of [...this.entities.values()]) {
      if (!e.conn && e.ghostUntil > 0 && now >= e.ghostUntil) {
        this.removeEntity(e);
        continue;
      }
      if (e.conn && e.status === 'available' && e.user.settings.autoAway && now - e.lastInput >= AUTO_AWAY_MS) {
        e.autoAway = true;
        this.setStatus(e, 'away');
      }
    }
    if (now - this.lastSeenAt >= LAST_SEEN_EVERY_MS) {
      this.lastSeenAt = now;
      for (const id of this.conns.keys()) void this.repos.users.touchLastSeen(id).catch(() => undefined);
    }
    if (now - this.lastRevalidate >= REVALIDATE_EVERY_MS) {
      this.lastRevalidate = now;
      void this.revalidateAll();
    }
  }

  /** Revalida a sessão de todos os conectados (público para os testes). */
  async revalidateAll(): Promise<void> {
    const session = this.opts.session;
    if (!session) return;
    await Promise.all(
      [...this.conns.keys()].map(async (id) => {
        try {
          const r = await session.revalidate(id);
          if (!this.conns.has(id)) return;
          if (!r.ok) {
            this.kickUser(id, r.reason === 'disabled' ? 'disabled' : 'session');
            return;
          }
          const e = this.entities.get(id);
          if (!e) return;
          const info = userInfoOf(r.user);
          const changed = info.name !== e.user.name || JSON.stringify(info.appearance) !== JSON.stringify(e.user.appearance);
          if (changed && info.appearance) this.appearanceChanged(id, info.appearance, info.name);
          e.user = info;
        } catch (err) {
          log.warn(`Failed to revalidate session of user ${id}: ${errMsg(err)}`);
        }
      }),
    );
  }

  private removeEntity(e: Ent): void {
    for (const s of [e.seat, e.seatTarget]) if (s && this.seatOwners.get(s) === e.id) this.seatOwners.delete(s);
    for (const s of [e.using, e.useTarget]) if (s && this.useOwners.get(s) === e.id) this.useOwners.delete(s);
    e.seat = null;
    e.seatTarget = null;
    e.using = null;
    e.useTarget = null;
    this.entities.delete(e.id);
    this.closeSessionLog(e);
    e.media = null;
    e.mediaPending = false;
    // Sai da zona (pode destrancar a sala)
    const fake = { ...e, tx: -1, ty: -1 };
    this.updateZone(fake);
    this.broadcast({ t: 'leave', id: e.id });
    this.av.remove(e.id);
    this.avChanged = true;
  }

  private closeSessionLog(e: Ent): void {
    const p = e.sessionLogId;
    e.sessionLogId = null;
    if (p) void p.then((id) => (id === null ? undefined : this.repos.sessions.close(id))).catch(() => undefined);
  }

  // ---------------------------------------------------------------- troca de mapa (A.5.1 passo 5)

  /** Pessoas no mundo como entrada de `planRelocation` (mesma ordem de `entities`). */
  entitiesForRelocation(): RelocEntity[] {
    return [...this.entities.values()].map((e) => ({ id: String(e.id), tx: e.tx, ty: e.ty, spotId: e.seat ?? e.seatTarget }));
  }

  /** Dry-run de `swapMap`: quantas pessoas seriam movidas e quantos assentos/mesas seriam liberados. Não muda nada. */
  relocationPreview(next: OfficeAssembly): SwapResult {
    const plan = planRelocation(next, this.entitiesForRelocation());
    let releasedDesks = 0;
    for (const id of this.desks.keys()) if (!next.deskById.has(id)) releasedDesks++;
    return { moved: plan.filter((m) => m.moved).length, releasedSeats: plan.filter((m) => m.released).length, releasedDesks };
  }

  /**
   * Troca o layout num único passo: realoca (com `tp`), libera assentos, refaz as zonas (trancas
   * mantidas por id se a zona continuar trancável), sincroniza as mesas, `layoutVersion++` e avisa
   * todos com `{t:'map'}` + `state`. O chamador já gravou a versão e podou `desks` no banco.
   */
  swapMap(next: OfficeAssembly, meta: { id?: number } = {}): SwapResult {
    const ents = [...this.entities.values()];
    const plan = planRelocation(next, this.entitiesForRelocation());
    const res: SwapResult = { moved: 0, releasedSeats: 0, releasedDesks: 0 };
    this.seatOwners.clear();
    this.useOwners.clear();
    plan.forEach((m, k) => {
      const e = ents[k];
      e.using = null;
      e.useTarget = null;
      e.held = 'none';
      e.path = null;
      e.moveDir = null;
      e.seatTarget = null;
      e.tx = m.tx;
      e.ty = m.ty;
      e.x = m.x;
      e.y = m.y;
      e.seat = m.spotId;
      if (m.spotId) {
        this.seatOwners.set(m.spotId, e.id);
        const spot = next.spotById.get(m.spotId);
        if (spot) e.dir = spot.dir;
      }
      if (m.released) res.releasedSeats++;
      if (m.moved) {
        res.moved++;
        e.tp = true;
      }
      e.dirty = true;
    });

    const old = new Map([...this.zones].map(([id, z]) => [id, z]));
    this.assemblyRef = next;
    this.finder.setGrid(next.grid);
    this.rebuildZones(old);
    for (const e of ents) {
      e.zone = -1;
      this.updateZone(e);
      e.pose = this.poseOf(e);
    }
    for (const z of this.zones.values()) {
      if (z.locked && z.members.size === 0) {
        z.locked = false;
        z.lockedBy = null;
      }
    }
    this.zoneChanged.clear();

    for (const [id, d] of [...this.desks]) {
      if (next.deskById.has(id)) continue;
      this.desks.delete(id);
      res.releasedDesks++;
      if (d.userId !== null) this.sendTo(d.userId, { t: 'notice', level: 'warn', text: tFor(this.localeOf(d.userId), 'server.world.deskRemoved') });
    }

    this.layoutVersionRef = Math.max(this.layoutVersionRef + 1, next.version);
    if (meta.id !== undefined) this.mapIdRef = meta.id;
    this.broadcast({ t: 'map', id: this.mapIdRef, version: this.layoutVersionRef });
    this.broadcastState();
    for (const e of ents) e.tp = false;
    this.stateDirty = false;
    this.avChanged = true;
    return res;
  }

  private rebuildZones(old: Map<string, ZoneRuntime>): void {
    this.zones.clear();
    this.zoneByIndex = this.assemblyRef.zones.map((def) => {
      const prev = old.get(def.id);
      const keep = !!prev?.locked && def.lockable;
      const z: ZoneRuntime = {
        def,
        locked: keep,
        lockedBy: keep ? prev!.lockedBy : null,
        members: new Set(),
        admitted: keep ? new Set(prev!.admitted) : new Set(),
        knocks: keep ? new Set(prev!.knocks) : new Set(),
      };
      this.zones.set(def.id, z);
      return z;
    });
  }

  // ---------------------------------------------------------------- snapshots

  /** Idioma de uma pessoa conectada (ou o padrão da instância). */
  private localeOf(userId: number): Locale {
    return this.entities.get(userId)?.locale ?? this.opts.defaultLocale ?? DEFAULT_LOCALE;
  }

  private spawnEntity(user: UserInfo, now: number, locale: Locale): Ent {
    const a = this.assemblyRef;
    const taken = new Set([...this.entities.values()].map((e) => `${e.tx},${e.ty}`));
    let tile = a.spawn.find((p) => a.grid.walkable(p.x, p.y) && !taken.has(`${p.x},${p.y}`)) ?? null;
    if (!tile && a.spawn[0]) {
      // Todos os spawns ocupados: o tile livre mais próximo do primeiro.
      const s = a.spawn[0];
      for (let r = 1; r <= 6 && !tile; r++) {
        for (let dy = -r; dy <= r && !tile; dy++) {
          for (let dx = -r; dx <= r && !tile; dx++) {
            const x = s.x + dx;
            const y = s.y + dy;
            if (Math.max(Math.abs(dx), Math.abs(dy)) === r && a.grid.walkable(x, y) && a.reach[y * a.w + x] && !taken.has(`${x},${y}`)) tile = { x, y };
          }
        }
      }
    }
    tile ??= a.spawn[0] ?? a.grid.nearestWalkable(0, 0, Math.max(a.w, a.h)) ?? { x: 0, y: 0 };
    const e: Ent = {
      id: user.id,
      user,
      status: 'available',
      autoAway: false,
      x: 0,
      y: 0,
      tx: 0,
      ty: 0,
      dir: 'down',
      pose: 'stand',
      held: 'none',
      run: false,
      path: null,
      seat: null,
      seatTarget: null,
      using: null,
      useTarget: null,
      useStart: 0,
      useUntil: 0,
      moveDir: null,
      clientMoving: false,
      lastPosAt: 0,
      lastRejectAt: 0,
      moveRun: false,
      dirBlocked: null,
      emote: null,
      emoteUntil: 0,
      emoteCooldownUntil: 0,
      zone: -1,
      tp: false,
      dirty: false,
      lastInput: now,
      chatTimes: [],
      knockAt: new Map(),
      conn: null,
      locale,
      ghostUntil: 0,
      sessionLogId: null,
      media: null,
      mediaSent: null,
      mediaSentAt: -Infinity,
      mediaPending: false,
    };
    placeAtTile(e, tile.x, tile.y);
    return e;
  }

  entityState(e: Ent): EntityState {
    const s: EntityState = {
      id: e.id,
      x: netCoord(e.x),
      y: netCoord(e.y),
      dir: e.dir,
      pose: e.pose,
      held: e.held,
      moving: e.path !== null || e.clientMoving,
      run: e.run && e.path !== null,
    };
    if (e.seat) s.seat = e.seat;
    if (e.using) s.using = e.using;
    if (e.tp) s.tp = 1;
    return s;
  }

  private userPublic(e: Ent): UserPublic {
    const u: UserPublic = { id: e.id, name: e.user.name, role: e.user.role, appearance: e.user.appearance, status: e.status };
    if (e.media) u.media = { ...e.media };
    return u;
  }

  private zoneState(z: ZoneRuntime): ZoneState {
    return { id: z.def.id, locked: z.locked, members: [...z.members].sort((a, b) => a - b) };
  }

  zoneStates(): ZoneState[] {
    return this.zoneByIndex.map((z) => this.zoneState(z));
  }

  deskStates(): DeskState[] {
    return [...this.desks.values()].filter((d) => this.assemblyRef.deskById.has(d.id)).map((d) => ({ ...d }));
  }

  /** Estado público de uma entidade (testes/diagnóstico). */
  stateOf(userId: number): EntityState | null {
    const e = this.entities.get(userId);
    return e ? this.entityState(e) : null;
  }

  /** Posição interna (px e tile) — testes. */
  posOf(userId: number): { x: number; y: number; tx: number; ty: number; status: UserStatus; seat: string | null } | null {
    const e = this.entities.get(userId);
    return e ? { x: e.x, y: e.y, tx: e.tx, ty: e.ty, status: e.status, seat: e.seat } : null;
  }

  /** Teleporta (admin/testes): sem caminho, com `tp`. */
  teleport(userId: number, tx: number, ty: number): void {
    const e = this.entities.get(userId);
    if (!e) return;
    if (e.seat || e.seatTarget) {
      const s = e.seat ?? e.seatTarget!;
      if (this.seatOwners.get(s) === e.id) this.seatOwners.delete(s);
      e.seat = null;
      e.seatTarget = null;
      this.stateDirty = true;
    }
    if (e.using !== null || e.useTarget !== null) this.releaseUse(e);
    e.path = null;
    placeAtTile(e, tx, ty);
    e.tp = true;
    e.dirty = true;
    this.updateZone(e);
    e.pose = this.poseOf(e);
  }

  // ---------------------------------------------------------------- envio

  sendTo(userId: number, msg: ServerMsg): void {
    const c = this.conns.get(userId);
    if (c) sendTo(c, msg);
  }

  broadcast(msg: ServerMsg, exceptUserId?: number): void {
    const except = exceptUserId !== undefined ? this.conns.get(exceptUserId) : undefined;
    broadcastTo(this.conns.values(), msg, except);
  }
}
