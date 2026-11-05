// Barra superior: logo, online, status, painéis (Chat [ · Participantes ] · Minimapa M · Configurações · Ajuda ?) e menu do avatar.
import { branding } from '../net/branding';
import type { UserStatus } from '../../../shared/model';
import { onLocaleChange, t, type MessageKey } from '../i18n';
import { runAvatarEditor } from './avatar-flow';
import { headThumb, updateHead } from './avatars';
import { badgeText } from './chat-logic';
import type { PanelCtx } from './deps';
import { h, setHidden, setText } from './dom';
import { openMenu } from './menu';
import { statusLabel } from './participants-logic';
import { SHELL_ICONS } from './shell-icons';

export type TopbarButton = 'chat' | 'people' | 'minimap' | 'settings' | 'help';

export interface TopbarHandlers {
  toggle(which: TopbarButton, anchor: HTMLElement): void;
}

export interface Topbar {
  readonly el: HTMLElement;
  setOnline(n: number): void;
  setUnread(n: number): void;
  setActive(which: TopbarButton, on: boolean): void;
  readonly height: number;
  destroy(): void;
}

const SELECTABLE: UserStatus[] = ['available', 'busy', 'away'];

export function createTopbar(ctx: PanelCtx, handlers: TopbarHandlers, host: HTMLElement): Topbar {
  const { store, socket, me, art, world } = ctx;
  let onlineN = 0;
  let unreadN = 0;

  const logo = h('img', { class: 'ui-topbar__logo', attrs: { src: branding().logoUrl, alt: branding().appName, height: 28, 'data-brand-logo': '' } });
  const online = h('span', { class: 'of-badge ui-topbar__online' });
  const onlineText = h('span');
  online.append(h('span', { class: 'ui-dot ui-dot--available' }), onlineText);

  // status
  const statusDot = h('span', { class: 'ui-dot' });
  const statusText = h('span', { class: 'ui-topbar__label' });
  const statusBtn = h('button', { class: 'of-btn of-btn--transparent of-btn--sm ui-topbar__status', type: 'button', attrs: { 'aria-haspopup': 'menu', 'aria-expanded': 'false' } }, statusDot, statusText);
  const chev = h('span', { class: 'ui-chevron' });
  chev.innerHTML = SHELL_ICONS.chevron;
  statusBtn.append(chev);
  const myStatus = (): UserStatus => store.self?.status ?? me.status;
  const renderStatus = () => {
    const s = myStatus();
    statusDot.className = `ui-dot ui-dot--${s}`;
    setText(statusText, statusLabel(s));
  };
  statusBtn.addEventListener('click', () => {
    const cur = myStatus();
    const list: UserStatus[] = SELECTABLE.includes(cur) ? SELECTABLE : [...SELECTABLE, cur];
    openMenu(
      host,
      statusBtn,
      list.map((s) => ({
        label: statusLabel(s),
        checked: s === cur,
        onSelect: () => {
          if (!socket.send({ t: 'status', status: s })) ctx.notify(t('shell.topbar.statusOffline'), 'warn');
        },
      })),
      { align: 'left' },
    );
  });

  // botões (rótulo = chave da mensagem; o texto é aplicado em applyTexts, também na troca de idioma)
  const buttons = new Map<TopbarButton, { el: HTMLButtonElement; label: MessageKey; key?: string }>();
  const mk = (which: TopbarButton, icon: string, label: MessageKey, key?: string): HTMLButtonElement => {
    const b = h('button', { class: 'ui-icon-btn ui-topbar__btn', type: 'button', attrs: { 'aria-pressed': 'false', 'data-btn': which } });
    b.innerHTML = icon;
    b.addEventListener('click', () => handlers.toggle(which, b));
    buttons.set(which, { el: b, label, key });
    return b;
  };
  const chatBtn = mk('chat', SHELL_ICONS.chat, 'shell.chat.title', '[');
  const badge = h('span', { class: 'ui-badge', hidden: true, attrs: { 'aria-hidden': 'true' } });
  chatBtn.append(badge);
  const peopleBtn = mk('people', SHELL_ICONS.people, 'shell.people.title', ']');
  const mapBtn = mk('minimap', SHELL_ICONS.map, 'shell.minimap.title', 'M');
  const setBtn = mk('settings', SHELL_ICONS.settings, 'shell.settings.title');
  setBtn.setAttribute('aria-haspopup', 'dialog');
  setBtn.setAttribute('aria-expanded', 'false');
  const helpBtn = mk('help', SHELL_ICONS.help, 'shell.help.title', '?');

  // avatar
  const meHead = headThumb(art, me.appearance, me.name, 'ui-head--sm');
  const meName = h('span', { class: 'ui-topbar__me-name', text: me.name });
  const meBtn = h('button', { class: 'of-btn of-btn--transparent of-btn--sm ui-topbar__me', type: 'button', attrs: { 'aria-haspopup': 'menu', 'aria-expanded': 'false' } }, meHead, meName);
  const refreshMe = () => {
    const u = store.self ?? me;
    updateHead(meHead, art, u.appearance, u.name);
    setText(meName, u.name);
  };
  meBtn.addEventListener('click', () => {
    const items = [
      {
        label: t('shell.topbar.myAvatar'),
        onSelect: () => {
          const u = store.self ?? me;
          void runAvatarEditor(art, u, 'edit')
            .then((saved) => {
              if (!saved) return;
              // O servidor propaga `appearance` pelo WebSocket; atualiza já o que é local.
              u.appearance = saved.appearance;
              u.name = saved.displayName;
              refreshMe();
            })
            .catch((err) => ctx.notify(err instanceof Error ? err.message : t('shell.topbar.avatarEditorError'), 'warn'));
        },
      },
      {
        label: t('shell.topbar.myDesk'),
        onSelect: () => (ctx.onMyDesk ? ctx.onMyDesk() : world.focusUser(me.id)),
      },
      ...(me.isAdmin ? [{ label: t('shell.topbar.admin'), href: '/admin', dividerBefore: true }] : []),
      {
        label: t('shell.topbar.signOut'),
        dividerBefore: true,
        onSelect: () => {
          import('../net/api')
            .then(({ api }) => api.post('/api/auth/logout'))
            .catch(() => undefined)
            .finally(() => location.assign('/login'));
        },
      },
    ];
    openMenu(host, meBtn, items, { align: 'right' });
  });

  const right = h('div', { class: 'ui-topbar__right' }, chatBtn, peopleBtn, mapBtn, setBtn, helpBtn, h('span', { class: 'ui-topbar__sep' }), meBtn);
  const left = h('div', { class: 'ui-topbar__left' }, logo, online, statusBtn);
  const el = h('header', { class: 'ui-topbar of-panel of-panel--float', attrs: { id: 'ui-topbar' } }, left, h('div', { class: 'ui-topbar__spacer' }), right);

  const renderOnline = () => setText(onlineText, t('shell.topbar.online', { n: onlineN }));
  const renderUnread = () => {
    const txt = badgeText(unreadN);
    setText(badge, txt);
    setHidden(badge, !txt);
    chatBtn.setAttribute('aria-label', unreadN > 0 ? t('shell.chat.unreadLabel', { n: txt }) : t('shell.chat.title'));
  };

  /** Textos fixos (título, aria-label); roda na montagem e a cada troca de idioma. */
  const applyTexts = () => {
    online.title = t('shell.topbar.peopleOnline');
    statusBtn.setAttribute('aria-label', t('shell.topbar.changeStatus'));
    meBtn.setAttribute('aria-label', t('shell.topbar.avatarMenu'));
    for (const { el: b, label, key } of buttons.values()) {
      const text = t(label);
      b.title = key ? `${text} (${key})` : text;
      b.setAttribute('aria-label', text);
    }
    renderStatus();
    renderOnline();
    renderUnread();
  };

  const offs = [
    store.on('status', (s) => s.id === store.selfId && renderStatus()),
    store.on('appearance', (id) => id === store.selfId && refreshMe()),
    store.on('reset', () => {
      renderStatus();
      refreshMe();
    }),
    onLocaleChange(applyTexts),
  ];
  applyTexts();

  return {
    el,
    get height() {
      return el.offsetHeight;
    },
    setOnline(n) {
      onlineN = n;
      renderOnline();
    },
    setUnread(n) {
      unreadN = n;
      renderUnread();
    },
    setActive(which, on) {
      buttons.get(which)?.el.setAttribute('aria-pressed', String(on));
    },
    destroy() {
      for (const off of offs) off();
      el.remove();
    },
  };
}
