// Menu de contexto das mesas (WP9 / Adendo D.4): clique numa mesa -> reivindicar, decorar, liberar.
// Cliques em avatares são tratados pelo cartão de perfil do shell (ignorados aqui).
// Slot esperado: `#context-menu`. Conexão no main/ui: `mountContextMenu(slot, deps)`.
import type { ClientMsg } from '../../../shared/protocol';
import type { DeskDef, OfficeAssembly } from '../../../shared/map/types';
import type { DeskState } from '../../../shared/model';
import type { OfficeClientStore } from '../net/world-store';
import type { WorldApi, WorldEvent } from '../world/api';
import { t, type MessageKey } from '../i18n';
import { h } from './dom';
import './desk-meeting.css';

export type DeskMenuAction = 'claim' | 'decorate' | 'release';

export interface DeskMenuItem {
  id: DeskMenuAction | 'info';
  label: string;
  disabled?: boolean;
  danger?: boolean;
}

export interface DeskMenuModel {
  title: string;
  items: DeskMenuItem[];
}

/**
 * Monta os itens do menu de uma mesa (puro).
 * Livre -> reivindicar; minha -> decorar + liberar; de outra pessoa -> só o nome do dono.
 */
export function buildDeskMenu(
  desk: Pick<DeskDef, 'id' | 'label'>,
  state: DeskState | null | undefined,
  selfId: number | null,
  nameOf: (id: number) => string,
  hasOtherDesk = false,
): DeskMenuModel {
  const title = t('shell.desk.title', { label: desk.label });
  const owner = state?.userId ?? null;
  if (owner === null) {
    return { title, items: [{ id: 'claim', label: hasOtherDesk ? t('shell.desk.claimSwap') : t('shell.desk.claim') }] };
  }
  if (selfId !== null && owner === selfId) {
    return {
      title,
      items: [
        { id: 'decorate', label: t('shell.desk.decorate') },
        { id: 'release', label: t('shell.desk.release'), danger: true },
      ],
    };
  }
  return { title, items: [{ id: 'info', label: t('shell.desk.ownedBy', { name: nameOf(owner) }), disabled: true }] };
}

/** Minha mesa no mapa atual (ou null). */
export function myDeskDef(store: Pick<OfficeClientStore, 'desks' | 'selfId'>, assembly: Pick<OfficeAssembly, 'deskById'>): DeskDef | null {
  const me = store.selfId;
  if (me === null) return null;
  for (const d of store.desks.values()) if (d.userId === me) return assembly.deskById.get(d.id) ?? null;
  return null;
}

/** Anda até a própria mesa e senta (a réplica anda e senta ao chegar). false se não há mesa/assento. */
export function goToMyDesk(deps: {
  store: Pick<OfficeClientStore, 'desks' | 'selfId'>;
  world: Pick<WorldApi, 'minimapSource'>;
  replica: { sit(spotId: string, run?: boolean): boolean };
}): boolean {
  const desk = myDeskDef(deps.store, deps.world.minimapSource().assembly);
  if (!desk) return false;
  return deps.replica.sit(desk.spotId);
}

export interface ContextMenuDeps {
  store: OfficeClientStore;
  world: WorldApi;
  socket: { send(msg: ClientMsg): boolean };
  /** Abre o popover de decoração perto do ponto (px CSS). */
  openDecor(deskId: string, anchor: { x: number; y: number }): void;
}

export interface ContextMenuHandle {
  close(): void;
  destroy(): void;
}

/** Rótulo da ação "usar" por tipo de ponto (chave da mensagem; tipos desconhecidos caem em `shell.use.default`). */
const USE_LABEL_KEYS: Record<string, MessageKey> = {
  coffee: 'shell.use.coffee',
  water: 'shell.use.water',
  snack: 'shell.use.snack',
  fridge: 'shell.use.fridge',
  sink: 'shell.use.sink',
  stall: 'shell.use.stall',
  arcade: 'shell.use.arcade',
  pingpong: 'shell.use.pingpong',
  shelf: 'shell.use.shelf',
  whiteboard: 'shell.use.whiteboard',
};

export function mountContextMenu(slot: HTMLElement, deps: ContextMenuDeps): ContextMenuHandle {
  const { store, world, socket } = deps;
  let current: HTMLElement | null = null;
  let cleanup: Array<() => void> = [];

  const close = (): void => {
    for (const fn of cleanup) fn();
    cleanup = [];
    current?.remove();
    current = null;
  };

  const place = (el: HTMLElement, x: number, y: number): void => {
    slot.append(el);
    const w = el.offsetWidth;
    const hgt = el.offsetHeight;
    const left = Math.max(8, Math.min(x, innerWidth - w - 8));
    const top = Math.max(8, Math.min(y, innerHeight - hgt - 8));
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  };

  const open = (el: HTMLElement, x: number, y: number): void => {
    close();
    current = el;
    place(el, x, y);
    const onDown = (ev: PointerEvent): void => {
      if (current && !current.contains(ev.target as Node)) close();
    };
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    cleanup = [
      () => document.removeEventListener('pointerdown', onDown, true),
      () => document.removeEventListener('keydown', onKey),
      () => window.removeEventListener('resize', close),
    ];
    el.querySelector<HTMLElement>('button:not([disabled])')?.focus({ preventScroll: true });
  };

  const confirmRelease = (x: number, y: number): void => {
    const el = h(
      'div',
      { class: 'of-menu of-ctx of-ctx--confirm', role: 'alertdialog', attrs: { 'aria-label': t('shell.desk.release') } },
      h('p', { class: 'of-ctx__msg', text: t('shell.desk.releaseConfirm') }),
      h(
        'div',
        { class: 'of-ctx__actions' },
        h('button', { class: 'of-btn of-btn--secondary of-btn--sm', type: 'button', text: t('common.cancel'), on: { click: close } }),
        h('button', {
          class: 'of-btn of-btn--primary of-btn--sm',
          type: 'button',
          text: t('shell.desk.releaseAction'),
          on: {
            click: () => {
              socket.send({ t: 'desk_release' });
              close();
            },
          },
        }),
      ),
    );
    open(el, x, y);
  };

  const onDeskClick = (deskId: string, x: number, y: number): void => {
    const assembly = world.minimapSource().assembly;
    const def = assembly.deskById.get(deskId);
    if (!def) return;
    const model = buildDeskMenu(def, store.desks.get(deskId), store.selfId, (id) => store.nameOf(id), myDeskDef(store, assembly) !== null);
    const list = h('ul', { class: 'of-menu of-ctx', role: 'menu', attrs: { 'aria-label': model.title } }, h('li', { class: 'of-ctx__title', text: model.title, role: 'presentation' }));
    for (const it of model.items) {
      const btn = h('button', {
        class: `of-menu__item${it.danger ? ' of-menu__item--danger' : ''}`,
        type: 'button',
        role: 'menuitem',
        text: it.label,
        attrs: { 'aria-disabled': it.disabled },
        on: {
          click: () => {
            if (it.disabled) return;
            if (it.id === 'claim') {
              socket.send({ t: 'desk_claim', desk: deskId });
              close();
            } else if (it.id === 'decorate') {
              close();
              deps.openDecor(deskId, { x, y });
            } else if (it.id === 'release') {
              confirmRelease(x, y);
            }
          },
        },
      });
      if (it.disabled) btn.disabled = true;
      list.append(h('li', { role: 'none' }, btn));
    }
    open(list, x, y);
  };

  /** Menu do botão direito num ponto do mapa: ir até lá, sentar, mesa. */
  const onTileMenu = (e: Extract<WorldEvent, { type: 'menu' }>): void => {
    if (e.desk && !e.seat) return onDeskClick(e.desk, e.x, e.y);
    const items: { label: string; run: () => void; disabled?: boolean }[] = [];
    if (e.user !== null && e.user !== store.selfId) items.push({ label: t('shell.menu.goTo', { name: store.nameOf(e.user) }), run: () => void world.moveTo(e.tx, e.ty) });
    if (e.use) items.push({ label: t(USE_LABEL_KEYS[e.use.kind] ?? 'shell.use.default'), run: () => void world.useAt(e.use!.id) });
    if (e.seat) items.push({ label: t('shell.menu.sitHere'), run: () => { if (!world.sitAt(e.seat!)) socket.send({ t: 'sit', spot: e.seat! }); } });
    items.push({ label: t('shell.menu.walkHere'), disabled: !e.walkable, run: () => void world.moveTo(e.tx, e.ty) });
    items.push({ label: t('shell.menu.runHere'), disabled: !e.walkable, run: () => void world.moveTo(e.tx, e.ty, true) });
    if (e.desk) items.push({ label: t('shell.menu.desk'), run: () => onDeskClick(e.desk!, e.x, e.y) });
    const list = h('ul', { class: 'of-menu of-ctx', role: 'menu', attrs: { 'aria-label': t('shell.menu.actions') } });
    for (const it of items) {
      const btn = h('button', { class: 'of-menu__item', type: 'button', role: 'menuitem', text: it.label, attrs: { 'aria-disabled': !!it.disabled }, on: { click: () => { if (it.disabled) return; close(); it.run(); } } });
      if (it.disabled) btn.disabled = true;
      list.append(h('li', { role: 'none' }, btn));
    }
    open(list, e.x, e.y);
  };

  const off = world.on((e) => {
    if (e.type === 'desk') onDeskClick(e.desk, e.x, e.y);
    else if (e.type === 'menu') onTileMenu(e);
    else if (e.type === 'select') close();
  });

  return {
    close,
    destroy: () => {
      off();
      close();
    },
  };
}
