import { describe, expect, it } from 'vitest';
import { DEVICES_KEY, applySavedDevices, loadDevicePrefs, saveDevicePref, type AvDeviceKind } from './devices';

function memStorage(init: Record<string, string> = {}) {
  const data = new Map(Object.entries(init));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
}

const dev = (deviceId: string, kind: MediaDeviceKind): MediaDeviceInfo =>
  ({ deviceId, kind, label: deviceId, groupId: '', toJSON: () => ({}) }) as MediaDeviceInfo;

describe('dispositivos', () => {
  it('salva e lê as escolhas; ignora lixo', () => {
    const st = memStorage();
    expect(loadDevicePrefs(st)).toEqual({});
    saveDevicePref('audioinput', 'mic-2', st);
    saveDevicePref('videoinput', 'cam-1', st);
    expect(loadDevicePrefs(st)).toEqual({ audioinput: 'mic-2', videoinput: 'cam-1' });
    expect(loadDevicePrefs(memStorage({ [DEVICES_KEY]: '{"audioinput":3,"videoinput":"ok","x":"y"}' }))).toEqual({ videoinput: 'ok' });
    expect(loadDevicePrefs(memStorage({ [DEVICES_KEY]: 'não é json' }))).toEqual({});
    expect(loadDevicePrefs(null)).toEqual({});
  });

  it('reaplica só os dispositivos salvos que ainda existem', async () => {
    const switched: [string, string][] = [];
    const room = {
      getActiveDevice: (k: MediaDeviceKind) => (k === 'audiooutput' ? 'spk-1' : undefined),
      switchActiveDevice: async (k: MediaDeviceKind, id: string) => {
        switched.push([k, id]);
        return true;
      },
    };
    const lists: Record<AvDeviceKind, MediaDeviceInfo[]> = {
      audioinput: [dev('mic-1', 'audioinput'), dev('mic-2', 'audioinput')],
      videoinput: [dev('cam-9', 'videoinput')],
      audiooutput: [dev('spk-1', 'audiooutput')],
    };
    await applySavedDevices(room, { audioinput: 'mic-2', videoinput: 'cam-1', audiooutput: 'spk-1' }, async (k) => lists[k]);
    // câmera salva sumiu; saída já é a ativa
    expect(switched).toEqual([['audioinput', 'mic-2']]);
  });
});
