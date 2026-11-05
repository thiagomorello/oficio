// Tipos comuns dos módulos de rotas (/api/*). Cada módulo devolve `true` quando tratou a requisição.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DeskDecor } from '../../shared/desk-decor';
import type { Appearance } from '../../shared/model';
import type { Mailer } from '../auth/mailer';
import type { SessionService } from '../auth/session';
import type { ServerConfig } from '../config';
import type { Repos } from '../db/repos/index';
import type { ReqTranslator } from '../i18n';

/** `tr` é o tradutor do idioma da requisição (app-factory resolve uma vez por requisição). */
export type RouteHandler = (req: IncomingMessage, res: ServerResponse, url: URL, tr: ReqTranslator) => Promise<boolean>;

/** Ganchos que outros pacotes (hub WebSocket) preenchem depois que o app sobe. */
export interface AppHooks {
  onAppearanceChanged?: (userId: number, appearance: Appearance, displayName: string) => void;
  /** Conta desativada por um admin: o escritório derruba as conexões do usuário. */
  onUserDisabled?: (userId: number) => void;
  /** Mesa liberada por um admin: o escritório atualiza o mapa. */
  onDeskReleased?: (deskId: string, userId: number) => void;
  /** Decoração da mesa do usuário alterada (null = limpa): o escritório avisa todo mundo. */
  onDeskDecor?: (deskId: string, userId: number, decor: DeskDecor | null) => void;
  /** Pessoas conectadas agora (estatísticas do admin). */
  onlineCount?: () => number;
  /** Ids conectados agora (painel de telemetria). */
  onlineUserIds?: () => number[];
  /** Login local bem-sucedido (contador `office_logins_total` do /metrics). */
  onLogin?: () => void;
}

export interface RouteContext {
  config: ServerConfig;
  repos: Repos;
  session: SessionService;
  mailer: Mailer;
  hooks: AppHooks;
}
