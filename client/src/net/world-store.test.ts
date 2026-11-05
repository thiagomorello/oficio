import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, FLAG_MOVING, type Appearance, FLAG_SEATED, FLAG_TP, type EntityState, type UserPublic } from '../../../shared/model';
import { PROTOCOL_VERSION, packEntity, type ServerMsg } from '../../../shared/protocol';
import { CHAT_RING, OfficeClientStore } from './world-store';

const user = (id: number, name = `U${id}`): UserPublic => ({ id, name, role: null, appearance: null, status: 'available' });
const ent = (id: number, x: number, y: number, extra: Partial<EntityState> = {}): EntityState => ({ id, x, y, dir: 'down', pose: 'stand', held: 'none', moving: false, run: false, ...extra });

function welcome(over: Partial<Extract<ServerMsg, { t: 'welcome' }>> = {}): ServerMsg {
  return {
    t: 'welcome',
    v: PROTOCOL_VERSION,
    you: { ...user(1, 'Eu'), email: 'eu@x', isAdmin: false, mustChangePassword: false, settings: DEFAULT_SETTINGS },
    tick: 100,
    now: 50_000,
    map: { id: 3, version: 3, etag: '"m3-1"' },
    entities: [ent(1, 5.5, 5.6875), ent(2, 8.5, 5.6875, { seat: 'open#f1:desk' })],
    users: [user(1, 'Eu'), user(2, 'Bia')],
    zones: [{ id: 'sala', locked: false, members: [] }],
    desks: [{ id: 'open#f1', userId: 2, decor: null }],
    chat: [],
    ...over,
  };
}

function mkStore(start = 50_000) {
  let now = start;
  const store = new OfficeClientStore({ serverNow: () => now });
  return { store, advance: (ms: number) => (now += ms), at: () => now };
}

describe('OfficeClientStore', () => {
  it('welcome: usuários, entidades (px nas amostras), zonas, mesas, mapa e o próprio usuário', () => {
    const { store } = mkStore();
    const events: string[] = [];
    store.on('reset', (r) => events.push(r.reason));
    store.apply(welcome());
    expect(events).toEqual(['welcome']);
    expect(store.selfId).toBe(1);
    expect(store.nameOf(2)).toBe('Bia');
    expect(store.map).toEqual({ id: 3, version: 3, etag: '"m3-1"' });
    expect(store.samples.get(1)![0]).toMatchObject({ x: 5.5 * 16, y: 5.6875 * 16, ts: 50_000 });
    expect(store.samples.get(2)![0].flags & FLAG_SEATED).toBe(FLAG_SEATED);
    expect(store.desks.get('open#f1')?.userId).toBe(2);
    expect(store.deskOf(2)?.id).toBe('open#f1');
  });

  it('deltas: desempacota, ignora ticks repetidos/antigos e marca o tempo pelo tick', () => {
    const { store, advance } = mkStore();
    store.apply(welcome());
    advance(100);
    const moved = ent(2, 9, 5.6875, { moving: true, pose: 'walk', dir: 'right' });
    store.apply({ t: 'delta', tick: 102, e: [packEntity(moved)] });
    const e2 = store.entities.get(2)!;
    expect(e2).toMatchObject({ x: 9, moving: true, pose: 'walk', dir: 'right' });
    // FLAG_SEATED sumiu do delta: o assento é removido
    expect(e2.seat).toBeUndefined();
    const buf = store.samples.get(2)!;
    expect(buf[buf.length - 1]).toMatchObject({ ts: 50_100, x: 144, flags: FLAG_MOVING });
    // tick repetido e tick antigo: ignorados
    store.apply({ t: 'delta', tick: 102, e: [packEntity(ent(2, 1, 1))] });
    store.apply({ t: 'delta', tick: 101, e: [packEntity(ent(2, 1, 1))] });
    expect(store.entities.get(2)!.x).toBe(9);
    expect(store.lastTick).toBe(102);
  });

  it('delta de entidade desconhecida cria a entidade; teleporte zera o buffer', () => {
    const { store, advance } = mkStore();
    store.apply(welcome());
    advance(100);
    store.apply({ t: 'delta', tick: 102, e: [packEntity(ent(7, 2.5, 3.6875))] });
    expect(store.entities.get(7)).toMatchObject({ id: 7, x: 2.5 });
    const tps: boolean[] = [];
    store.on('entity', (e) => tps.push(e.tp));
    advance(100);
    store.apply({ t: 'delta', tick: 104, e: [packEntity(ent(1, 20.5, 20.6875, { tp: 1 }))] });
    expect(tps).toEqual([true]);
    expect(store.entities.get(1)!.tp).toBe(1);
    expect(store.samples.get(1)).toHaveLength(1);
    expect(store.samples.get(1)![0].flags & FLAG_TP).toBe(FLAG_TP);
  });

  it('state antigo é ignorado; state novo substitui o mundo', () => {
    const { store } = mkStore();
    store.apply(welcome());
    store.apply({ t: 'state', tick: 90, entities: [], zones: [], desks: [] });
    expect(store.entities.size).toBe(2);
    store.apply({ t: 'state', tick: 120, entities: [ent(2, 1, 1)], zones: [], desks: [] });
    expect([...store.entities.keys()]).toEqual([2]);
    expect(store.desks.size).toBe(0);
  });

  it('join/leave, status, aparência (nome exibido) e chat em anel de 300', () => {
    const { store } = mkStore();
    store.apply(welcome());
    store.apply({ t: 'join', user: user(9, 'Caio'), entity: ent(9, 1.5, 1.6875) });
    expect(store.entities.has(9)).toBe(true);
    store.apply({ t: 'status', id: 9, status: 'busy' });
    expect(store.users.get(9)!.status).toBe('busy');
    store.apply({ t: 'leave', id: 9 });
    expect(store.entities.has(9)).toBe(false);
    expect(store.nameOf(9)).toBe('Caio');
    store.apply({ t: 'appearance', id: 1, appearance: {} as Appearance, displayName: 'Eu Mesmo' });
    expect(store.self!.name).toBe('Eu Mesmo');
    for (let i = 0; i < CHAT_RING + 20; i++) store.apply({ t: 'chat', msg: { id: i, scope: 'global', zone: null, from: 2, name: 'Bia', text: `m${i}`, ts: i } });
    expect(store.chat).toHaveLength(CHAT_RING);
    expect(store.chat[0].id).toBe(20);
  });

  it('fantasma: campo `ghost` tolerado em usuários/entidades/status (o protocolo ainda não define)', () => {
    const { store } = mkStore();
    store.apply(welcome({ users: [user(1), { ...user(2), ghost: true } as UserPublic] }));
    expect(store.ghosts.has(2)).toBe(true);
    store.apply({ t: 'status', id: 2, status: 'away', ghost: false } as ServerMsg);
    expect(store.ghosts.has(2)).toBe(false);
    store.apply({ t: 'join', user: user(5), entity: { ...ent(5, 1, 1), ghost: 1 } as EntityState });
    expect(store.ghosts.has(5)).toBe(true);
    store.apply({ t: 'leave', id: 5 });
    expect(store.ghosts.has(5)).toBe(false);
  });

  it('mesas, zonas, mapa, av_set e eventos de movimento', () => {
    const { store } = mkStore();
    store.apply(welcome());
    const seen: string[] = [];
    store.on('map', (m) => seen.push(`map:${m.version}`));
    store.on('reject', (r) => seen.push(`reject:${r.reason}`));
    store.apply({ t: 'desk', desk: 'open#f1', userId: null, decor: null });
    store.apply({ t: 'zone', zone: { id: 'sala', locked: true, members: [1] } });
    store.apply({ t: 'map', id: 4, version: 4 });
    store.apply({ t: 'av_set', hear: [2], allow: [2], volumes: { '2': 1 }, screenAllowed: false });
    store.apply({ t: 'moved_reject', seq: 3, reason: 'locked', x: 5, y: 5 });
    expect(store.desks.get('open#f1')!.userId).toBeNull();
    expect(store.zones.get('sala')!.locked).toBe(true);
    expect(store.map).toEqual({ id: 4, version: 4 });
    expect(store.avSet!.hear).toEqual([2]);
    expect(seen).toEqual(['map:4', 'reject:locked']);
  });

  it('relógio dos ticks: rebaseia quando a estimativa foge do relógio do servidor', () => {
    const { store, advance, at } = mkStore();
    store.apply(welcome());
    advance(120);
    // dentro do esperado: instante pelo tick (100 ms depois do welcome)
    expect(store.tickTime(102)).toBe(50_100);
    advance(5000);
    // tick 104 "deveria" ser 50_200, mas o relógio já está em 55_120: rebaseia para agora
    expect(store.tickTime(104)).toBe(at());
    advance(100);
    expect(store.tickTime(106)).toBe(at());
  });

  it('media (WP8): welcome/join carregam e a mensagem atualiza mic/câmera/tela/fala', () => {
    const { store } = mkStore();
    store.apply(welcome({ users: [user(1, 'Eu'), { ...user(2, 'Bia'), media: { mic: false, cam: true, screen: false, speaking: false } }] }));
    expect(store.media.get(2)).toEqual({ mic: false, cam: true, screen: false });
    const events: unknown[] = [];
    store.on('media', (m) => events.push(m));
    store.on('speaking', (m) => events.push(m));
    store.apply({ t: 'media', id: 2, mic: true, cam: true, screen: true, speaking: true });
    expect(store.media.get(2)).toEqual({ mic: true, cam: true, screen: true });
    expect(store.speaking.has(2)).toBe(true);
    expect(events).toEqual([{ id: 2, media: { mic: true, cam: true, screen: true } }, { id: 2, speaking: true }]);
    store.apply({ t: 'join', user: { ...user(3), media: { mic: true, cam: false, screen: false, speaking: true } }, entity: ent(3, 1, 1) });
    expect(store.speaking.has(3)).toBe(true);
  });
});
