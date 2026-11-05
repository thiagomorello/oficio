// Cartão de perfil perto do avatar clicado: nome, cargo, status, sala e "Conversar perto".
import type { PanelCtx } from './deps';
import { h, setHidden } from './dom';
import { headThumb } from './avatars';
import { statusLabel } from './participants-logic';
import { zoneOfUser } from './chat-logic';
import { t } from '../i18n';

export interface ProfileCard {
  readonly el: HTMLElement;
  show(userId: number, x: number, y: number): void;
  hide(): void;
  destroy(): void;
}

export function createProfileCard(ctx: PanelCtx, onChatNear: () => void): ProfileCard {
  const { store, world, art } = ctx;
  const el = h('div', { class: 'ui-profile of-panel of-panel--float', role: 'dialog', attrs: { 'aria-label': t('shell.profile.title') }, hidden: true });
  let shownFor: number | null = null;

  function hide(): void {
    if (shownFor === null) return;
    shownFor = null;
    setHidden(el, true);
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
  }
  function onOutside(e: Event): void {
    const t = e.target as HTMLElement | null;
    if (t && el.contains(t)) return;
    // Cliques no canvas são tratados pela seleção do mundo (que chama hide quando limpa).
    if (t && t.id === 'world') return;
    hide();
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') hide();
  }

  function show(userId: number, x: number, y: number): void {
    const u = store.users.get(userId);
    if (!u) return;
    const self = userId === store.selfId;
    const zoneId = zoneOfUser(store.zones.values(), userId);
    const zone = zoneId ? ctx.zoneName(zoneId) : undefined;
    el.setAttribute('aria-label', t('shell.profile.title'));
    const close = h('button', { class: 'ui-icon-btn ui-profile__close', type: 'button', title: t('common.close'), attrs: { 'aria-label': t('common.close') }, text: '×' });
    close.addEventListener('click', hide);
    const chat = h('button', { class: 'of-btn of-btn--primary of-btn--sm', type: 'button', text: t('shell.profile.chatNear') });
    chat.addEventListener('click', () => {
      hide();
      onChatNear();
    });
    el.replaceChildren(
      close,
      h(
        'div',
        { class: 'ui-profile__top' },
        headThumb(art, u.appearance, u.name, 'ui-head--lg'),
        h('div', { class: 'ui-profile__who' }, h('strong', { class: 'ui-profile__name', text: self ? t('shell.nameYou', { name: u.name }) : u.name }), u.role ? h('span', { class: 'of-caption', text: u.role }) : null),
      ),
      h('div', { class: 'ui-profile__meta' }, h('span', { class: `ui-dot ui-dot--${u.status}` }), h('span', { text: statusLabel(u.status) }), zone ? h('span', { class: 'of-caption', text: `· ${zone}` }) : null),
      ...(self ? [] : [chat]),
    );
    setHidden(el, false);
    shownFor = userId;
    const w = el.offsetWidth;
    const hgt = el.offsetHeight;
    el.style.left = `${Math.round(Math.max(8, Math.min(innerWidth - w - 8, x - w / 2)))}px`;
    const above = y - hgt - 12;
    el.style.top = `${Math.round(above >= 56 ? above : Math.min(innerHeight - hgt - 8, y + 24))}px`;
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
  }

  const offSel = world.onSelect((sel) => {
    if (!sel || sel.type !== 'agent') hide();
  });

  return {
    el,
    show,
    hide,
    destroy() {
      offSel();
      hide();
      el.remove();
    },
  };
}
