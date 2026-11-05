// Indicador de sala (WP9 / regras do WP4): cartão da sala de reunião em que estou (trancar/destrancar,
// membros, dica de compartilhar tela), aviso "Sala trancada — Bater (K)" ao chegar perto da porta de
// uma sala trancada, e os pedidos de entrada ("X está batendo na porta" -> Deixar entrar).
// Slot esperado: `#room-indicator` (canto superior esquerdo).
import type { ClientMsg, ServerMsg } from '../../../shared/protocol';
import type { OfficeAssembly, ZoneDef } from '../../../shared/map/types';
import type { ZoneState } from '../../../shared/model';
import type { OfficeClientStore } from '../net/world-store';
import type { WorldApi } from '../world/api';
import { onLocaleChange, t, tn } from '../i18n';
import { h, setHidden } from './dom';
import type { Notice } from './toasts';
import './desk-meeting.css';

/** Distância máxima (Chebyshev, em tiles) da porta para oferecer "Bater". */
export const KNOCK_RANGE = 2;
/** Pedido de entrada some do cartão depois deste tempo. */
export const KNOCK_CARD_MS = 60_000;

export interface TilePos {
  id: number;
  tx: number;
  ty: number;
}

type ZonesLike = ReadonlyMap<string, ZoneState> | Iterable<ZoneState>;

function zoneStates(zones: ZonesLike): Iterable<ZoneState> {
  return zones instanceof Map ? zones.values() : (zones as Iterable<ZoneState>);
}

/**
 * Sala trancada cuja porta está a ≤ `range` tiles (Chebyshev) de mim, da qual não sou membro.
 * Devolve a mais próxima ou null (puro).
 */
export function nearLockedDoor(assembly: Pick<OfficeAssembly, 'zoneById'>, self: TilePos, zones: ZonesLike, range = KNOCK_RANGE): ZoneDef | null {
  let best: ZoneDef | null = null;
  let bestD = Infinity;
  for (const st of zoneStates(zones)) {
    if (!st.locked || st.members.includes(self.id)) continue;
    const def = assembly.zoneById.get(st.id);
    if (!def) continue;
    for (const d of def.doorTiles) {
      const dist = Math.max(Math.abs(d.x - self.tx), Math.abs(d.y - self.ty));
      if (dist <= range && dist < bestD) {
        best = def;
        bestD = dist;
      }
    }
  }
  return best;
}

/** Sala `lockable` (reunião) em que estou, ou null (puro). */
export function currentMeetingZone(assembly: Pick<OfficeAssembly, 'zoneById'>, selfId: number, zones: ZonesLike): { def: ZoneDef; state: ZoneState } | null {
  for (const st of zoneStates(zones)) {
    if (!st.members.includes(selfId)) continue;
    const def = assembly.zoneById.get(st.id);
    if (def?.lockable) return { def, state: st };
  }
  return null;
}

/** Tecla K deve bater na porta? Ignora campos de texto e combinações com modificadores (puro). */
export function isKnockKey(ev: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; repeat?: boolean; target?: unknown }): boolean {
  if (ev.key !== 'k' && ev.key !== 'K') return false;
  if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.repeat) return false;
  const t = ev.target as { tagName?: string; isContentEditable?: boolean } | null | undefined;
  const tag = t?.tagName?.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return false;
  return true;
}

export interface RoomIndicatorDeps {
  store: OfficeClientStore;
  world: Pick<WorldApi, 'minimapSource'>;
  socket: { send(msg: ClientMsg): boolean };
  toast?: { push(n: Notice): void };
}

export interface RoomIndicatorHandle {
  destroy(): void;
}

interface KnockCard {
  from: number;
  zone: string;
  el: HTMLElement;
  timer: ReturnType<typeof setTimeout>;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function mountRoomIndicator(slot: HTMLElement, deps: RoomIndicatorDeps): RoomIndicatorHandle {
  const { store, socket } = deps;
  const toast = (n: Omit<Notice, 'at'>): void => deps.toast?.push({ ...n, at: Date.now() });

  const title = h('strong', { class: 'of-room__name' });
  const lockedTag = h('span', { class: 'of-room__tag', hidden: true });
  const members = h('div', { class: 'of-room__members' });
  const count = h('span', { class: 'of-room__count' });
  const lockBtn = h('button', { class: 'of-btn of-btn--secondary of-btn--sm', type: 'button' });
  const hint = h('p', { class: 'of-room__hint' });
  const card = h(
    'section',
    { class: 'of-panel of-panel--float of-room', hidden: true },
    h('div', { class: 'of-room__head' }, title, lockedTag),
    h('div', { class: 'of-room__row' }, members, count),
    h('div', { class: 'of-room__row' }, lockBtn),
    hint,
  );

  const doorMsg = h('span', { class: 'of-room__door-msg' });
  const knockBtn = h('button', { class: 'of-btn of-btn--primary of-btn--sm', type: 'button' });
  const door = h('section', { class: 'of-panel of-panel--float of-room of-room--door', role: 'status', hidden: true }, doorMsg, knockBtn);
  const knocks = h('div', { class: 'of-room__knocks', attrs: { 'aria-live': 'polite' } });
  slot.classList.add('of-room-slot');
  slot.append(card, door, knocks);

  let meeting: { def: ZoneDef; state: ZoneState } | null = null;
  let doorZone: ZoneDef | null = null;
  let lastMembers = "";
  const cards: KnockCard[] = [];

  const assembly = (): OfficeAssembly => deps.world.minimapSource().assembly;

  const selfPos = (): TilePos | null => {
    const id = store.selfId;
    const e = id === null ? undefined : store.entities.get(id);
    return id !== null && e ? { id, tx: Math.floor(e.x), ty: Math.floor(e.y) } : null;
  };

  const dropCard = (k: KnockCard): void => {
    clearTimeout(k.timer);
    k.el.remove();
    const i = cards.indexOf(k);
    if (i >= 0) cards.splice(i, 1);
  };

  const sendLock = (): void => {
    if (meeting) socket.send({ t: 'lock', zone: meeting.def.id, locked: !meeting.state.locked });
  };
  const sendKnock = (): void => {
    if (doorZone) socket.send({ t: 'knock', zone: doorZone.id });
  };
  lockBtn.addEventListener('click', sendLock);
  knockBtn.addEventListener('click', sendKnock);

  const update = (): void => {
    const pos = selfPos();
    const asm = assembly();
    meeting = pos ? currentMeetingZone(asm, pos.id, store.zones) : null;
    doorZone = pos && !meeting ? nearLockedDoor(asm, pos, store.zones) : null;

    setHidden(card, !meeting);
    if (meeting) {
      const { def, state } = meeting;
      title.textContent = def.name;
      setHidden(lockedTag, !state.locked);
      lockBtn.textContent = state.locked ? t('shell.room.unlock') : t('shell.room.lock');
      lockBtn.setAttribute('aria-pressed', String(state.locked));
      count.textContent = tn('common.people', state.members.length);
      const mKey = state.members.join(",") + "|" + pos?.id;
      if (mKey !== lastMembers) {
        lastMembers = mKey;
      members.replaceChildren(
        ...state.members.slice(0, 8).map((id) => h('span', { class: `of-room__avatar${id === pos?.id ? ' is-self' : ''}`, title: store.nameOf(id), text: initials(store.nameOf(id)) })),
        ...(state.members.length > 8 ? [h('span', { class: 'of-room__avatar of-room__avatar--more', text: `+${state.members.length - 8}` })] : []),
      );
      }
    }

    setHidden(door, !doorZone);
    if (doorZone) {
      doorMsg.textContent = t('shell.room.doorLocked', { name: doorZone.name });
      knockBtn.textContent = t('shell.room.knock');
    }

    // Pedidos de entrada de salas que não estão mais trancadas/ou das quais saí perdem o sentido.
    for (const k of [...cards]) {
      const st = store.zones.get(k.zone);
      if (!st || !st.locked || !st.members.includes(store.selfId ?? -1)) dropCard(k);
    }
  };

  /** Textos fixos do cartão; roda na montagem e a cada troca de idioma (o resto sai do update). */
  const applyTexts = (): void => {
    lockedTag.textContent = t('shell.room.locked');
    members.setAttribute('aria-label', t('shell.room.members'));
    hint.textContent = t('shell.room.screenHint');
    card.setAttribute('aria-label', t('shell.room.meetingRoom'));
    update();
  };

  const onKnock = (m: Extract<ServerMsg, { t: 'knock' }>): void => {
    const zoneName = assembly().zoneById.get(m.zone)?.name ?? t('shell.room.fallbackName');
    toast({ level: 'info', text: t('shell.room.knockingAt', { name: m.name, room: zoneName }) });
    const prev = cards.find((k) => k.from === m.from && k.zone === m.zone);
    if (prev) dropCard(prev);
    const answer = (allow: boolean) => (): void => {
      socket.send({ t: 'admit', zone: m.zone, user: m.from, allow });
      dropCard(k);
    };
    const el = h(
      'div',
      { class: 'of-panel of-panel--float of-room of-room--knock', role: 'alert' },
      h('p', { class: 'of-room__knock-msg', text: t('shell.room.knocking', { name: m.name }) }),
      h(
        'div',
        { class: 'of-room__row' },
        h('button', { class: 'of-btn of-btn--primary of-btn--sm', type: 'button', text: t('shell.room.admit'), on: { click: answer(true) } }),
        h('button', { class: 'of-btn of-btn--secondary of-btn--sm', type: 'button', text: t('shell.room.refuse'), on: { click: answer(false) } }),
      ),
    );
    const k: KnockCard = { from: m.from, zone: m.zone, el, timer: setTimeout(() => dropCard(k), KNOCK_CARD_MS) };
    cards.push(k);
    knocks.append(el);
  };

  const onResult = (m: Extract<ServerMsg, { t: 'knock_result' }>): void => {
    const zoneName = assembly().zoneById.get(m.zone)?.name ?? t('shell.room.fallbackName');
    if (m.allow) toast({ level: 'success', text: t('shell.room.admitted', { room: zoneName }) });
    else toast({ level: 'warn', text: t('shell.room.refused', { room: zoneName }) });
  };

  const onKey = (ev: KeyboardEvent): void => {
    if (!doorZone || !isKnockKey(ev)) return;
    ev.preventDefault();
    sendKnock();
  };
  window.addEventListener('keydown', onKey);

  const offs = [
    store.on('zone', update),
    store.on('entity', (e) => {
      if (e.id === store.selfId) update();
    }),
    store.on('reset', update),
    store.on('user', update),
    store.on('map', update),
    store.on('knock', onKnock),
    store.on('knock_result', onResult),
    onLocaleChange(applyTexts),
  ];
  applyTexts();

  return {
    destroy: () => {
      for (const f of offs) f();
      window.removeEventListener('keydown', onKey);
      for (const k of [...cards]) dropCard(k);
      card.remove();
      door.remove();
      knocks.remove();
    },
  };
}
