import { describe, expect, it } from 'vitest';
import { DisconnectReason, RoomEvent, type Room, type RoomOptions } from 'livekit-client';
import type { ClientMsg, LiveKitInfo } from '../../../shared/protocol';
import { MediaManager, ROOM_OPTIONS, SPEAKING_SEND_MS, deviceErrorText, retryDelay, type MediaStoreLike } from './livekit';
import type { AvSetMsg } from './subscriptions';

type Fn = (...a: unknown[]) => void;

class FakePub {
  calls: boolean[] = [];
  constructor(readonly trackSid: string, readonly source: string) {}
  setSubscribed(s: boolean): void {
    this.calls.push(s);
  }
}

class FakeLocal {
  identity = 'u1';
  isMicrophoneEnabled = false;
  isCameraEnabled = false;
  isScreenShareEnabled = false;
  log: string[] = [];
  failMic: Error | null = null;
  constructor(private readonly room: FakeRoom) {}
  async setMicrophoneEnabled(on: boolean): Promise<void> {
    this.log.push(`mic:${on}`);
    if (this.failMic) throw this.failMic;
    this.isMicrophoneEnabled = on;
    this.room.emit(on ? RoomEvent.LocalTrackPublished : RoomEvent.TrackMuted);
  }
  async setCameraEnabled(on: boolean): Promise<void> {
    this.log.push(`cam:${on}`);
    this.isCameraEnabled = on;
  }
  async setScreenShareEnabled(on: boolean): Promise<void> {
    this.log.push(`screen:${on}`);
    this.isScreenShareEnabled = on;
  }
  setTrackSubscriptionPermissions(all: boolean, list: { participantIdentity: string }[] = []): void {
    this.log.push(`perm:${all}:${list.map((p) => p.participantIdentity).join(',')}`);
  }
  getTrackPublication(): undefined {
    return undefined;
  }
}

class FakeRoom {
  handlers = new Map<string, Set<Fn>>();
  connects: { url: string; token: string; opts: unknown }[] = [];
  remoteParticipants = new Map<string, { identity: string; trackPublications: Map<string, FakePub>; setVolume(v: number): void }>();
  localParticipant: FakeLocal = new FakeLocal(this);
  canPlaybackAudio = true;
  failConnect = false;
  constructor(readonly options: RoomOptions) {}
  on(ev: string, fn: Fn): this {
    let s = this.handlers.get(ev);
    if (!s) this.handlers.set(ev, (s = new Set()));
    s.add(fn);
    return this;
  }
  off(ev: string, fn: Fn): this {
    this.handlers.get(ev)?.delete(fn);
    return this;
  }
  emit(ev: string, ...args: unknown[]): void {
    for (const fn of [...(this.handlers.get(ev) ?? [])]) fn(...args);
  }
  async connect(url: string, token: string, opts: unknown): Promise<void> {
    this.connects.push({ url, token, opts });
    if (this.failConnect) throw new Error('falhou');
  }
  async disconnect(): Promise<void> {
    this.emit(RoomEvent.Disconnected, DisconnectReason.CLIENT_INITIATED);
  }
  getActiveDevice(): undefined {
    return undefined;
  }
  async switchActiveDevice(): Promise<boolean> {
    return true;
  }
  async startAudio(): Promise<void> {
    this.canPlaybackAudio = true;
  }
}

const INFO: LiveKitInfo = { url: 'wss://lk.example', token: 't0', room: 'escritorio' };

function setup(over: { settings?: { micOnJoin?: boolean; camOnJoin?: boolean }; token?: () => Promise<LiveKitInfo | null> } = {}) {
  const sent: ClientMsg[] = [];
  const notices: [string, string][] = [];
  const rooms: FakeRoom[] = [];
  const speaking = new Map<number, boolean>();
  const clock = { t: 1000 };
  const timers: { at: number; fn: () => void; dead: boolean }[] = [];
  const store: MediaStoreLike = {
    selfId: 1,
    avSet: null,
    setSpeaking: (id, on) => void speaking.set(id, on),
  };
  const m = new MediaManager({
    send: (msg) => void sent.push(msg),
    store,
    settings: () => over.settings ?? {},
    notify: (level, text) => void notices.push([level, text]),
    fetchToken: over.token ?? (async () => ({ ...INFO, token: `t${rooms.length}` })),
    createRoom: (o) => {
      const r = new FakeRoom(o);
      rooms.push(r);
      return r as unknown as Room;
    },
    now: () => clock.t,
    schedule: (fn, ms) => {
      const t = { at: clock.t + ms, fn, dead: false };
      timers.push(t);
      return () => void (t.dead = true);
    },
  });
  const advance = async (ms: number): Promise<void> => {
    clock.t += ms;
    for (const t of timers.filter((x) => !x.dead && x.at <= clock.t)) {
      t.dead = true;
      t.fn();
    }
    await flush();
  };
  const media = () => sent.filter((x): x is Extract<ClientMsg, { t: 'media' }> => x.t === 'media');
  return { m, sent, media, notices, rooms, speaking, store, advance, clock };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

const av = (hear: number[], screenAllowed = false): AvSetMsg => ({ t: 'av_set', hear, allow: hear, volumes: {}, screenAllowed });

describe('MediaManager', () => {
  it('conecta sem auto-assinatura, aplica privacidade antes de publicar e liga o mic', async () => {
    const s = setup();
    await s.m.connect(INFO);
    const room = s.rooms[0];
    expect(room.options).toBe(ROOM_OPTIONS);
    expect(ROOM_OPTIONS).toMatchObject({ adaptiveStream: true, dynacast: true, publishDefaults: { simulcast: true } });
    expect(room.connects).toEqual([{ url: INFO.url, token: 't0', opts: { autoSubscribe: false, peerConnectionTimeout: 45_000 } }]);
    const log = room.localParticipant.log;
    expect(log[0]).toBe('perm:false:');
    expect(log.indexOf('mic:true')).toBeGreaterThan(0);
    expect(log).toContain('cam:false');
    expect(s.m.state).toMatchObject({ status: 'connected', mic: true, cam: false, screen: false });
    expect(s.media().at(-1)).toEqual({ t: 'media', mic: true, cam: false, screen: false, speaking: false });
  });

  it('camOnJoin/micOnJoin das preferências', async () => {
    const s = setup({ settings: { micOnJoin: false, camOnJoin: true } });
    await s.m.connect(INFO);
    expect(s.rooms[0].localParticipant.log).toEqual(expect.arrayContaining(['mic:false', 'cam:true']));
    expect(s.m.state).toMatchObject({ mic: false, cam: true });
  });

  it('permissão negada: aviso, estado bloqueado e mic desligado', async () => {
    const s = setup();
    const err = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
    // falha já na primeira tentativa de ligar o microfone
    const p = s.m.connect(INFO);
    s.rooms[0].localParticipant.failMic = err;
    await p;
    expect(s.m.state).toMatchObject({ status: 'connected', mic: false, micBlocked: true });
    expect(s.notices[0][0]).toBe('warn');
    expect(s.notices[0][1]).toMatch(/bloqueou o microfone/);
  });

  it('toggles mandam `media` a cada mudança', async () => {
    const s = setup();
    await s.m.connect(INFO);
    const n = s.media().length;
    await s.m.toggleCam();
    expect(s.media().at(-1)).toMatchObject({ mic: true, cam: true });
    await s.m.toggleMic();
    expect(s.media().at(-1)).toMatchObject({ mic: false, cam: true });
    expect(s.media()).toHaveLength(n + 2);
  });

  it('tela só com screenAllowed; sair da reunião para o compartilhamento', async () => {
    const s = setup();
    await s.m.connect(INFO);
    await s.m.toggleScreen();
    expect(s.rooms[0].localParticipant.log).not.toContain('screen:true');
    expect(s.notices.at(-1)?.[0]).toBe('info');

    s.m.setAvSet(av([2], true));
    expect(s.m.state.screenAllowed).toBe(true);
    await s.m.toggleScreen();
    expect(s.m.state.screen).toBe(true);
    expect(s.media().at(-1)).toMatchObject({ screen: true });

    s.m.setAvSet(av([2], false));
    await flush();
    expect(s.rooms[0].localParticipant.log.at(-1)).toBe('screen:false');
    expect(s.m.state.screen).toBe(false);
    expect(s.media().at(-1)).toMatchObject({ screen: false });
  });

  it('av_set reconcilia as faixas remotas e as permissões', async () => {
    const s = setup();
    await s.m.connect(INFO);
    const room = s.rooms[0];
    const pub = new FakePub('T1', 'microphone');
    const vols: number[] = [];
    room.remoteParticipants.set('u2', { identity: 'u2', trackPublications: new Map([['T1', pub]]), setVolume: (v) => void vols.push(v) });
    s.m.setAvSet({ t: 'av_set', hear: [2], allow: [2], volumes: { 2: 0.6 }, screenAllowed: false });
    expect(pub.calls).toEqual([true]);
    expect(vols).toEqual([0.6]);
    expect(room.localParticipant.log).toContain('perm:false:u2');
    // faixa nova publicada por alguém: reconcilia sozinho
    const cam = new FakePub('T2', 'camera');
    room.remoteParticipants.get('u2')!.trackPublications.set('T2', cam);
    room.emit(RoomEvent.TrackPublished, cam, room.remoteParticipants.get('u2'));
    expect(cam.calls).toEqual([true]);
  });

  it('fala: store + `media` com limite de 300 ms', async () => {
    const s = setup();
    await s.m.connect(INFO);
    const room = s.rooms[0];
    await s.advance(1000);
    const n = s.media().length;
    room.emit(RoomEvent.ActiveSpeakersChanged, [room.localParticipant, { identity: 'u2' }]);
    expect(s.speaking.get(1)).toBe(true);
    expect(s.speaking.get(2)).toBe(true);
    expect(s.media()).toHaveLength(n + 1);
    expect(s.media().at(-1)).toMatchObject({ speaking: true });

    room.emit(RoomEvent.ActiveSpeakersChanged, []);
    expect(s.speaking.get(1)).toBe(false);
    expect(s.speaking.get(2)).toBe(false);
    expect(s.media()).toHaveLength(n + 1); // dentro da janela: espera
    await s.advance(SPEAKING_SEND_MS);
    expect(s.media()).toHaveLength(n + 2);
    expect(s.media().at(-1)).toMatchObject({ speaking: false });
  });

  it('queda inesperada: token novo e reconexão com backoff', async () => {
    const s = setup();
    await s.m.connect(INFO);
    s.rooms[0].emit(RoomEvent.Disconnected, DisconnectReason.SIGNAL_CLOSE);
    expect(s.m.state.status).toBe('reconnecting');
    expect(s.media().at(-1)).toMatchObject({ mic: false });
    await s.advance(retryDelay(0));
    expect(s.rooms).toHaveLength(2);
    expect(s.rooms[1].connects[0].token).toBe('t1');
    expect(s.m.state).toMatchObject({ status: 'connected', mic: true });
  });

  it('aba duplicada não reconecta; sair/voltar do áudio', async () => {
    const s = setup();
    await s.m.connect(INFO);
    s.rooms[0].emit(RoomEvent.Disconnected, DisconnectReason.DUPLICATE_IDENTITY);
    expect(s.m.state.status).toBe('left');
    await s.advance(60_000);
    expect(s.rooms).toHaveLength(1);
    await s.m.rejoin();
    expect(s.rooms).toHaveLength(2);
    expect(s.m.state.status).toBe('connected');
    await s.m.leave();
    expect(s.m.state.status).toBe('left');
    expect(s.media().at(-1)).toMatchObject({ mic: false, cam: false, screen: false });
    // `welcome` de novo não religa quem saiu
    await s.m.connect(INFO);
    expect(s.rooms).toHaveLength(2);
  });

  it('servidor sem LiveKit na renovação: indisponível', async () => {
    const s = setup({ token: async () => null });
    await s.m.connect(INFO);
    s.rooms[0].emit(RoomEvent.Disconnected, DisconnectReason.SERVER_SHUTDOWN);
    await s.advance(retryDelay(0));
    expect(s.m.state.status).toBe('unavailable');
  });

  it('autoplay bloqueado: estado e startAudio', async () => {
    const s = setup();
    const p = s.m.connect(INFO);
    s.rooms[0].canPlaybackAudio = false;
    await p;
    expect(s.m.state.audioLocked).toBe(true);
    await s.m.unlockAudio();
    expect(s.m.state.audioLocked).toBe(false);
  });

  it('textos de erro de dispositivo', () => {
    const denied = Object.assign(new Error('x'), { name: 'NotAllowedError' });
    expect(deviceErrorText('cam', denied)).toMatchObject({ blocked: true });
    expect(deviceErrorText('screen', denied)).toBeNull(); // cancelou o seletor de tela
    expect(deviceErrorText('mic', Object.assign(new Error('x'), { name: 'NotFoundError' }))?.text).toBe('Nenhum microfone encontrado.');
    expect(retryDelay(0)).toBe(2000);
    expect(retryDelay(10)).toBe(30000);
  });
});
