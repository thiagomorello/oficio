// Tipos de linha do banco (já convertidos: booleans reais, JSON parseado, Date em UTC).
import type { Appearance, UserSettings } from '../../shared/model';
import type { DeskDecor } from '../../shared/desk-decor';

export type AccountStatus = 'active' | 'disabled';

export interface UserRow {
  id: number;
  /** Identificador no sistema de origem, quando a conta foi importada (NULL para contas locais). */
  external_id: string | null;
  email: string;
  name: string;
  display_name: string | null;
  password_hash: string;
  password_version: number;
  must_change_password: boolean;
  role_name: string | null;
  is_admin: boolean;
  status: AccountStatus;
  appearance: Appearance | null;
  settings: Partial<UserSettings> | null;
  last_seen_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** Linha de importação já mapeada (ver server/import/core.ts). */
export interface ImportRow {
  external_id: string;
  name: string;
  email: string;
  password_hash: string;
  role_name: string | null;
  is_admin: boolean;
}

export type TokenKind = 'reset' | 'invite';

export interface TokenRow {
  id: number;
  user_id: number;
  kind: TokenKind;
  token_hash: string;
  expires_at: Date;
  used_at: Date | null;
  created_at: Date;
}

export interface DeskRow {
  desk_id: string;
  user_id: number;
  decor: DeskDecor | null;
  claimed_at: Date;
}

export type ChatScope = 'global' | 'room' | 'near';

export interface ChatRow {
  id: number;
  scope: ChatScope;
  zone_id: string | null;
  user_id: number;
  name: string;
  text: string;
  created_at: Date;
}

export interface SessionLogRow {
  id: number;
  user_id: number;
  opened_at: Date;
  closed_at: Date | null;
  ip: string | null;
}

export type MapKind = 'draft' | 'version';

export interface MapRow {
  id: number;
  kind: MapKind;
  name: string;
  /** OfficeMapDoc (tipado em shared/map/doc.ts, WP1); o banco só guarda o JSON. */
  doc: unknown;
  doc_schema: number;
  parent_id: number | null;
  created_by: number | null;
  created_at: Date;
  updated_at: Date;
  published_at: Date | null;
  stats: Record<string, unknown> | null;
}

/** Linha de listagem (sem o doc). */
export type MapListRow = Omit<MapRow, 'doc'>;
