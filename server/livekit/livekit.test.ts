import { afterEach, describe, expect, it, vi } from 'vitest';
import { TrackSource } from 'livekit-server-sdk';
import { createScreenControl, httpUrl } from './control';
import { mintToken, userIdFromIdentity } from './tokens';

const cfg = { url: 'wss://livekit.example.com', apiKey: 'key', apiSecret: 'secret-secret-secret-secret-1234', room: 'escritorio' };

function payload(jwt: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8')) as Record<string, unknown>;
}

describe('LiveKit tokens', () => {
  it('null sem configuração', async () => {
    expect(await mintToken({ room: 'escritorio' }, { id: 1, displayName: 'A' })).toBeNull();
  });

  it('identidade u<id>, 12 h, sem dados e só microfone/câmera', async () => {
    const info = await mintToken(cfg, { id: 7, displayName: 'Ana' });
    expect(info).toMatchObject({ url: cfg.url, room: 'escritorio' });
    const p = payload(info!.token);
    expect(p.sub).toBe('u7');
    expect(p.name).toBe('Ana');
    expect((p.exp as number) - (p.nbf as number)).toBe(12 * 3600);
    expect(p.video).toMatchObject({ roomJoin: true, room: 'escritorio', canPublish: true, canSubscribe: true, canPublishData: false });
    expect((p.video as { canPublishSources: string[] }).canPublishSources).toEqual(['microphone', 'camera', 'screen_share', 'screen_share_audio']);
    expect(userIdFromIdentity('u7')).toBe(7);
  });
});

describe('LiveKit control', () => {
  afterEach(() => vi.useRealTimers());

  it('converte ws(s) para http(s)', () => {
    expect(httpUrl('wss://a.b')).toBe('https://a.b');
    expect(httpUrl('ws://livekit:7880')).toBe('http://livekit:7880');
    expect(httpUrl('http://livekit:7880')).toBe('http://livekit:7880');
  });

  it('libera/retira tela com debounce (último valor vence)', async () => {
    vi.useFakeTimers();
    const calls: unknown[][] = [];
    const ctl = createScreenControl(cfg, { updateParticipant: async (...args: unknown[]) => void calls.push(args) }, 100)!;
    ctl.setScreenAllowed(3, true);
    ctl.setScreenAllowed(3, false);
    ctl.setScreenAllowed(3, true);
    await vi.advanceTimersByTimeAsync(150);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('escritorio');
    expect(calls[0][1]).toBe('u3');
    expect((calls[0][3] as { canPublishSources: TrackSource[] }).canPublishSources).toEqual([
      TrackSource.MICROPHONE, TrackSource.CAMERA, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO,
    ]);
    ctl.setScreenAllowed(3, false);
    await vi.advanceTimersByTimeAsync(150);
    expect((calls[1][3] as { canPublishSources: TrackSource[] }).canPublishSources).toEqual([TrackSource.MICROPHONE, TrackSource.CAMERA]);
    ctl.close();
  });

  it('sem configuração e sem cliente: null', () => {
    expect(createScreenControl({ room: 'x' })).toBeNull();
  });
});
