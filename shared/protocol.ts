// Protocolo WebSocket cliente <-> servidor (JSON, um objeto por frame, campo `t` discrimina).
// O cliente só envia intenções; o servidor valida e é a fonte da verdade.
import { z } from 'zod';
import {
  DIRS, EMOTES, FLAG_MOVING, FLAG_RUN, FLAG_SEATED, FLAG_TP, HELD_CODES, POSE_CODES, USER_STATUSES,
} from './model';
import type {
  Appearance, ChatMessage, DeskState, MediaFlags, Dir, EntityDelta, EntityState, Emote, HeldItem, Pose, UserPublic, UserPublicSelf,
  UserStatus, ZoneState,
} from './model';
import type { DeskDecor } from './desk-decor';

export const PROTOCOL_VERSION = 1;

export type ChatScope = 'global' | 'room' | 'near';

export type MoveRejectReason = 'locked' | 'blocked' | 'far' | 'seat_taken' | 'desk_taken' | 'cooldown' | 'invalid';

export type ErrorCode = 'bad_message' | 'rate_limited' | 'forbidden' | 'not_found' | 'conflict' | 'server';

/** Cliente -> servidor. `seq` (opcional, inteiro crescente) é ecoado em `ack`/`moved_reject` para reconciliação. */
export type ClientMsg =
  | { t: 'ping'; ts: number }
  | { t: 'move_to'; x: number; y: number; run?: boolean; seq?: number }
  | { t: 'move_dir'; dir: Dir | null; run?: boolean; seq?: number }
  /** Posição do próprio avatar (pés, px de mundo), ditada pelo cliente e validada pelo servidor. */
  | { t: 'pos'; x: number; y: number; dir: Dir; moving: boolean; run?: boolean }
  | { t: 'sit'; spot: string }
  /** (Aditivo) Usa um spot que não é assento (café, pia, arcade...). Longe: anda até lá e usa ao chegar. */
  | { t: 'use'; spot: string }
  | { t: 'stand' }
  | { t: 'emote'; emote: Emote }
  | { t: 'chat'; scope: ChatScope; text: string }
  | { t: 'status'; status: UserStatus }
  /** Qualquer input do usuário (zera o contador de auto-away). */
  | { t: 'activity' }
  | { t: 'lock'; zone: string; locked: boolean }
  | { t: 'knock'; zone: string }
  /** Dono/membro de sala responde a uma batida. */
  | { t: 'admit'; zone: string; user: number; allow: boolean }
  | { t: 'desk_claim'; desk: string }
  | { t: 'desk_release' }
  /** (Aditivo, WP8) Estado do A/V local. Sem `speaking`, o servidor mantém o valor anterior. */
  | { t: 'media'; mic: boolean; cam: boolean; screen: boolean; speaking?: boolean };

export interface WelcomeMsg {
  t: 'welcome';
  v: number;
  you: UserPublicSelf;
  /** Tick atual do servidor e relógio (epoch ms) para sincronizar. */
  tick: number;
  now: number;
  map: { id: number; version: number; etag: string };
  entities: EntityState[];
  users: UserPublic[];
  zones: ZoneState[];
  desks: DeskState[];
  chat: ChatMessage[];
  /** (Aditivo, WP4) Credenciais do LiveKit; null quando o servidor não tem LIVEKIT_* configurado. */
  livekit?: LiveKitInfo | null;
}

/** (Aditivo, WP4) Também é a resposta de `GET /api/livekit/token`. */
export interface LiveKitInfo {
  url: string;
  token: string;
  room: string;
}

/** Servidor -> cliente. */
export type ServerMsg =
  | WelcomeMsg
  /** Snapshot completo (após troca de mapa ou ressincronização). */
  | { t: 'state'; tick: number; entities: EntityState[]; zones: ZoneState[]; desks: DeskState[] }
  /** Deltas a 10 Hz (saídas vêm em `leave`). */
  | { t: 'delta'; tick: number; e: EntityDelta[] }
  | { t: 'join'; user: UserPublic; entity: EntityState }
  | { t: 'leave'; id: number }
  | { t: 'status'; id: number; status: UserStatus }
  | { t: 'appearance'; id: number; appearance: Appearance; displayName: string }
  | { t: 'chat'; msg: ChatMessage }
  | { t: 'zone'; zone: ZoneState }
  /** Cobre reivindicar, liberar, decorar, reatribuir e remoção pelo publish do mapa. */
  | { t: 'desk'; desk: string; userId: number | null; decor: DeskDecor | null }
  | { t: 'map'; id: number; version: number }
  | { t: 'knock'; zone: string; from: number; name: string }
  | { t: 'knock_result'; zone: string; allow: boolean }
  /** (Aditivo, WP8) Mudança de microfone/câmera/tela/fala de um usuário (fala limitada a 1 a cada 300 ms). */
  | ({ t: 'media'; id: number } & MediaFlags)
  | { t: 'av_set'; hear: number[]; allow: number[]; volumes: Record<string, number>; screenAllowed: boolean }
  | { t: 'ack'; seq: number; x: number; y: number }
  | { t: 'moved_reject'; seq?: number; reason: MoveRejectReason; x: number; y: number }
  | { t: 'notice'; level: 'info' | 'warn'; text: string }
  | { t: 'kick'; reason: 'replaced' | 'disabled' | 'session' | 'server' }
  | { t: 'pong'; ts: number; now: number }
  | { t: 'error'; code: ErrorCode; message?: string };

export type ServerMsgKind = ServerMsg['t'];

// ---------------------------------------------------------------------------------------------
// Validação do que vem do cliente

const MAX_TILE = 1023;

/** Remove caracteres de controle (newline/tab viram espaço) e apara. */
export function cleanText(s: string): string {
  return s.replace(/[\t\r\n]+/g, ' ').replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, '').trim();
}

const int = z.number().int().finite();
const tile = int.min(0).max(MAX_TILE);
const seq = int.min(0).max(2 ** 31 - 1).optional();
// ids reais: `area#f12:desk:1` (assentos), `area#f12` (mesas), `z:lounge` (zonas)
const id64 = z.string().min(1).max(64).regex(/^[A-Za-z0-9_.:#-]+$/);
const dirEnum = z.enum(DIRS as unknown as [Dir, ...Dir[]]);

export const clientMsgSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('ping'), ts: int.min(0) }).strict(),
  z.object({ t: z.literal('move_to'), x: tile, y: tile, run: z.boolean().optional(), seq }).strict(),
  z.object({ t: z.literal('move_dir'), dir: dirEnum.nullable(), run: z.boolean().optional(), seq }).strict(),
  z.object({ t: z.literal('pos'), x: z.number().finite().min(0).max(MAX_TILE * 16), y: z.number().finite().min(0).max(MAX_TILE * 16), dir: dirEnum, moving: z.boolean(), run: z.boolean().optional() }).strict(),
  z.object({ t: z.literal('sit'), spot: id64 }).strict(),
  z.object({ t: z.literal('use'), spot: id64 }).strict(),
  z.object({ t: z.literal('stand') }).strict(),
  z.object({ t: z.literal('emote'), emote: z.enum(EMOTES as unknown as [Emote, ...Emote[]]) }).strict(),
  z
    .object({
      t: z.literal('chat'),
      scope: z.enum(['global', 'room', 'near']),
      text: z.string().max(4000).transform(cleanText).pipe(z.string().min(1).max(1000)),
    })
    .strict(),
  z.object({ t: z.literal('status'), status: z.enum(USER_STATUSES as unknown as [UserStatus, ...UserStatus[]]) }).strict(),
  z.object({ t: z.literal('activity') }).strict(),
  z.object({ t: z.literal('lock'), zone: id64, locked: z.boolean() }).strict(),
  z.object({ t: z.literal('knock'), zone: id64 }).strict(),
  z.object({ t: z.literal('admit'), zone: id64, user: int.min(1), allow: z.boolean() }).strict(),
  z.object({ t: z.literal('desk_claim'), desk: id64 }).strict(),
  z.object({ t: z.literal('desk_release') }).strict(),
  z
    .object({ t: z.literal('media'), mic: z.boolean(), cam: z.boolean(), screen: z.boolean(), speaking: z.boolean().optional() })
    .strict(),
]);

/** Decodifica e valida um frame do cliente. Qualquer problema -> null (o servidor responde `bad_message`). */
export function decodeClient(raw: string, maxLen = 4096): ClientMsg | null {
  if (typeof raw !== 'string' || raw.length > maxLen) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const r = clientMsgSchema.safeParse(data);
  return r.success ? (r.data as ClientMsg) : null;
}

export function encodeServer(msg: ServerMsg): string {
  return JSON.stringify(msg);
}

/** Decodificação leve para o cliente (o servidor é confiável): só checa o formato do envelope. */
export function decodeServer(raw: string): ServerMsg | null {
  try {
    const d: unknown = JSON.parse(raw);
    if (d && typeof d === 'object' && typeof (d as { t?: unknown }).t === 'string') return d as ServerMsg;
  } catch {
    // frame inválido
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Entidades: pack/unpack

export function dirCode(d: Dir): number {
  const i = DIRS.indexOf(d);
  return i < 0 ? 0 : i;
}
export function codeDir(c: number): Dir {
  return DIRS[c & 3] ?? 'down';
}
export function poseCode(p: Pose): number {
  const i = (POSE_CODES as readonly Pose[]).indexOf(p);
  return i < 0 ? 0 : i;
}
export function codePose(c: number): Pose {
  return POSE_CODES[c] ?? 'stand';
}
export function heldCode(h: HeldItem): number {
  const i = (HELD_CODES as readonly HeldItem[]).indexOf(h);
  return i < 0 ? 0 : i;
}
export function codeHeld(c: number): HeldItem {
  return HELD_CODES[c] ?? 'none';
}

/** Posição em tiles -> 1/16 de tile (pixel do mundo). */
export function packEntity(e: EntityState): EntityDelta {
  const flags = (e.moving ? FLAG_MOVING : 0) | (e.run ? FLAG_RUN : 0) | (e.seat ? FLAG_SEATED : 0) | (e.tp ? FLAG_TP : 0);
  return [e.id, Math.round(e.x * 16), Math.round(e.y * 16), dirCode(e.dir) | (poseCode(e.pose) << 2), flags, heldCode(e.held)];
}

/**
 * Aplica um delta sobre uma entidade existente (mantém `seat`, que só vai no snapshot completo;
 * `seat` é removido quando o flag SEATED some). `tp` reflete o flag do delta atual.
 */
export function unpackEntity(t: EntityDelta, into: EntityState): EntityState {
  const [, px, py, dp, flags, held] = t;
  into.x = px / 16;
  into.y = py / 16;
  into.dir = codeDir(dp);
  into.pose = codePose(dp >> 2);
  into.held = codeHeld(held);
  into.moving = (flags & FLAG_MOVING) !== 0;
  into.run = (flags & FLAG_RUN) !== 0;
  if (!(flags & FLAG_SEATED)) delete into.seat;
  if (flags & FLAG_MOVING) delete into.using;
  if (flags & FLAG_TP) into.tp = 1;
  else delete into.tp;
  return into;
}

/** Cria uma entidade nova a partir de um delta (id vem do tuple). */
export function entityFromDelta(t: EntityDelta): EntityState {
  return unpackEntity(t, { id: t[0], x: 0, y: 0, dir: 'down', pose: 'stand', held: 'none', moving: false, run: false });
}
