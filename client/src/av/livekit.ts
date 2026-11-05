// Áudio e vídeo por proximidade (WP8): uma sala do LiveKit para o escritório inteiro, sem assinatura
// automática. O servidor diz quem eu ouço (`av_set`); aqui só aplicamos (subscriptions.ts), ligamos
// microfone/câmera/tela, avisamos o servidor do nosso estado (`media`) e alimentamos o indicador de fala.
import {
  DisconnectReason,
  MediaDeviceFailure,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RoomOptions,
} from 'livekit-client';
import type { ClientMsg, LiveKitInfo } from '../../../shared/protocol';
import { t, type MessageKey } from '../i18n';
import { applySavedDevices, loadDevicePrefs, saveDevicePref, type AvDeviceKind } from './devices';
import { SubscriptionReconciler, lkIdentity, userIdFromIdentity, type AvSetMsg, type RoomLike } from './subscriptions';

export const ROOM_OPTIONS: RoomOptions = {
  adaptiveStream: true,
  dynacast: true,
  audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  videoCaptureDefaults: { resolution: VideoPresets.h360.resolution },
  publishDefaults: { simulcast: true },
};

/** Intervalo mínimo entre envios de `media` que só mudam a fala (o servidor aplica o mesmo limite). */
export const SPEAKING_SEND_MS = 300;
export const RETRY_MIN_MS = 2_000;
export const RETRY_MAX_MS = 30_000;

export interface MediaSettings {
  /** Microfone ligado ao entrar (padrão: sim). */
  micOnJoin?: boolean;
  /** Câmera ligada ao entrar (padrão: não). */
  camOnJoin?: boolean;
  /** Volume geral dos colegas, 0..1 (multiplica o volume por distância). */
  volume?: number;
}

export type MediaStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'left' | 'unavailable';

export interface LocalMediaState {
  status: MediaStatus;
  mic: boolean;
  cam: boolean;
  screen: boolean;
  speaking: boolean;
  /** O navegador negou a permissão (ou não há dispositivo). */
  micBlocked: boolean;
  camBlocked: boolean;
  /** Na mesma sala de reunião: pode compartilhar a tela. */
  screenAllowed: boolean;
  /** Autoplay bloqueado: precisa de um clique para tocar o áudio dos colegas. */
  audioLocked: boolean;
}

export type NoticeLevel = 'info' | 'warn' | 'alert';

/** Parte do store usada aqui. */
export interface MediaStoreLike {
  readonly selfId: number | null;
  avSet: AvSetMsg | null;
  setSpeaking(id: number, on: boolean): void;
}

export interface MediaManagerOptions {
  send: (msg: ClientMsg) => void;
  store: MediaStoreLike;
  settings?: () => MediaSettings;
  notify?: (level: NoticeLevel, text: string) => void;
  /** Token novo (`GET /api/livekit/token`) para reconectar; null = LiveKit desligado no servidor. */
  fetchToken?: () => Promise<LiveKitInfo | null>;
  createRoom?: (options: RoomOptions) => Room;
  /** Onde ficam os <audio> dos colegas (padrão: um contêiner oculto no <body>). */
  audioHost?: () => HTMLElement | null;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => () => void;
}

export interface MediaEvents {
  /** Estado local mudou (botões, status). */
  change: LocalMediaState;
  /** Faixas de vídeo apareceram/sumiram (tiles). */
  tracks: void;
  /** Sala conectada ou dispositivo trocado (seletores de dispositivo). */
  devices: void;
  /** Falha de A/V (telemetria): onde e a mensagem. */
  error: { where: string; message: string; name?: string };
}

const errInfo = (where: string, err: unknown): MediaEvents['error'] => ({
  where,
  message: err instanceof Error ? err.message : String(err),
  ...(err instanceof Error && err.name ? { name: err.name } : {}),
});

type Listener<T> = (v: T) => void;
type Kind = 'mic' | 'cam' | 'screen';

/** Nome do dispositivo em frases ("o microfone"), no idioma atual. */
const KIND_KEYS: Record<Kind, MessageKey> = { mic: 'av.kind.mic', cam: 'av.kind.cam', screen: 'av.kind.screen' };

export function retryDelay(attempt: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** Math.max(0, attempt));
}

export async function fetchLiveKitToken(): Promise<LiveKitInfo | null> {
  const res = await fetch('/api/livekit/token', { credentials: 'same-origin', headers: { accept: 'application/json' } });
  if (res.status === 404 || res.status === 503) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as Partial<LiveKitInfo> | null;
  return body && typeof body.url === 'string' && typeof body.token === 'string' ? (body as LiveKitInfo) : null;
}

/**
 * Mensagem (no idioma atual) para uma falha ao ligar um dispositivo (null = cancelado pelo usuário, sem aviso).
 * `generic` marca a falha sem causa conhecida (a troca de dispositivo usa outra frase nesse caso).
 */
export function deviceErrorText(kind: Kind, err: unknown): { text: string; blocked: boolean; generic?: boolean } | null {
  const failure = MediaDeviceFailure.getFailure(err);
  const name = err instanceof Error ? err.name : '';
  if (kind === 'screen') {
    if (name === 'NotAllowedError' || name === 'AbortError') return null;
    return { text: t('av.error.screen'), blocked: false };
  }
  const what = t(KIND_KEYS[kind]);
  switch (failure) {
    case MediaDeviceFailure.PermissionDenied:
      return { text: t('av.error.blocked', { what }), blocked: true };
    case MediaDeviceFailure.NotFound:
      return { text: kind === 'mic' ? t('av.error.noMic') : t('av.error.noCam'), blocked: true };
    case MediaDeviceFailure.DeviceInUse:
      return { text: t('av.error.inUse', { what }), blocked: false };
    default:
      return { text: t('av.error.enable', { what }), blocked: false, generic: true };
  }
}

export class MediaManager {
  room: Room | null = null;
  readonly state: LocalMediaState = {
    status: 'idle',
    mic: false,
    cam: false,
    screen: false,
    speaking: false,
    micBlocked: false,
    camBlocked: false,
    screenAllowed: false,
    audioLocked: false,
  };
  private info: LiveKitInfo | null = null;
  /** O que a pessoa quer (vale para a próxima conexão também). */
  private desired: { mic: boolean; cam: boolean };
  private readonly reconciler: SubscriptionReconciler;
  private readonly listeners = new Map<keyof MediaEvents, Set<Listener<never>>>();
  private attempt = 0;
  private cancelRetry: (() => void) | null = null;
  private cancelSpeaking: (() => void) | null = null;
  private sent: { mic: boolean; cam: boolean; screen: boolean; speaking: boolean } | null = null;
  private sentAt = -Infinity;
  /** Ids que o LiveKit marcou como falando (para desmarcar só os nossos). */
  private lkSpeaking = new Set<number>();
  private audioEls = new Map<string, HTMLMediaElement[]>();
  private ownAudioHost: HTMLElement | null = null;
  private unbindRoom: (() => void) | null = null;
  private gestureArmed = false;
  private destroyed = false;
  private readonly opts: Required<Omit<MediaManagerOptions, 'audioHost'>> & Pick<MediaManagerOptions, 'audioHost'>;

  constructor(opts: MediaManagerOptions) {
    this.opts = {
      settings: () => ({}),
      notify: () => undefined,
      fetchToken: fetchLiveKitToken,
      createRoom: (o) => new Room(o),
      now: () => Date.now(),
      schedule: (fn, ms) => {
        const t = setTimeout(fn, ms);
        return () => clearTimeout(t);
      },
      ...opts,
    };
    const s = this.opts.settings();
    this.desired = { mic: s.micOnJoin ?? true, cam: s.camOnJoin ?? false };
    this.reconciler = new SubscriptionReconciler({
      selfId: () => this.opts.store.selfId,
      masterVolume: () => this.opts.settings().volume ?? 1,
    });
  }

  // ---------------------------------------------------------------- eventos

  on<K extends keyof MediaEvents>(ev: K, cb: Listener<MediaEvents[K]>): () => void {
    let set = this.listeners.get(ev);
    if (!set) this.listeners.set(ev, (set = new Set()));
    set.add(cb as Listener<never>);
    return () => void set!.delete(cb as Listener<never>);
  }

  private emit<K extends keyof MediaEvents>(ev: K, v: MediaEvents[K]): void {
    const set = this.listeners.get(ev);
    if (!set) return;
    for (const cb of [...set]) {
      try {
        (cb as Listener<MediaEvents[K]>)(v);
      } catch (err) {
        console.error(`[av] erro no ouvinte de ${String(ev)}`, err);
      }
    }
  }

  // ---------------------------------------------------------------- conexão

  get connected(): boolean {
    return this.state.status === 'connected';
  }

  /** Lê o status sem o estreitamento do TS (muda durante os `await`). */
  private statusIs(s: MediaStatus): boolean {
    return this.state.status === s;
  }

  /** Entra na sala (credenciais do `welcome.livekit`). Chamadas repetidas só atualizam o token guardado. */
  async connect(info: LiveKitInfo): Promise<void> {
    if (this.destroyed) return;
    this.info = info;
    if (this.room || this.state.status === 'left') return;
    await this.open(info);
  }

  private async open(info: LiveKitInfo): Promise<void> {
    this.cancelRetry?.();
    this.cancelRetry = null;
    const room = this.opts.createRoom(ROOM_OPTIONS);
    this.room = room;
    this.reconciler.reset();
    this.unbindRoom?.();
    this.unbindRoom = this.bind(room);
    this.setStatus(this.attempt > 0 ? 'reconnecting' : 'connecting');
    try {
      // 45 s: quando o UDP está bloqueado, o Chrome só tenta os candidatos ICE/TCP depois que os UDP expiram.
      await room.connect(info.url, info.token, { autoSubscribe: false, peerConnectionTimeout: 45_000 });
    } catch (err) {
      if (this.room !== room) return;
      console.warn('[av] falha ao conectar no LiveKit', err);
      this.emit('error', errInfo('connect', err));
      this.dropRoom();
      this.scheduleReconnect();
      return;
    }
    if (this.room !== room || this.destroyed) {
      void room.disconnect();
      return;
    }
    this.attempt = 0;
    this.setStatus('connected');
    await applySavedDevices(room, loadDevicePrefs()).catch(() => undefined);
    // Privacidade antes de publicar: ninguém assina nada fora do `allow`.
    this.applyAv(true);
    await this.setKind('mic', this.desired.mic, false);
    await this.setKind('cam', this.desired.cam, false);
    this.updateAudioLock();
    this.emit('devices', undefined);
    this.sync(true);
  }

  private bind(room: Room): () => void {
    const handlers: [RoomEvent, (...args: never[]) => void][] = [];
    const on = <E extends RoomEvent>(ev: E, fn: (...args: never[]) => void): void => {
      handlers.push([ev, fn]);
      (room as unknown as { on(e: string, f: (...a: never[]) => void): void }).on(ev, fn);
    };
    on(RoomEvent.ParticipantConnected, () => this.applyAv(false));
    on(RoomEvent.TrackPublished, () => this.applyAv(false));
    on(RoomEvent.TrackUnpublished, () => this.emit('tracks', undefined));
    on(RoomEvent.ParticipantDisconnected, ((p: RemoteParticipant) => {
      const id = userIdFromIdentity(p.identity);
      if (id !== null && this.lkSpeaking.delete(id)) this.opts.store.setSpeaking(id, false);
      this.applyAv(false);
      this.emit('tracks', undefined);
    }) as (...args: never[]) => void);
    on(RoomEvent.TrackSubscribed, ((track: RemoteTrack, pub: RemoteTrackPublication, p: RemoteParticipant) => {
      if (track.kind === Track.Kind.Audio) this.attachAudio(track, pub, p);
      this.emit('tracks', undefined);
    }) as (...args: never[]) => void);
    on(RoomEvent.TrackUnsubscribed, ((track: RemoteTrack, pub: RemoteTrackPublication) => {
      if (track.kind === Track.Kind.Audio) this.detachAudio(track, pub);
      this.emit('tracks', undefined);
    }) as (...args: never[]) => void);
    on(RoomEvent.TrackMuted, () => {
      this.sync();
      this.emit('tracks', undefined);
    });
    on(RoomEvent.TrackUnmuted, () => {
      this.sync();
      this.emit('tracks', undefined);
    });
    on(RoomEvent.LocalTrackPublished, () => {
      // Faixa nova: reaplica as permissões (o SFU avalia por faixa).
      this.applyAv(true);
      this.sync();
      this.emit('tracks', undefined);
    });
    on(RoomEvent.LocalTrackUnpublished, () => {
      // Inclui "Parar de compartilhar" na barra do navegador.
      this.sync();
      this.emit('tracks', undefined);
    });
    on(RoomEvent.ActiveSpeakersChanged, ((speakers: Participant[]) => this.onSpeakers(speakers)) as (...args: never[]) => void);
    on(RoomEvent.AudioPlaybackStatusChanged, () => this.updateAudioLock());
    on(RoomEvent.Reconnecting, () => this.setStatus('reconnecting'));
    on(RoomEvent.Reconnected, () => {
      this.setStatus('connected');
      this.applyAv(true);
      this.sync(true);
    });
    on(RoomEvent.ActiveDeviceChanged, () => this.emit('devices', undefined));
    on(RoomEvent.MediaDevicesChanged, () => this.emit('devices', undefined));
    on(RoomEvent.Disconnected, ((reason?: DisconnectReason) => this.onDisconnected(room, reason)) as (...args: never[]) => void);
    return () => {
      for (const [ev, fn] of handlers) (room as unknown as { off(e: string, f: (...a: never[]) => void): void }).off(ev, fn);
    };
  }

  private onDisconnected(room: Room, reason?: DisconnectReason): void {
    if (this.room !== room) return;
    this.dropRoom();
    if (reason === DisconnectReason.CLIENT_INITIATED || this.destroyed) return;
    this.emit('error', { where: 'disconnected', message: `reason=${String(reason)}` });
    if (reason === DisconnectReason.DUPLICATE_IDENTITY) {
      this.setStatus('left');
      this.opts.notify('warn', t('av.error.duplicate'));
      return;
    }
    this.scheduleReconnect();
  }

  /** Esquece a sala atual (sem reconectar). */
  private dropRoom(): void {
    this.unbindRoom?.();
    this.unbindRoom = null;
    this.room = null;
    this.reconciler.reset();
    for (const els of this.audioEls.values()) for (const el of els) el.remove();
    this.audioEls.clear();
    for (const id of this.lkSpeaking) this.opts.store.setSpeaking(id, false);
    this.lkSpeaking.clear();
    this.cancelSpeaking?.();
    this.cancelSpeaking = null;
    this.state.speaking = false;
    this.sync();
    this.emit('tracks', undefined);
  }

  /** Reconecta com backoff e token novo (o do `welcome` pode ter expirado). */
  private scheduleReconnect(): void {
    if (this.destroyed || this.cancelRetry) return;
    this.setStatus('reconnecting');
    const delay = retryDelay(this.attempt++);
    this.cancelRetry = this.opts.schedule(() => {
      this.cancelRetry = null;
      void this.reconnectNow();
    }, delay);
  }

  private async reconnectNow(): Promise<void> {
    if (this.destroyed || this.room || this.state.status === 'left') return;
    let info: LiveKitInfo | null;
    try {
      info = await this.opts.fetchToken();
    } catch (err) {
      console.warn('[av] falha ao renovar o token do LiveKit', err);
      this.emit('error', errInfo('token', err));
      this.scheduleReconnect();
      return;
    }
    if (!info) {
      this.setStatus('unavailable');
      return;
    }
    this.info = info;
    if (this.room || this.statusIs('left') || this.destroyed) return;
    await this.open(info);
  }

  /** Sai da sala (página fechando, `kick`, destroy). */
  async disconnect(): Promise<void> {
    this.cancelRetry?.();
    this.cancelRetry = null;
    const room = this.room;
    if (room) {
      this.dropRoom();
      await room.disconnect().catch(() => undefined);
    }
    if (this.state.status !== 'left' && this.state.status !== 'unavailable') this.setStatus('idle');
  }

  /** "Sair do áudio": desconecta e não volta sozinho. */
  async leave(): Promise<void> {
    this.setStatus('left');
    await this.disconnect();
    this.setStatus('left');
  }

  /** Volta para o áudio depois de `leave()` (ou de uma aba duplicada). */
  async rejoin(): Promise<void> {
    if (this.destroyed || this.room) return;
    this.setStatus('idle');
    this.attempt = 0;
    let info = this.info;
    try {
      info = (await this.opts.fetchToken()) ?? null;
    } catch {
      // usa o token que já temos
    }
    if (!info) {
      this.setStatus('unavailable');
      return;
    }
    this.info = info;
    await this.open(info);
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    await this.disconnect();
    this.disarmGesture();
    this.ownAudioHost?.remove();
    this.ownAudioHost = null;
    this.listeners.clear();
  }

  // ---------------------------------------------------------------- av_set

  /** Novo `av_set` do servidor (ou só reaplica o último). */
  setAvSet(av: AvSetMsg | null): void {
    if (av) {
      this.opts.store.avSet = av;
      if (this.state.screenAllowed !== av.screenAllowed) {
        this.state.screenAllowed = av.screenAllowed;
        if (!av.screenAllowed && this.state.screen) void this.setKind('screen', false);
        this.emit('change', this.snapshot());
      }
    }
    this.applyAv(false);
  }

  private applyAv(forcePermissions: boolean): void {
    const room = this.room;
    if (!room || this.state.status !== 'connected') return;
    const av = this.opts.store.avSet;
    const like = room as unknown as RoomLike;
    try {
      this.reconciler.applyPermissions(like, av, forcePermissions);
      this.reconciler.reconcile(like, av);
    } catch (err) {
      console.warn('[av] falha ao aplicar o conjunto audível', err);
      this.emit('error', errInfo('subscriptions', err));
    }
  }

  /** Volume geral mudou nas configurações. */
  refreshVolumes(): void {
    this.reconciler.reset();
    this.applyAv(true);
  }

  // ---------------------------------------------------------------- botões

  async toggleMic(): Promise<void> {
    this.desired.mic = !this.state.mic;
    await this.setKind('mic', this.desired.mic);
  }

  async toggleCam(): Promise<void> {
    this.desired.cam = !this.state.cam;
    await this.setKind('cam', this.desired.cam);
  }

  async toggleScreen(): Promise<void> {
    if (!this.state.screen && !this.state.screenAllowed) {
      this.opts.notify('info', t('av.screen.onlyMeetingNotice'));
      return;
    }
    await this.setKind('screen', !this.state.screen);
  }

  private async setKind(kind: Kind, on: boolean, notify = true): Promise<void> {
    const room = this.room;
    if (!room || this.state.status !== 'connected') {
      // Sem sala: fica como intenção (`desired`) para a próxima conexão.
      this.emit('change', this.snapshot());
      return;
    }
    const lp = room.localParticipant;
    try {
      if (kind === 'mic') await lp.setMicrophoneEnabled(on);
      else if (kind === 'cam') await lp.setCameraEnabled(on);
      else await lp.setScreenShareEnabled(on, { audio: true });
      if (on && kind === 'mic') this.state.micBlocked = false;
      if (on && kind === 'cam') this.state.camBlocked = false;
    } catch (err) {
      const e = deviceErrorText(kind, err);
      if (e?.blocked && kind === 'mic') this.state.micBlocked = true;
      if (e?.blocked && kind === 'cam') this.state.camBlocked = true;
      if (kind === 'mic') this.desired.mic = false;
      if (kind === 'cam') this.desired.cam = false;
      if (e) {
        console.warn(`[av] falha ao ligar ${kind}`, err);
        this.emit('error', errInfo(kind, err));
        if (notify || e.blocked) this.opts.notify('warn', e.text);
      }
    }
    this.sync();
    this.emit('tracks', undefined);
  }

  // ---------------------------------------------------------------- dispositivos

  /** Troca em andamento: o seletor mostra a escolha até o LiveKit confirmar o aparelho novo. */
  private pendingDevices = new Map<AvDeviceKind, string>();

  activeDevice(kind: AvDeviceKind): string | undefined {
    return this.pendingDevices.get(kind) ?? this.room?.getActiveDevice(kind) ?? loadDevicePrefs()[kind];
  }

  async switchDevice(kind: AvDeviceKind, deviceId: string): Promise<boolean> {
    const room = this.room;
    if (!room) {
      saveDevicePref(kind, deviceId);
      return true;
    }
    const prev = room.getActiveDevice(kind);
    this.pendingDevices.set(kind, deviceId);
    try {
      // `exact`: com restrição "ideal" o navegador caía em silêncio no aparelho anterior (Jabra em uso
      // por outro app → continuava na webcam) e o seletor voltava sozinho, sem aviso.
      const ok = await room.switchActiveDevice(kind, deviceId, kind !== 'audiooutput' ? true : undefined);
      if (ok) saveDevicePref(kind, deviceId);
      return ok;
    } catch (err) {
      console.warn('[av] falha ao trocar o dispositivo', err);
      this.emit('error', errInfo('switch_device', err));
      const k: Kind | null = kind === 'audioinput' ? 'mic' : kind === 'videoinput' ? 'cam' : null;
      const e = k ? deviceErrorText(k, err) : null;
      this.opts.notify('warn', e && k ? (e.generic ? t('av.error.switchTo', { what: t(KIND_KEYS[k]) }) : e.text) : t('av.error.switchDevice'));
      // A falha acontece depois de parar a captura antiga: volta para o aparelho anterior.
      if (kind !== 'audiooutput' && prev && prev !== deviceId) {
        await room.switchActiveDevice(kind, prev, false).catch(() => undefined);
      }
      return false;
    } finally {
      this.pendingDevices.delete(kind);
      this.emit('devices', undefined);
    }
  }

  // ---------------------------------------------------------------- áudio dos colegas

  private audioHost(): HTMLElement | null {
    const custom = this.opts.audioHost?.();
    if (custom) return custom;
    if (typeof document === 'undefined') return null;
    if (!this.ownAudioHost) {
      this.ownAudioHost = document.createElement('div');
      this.ownAudioHost.className = 'av-audio-host';
      this.ownAudioHost.hidden = true;
      document.body.append(this.ownAudioHost);
    }
    return this.ownAudioHost;
  }

  private attachAudio(track: RemoteTrack, pub: RemoteTrackPublication, p: RemoteParticipant): void {
    const host = this.audioHost();
    if (!host) return;
    const el = track.attach();
    el.dataset.identity = p.identity;
    host.append(el);
    const key = pub.trackSid;
    this.audioEls.set(key, [...(this.audioEls.get(key) ?? []), el]);
    this.updateAudioLock();
  }

  private detachAudio(track: RemoteTrack, pub: RemoteTrackPublication): void {
    for (const el of track.detach()) el.remove();
    for (const el of this.audioEls.get(pub.trackSid) ?? []) el.remove();
    this.audioEls.delete(pub.trackSid);
  }

  private updateAudioLock(): void {
    const locked = !!this.room && !this.room.canPlaybackAudio;
    if (locked) this.armGesture();
    if (locked === this.state.audioLocked) return;
    this.state.audioLocked = locked;
    this.emit('change', this.snapshot());
  }

  /** Tenta liberar o áudio (precisa vir de um gesto do usuário). */
  async unlockAudio(): Promise<void> {
    const room = this.room;
    if (!room) return;
    try {
      await room.startAudio();
    } catch (err) {
      console.warn('[av] startAudio falhou', err);
      this.emit('error', errInfo('start_audio', err));
    }
    this.updateAudioLock();
  }

  private readonly onGesture = (): void => {
    this.disarmGesture();
    if (this.state.audioLocked) void this.unlockAudio();
  };

  private armGesture(): void {
    if (this.gestureArmed || typeof window === 'undefined') return;
    this.gestureArmed = true;
    window.addEventListener('pointerdown', this.onGesture, true);
    window.addEventListener('keydown', this.onGesture, true);
  }

  private disarmGesture(): void {
    if (!this.gestureArmed || typeof window === 'undefined') return;
    this.gestureArmed = false;
    window.removeEventListener('pointerdown', this.onGesture, true);
    window.removeEventListener('keydown', this.onGesture, true);
  }

  // ---------------------------------------------------------------- fala

  private onSpeakers(speakers: Participant[]): void {
    const now = new Set<number>();
    const self = this.opts.store.selfId;
    let selfSpeaking = false;
    for (const p of speakers) {
      const id = userIdFromIdentity(p.identity);
      if (id === null) continue;
      if (id === self || p === (this.room?.localParticipant as Participant | undefined)) selfSpeaking = true;
      else now.add(id);
    }
    for (const id of this.lkSpeaking) if (!now.has(id)) this.opts.store.setSpeaking(id, false);
    for (const id of now) this.opts.store.setSpeaking(id, true);
    this.lkSpeaking = now;
    this.setSelfSpeaking(selfSpeaking && this.state.mic);
  }

  private setSelfSpeaking(on: boolean): void {
    const self = this.opts.store.selfId;
    if (self !== null) this.opts.store.setSpeaking(self, on);
    if (this.state.speaking === on) return;
    this.state.speaking = on;
    this.emit('change', this.snapshot());
    this.scheduleSpeakingSend();
  }

  private scheduleSpeakingSend(): void {
    if (this.cancelSpeaking) return;
    const wait = SPEAKING_SEND_MS - (this.opts.now() - this.sentAt);
    if (wait <= 0) {
      this.send(false);
      return;
    }
    this.cancelSpeaking = this.opts.schedule(() => {
      this.cancelSpeaking = null;
      this.send(false);
    }, wait);
  }

  // ---------------------------------------------------------------- estado -> servidor

  /** Lê o estado real da sala; avisa o servidor e a UI se mudou. `force` reenvia (reconexão do WS). */
  sync(force = false): void {
    const lp = this.connected ? this.room?.localParticipant : undefined;
    const mic = !!lp?.isMicrophoneEnabled;
    const cam = !!lp?.isCameraEnabled;
    const screen = !!lp?.isScreenShareEnabled;
    const changed = mic !== this.state.mic || cam !== this.state.cam || screen !== this.state.screen;
    this.state.mic = mic;
    this.state.cam = cam;
    this.state.screen = screen;
    if (!mic && this.state.speaking) {
      this.state.speaking = false;
      const self = this.opts.store.selfId;
      if (self !== null) this.opts.store.setSpeaking(self, false);
    }
    if (changed || force) this.send(force);
    if (changed) this.emit('change', this.snapshot());
  }

  /** O servidor esquece o `media` quando o WS cai: chame no `welcome`. */
  resend(): void {
    this.sync(true);
  }

  private send(force: boolean): void {
    const m = { mic: this.state.mic, cam: this.state.cam, screen: this.state.screen, speaking: this.state.speaking };
    const s = this.sent;
    if (!force && s && s.mic === m.mic && s.cam === m.cam && s.screen === m.screen && s.speaking === m.speaking) return;
    this.sent = m;
    this.sentAt = this.opts.now();
    this.opts.send({ t: 'media', ...m });
  }

  private setStatus(s: MediaStatus): void {
    if (this.state.status === s) return;
    this.state.status = s;
    this.emit('change', this.snapshot());
  }

  snapshot(): LocalMediaState {
    return { ...this.state };
  }

  // ---------------------------------------------------------------- vídeo para os tiles

  /** Faixas de vídeo (câmera/tela) de um usuário, se assinadas e não mutadas. */
  videoOf(userId: number): { camera: Track | null; screen: Track | null } {
    const room = this.room;
    if (!room) return { camera: null, screen: null };
    const p: Participant | undefined =
      userId === this.opts.store.selfId ? room.localParticipant : room.remoteParticipants.get(lkIdentity(userId));
    if (!p) return { camera: null, screen: null };
    const pick = (src: Track.Source): Track | null => {
      const pub = p.getTrackPublication(src);
      return pub?.track && !pub.isMuted && (pub.isSubscribed || userId === this.opts.store.selfId) ? pub.track : null;
    };
    return { camera: pick(Track.Source.Camera), screen: pick(Track.Source.ScreenShare) };
  }
}
