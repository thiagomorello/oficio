import type { Db } from '../pool';
import { createMysqlChatRepo, type ChatRepo } from './chat';
import { createMysqlDesksRepo, type DesksRepo } from './desks';
import { createMysqlMapsRepo, type MapsRepo } from './maps';
import { createMysqlSessionsLogRepo, type SessionsLogRepo } from './sessions';
import { createMysqlSettingsRepo, type SettingsRepo } from './settings';
import { createMysqlTokensRepo, type TokensRepo } from './tokens';
import { createMysqlTelemetryRepo, type TelemetryRepo } from './telemetry';
import { createMysqlUsersRepo, type UsersRepo } from './users';

export type { ChatRepo, DesksRepo, MapsRepo, SessionsLogRepo, SettingsRepo, TelemetryRepo, TokensRepo, UsersRepo };
export type { NewTelemetryEvent, TelemetryEventRow, TelemetryQuery, TelemetrySummaryRow } from './telemetry';
export type { NewChatMessage } from './chat';
export type { ClaimResult } from './desks';
export type { SaveDraftResult } from './maps';
export type { CreateLocalUser, UserListQuery, UserPatch } from './users';
export { SETTING_PUBLISHED_MAP_ID } from './settings';

export interface Repos {
  users: UsersRepo;
  tokens: TokensRepo;
  desks: DesksRepo;
  chat: ChatRepo;
  sessions: SessionsLogRepo;
  maps: MapsRepo;
  settings: SettingsRepo;
  telemetry: TelemetryRepo;
}

export function createMysqlRepos(db: Db): Repos {
  return {
    users: createMysqlUsersRepo(db),
    tokens: createMysqlTokensRepo(db),
    desks: createMysqlDesksRepo(db),
    chat: createMysqlChatRepo(db),
    sessions: createMysqlSessionsLogRepo(db),
    maps: createMysqlMapsRepo(db),
    settings: createMysqlSettingsRepo(db),
    telemetry: createMysqlTelemetryRepo(db),
  };
}
