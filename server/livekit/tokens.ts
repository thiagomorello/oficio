// Tokens de acesso ao LiveKit (uma sala para o escritório inteiro). A tela é compartilhável em qualquer
// lugar (`world/av.ts`), então já nasce no token: liberar só via `control.ts` falhava quando a pessoa
// ainda não estava na sala do LiveKit e a permissão nunca era reenviada.
import { AccessToken, TrackSource } from 'livekit-server-sdk';
import type { ServerConfig } from '../config';
import type { LiveKitInfo } from '../../shared/protocol';

export type LiveKitConfig = ServerConfig['livekit'];

export const TOKEN_TTL = '12h';

/** Fontes que todo mundo pode publicar; reunião acrescenta as de tela. */
export const BASE_SOURCES: TrackSource[] = [TrackSource.MICROPHONE, TrackSource.CAMERA];
export const SCREEN_SOURCES: TrackSource[] = [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO];

export function liveKitConfigured(cfg: LiveKitConfig): cfg is LiveKitConfig & { url: string; apiKey: string; apiSecret: string } {
  return !!(cfg.url && cfg.apiKey && cfg.apiSecret);
}

/** Identidade do participante no LiveKit. */
export function lkIdentity(userId: number): string {
  return `u${userId}`;
}

/** Id do usuário a partir da identidade (`u12` -> 12), ou null. */
export function userIdFromIdentity(identity: string): number | null {
  const m = /^u(\d+)$/.exec(identity);
  return m ? Number(m[1]) : null;
}

export async function mintToken(cfg: LiveKitConfig, user: { id: number; displayName: string }): Promise<LiveKitInfo | null> {
  if (!liveKitConfigured(cfg)) return null;
  const at = new AccessToken(cfg.apiKey, cfg.apiSecret, { identity: lkIdentity(user.id), name: user.displayName, ttl: TOKEN_TTL });
  at.addGrant({
    roomJoin: true,
    room: cfg.room,
    canPublish: true,
    canSubscribe: true,
    canPublishData: false,
    canPublishSources: [...BASE_SOURCES, ...SCREEN_SOURCES],
  });
  return { url: cfg.url, token: await at.toJwt(), room: cfg.room };
}
