// Participantes (gaveta à esquerda): quem está online, com status, sala e mic/câmera. Clique foca a pessoa.
import { onLocaleChange, t } from '../i18n';
import type { Panel, PanelCtx } from './deps';
import { h, KeyedList, setHidden, setText } from './dom';
import { headThumb, updateHead } from './avatars';
import { buildRows, filterRows, sortRows, statusLabel, type ParticipantRow } from './participants-logic';
import { SHELL_ICONS } from './shell-icons';

export interface ParticipantsPanel extends Panel {
  /** Quantidade de pessoas online. */
  readonly count: number;
  onCount(cb: (n: number) => void): () => void;
  onToggle(cb: (open: boolean) => void): () => void;
}

interface RowEl extends HTMLButtonElement {
  _head?: HTMLElement;
  _name?: HTMLElement;
  _sub?: HTMLElement;
  _dot?: HTMLElement;
  _mic?: HTMLElement;
  _cam?: HTMLElement;
}

export function createParticipants(ctx: PanelCtx, opts: { onPick?: () => void } = {}): ParticipantsPanel {
  const { store, world, art } = ctx;
  let open = false;
  let count = 0;
  let query = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  const countCbs = new Set<(n: number) => void>();
  const toggleCbs = new Set<(open: boolean) => void>();

  const title = h('h3');
  const closeBtn = h('button', { class: 'ui-icon-btn', type: 'button' });
  closeBtn.innerHTML = SHELL_ICONS.close;
  const search = h('input', { class: 'of-input of-input--outlined', type: 'search', attrs: { autocomplete: 'off' } }) as HTMLInputElement;
  const listEl = h('div', { class: 'ui-people__list', role: 'list' });
  const empty = h('p', { class: 'of-caption ui-people__empty', hidden: true });
  const el = h(
    'aside',
    { class: 'ui-drawer ui-drawer--left ui-people of-panel of-panel--float', attrs: { id: 'ui-people' }, hidden: true },
    h('header', { class: 'ui-drawer__head' }, title, closeBtn),
    h('div', { class: 'ui-people__search' }, search),
    listEl,
    empty,
  );

  const rowsList = new KeyedList<ParticipantRow, RowEl>(listEl, {
    key: (r) => String(r.id),
    create: (r) => {
      const u = store.users.get(r.id);
      const b = h('button', { class: 'ui-person', type: 'button', role: 'listitem' }) as RowEl;
      b._head = headThumb(art, u?.appearance ?? null, r.name);
      b._dot = h('span', { class: 'ui-dot' });
      b._name = h('span', { class: 'ui-person__name' });
      b._sub = h('span', { class: 'ui-person__sub of-caption' });
      b._mic = h('span', { class: 'ui-person__media', hidden: true });
      b._mic.innerHTML = SHELL_ICONS.mic;
      b._cam = h('span', { class: 'ui-person__media', hidden: true });
      b._cam.innerHTML = SHELL_ICONS.cam;
      b.append(b._head, h('span', { class: 'ui-person__text' }, b._name, b._sub), b._mic, b._cam, b._dot);
      b.addEventListener('click', () => {
        world.focusUser(r.id);
        opts.onPick?.();
      });
      return b;
    },
    update: (b, r) => {
      const u = store.users.get(r.id);
      updateHead(b._head!, art, u?.appearance ?? null, r.name);
      setText(b._name!, r.self ? t('shell.nameYou', { name: r.name }) : r.name);
      const zone = r.zoneId ? ctx.zoneName(r.zoneId) : undefined;
      const status = statusLabel(r.status);
      setText(b._sub!, [r.role, zone].filter(Boolean).join(' · ') || (r.ghost ? t('shell.people.reconnecting') : status));
      b._dot!.className = `ui-dot ui-dot--${r.ghost ? 'ghost' : r.status}`;
      b._dot!.title = r.ghost ? t('shell.people.reconnectingTitle') : status;
      b._mic!.title = t('shell.people.micOn');
      b._cam!.title = t('shell.people.camOn');
      setHidden(b._mic!, !r.mic);
      setHidden(b._cam!, !r.cam);
      b.setAttribute('aria-label', zone ? t('shell.people.rowLabelZone', { name: r.name, status, zone }) : t('shell.people.rowLabel', { name: r.name, status }));
    },
  });

  function render(): void {
    timer = null;
    const all = buildRows({ users: store.users, online: store.entities.keys(), zones: store.zones.values(), ghosts: store.ghosts, media: store.media, selfId: store.selfId });
    if (all.length !== count) {
      count = all.length;
      for (const cb of countCbs) cb(count);
    }
    if (!open) return;
    const rows = filterRows(sortRows(all), query, ctx.zoneName);
    rowsList.sync(rows);
    setHidden(empty, rows.length > 0);
  }
  const schedule = () => {
    if (!timer) timer = setTimeout(render, 80);
  };

  /** Textos fixos; roda na montagem e a cada troca de idioma (as linhas são atualizadas pelo render). */
  function applyTexts(): void {
    setText(title, t('shell.people.title'));
    el.setAttribute('aria-label', t('shell.people.title'));
    closeBtn.title = t('shell.people.close');
    closeBtn.setAttribute('aria-label', t('shell.people.close'));
    search.placeholder = t('shell.people.searchPlaceholder');
    search.setAttribute('aria-label', t('shell.people.search'));
    setText(empty, t('shell.people.empty'));
    if (open) render();
  }

  function setOpen(v: boolean): void {
    if (v === open) return;
    open = v;
    setHidden(el, !v);
    if (v) render();
    for (const cb of toggleCbs) cb(v);
  }

  search.addEventListener('input', () => {
    query = search.value;
    render();
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (search.value) {
        search.value = '';
        query = '';
        render();
      } else search.blur();
    }
  });
  closeBtn.addEventListener('click', () => setOpen(false));

  const offs = [
    store.on('reset', schedule),
    store.on('join', schedule),
    store.on('leave', schedule),
    store.on('user', schedule),
    store.on('status', schedule),
    store.on('zone', schedule),
    store.on('media', schedule),
    onLocaleChange(applyTexts),
  ];
  applyTexts();
  render();

  return {
    el,
    get isOpen() {
      return open;
    },
    get count() {
      return count;
    },
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(!open),
    onCount(cb) {
      countCbs.add(cb);
      return () => void countCbs.delete(cb);
    },
    onToggle(cb) {
      toggleCbs.add(cb);
      return () => void toggleCbs.delete(cb);
    },
    destroy() {
      for (const off of offs) off();
      if (timer) clearTimeout(timer);
      el.remove();
    },
  };
}
