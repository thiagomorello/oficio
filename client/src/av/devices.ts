// Dispositivos de A/V (WP8): lista microfones/câmeras/saídas, troca o ativo na sala e lembra a escolha
// no localStorage (chave própria, mesmo acesso protegido de `ui/prefs.ts`).
import { Room } from 'livekit-client';
import { t, type MessageKey } from '../i18n';
import { h, setText } from '../ui/dom';
import { safeLocalStorage } from '../ui/prefs';

export type AvDeviceKind = 'audioinput' | 'videoinput' | 'audiooutput';
export const DEVICE_KINDS: readonly AvDeviceKind[] = ['audioinput', 'videoinput', 'audiooutput'];
export const DEVICES_KEY = 'oficio:av-devices';

const DEVICE_LABEL_KEYS: Record<AvDeviceKind, MessageKey> = {
  audioinput: 'av.device.audioinput',
  videoinput: 'av.device.videoinput',
  audiooutput: 'av.device.audiooutput',
};

/** Nome do tipo de dispositivo (Microfone, Câmera, Alto-falante), no idioma atual. */
export function deviceKindLabel(kind: AvDeviceKind): string {
  return t(DEVICE_LABEL_KEYS[kind]);
}

export type DevicePrefs = Partial<Record<AvDeviceKind, string>>;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function loadDevicePrefs(storage: StorageLike | null = safeLocalStorage()): DevicePrefs {
  if (!storage) return {};
  try {
    const raw: unknown = JSON.parse(storage.getItem(DEVICES_KEY) ?? 'null');
    const out: DevicePrefs = {};
    if (raw && typeof raw === 'object') {
      for (const k of DEVICE_KINDS) {
        const v = (raw as Record<string, unknown>)[k];
        if (typeof v === 'string' && v.length > 0 && v.length <= 512) out[k] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function saveDevicePref(kind: AvDeviceKind, deviceId: string, storage: StorageLike | null = safeLocalStorage()): void {
  if (!storage) return;
  try {
    const prefs = loadDevicePrefs(storage);
    prefs[kind] = deviceId;
    storage.setItem(DEVICES_KEY, JSON.stringify(prefs));
  } catch {
    // armazenamento cheio/bloqueado: a escolha vale só nesta sessão
  }
}

/** Dispositivos de um tipo (sem pedir permissão: sem ela os rótulos vêm vazios). */
export async function listDevices(kind: AvDeviceKind): Promise<MediaDeviceInfo[]> {
  try {
    return (await Room.getLocalDevices(kind, false)).filter((d) => d.deviceId !== '');
  } catch {
    return [];
  }
}

/** Mínimo da sala usado aqui (testável). */
export interface DeviceRoomLike {
  switchActiveDevice(kind: MediaDeviceKind, deviceId: string, exact?: boolean): Promise<boolean>;
  getActiveDevice(kind: MediaDeviceKind): string | undefined;
}

/**
 * Reaplica as escolhas salvas que ainda existem (um fone desplugado não quebra a captura).
 * `list` é injetável para os testes.
 */
export async function applySavedDevices(
  room: DeviceRoomLike,
  prefs: DevicePrefs = loadDevicePrefs(),
  list: (kind: AvDeviceKind) => Promise<MediaDeviceInfo[]> = listDevices,
): Promise<void> {
  for (const kind of DEVICE_KINDS) {
    const id = prefs[kind];
    if (!id || room.getActiveDevice(kind) === id) continue;
    const available = await list(kind);
    if (!available.some((d) => d.deviceId === id)) continue;
    try {
      await room.switchActiveDevice(kind, id, kind !== 'audiooutput' ? false : undefined);
    } catch {
      // segue com o padrão do sistema
    }
  }
}

/** O que os seletores precisam do gerenciador de mídia. */
export interface DeviceSwitcher {
  switchDevice(kind: AvDeviceKind, deviceId: string): Promise<boolean>;
  activeDevice(kind: AvDeviceKind): string | undefined;
  on(ev: 'devices', cb: () => void): () => void;
}

function deviceLabel(d: MediaDeviceInfo, i: number, kind: AvDeviceKind): string {
  if (d.label) return d.label;
  if (d.deviceId === 'default') return t('av.device.systemDefault');
  return `${deviceKindLabel(kind)} ${i + 1}`;
}

/**
 * Seletores de microfone/câmera/alto-falante (para `#settings-devices` e o menu da barra de A/V).
 * Atualiza ao plugar/desplugar dispositivos e quando o A/V muda de estado (rótulos depois da permissão).
 */
export function mountDevicePickers(slot: HTMLElement, manager: DeviceSwitcher): { refresh(): Promise<void>; destroy(): void } {
  const root = h('div', { class: 'av-devices' });
  const rows = new Map<AvDeviceKind, { row: HTMLElement; label: HTMLElement; select: HTMLSelectElement }>();
  for (const kind of DEVICE_KINDS) {
    const id = `av-dev-${kind}-${Math.random().toString(36).slice(2, 8)}`;
    const select = h('select', { class: 'of-select of-select--outlined', attrs: { id } });
    select.addEventListener('change', () => {
      if (select.value) void manager.switchDevice(kind, select.value);
    });
    const label = h('label', { class: 'of-caption', text: deviceKindLabel(kind), attrs: { for: id } });
    const row = h('div', { class: 'av-devices__row' }, label, select);
    rows.set(kind, { row, label, select });
    root.append(row);
  }
  const empty = h('p', { class: 'of-caption av-devices__empty', text: t('av.device.none'), hidden: true });
  root.append(empty);
  slot.append(root);

  let alive = true;
  const refresh = async (): Promise<void> => {
    let total = 0;
    const saved = loadDevicePrefs();
    setText(empty, t('av.device.none'));
    for (const kind of DEVICE_KINDS) {
      const { row, label, select } = rows.get(kind)!;
      setText(label, deviceKindLabel(kind));
      const list = await listDevices(kind);
      if (!alive) return;
      total += list.length;
      // Saída de áudio só existe em alguns navegadores (Chrome/Edge).
      row.hidden = list.length === 0;
      const current = manager.activeDevice(kind) ?? saved[kind] ?? 'default';
      select.replaceChildren(...list.map((d, i) => h('option', { text: deviceLabel(d, i, kind), attrs: { value: d.deviceId } })));
      if (list.some((d) => d.deviceId === current)) select.value = current;
    }
    empty.hidden = total > 0;
  };
  const onDeviceChange = (): void => void refresh();
  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  md?.addEventListener?.('devicechange', onDeviceChange);
  const off = manager.on('devices', onDeviceChange);
  void refresh();
  return {
    refresh,
    destroy() {
      alive = false;
      md?.removeEventListener?.('devicechange', onDeviceChange);
      off();
      root.remove();
    },
  };
}
