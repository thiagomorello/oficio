// Shell de UI do escritório (WP7): barra superior, chat, participantes, minimapa, configurações, ajuda,
// cartão de perfil, faixa de conexão e avisos. Substitui o mini-shell do WP5.
//
// Pontos de montagem deixados vazios para outros pacotes (dentro de `root`):
//   #avbar            topo-centro, controles de áudio/vídeo (WP8)
//   #room-indicator   topo-esquerda, indicador da sala atual (WP9)
//   #context-menu     menu de contexto de mesas/pessoas (WP9)
//   #settings-devices dentro das configurações, seletores de dispositivo (WP8)
import type { UserSettings } from '../../../shared/model';
import { initLocale, t } from '../i18n';
import { branding } from '../net/branding';
import { createChat } from './chat';
import { createConnectionBanner } from './connection';
import type { PanelCtx, UIDeps } from './deps';
import { h } from './dom';
import { HelpDialog } from './help';
import { createMinimap } from './minimap';
import { createParticipants } from './participants';
import { createProfileCard } from './profile-card';
import { createSettings } from './settings';
import { Toasts } from './toasts';
import { goToMyDesk, mountContextMenu } from './context-menu';
import { mountDeskDecorPopover } from './desk-decor-popover';
import { mountRoomIndicator } from './meeting';
import { createTopbar, type TopbarButton } from './topbar';
import { computeInsets, sameInsets } from './viewport';
import type { ViewInsets } from '../world/api';
import './styles.css';

export type { UIDeps } from './deps';

export interface MountedUI {
  destroy(): void;
  /** Slots para o áudio/vídeo (WP8): barra no topo e seletores de dispositivo nas configurações. */
  slots: { avbar: HTMLElement; devices: HTMLElement | null };
  /** Aviso curto (toast). */
  notify(text: string, level?: 'info' | 'success' | 'warn' | 'alert'): void;
}

const MOBILE_QUERY = '(max-width: 900px)';

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

export function mountUI(root: HTMLElement, deps: UIDeps): MountedUI {
  const { store, world } = deps;
  root.classList.add('ui-root');
  // Idioma: escolha salva no servidor (me.settings.locale) > navegador (localStorage) > idioma do navegador >
  // padrão da instância. Antes de montar os painéis, que leem t() ao nascer; trocas depois disso
  // chegam por onLocaleChange e cada painel reaplica os próprios textos.
  initLocale(branding().defaultLocale, deps.me.settings?.locale ?? null);
  // "Minha mesa": anda até a própria mesa e senta (WP9).
  deps = { ...deps, onMyDesk: deps.onMyDesk ?? (() => { if (!goToMyDesk({ store, world, replica: { sit: world.sitAt } })) toasts.push({ level: 'info', text: t('shell.desk.noDesk'), at: Date.now() }); }) };

  const toasts = new Toasts();
  const ctx: PanelCtx = {
    ...deps,
    notify: (text, level = 'info') => toasts.push({ level, text, at: Date.now() }),
    zoneName: (id) => {
      try {
        return world.minimapSource().assembly.zoneById.get(id)?.name;
      } catch {
        return undefined;
      }
    },
  };
  const mobile = window.matchMedia(MOBILE_QUERY);

  const settings = createSettings(ctx);
  const chat = createChat(ctx);
  const people = createParticipants(ctx, { onPick: () => mobile.matches && people.close() });
  const minimap = createMinimap(root, () => world.minimapSource(), settings.get().minimap);
  const help = new HelpDialog();
  const banner = createConnectionBanner(ctx);
  const profile = createProfileCard(ctx, () => chat.focusInput('near'));

  const topbar = createTopbar(
    ctx,
    {
      toggle(which: TopbarButton, anchor: HTMLElement) {
        if (which === 'chat') chat.toggle();
        else if (which === 'people') people.toggle();
        else if (which === 'minimap') minimap.toggle();
        else if (which === 'settings') settings.toggle(anchor);
        else help.toggle();
      },
    },
    root,
  );

  const avbar = h('div', { attrs: { id: 'avbar' } });
  const roomIndicator = h('div', { attrs: { id: 'room-indicator' } });
  const contextMenu = h('div', { attrs: { id: 'context-menu' } });
  root.append(topbar.el, avbar, roomIndicator, people.el, chat.el, minimap.el, settings.el, profile.el, banner.el, toasts.el, contextMenu, help.el);
  // Mesas e salas (WP9): popover de decoração, menu de contexto e indicador de sala.
  const decor = mountDeskDecorPopover(contextMenu, { store, world, art: deps.art, toast: toasts });
  const deskMenu = mountContextMenu(contextMenu, { store, world, socket: deps.socket, openDecor: decor.open });
  const room = mountRoomIndicator(roomIndicator, { store, world, socket: deps.socket, toast: toasts });

  // ------------------------------------------------------------------ insets da câmera
  let lastInsets: ViewInsets | null = null;
  const updateInsets = () => {
    const vw = innerWidth;
    const vh = innerHeight;
    const insets = computeInsets(
      {
        vw,
        vh,
        topBottom: topbar.el.offsetTop + topbar.el.offsetHeight,
        sideRight: people.el.offsetLeft + people.el.offsetWidth,
        drawerLeft: chat.isOpen ? chat.el.offsetLeft : vw,
        drawerTop: chat.el.offsetTop,
        drawerSheet: false,
        feedOpenH: 0,
        feedClosedH: 0,
        feedMargin: 0,
      },
      { sidebar: people.isOpen, feed: false, drawer: chat.isOpen, narrow: mobile.matches },
    );
    if (sameInsets(lastInsets, insets)) return;
    lastInsets = insets;
    world.setViewInsets?.(insets);
  };
  const relayout = () => {
    root.classList.toggle('chat-open', chat.isOpen);
    root.classList.toggle('people-open', people.isOpen);
    root.classList.toggle('minimap-open', minimap.isOpen);
    topbar.setActive('chat', chat.isOpen);
    topbar.setActive('people', people.isOpen);
    topbar.setActive('minimap', minimap.isOpen);
    updateInsets();
  };

  // No celular as gavetas ocupam a tela toda: só uma por vez.
  const offs: Array<() => void> = [
    chat.onToggle((open) => {
      if (open && mobile.matches) people.close();
      relayout();
    }),
    people.onToggle((open) => {
      if (open && mobile.matches) chat.close();
      relayout();
    }),
    minimap.onToggle((open) => {
      settings.set({ minimap: open });
      relayout();
    }),
    chat.onUnread((n) => topbar.setUnread(n)),
    people.onCount((n) => topbar.setOnline(n)),
    settings.onChange((s: UserSettings, patch: Partial<UserSettings>) => {
      if ('showNames' in patch) world.setOptions({ showNames: s.showNames });
      if ('minimap' in patch) {
        if (s.minimap) minimap.open();
        else minimap.close();
      }
    }),
    store.on('notice', (n) => ctx.notify(n.text, 'info')),
    store.on('reject', (r) => {
      if (r.reason === 'locked') ctx.notify(t('shell.reject.locked'));
      else if (r.reason === 'seat_taken') ctx.notify(t('shell.reject.seatTaken'));
      else if (r.reason === 'desk_taken') ctx.notify(t('shell.reject.deskTaken'));
      else if (r.reason === 'far') ctx.notify(t('shell.reject.far'));
    }),
    world.on((e) => {
      if (e.type === 'chat') chat.focusInput();
      else if (e.type === 'minimap') minimap.toggle();
      else if (e.type === 'help') help.toggle();
      else if (e.type === 'select') profile.show(e.user, e.x, e.y);
      else if (e.type === 'hint') ctx.notify(e.text);
      // 'desk': menu de mesa é do WP9 (#context-menu).
    }),
  ];

  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || help.isOpen) return;
    if (e.key === '[') chat.toggle();
    else if (e.key === ']') people.toggle();
  };
  document.addEventListener('keydown', onKey);
  mobile.addEventListener('change', relayout);
  addEventListener('resize', updateInsets);

  // estado inicial
  world.setOptions({ showNames: settings.get().showNames });
  topbar.setOnline(people.count);
  relayout();
  requestAnimationFrame(updateInsets);

  return {
    slots: { avbar, devices: root.querySelector<HTMLElement>('#settings-devices') },
    notify: ctx.notify,
    destroy() {
      for (const off of offs) off();
      document.removeEventListener('keydown', onKey);
      mobile.removeEventListener('change', relayout);
      removeEventListener('resize', updateInsets);
      for (const c of [topbar, chat, people, minimap, settings, profile, banner, help]) c.destroy();
      room.destroy();
      deskMenu.destroy();
      decor.destroy();
      toasts.destroy();
      avbar.remove();
      roomIndicator.remove();
      contextMenu.remove();
      root.classList.remove('ui-root', 'chat-open', 'people-open', 'minimap-open');
    },
  };
}
