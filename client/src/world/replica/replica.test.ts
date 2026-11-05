import { describe, expect, it } from 'vitest';
import type { Appearance } from '../../art/api';
import { DEFAULT_SETTINGS, type EntityState } from '../../../../shared/model';
import { PROTOCOL_VERSION, packEntity, type ClientMsg } from '../../../../shared/protocol';
import { assembleOffice } from '../../../../shared/map/assemble';
import { OfficeClientStore } from '../../net/world-store';
import { buildSampleMap } from '../sample-map';
import { protocolPointToPx, Replica } from './replica';

const ent = (id: number, x: number, y: number, extra: Partial<EntityState> = {}): EntityState => ({ id, x, y, dir: 'down', pose: 'stand', held: 'none', moving: false, run: false, ...extra });

function setup() {
  let now = 100_000;
  const store = new OfficeClientStore({ serverNow: () => now });
  const sent: ClientMsg[] = [];
  const assembly = assembleOffice(buildSampleMap(), 0);
  const r = new Replica(store, assembly, {
    send: (m) => sent.push(m),
    serverNow: () => now,
    clock: () => ({ offset: 0, rtt: 0 }),
    appearanceFor: () => ({}) as Appearance,
    now: () => now,
  });
  const chair = assembly.spots.find((s) => s.kind === 'desk')!;
  store.apply({
    t: 'welcome', v: PROTOCOL_VERSION, tick: 10, now,
    you: { id: 1, name: 'Eu', role: null, appearance: null, status: 'available', email: 'e', isAdmin: false, mustChangePassword: false, settings: DEFAULT_SETTINGS },
    map: { id: 0, version: 0, etag: '' },
    entities: [ent(1, 5.5, 12.6875), ent(2, 10.5, 12.6875), ent(3, chair.x / 16, chair.y / 16, { pose: 'type', seat: chair.id })],
    users: [{ id: 2, name: 'Bia', role: null, appearance: null, status: 'busy' }],
    zones: [], desks: [], chat: [],
  });
  const step = (ms: number) => {
    now += ms;
    r.update(ms / 1000, now);
  };
  return { store, r, sent, step, chair, at: () => now };
}

describe('Replica', () => {
  it('cria avatares, resolve assento e ocupação; tela da mesa ocupada', () => {
    const { r, step, chair } = setup();
    step(16);
    expect(r.avatars.size).toBe(3);
    expect(r.self?.id).toBe(1);
    const sitter = r.avatars.get(3)!;
    expect(sitter.seated).toBe(true);
    expect(sitter.spot).toBe(chair.id);
    expect(sitter.sortY).toBe(chair.sortY);
    expect(r.spots.get(chair.id)).toBe(3);
  });

  it('remoto: interpolado com 120 ms de atraso; chat vira balão de 6 s', () => {
    const { store, r, step, at } = setup();
    step(100);
    store.apply({ t: 'delta', tick: 12, e: [packEntity(ent(2, 11.5, 12.6875, { moving: true, pose: 'walk', dir: 'right' }))] });
    step(100);
    store.apply({ t: 'delta', tick: 14, e: [packEntity(ent(2, 12.5, 12.6875, { moving: true, pose: 'walk', dir: 'right' }))] });
    step(60);
    const b = r.avatars.get(2)!;
    // renderTime = agora - 120 -> entre as duas primeiras amostras
    expect(b.x).toBeGreaterThan(10.5 * 16);
    expect(b.x).toBeLessThan(12.5 * 16);
    expect(b.pose).toBe('walk');
    store.apply({ t: 'chat', msg: { id: 1, scope: 'near', zone: null, from: 2, name: 'Bia', text: 'oi', ts: at() } });
    expect(b.sayText).toBe('oi');
    step(6100);
    expect(b.sayText).toBe('');
  });

  it('próprio avatar: tecla anda já e manda pos (cliente autoritativo); emote vira ícone', () => {
    const { store, r, sent, step } = setup();
    step(16);
    const x0 = r.self!.x;
    r.setDir('right');
    for (let i = 0; i < 10; i++) step(50);
    expect(sent[0]).toMatchObject({ t: 'pos', dir: 'right', moving: true });
    expect(sent.filter((m) => m.t === 'pos').length).toBeGreaterThan(5);
    expect(r.self!.x).toBeGreaterThan(x0 + 16);
    r.setDir(null);
    store.apply({ t: 'delta', tick: 40, e: [packEntity(ent(2, 10.5, 12.6875, { pose: 'cheer' }))] });
    step(200);
    expect(r.avatars.get(2)!.icon).toBe('star');
    expect(r.effects.some((e) => e.kind === 'confetti' && e.id === 2)).toBe(true);
  });

  it('assento longe: anda (pos) e só manda sit ao chegar, depois da última pos', () => {
    const { r, sent, step, chair } = setup();
    step(16);
    expect(r.sit(chair.id)).toBe(false); // ocupado pelo 3
    const free = r.assembly.spots.find((s) => s.kind === 'desk' && s.id !== chair.id)!;
    expect(r.sit(free.id)).toBe(true);
    expect(sent.some((m) => m.t === 'sit')).toBe(false);
    for (let i = 0; i < 300 && !sent.some((m) => m.t === 'sit'); i++) step(50);
    expect(sent.at(-1)).toEqual({ t: 'sit', spot: free.id });
    expect(sent.at(-2)).toMatchObject({ t: 'pos', moving: false });
  });

  it('sentado: um toque na tecla levanta e não volta para o assento enquanto o servidor ainda diz sentado', () => {
    const { r, sent, step, store } = setup();
    const seat = r.assembly.spots.find((s) => s.kind === 'desk' && store.entities.get(3)?.seat !== s.id)!;
    const seated = (tick: number) =>
      store.apply({
        t: 'state', tick, zones: [], desks: [],
        entities: [ent(1, seat.x / 16, seat.y / 16, { pose: 'type', seat: seat.id, ...(tick === 30 ? { tp: 1 as const } : {}) }), ent(2, 10.5, 12.6875)],
      });
    seated(30);
    for (let i = 0; i < 5; i++) step(50);
    expect(r.self).toMatchObject({ seated: true, x: seat.x, y: seat.y });
    sent.length = 0;

    // toque curto para baixo; o servidor ainda manda "sentado" por ~400 ms (latência)
    r.setDir('down');
    step(50);
    step(50);
    r.setDir(null);
    for (let i = 0; i < 4; i++) {
      seated(31 + i);
      step(100);
    }
    const me = r.self!;
    expect(me.seated).toBe(false);
    expect(me.y).toBeGreaterThan(seat.y + 8);
    expect(sent.some((m) => m.t === 'sit')).toBe(false);
    const y = me.y;

    // servidor confirma a saída: segue onde parou, e pode sentar de novo depois
    store.apply({ t: 'state', tick: 40, zones: [], desks: [], entities: [ent(1, me.x / 16, me.y / 16), ent(2, 10.5, 12.6875)] });
    for (let i = 0; i < 6; i++) step(50);
    expect(r.self!.y).toBe(y);
    expect(r.self!.seated).toBe(false);
  });

  it('sentado: deltas atrasados com a flag de sentado não puxam de volta depois de levantar', () => {
    const { r, step, store } = setup();
    const seat = r.assembly.spots.find((s) => s.kind === 'desk' && store.entities.get(3)?.seat !== s.id)!;
    store.apply({
      t: 'state', tick: 30, zones: [], desks: [],
      entities: [ent(1, seat.x / 16, seat.y / 16, { pose: 'type', seat: seat.id, tp: 1 }), ent(2, 10.5, 12.6875)],
    });
    step(50);
    r.setDir('down');
    step(50);
    step(50);
    r.setDir(null);
    for (let i = 0; i < 4; i++) {
      store.apply({ t: 'delta', tick: 31 + i, e: [packEntity(ent(1, seat.x / 16, seat.y / 16, { pose: 'type', seat: seat.id }))] });
      step(100);
    }
    expect(r.self!.seated).toBe(false);
    expect(r.self!.y).toBeGreaterThan(seat.y + 8);
  });

  it('state de outro jogador no meio da caminhada não para a tecla nem puxa para trás', () => {
    const { r, step, store } = setup();
    step(16);
    r.setDir('right');
    for (let i = 0; i < 6; i++) step(50);
    const x = r.self!.x;
    // servidor ainda acha que o próprio está no ponto inicial (atraso); outro jogador sentou
    store.apply({ t: 'state', tick: 50, zones: [], desks: [], entities: [ent(1, 5.5, 12.6875), ent(2, 10.5, 12.6875, { pose: 'sit' })] });
    step(50);
    expect(r.self!.x).toBeGreaterThan(x);
    expect(r.predictor.heldDir).toBe('right');
  });

  it('ack/moved_reject: inteiros são tiles, frações são unidades de entidade', () => {
    expect(protocolPointToPx(2, 3)).toEqual({ x: 40, y: 59 });
    expect(protocolPointToPx(2.5, 3.6875)).toEqual({ x: 40, y: 59 });
  });

  it('use(): longe anda e manda use ao chegar; ocupado/não-uso recusa; pose, held e encaixe vêm do estado', () => {
    const { r, sent, step, store, chair } = setup();
    step(16);
    const coffee = r.assembly.spots.find((s) => s.kind === 'coffee')!;
    expect(r.use(chair.id)).toBe(false); // assento não é spot de uso
    expect(r.use('nada#x:coffee')).toBe(false);
    expect(r.use(coffee.id)).toBe(true);
    for (let i = 0; i < 300 && !sent.some((m) => m.t === 'use'); i++) step(50);
    expect(sent.at(-1)).toEqual({ t: 'use', spot: coffee.id });

    // remoto (2) usando o café: encaixa no spot, olha para spot.dir, pose/held do estado
    store.apply({
      t: 'state', tick: 20, zones: [], desks: [],
      entities: [
        ent(1, 5.5, 12.6875),
        ent(2, coffee.x / 16, coffee.y / 16, { pose: 'drink', held: 'coffee', dir: coffee.dir, using: coffee.id }),
      ],
    });
    step(16);
    const other = r.avatars.get(2)!;
    expect(other).toMatchObject({ pose: 'drink', held: 'coffee', using: coffee.id, spot: coffee.id, dir: coffee.dir });
    expect(other.x).toBe(coffee.x);
    expect(other.y).toBe(coffee.y);
    expect(r.use(coffee.id)).toBe(false); // ocupado pelo 2
    expect(r.nearestUse(0)).toBeNull();
  });

  it('use() perto manda só use; o próprio avatar assume pose e held do servidor', () => {
    const { r, sent, step, store } = setup();
    step(16);
    const arcade = r.assembly.spots.find((s) => s.kind === 'arcade');
    const spot = arcade ?? r.assembly.spots.find((s) => s.kind === 'water')!;
    // teleporta o próprio para o tile do spot
    store.apply({
      t: 'state', tick: 21, zones: [], desks: [],
      entities: [ent(1, (spot.tx * 16 + 8) / 16, (spot.ty * 16 + 11) / 16, { tp: 1 }), ent(2, 10.5, 12.6875)],
    });
    step(16);
    sent.length = 0;
    expect(r.use(spot.id)).toBe(true);
    expect(sent).toEqual([{ t: 'use', spot: spot.id }]);
    store.apply({
      t: 'state', tick: 22, zones: [], desks: [],
      entities: [ent(1, spot.x / 16, spot.y / 16, { pose: 'game', held: 'controller', dir: spot.dir, using: spot.id }), ent(2, 10.5, 12.6875)],
    });
    step(50);
    const me = r.self!;
    expect(me).toMatchObject({ pose: 'game', held: 'controller', using: spot.id, dir: spot.dir });
    expect(me.x).toBe(spot.x);
    expect(me.y).toBe(spot.y);
    expect(r.nearestUse(1)?.id).toBe(spot.id);
  });

  it('troca de mapa incrementa layoutVersion', () => {
    const { r } = setup();
    const v = r.layoutVersion;
    r.setAssembly(assembleOffice(buildSampleMap(), 1));
    expect(r.layoutVersion).toBe(v + 1);
  });
});
