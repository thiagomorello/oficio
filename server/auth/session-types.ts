// Interface mínima de sessão consumida pelo mundo/hub WebSocket (WP4). A implementação real
// (`SessionService` em session.ts, WP3) satisfaz este contrato; os testes injetam um fake.
import type { IncomingMessage } from 'node:http';
import type { Appearance, UserSettings } from '../../shared/model';

/** Usuário autenticado como a camada de sessão o devolve. */
export interface SessionUser {
  id: number;
  /** Nome do cadastro. */
  name: string;
  email: string;
  /** Nome escolhido pelo usuário (vazio/null = usa `name`). */
  displayName: string | null;
  isAdmin: boolean;
  needsPasswordChange: boolean;
  appearance: Appearance | null;
  settings: Partial<UserSettings> | null;
  roleName: string | null;
}

/** Resultado da revalidação periódica (a cada 5 min) de quem está conectado. */
export type RevalidateResult =
  | { ok: true; user: SessionUser }
  /** `disabled` = conta desativada; `auth` = sessão invalidada (senha trocada, usuário apagado...). */
  | { ok: false; reason: 'disabled' | 'auth' };

export interface SessionLike {
  /** Lê o cookie `office_session` da requisição (upgrade do WS ou HTTP). null = não autenticado. */
  userFromRequest(req: IncomingMessage): SessionUser | null | Promise<SessionUser | null>;
  /** Confere de novo, pelo banco, se o usuário continua ativo e com a sessão válida. */
  revalidate(userId: number): RevalidateResult | Promise<RevalidateResult>;
}
