// Qual som toca para qual evento (puro, sem DOM): testado em node.
import type { ChatMessage } from '../../../shared/model';
import type { SoundKind } from '../audio/scheduler';
import { tn } from '../i18n';

export type CueEvent =
  | { t: 'chat'; scope: ChatMessage['scope']; from: number }
  | { t: 'knock' }
  | { t: 'knock_result'; allow: boolean }
  /** Alguém entrou no meu conjunto de proximidade/áudio. */
  | { t: 'near_join' }
  | { t: 'kick' }
  | { t: 'disconnect' };

export interface CueContext {
  selfId: number | null;
  /** Preferência `sounds` do usuário (padrão ligado). */
  enabled: boolean;
}

/** Som do evento, ou null (sons desligados, mensagem minha). */
export function cueFor(ev: CueEvent, ctx: CueContext): SoundKind | null {
  if (!ctx.enabled) return null;
  switch (ev.t) {
    case 'chat':
      if (ctx.selfId !== null && ev.from === ctx.selfId) return null;
      return ev.scope === 'near' ? 'pop' : 'note';
    case 'knock':
      return 'chime';
    case 'knock_result':
      return ev.allow ? 'note' : 'low';
    case 'near_join':
      return 'pop';
    case 'kick':
    case 'disconnect':
      return 'low';
  }
}

/** Ids novos em `next` que não estavam em `prev` (sem contar `self`). */
export function newlyHeard(prev: readonly number[] | null, next: readonly number[], self: number | null): number[] {
  if (prev === null) return [];
  const had = new Set(prev);
  return next.filter((id) => id !== self && !had.has(id));
}

/** Título da aba com o aviso de mensagens não lidas. */
export function flashTitle(base: string, unread: number): string {
  if (unread <= 0) return base;
  return tn('shell.title.unread', unread, { base });
}
