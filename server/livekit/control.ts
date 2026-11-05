// Controle de permissões no SFU: libera/retira o compartilhamento de tela quando a pessoa entra ou
// sai de uma sala de reunião. Debounce por usuário (o último valor vence); erros só vão para o log.
import { RoomServiceClient } from 'livekit-server-sdk';
import { errMsg, log } from '../log';
import { BASE_SOURCES, SCREEN_SOURCES, lkIdentity, liveKitConfigured, type LiveKitConfig } from './tokens';

export interface ScreenControl {
  setScreenAllowed(userId: number, allowed: boolean): void;
  close(): void;
}

/** Subconjunto do RoomServiceClient usado aqui (injetável nos testes). */
export interface RoomServiceLike {
  updateParticipant(room: string, identity: string, metadata?: string, permission?: Record<string, unknown>): Promise<unknown>;
}

export const SCREEN_DEBOUNCE_MS = 400;

/** `wss://host` -> `https://host`, `ws://` -> `http://` (a API do RoomService é HTTP/Twirp). */
export function httpUrl(url: string): string {
  return url.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:');
}

export function createScreenControl(cfg: LiveKitConfig, client?: RoomServiceLike, debounceMs = SCREEN_DEBOUNCE_MS): ScreenControl | null {
  if (!liveKitConfigured(cfg) && !client) return null;
  const svc: RoomServiceLike =
    client ?? (new RoomServiceClient(httpUrl(cfg.internalUrl ?? cfg.url!), cfg.apiKey, cfg.apiSecret) as unknown as RoomServiceLike);
  const timers = new Map<number, { timer: NodeJS.Timeout; allowed: boolean }>();
  const flush = (userId: number, allowed: boolean): void => {
    const sources = allowed ? [...BASE_SOURCES, ...SCREEN_SOURCES] : [...BASE_SOURCES];
    // A permissão enviada substitui a inteira: repete os demais campos do token.
    svc
      .updateParticipant(cfg.room, lkIdentity(userId), undefined, { canPublish: true, canSubscribe: true, canPublishData: false, canPublishSources: sources })
      .catch((err: unknown) => {
        const m = errMsg(err);
        // Fora da sala do LiveKit (sem áudio/vídeo ligado) não é erro.
        if (/not found|not_found|404/i.test(m)) return;
        log.warn(`LiveKit: failed to update permissions of ${lkIdentity(userId)}: ${m}`);
      });
  };
  return {
    setScreenAllowed(userId, allowed) {
      const cur = timers.get(userId);
      if (cur) clearTimeout(cur.timer);
      const timer = setTimeout(() => {
        timers.delete(userId);
        flush(userId, allowed);
      }, debounceMs);
      timer.unref?.();
      timers.set(userId, { timer, allowed });
    },
    close() {
      for (const t of timers.values()) clearTimeout(t.timer);
      timers.clear();
    },
  };
}
