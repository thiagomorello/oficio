// Reconciliação do A/V por proximidade (WP8): dado o `av_set` do servidor, decide o que assinar na
// sala do LiveKit (banda) e quem pode assinar as minhas faixas (privacidade imposta pelo SFU).
// Escrito contra uma interface mínima (`RoomLike`) para os testes usarem uma sala falsa.
import type { ServerMsg } from '../../../shared/protocol';

export type AvSetMsg = Extract<ServerMsg, { t: 'av_set' }>;

/** Valores de `Track.Source` do livekit-client (strings estáveis do protocolo). */
export const SOURCE = {
  camera: 'camera',
  microphone: 'microphone',
  screen: 'screen_share',
  screenAudio: 'screen_share_audio',
} as const;

export interface RemotePublicationLike {
  trackSid: string;
  source: string;
  setSubscribed(subscribed: boolean): void;
}

export interface RemoteParticipantLike {
  identity: string;
  trackPublications: Map<string, RemotePublicationLike>;
  /** Volume do microfone (0..1). */
  setVolume(volume: number): void;
}

export interface ParticipantPermissionLike {
  participantIdentity: string;
  allowAll: boolean;
}

export interface LocalParticipantLike {
  setTrackSubscriptionPermissions(allParticipantsAllowed: boolean, permissions?: ParticipantPermissionLike[]): void;
}

export interface RoomLike {
  remoteParticipants: Map<string, RemoteParticipantLike>;
  localParticipant: LocalParticipantLike;
}

/** Identidade do participante no LiveKit (`u12`), igual a `server/livekit/tokens.ts`. */
export function lkIdentity(userId: number): string {
  return `u${userId}`;
}

/** `u12` -> 12; qualquer outra coisa -> null. */
export function userIdFromIdentity(identity: string): number | null {
  const m = /^u(\d+)$/.exec(identity);
  return m ? Number(m[1]) : null;
}

export function isScreenSource(source: string): boolean {
  return source === SOURCE.screen || source === SOURCE.screenAudio;
}

/** A faixa deve estar assinada? Tela só quando o servidor libera (mesma sala de reunião). */
export function wantsTrack(av: AvSetMsg | null, userId: number, source: string): boolean {
  if (!av || !av.hear.includes(userId)) return false;
  return isScreenSource(source) ? av.screenAllowed : true;
}

export function clampVolume(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
}

/**
 * Guarda o último estado aplicado para só chamar o SDK nas diferenças (cada `setSubscribed` vira
 * sinalização com o SFU). `masterVolume` multiplica o volume por distância.
 */
export class SubscriptionReconciler {
  private subscribed = new Map<string, boolean>();
  private volumes = new Map<string, number>();
  private permKey: string | null = null;

  constructor(private readonly opts: { selfId: () => number | null; masterVolume?: () => number } = { selfId: () => null }) {}

  /** Assinaturas + volumes das faixas remotas. */
  reconcile(room: RoomLike, av: AvSetMsg | null): void {
    const self = this.opts.selfId();
    const master = clampVolume(this.opts.masterVolume?.() ?? 1);
    const seen = new Set<string>();
    for (const p of room.remoteParticipants.values()) {
      const id = userIdFromIdentity(p.identity);
      for (const pub of p.trackPublications.values()) {
        const key = `${p.identity}/${pub.trackSid}`;
        seen.add(key);
        const want = id !== null && id !== self && wantsTrack(av, id, pub.source);
        if (this.subscribed.get(key) !== want) {
          this.subscribed.set(key, want);
          pub.setSubscribed(want);
        }
      }
      if (id === null) continue;
      const vol = clampVolume((av?.volumes[String(id)] ?? 1) * master);
      if (this.volumes.get(p.identity) !== vol) {
        this.volumes.set(p.identity, vol);
        p.setVolume(vol);
      }
    }
    for (const key of [...this.subscribed.keys()]) if (!seen.has(key)) this.subscribed.delete(key);
    for (const ident of [...this.volumes.keys()]) if (!room.remoteParticipants.has(ident)) this.volumes.delete(ident);
  }

  /**
   * Quem pode assinar as minhas faixas: exatamente `allow`. `force` reaplica mesmo sem mudança
   * (nova faixa publicada, reconexão).
   */
  applyPermissions(room: RoomLike, av: AvSetMsg | null, force = false): void {
    const self = this.opts.selfId();
    const allow = [...new Set(av?.allow ?? [])].filter((id) => id !== self).sort((a, b) => a - b);
    const key = allow.join(',');
    if (!force && key === this.permKey) return;
    this.permKey = key;
    room.localParticipant.setTrackSubscriptionPermissions(
      false,
      allow.map((id) => ({ participantIdentity: lkIdentity(id), allowAll: true })),
    );
  }

  /** Esquece o estado aplicado (nova sala/conexão). */
  reset(): void {
    this.subscribed.clear();
    this.volumes.clear();
    this.permKey = null;
  }
}
