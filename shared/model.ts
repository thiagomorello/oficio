// Modelo de domínio compartilhado entre servidor e cliente (usuários, entidades, chat, zonas, mesas).
// Sem dependências de código do cliente.
import type { Locale } from './branding';
import type { DeskDecor } from './desk-decor';

import type { Dir, Pose, HeldItem, HairStyle, TopStyle, Accessory, Appearance } from './map/furniture';
export type { Dir, Pose, HeldItem, HairStyle, TopStyle, Accessory, Appearance };

export type { DeskDecor };

/** Estado de presença escolhido pelo usuário (ou `away` automático após 5 min sem input). */
export type UserStatus = 'available' | 'busy' | 'away' | 'dnd';
export const USER_STATUSES: readonly UserStatus[] = ['available', 'busy', 'away', 'dnd'];

/** Emotes (poses temporárias). Cooldown de 1,5 s no servidor. */
export type Emote = 'raise_hand' | 'cheer' | 'laugh' | 'stretch' | 'sulk' | 'talk';
export const EMOTES: readonly Emote[] = ['raise_hand', 'cheer', 'laugh', 'stretch', 'sulk', 'talk'];

export const DIRS = ['down', 'up', 'left', 'right'] as const satisfies readonly Dir[];

/** Ordem fixa: o índice é o código de rede da pose. Só acrescente ao final. */
export const POSE_CODES = [
  'stand', 'walk', 'run', 'sit', 'type', 'sleep', 'drink', 'use', 'raise_hand', 'talk', 'stretch',
  'read', 'play', 'wait', 'cheer', 'laugh', 'game', 'rps', 'groom', 'sulk',
] as const satisfies readonly Pose[];

/** Ordem fixa dos itens segurados (índice = código de rede). */
export const HELD_CODES = [
  'none', 'coffee', 'water', 'papers', 'laptop', 'book', 'box', 'paddle', 'popcorn',
  'controller', 'rock', 'paper', 'scissors', 'phone', 'lipstick', 'comb',
] as const satisfies readonly HeldItem[];

export interface UserPublic {
  id: number;
  /** Nome exibido (display_name ou nome do cadastro). */
  name: string;
  role: string | null;
  appearance: Appearance | null;
  status: UserStatus;
  /** (Aditivo, WP8) Estado de áudio/vídeo; ausente = ainda não entrou no A/V (vai em `welcome.users` e `join`). */
  media?: MediaFlags;
}

/** (Aditivo, WP8) Microfone, câmera, compartilhamento de tela e indicador de fala de um usuário. */
export interface MediaFlags {
  mic: boolean;
  cam: boolean;
  screen: boolean;
  speaking: boolean;
}

export interface UserSettings {
  /** Sons de notificação. */
  sounds: boolean;
  /** Mostrar nomes sobre os avatares. */
  showNames: boolean;
  /** Entrar em `away` sozinho após 5 min sem input. */
  autoAway: boolean;
  /** Volume geral do áudio dos colegas, 0..1. */
  volume: number;
  /** Mostrar o minimapa. */
  minimap: boolean;
  /** Idioma da interface escolhido pela pessoa (ausente/null = automático: navegador, depois o padrão da instância). */
  locale?: Locale | null;
}
export const DEFAULT_SETTINGS: UserSettings = { sounds: true, showNames: true, autoAway: true, volume: 1, minimap: true };


export interface UserPublicSelf extends UserPublic {
  email: string;
  isAdmin: boolean;
  mustChangePassword: boolean;
  settings: UserSettings;
}

/** Estado completo de uma entidade (posição em tiles, múltiplos de 1/16). */
export interface EntityState {
  id: number;
  x: number;
  y: number;
  dir: Dir;
  pose: Pose;
  held: HeldItem;
  /** Andando/correndo no momento. */
  moving: boolean;
  run: boolean;
  /** Id do spot onde está sentado, se houver. */
  seat?: string;
  /** (Aditivo) Id do spot de uso (café, pia, arcade...) em que está, se houver. */
  using?: string;
  /** Teleporte: o cliente zera interpolação/predição. */
  tp?: 1;
}

/** [id, x*16, y*16, dir | pose<<2, flags, heldCode] */
export type EntityDelta = [id: number, px: number, py: number, dirPose: number, flags: number, held: number];

export const FLAG_MOVING = 1;
export const FLAG_RUN = 2;
export const FLAG_SEATED = 4;
export const FLAG_TP = 8;

export interface ChatMessage {
  id: number;
  scope: 'global' | 'room' | 'near';
  /** Zona da sala quando `scope === 'room'`. */
  zone: string | null;
  from: number;
  name: string;
  text: string;
  /** epoch ms */
  ts: number;
}

export interface ZoneState {
  id: string;
  locked: boolean;
  /** Ids dos usuários dentro da zona. */
  members: number[];
}

export interface DeskState {
  id: string;
  userId: number | null;
  decor: DeskDecor | null;
}
