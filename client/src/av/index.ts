// Liga o A/V por proximidade (WP8) ao resto do cliente: credenciais do `welcome.livekit`, `av_set`
// do store -> reconciliação, `kick`/fechar a página -> sai da sala, barra de vídeos e seletores.
// Sem LiveKit no servidor (`welcome.livekit` null) a barra fica escondida e o escritório segue sem A/V.
import type { LiveKitInfo } from '../../../shared/protocol';
import type { OfficeSocket } from '../net/socket';
import type { OfficeClientStore } from '../net/world-store';
import { onLocaleChange, t } from '../i18n';
import { mountAvBar, type AvBarArt, type AvBarHandle } from '../ui/avbar';
import { h, setText } from '../ui/dom';
import { openDevicesModal } from './devices-modal';
import { MediaManager, fetchLiveKitToken, type MediaSettings, type NoticeLevel } from './livekit';

export { MediaManager } from './livekit';
export type { LocalMediaState, MediaSettings, MediaStatus } from './livekit';
export { mountDevicePickers } from './devices';
export { openDevicesModal } from './devices-modal';

export interface StartMediaOptions {
  store: OfficeClientStore;
  socket: Pick<OfficeSocket, 'send' | 'on'>;
  /** Eu (id do usuário); padrão: `store.selfId`. */
  me?: { id: number } | number | null;
  /** Preferências de A/V (objeto fixo ou leitura sob demanda, ex.: `() => store.self?.settings`). */
  settings?: MediaSettings | (() => MediaSettings | null | undefined) | null;
  art?: AvBarArt;
  slots?: { avbar?: HTMLElement | null; devices?: HTMLElement | null };
  /** Avisos (toasts). Padrão: console. */
  notify?: (level: NoticeLevel, text: string) => void;
  /**
   * Credenciais já recebidas, se `startMedia` for chamado depois do `welcome`. `undefined` + socket
   * aberto: busca em `GET /api/livekit/token`.
   */
  livekit?: LiveKitInfo | null;
}

export interface MediaHandle {
  manager: MediaManager;
  bar: AvBarHandle | null;
  destroy(): void;
}

export function startMedia(opts: StartMediaOptions): MediaHandle {
  const { store, socket } = opts;
  const readSettings = (): MediaSettings => {
    const s = typeof opts.settings === 'function' ? opts.settings() : opts.settings;
    return s ?? {};
  };
  let bar: AvBarHandle | null = null;
  const manager = new MediaManager({
    send: (msg) => void socket.send(msg),
    store,
    settings: readSettings,
    notify: opts.notify ?? ((level, text) => (level === 'info' ? console.info : console.warn)(`[av] ${text}`)),
    audioHost: () => bar?.audioHost ?? null,
  });

  if (opts.slots?.avbar) bar = mountAvBar(opts.slots.avbar, { manager, store, me: opts.me, art: opts.art });
  // Nas configurações: um botão que abre o modal de dispositivos (em vez de seletores embutidos).
  let devicesBtn: HTMLButtonElement | null = null;
  let offLocale: (() => void) | null = null;
  if (opts.slots?.devices) {
    const btn = h('button', { class: 'of-btn of-btn--sm av-settings-devices-btn', type: 'button', text: t('av.chooseDevices') });
    btn.addEventListener('click', () => openDevicesModal(manager));
    opts.slots.devices.append(btn);
    devicesBtn = btn;
    offLocale = onLocaleChange(() => setText(btn, t('av.chooseDevices')));
  }

  const apply = (info: LiveKitInfo | null): void => {
    bar?.setAvailable(!!info);
    if (opts.slots?.devices) opts.slots.devices.hidden = !info;
    if (info) {
      void manager.connect(info);
      // O servidor esquece o `media` quando o WebSocket cai: reenvia o estado atual.
      manager.resend();
    } else {
      void manager.disconnect();
    }
  };

  const offs: (() => void)[] = [
    socket.on('message', (m) => {
      if (m.t === 'welcome') apply(m.livekit ?? null);
    }),
    socket.on('kick', () => void manager.disconnect()),
    store.on('av', (av) => manager.setAvSet(av)),
  ];
  if (store.avSet) manager.setAvSet(store.avSet);

  if (opts.livekit !== undefined) apply(opts.livekit);
  else if (store.connection === 'open') {
    fetchLiveKitToken()
      .then((info) => apply(info))
      .catch(() => apply(null));
  } else bar?.setAvailable(false);

  const onPageHide = (): void => void manager.disconnect();
  if (typeof window !== 'undefined') window.addEventListener('pagehide', onPageHide);

  return {
    manager,
    get bar() {
      return bar;
    },
    destroy() {
      for (const off of offs) off();
      if (typeof window !== 'undefined') window.removeEventListener('pagehide', onPageHide);
      offLocale?.();
      devicesBtn?.remove();
      bar?.destroy();
      bar = null;
      void manager.destroy();
    },
  };
}
