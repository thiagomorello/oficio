// Chat (gaveta à direita): abas Geral / Sala / Perto, lista com até 300 mensagens e campo de envio.
import type { ChatScope } from '../../../shared/protocol';
import type { ChatMessage } from '../../../shared/model';
import { onLocaleChange, t } from '../i18n';
import { badgeText, CHAT_TABS, CHAT_TEXT_MAX, CHAT_VISIBLE_MAX, countUnread, lastMessageId, messagesFor, prepareChatText, resolveActiveScope, scopeAvailability, scopeLabel, zoneOfUser } from './chat-logic';
import type { Panel, PanelCtx } from './deps';
import { h, setHidden, setText } from './dom';
import { formatClock } from './format';
import { SHELL_ICONS } from './shell-icons';

export interface ChatPanel extends Panel {
  /** Abre, escolhe a aba (se disponível) e foca o campo. */
  focusInput(scope?: ChatScope): void;
  readonly unread: number;
  onUnread(cb: (n: number) => void): () => void;
  onToggle(cb: (open: boolean) => void): () => void;
}

export function createChat(ctx: PanelCtx): ChatPanel {
  const { store, socket } = ctx;
  let open = false;
  let active: ChatScope = 'global';
  let lastSeen = lastMessageId(store.chat);
  let unread = 0;
  const unreadCbs = new Set<(n: number) => void>();
  const toggleCbs = new Set<(open: boolean) => void>();

  const tabs = new Map<ChatScope, HTMLButtonElement>();
  const tabBar = h('div', { class: 'of-tabs ui-chat__tabs', role: 'tablist' });
  for (const scope of CHAT_TABS) {
    const b = h('button', { class: 'of-tab', type: 'button', role: 'tab', attrs: { 'data-scope': scope } });
    b.addEventListener('click', () => setScope(scope));
    tabs.set(scope, b);
    tabBar.append(b);
  }
  const list = h('div', { class: 'ui-chat__list', attrs: { role: 'log', 'aria-live': 'polite' } });
  const empty = h('p', { class: 'of-caption ui-chat__empty' });
  const input = h('input', {
    class: 'of-input of-input--outlined',
    type: 'text',
    attrs: { maxlength: CHAT_TEXT_MAX, autocomplete: 'off' },
  }) as HTMLInputElement;
  const send = h('button', { class: 'of-btn of-btn--primary of-btn--sm', type: 'submit' });
  const form = h('form', { class: 'ui-chat__form' }, input, send);
  const closeBtn = h('button', { class: 'ui-icon-btn', type: 'button' });
  closeBtn.innerHTML = SHELL_ICONS.close;
  const title = h('h3');
  const el = h(
    'aside',
    { class: 'ui-drawer ui-drawer--right ui-chat of-panel of-panel--float', attrs: { id: 'ui-chat' }, hidden: true },
    h('header', { class: 'ui-drawer__head' }, title, closeBtn),
    tabBar,
    list,
    empty,
    form,
  );

  const currentZone = () => zoneOfUser(store.zones.values(), store.selfId);

  function renderTabs(): void {
    const zone = currentZone();
    active = resolveActiveScope(active, zone);
    for (const [scope, b] of tabs) {
      const a = scopeAvailability(scope, zone, ctx.zoneName);
      setText(b, a.label);
      b.disabled = !a.enabled;
      b.title = a.enabled ? '' : t('shell.chat.roomHint');
      b.setAttribute('aria-selected', String(scope === active));
      b.classList.toggle('is-active', scope === active);
    }
  }

  function line(m: ChatMessage): HTMLElement {
    const own = m.from === store.selfId;
    const chipText = m.scope === 'room' ? (m.zone ? (ctx.zoneName(m.zone) ?? scopeLabel('room')) : scopeLabel('room')) : scopeLabel(m.scope);
    const chip = h('span', { class: `of-chip ${m.scope === 'room' ? 'of-chip--room' : m.scope === 'near' ? 'of-chip--near' : 'of-chip--global'}`, text: chipText });
    return h(
      'div',
      { class: `ui-chat__msg of-bubble${own ? ' of-bubble--own' : ''}`, attrs: { 'data-id': m.id } },
      h('div', { class: 'ui-chat__meta' }, h('span', { class: 'ui-chat__time', text: formatClock(m.ts, false) }), h('strong', { class: 'ui-chat__name', text: own ? t('shell.you') : m.name }), chip),
      h('div', { class: 'ui-chat__text', text: m.text }),
    );
  }

  function renderEmpty(): void {
    const none = list.childElementCount === 0;
    setHidden(empty, !none);
    if (none) setText(empty, active === 'near' ? t('shell.chat.empty.near') : active === 'room' ? t('shell.chat.empty.room') : t('shell.chat.empty.global'));
  }

  function renderList(): void {
    list.replaceChildren(...messagesFor(store.chat, active, currentZone(), CHAT_VISIBLE_MAX).map(line));
    list.scrollTop = list.scrollHeight;
    renderEmpty();
  }

  /** Textos fixos; roda na montagem e a cada troca de idioma (a lista é refeita se estiver aberta). */
  function applyTexts(): void {
    setText(title, t('shell.chat.title'));
    el.setAttribute('aria-label', t('shell.chat.title'));
    tabBar.setAttribute('aria-label', t('shell.chat.scope'));
    list.setAttribute('aria-label', t('shell.chat.messages'));
    input.placeholder = t('shell.chat.placeholder');
    input.setAttribute('aria-label', t('shell.chat.message'));
    setText(send, t('shell.chat.send'));
    closeBtn.title = t('shell.chat.close');
    closeBtn.setAttribute('aria-label', t('shell.chat.close'));
    renderTabs();
    if (open) renderList();
    else renderEmpty();
  }

  function setUnread(n: number): void {
    if (n === unread) return;
    unread = n;
    for (const cb of unreadCbs) cb(n);
  }

  function markSeen(): void {
    lastSeen = lastMessageId(store.chat);
    setUnread(0);
  }

  function setScope(scope: ChatScope): void {
    const a = scopeAvailability(scope, currentZone(), ctx.zoneName);
    if (!a.enabled) return;
    active = scope;
    renderTabs();
    renderList();
  }

  function setOpen(v: boolean): void {
    if (v === open) return;
    open = v;
    setHidden(el, !v);
    if (v) {
      renderTabs();
      renderList();
      markSeen();
    }
    for (const cb of toggleCbs) cb(v);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = prepareChatText(input.value);
    if (!text) return;
    if (!socket.send({ t: 'chat', scope: active, text })) {
      ctx.notify(t('shell.chat.sendOffline'), 'warn');
      return;
    }
    input.value = '';
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      input.blur();
    }
  });
  closeBtn.addEventListener('click', () => setOpen(false));

  const offs = [
    store.on('chat', (m) => {
      if (open) {
        const zone = currentZone();
        if (messagesFor([m], active, zone).length) {
          const stick = list.scrollHeight - list.scrollTop - list.clientHeight < 40 || m.from === store.selfId;
          list.append(line(m));
          while (list.childElementCount > CHAT_VISIBLE_MAX) list.firstElementChild?.remove();
          if (stick) list.scrollTop = list.scrollHeight;
          renderEmpty();
        }
        markSeen();
      } else {
        setUnread(countUnread(store.chat, lastSeen, store.selfId));
      }
    }),
    store.on('zone', () => open && renderTabs()),
    store.on('reset', () => {
      renderTabs();
      if (open) {
        renderList();
        markSeen();
      } else {
        lastSeen = Math.min(lastSeen, lastMessageId(store.chat));
        setUnread(countUnread(store.chat, lastSeen, store.selfId));
      }
    }),
    onLocaleChange(applyTexts),
  ];
  applyTexts();

  return {
    el,
    get isOpen() {
      return open;
    },
    get unread() {
      return unread;
    },
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(!open),
    focusInput(scope) {
      setOpen(true);
      if (scope) setScope(scope);
      requestAnimationFrame(() => input.focus());
    },
    onUnread(cb) {
      unreadCbs.add(cb);
      return () => void unreadCbs.delete(cb);
    },
    onToggle(cb) {
      toggleCbs.add(cb);
      return () => void toggleCbs.delete(cb);
    },
    destroy() {
      for (const off of offs) off();
      el.remove();
    },
  };
}

export { badgeText };
