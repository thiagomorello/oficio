// Lógica pura do chat (sem DOM): escopos disponíveis, contagem de não lidas e anel de mensagens.
import type { ChatScope } from '../../../shared/protocol';
import type { ChatMessage, ZoneState } from '../../../shared/model';
import { t, type MessageKey } from '../i18n';

export const CHAT_VISIBLE_MAX = 300;
export const CHAT_TEXT_MAX = 1000;

/** Abas do chat, na ordem de exibição. */
export const CHAT_TABS: readonly ChatScope[] = ['global', 'room', 'near'];
const SCOPE_KEY: Record<ChatScope, MessageKey> = { global: 'shell.chat.scope.global', room: 'shell.chat.scope.room', near: 'shell.chat.scope.near' };

/** Rótulo da aba/selo de um escopo, no idioma atual. */
export function scopeLabel(scope: ChatScope): string {
  return t(SCOPE_KEY[scope]);
}

/** Zona em que o usuário está (pelos membros das zonas), ou null. */
export function zoneOfUser(zones: Iterable<ZoneState>, userId: number | null): string | null {
  if (userId === null) return null;
  for (const z of zones) if (z.members.includes(userId)) return z.id;
  return null;
}

export interface ScopeAvailability {
  enabled: boolean;
  label: string;
}

/** A aba "Sala" só existe dentro de uma zona (o rótulo traz o nome dela). */
export function scopeAvailability(scope: ChatScope, zoneId: string | null, zoneName: (id: string) => string | undefined): ScopeAvailability {
  if (scope !== 'room') return { enabled: true, label: scopeLabel(scope) };
  if (!zoneId) return { enabled: false, label: scopeLabel('room') };
  return { enabled: true, label: zoneName(zoneId) ?? scopeLabel('room') };
}

/** Se a aba ativa ficou indisponível (saiu da sala), volta para a Geral. */
export function resolveActiveScope(active: ChatScope, zoneId: string | null): ChatScope {
  return active === 'room' && !zoneId ? 'global' : active;
}

/** Mensagens de outras pessoas depois da última vista (por id crescente). */
export function countUnread(messages: readonly ChatMessage[], lastSeenId: number, selfId: number | null): number {
  let n = 0;
  for (const m of messages) if (m.id > lastSeenId && m.from !== selfId) n++;
  return n;
}

/** Id da última mensagem (0 sem mensagens). */
export function lastMessageId(messages: readonly ChatMessage[]): number {
  return messages.length ? messages[messages.length - 1].id : 0;
}

/** Mensagens que a aba mostra: Geral/Perto por escopo; Sala só da zona atual. */
export function messagesFor(messages: readonly ChatMessage[], scope: ChatScope, zoneId: string | null, max = CHAT_VISIBLE_MAX): ChatMessage[] {
  const out = messages.filter((m) => m.scope === scope && (scope !== 'room' || m.zone === zoneId));
  return out.length > max ? out.slice(out.length - max) : out;
}

/** Texto pronto para enviar (aparado e limitado), ou null se vazio. */
export function prepareChatText(raw: string): string | null {
  const t = raw.trim();
  return t ? t.slice(0, CHAT_TEXT_MAX) : null;
}

/** Texto do selo de não lidas no botão da barra. */
export function badgeText(n: number): string {
  return n <= 0 ? '' : n > 99 ? '99+' : String(n);
}
