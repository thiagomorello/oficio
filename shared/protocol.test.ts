import { describe, expect, it } from 'vitest';
import { mulberry32 } from './hash';
import { assembleOffice } from './map/assemble';
import { buildDefaultMap } from './map/default-map';
import { USE_SPOT_KINDS } from './map/spots';
import { DEFAULT_SETTINGS, DIRS, POSE_CODES, type Appearance, type EntityState } from './model';
import {
  PROTOCOL_VERSION, clientMsgSchema, codeDir, codePose, decodeClient, decodeServer, dirCode, encodeServer, entityFromDelta,
  packEntity, poseCode, unpackEntity, type ServerMsg, type ServerMsgKind,
} from './protocol';

const appearance: Appearance = {
  skin: '#e8b98f', hair: '#2b1d14', hairStyle: 'short', eyes: '#3b6fb0', top: '#c43', topAccent: '#fff', topStyle: 'tshirt',
  bottom: '#223', shoes: '#111', accessory: 'none', accessoryColor: '#000', lanyard: null, look: 'f',
};
const ent: EntityState = { id: 7, x: 10.5, y: 20.0625, dir: 'left', pose: 'walk', held: 'coffee', moving: true, run: false };
const user = { id: 7, name: 'Ana B', role: 'Suporte', appearance, status: 'available' as const };

const samples: ServerMsg[] = [
  {
    t: 'welcome', v: PROTOCOL_VERSION, tick: 5, now: 1000,
    you: { ...user, email: 'a@b.c', isAdmin: false, mustChangePassword: false, settings: DEFAULT_SETTINGS },
    map: { id: 3, version: 3, etag: '"m3-1"' }, entities: [ent], users: [user], zones: [{ id: 'sala-rosa', locked: false, members: [7] }],
    desks: [{ id: 'A1-1', userId: 7, decor: { slots: { left: { kind: 'mug', variant: 'red' } } } }], chat: [],
  },
  { t: 'state', tick: 9, entities: [ent], zones: [], desks: [] },
  { t: 'delta', tick: 10, e: [packEntity(ent)] },
  { t: 'join', user, entity: ent },
  { t: 'leave', id: 7 },
  { t: 'status', id: 7, status: 'busy' },
  { t: 'appearance', id: 7, appearance, displayName: 'Ana' },
  { t: 'chat', msg: { id: 1, scope: 'global', zone: null, from: 7, name: 'Ana', text: 'oi', ts: 1 } },
  { t: 'zone', zone: { id: 'z', locked: true, members: [] } },
  { t: 'desk', desk: 'A1-1', userId: null, decor: null },
  { t: 'map', id: 4, version: 4 },
  { t: 'knock', zone: 'sala-azul', from: 7, name: 'Ana' },
  { t: 'knock_result', zone: 'sala-azul', allow: true },
  { t: 'av_set', hear: [1, 2], allow: [1, 2, 3], volumes: { '1': 1, '2': 0.5 }, screenAllowed: false },
  { t: 'ack', seq: 3, x: 1, y: 2 },
  { t: 'moved_reject', seq: 4, reason: 'locked', x: 1, y: 2 },
  { t: 'notice', level: 'info', text: 'Sua mesa foi removida do mapa' },
  { t: 'kick', reason: 'replaced' },
  { t: 'pong', ts: 1, now: 2 },
  { t: 'error', code: 'rate_limited' },
];

describe('protocol: ServerMsg', () => {
  it('round-trip de todos os kinds', () => {
    const kinds = new Set<ServerMsgKind>(samples.map((s) => s.t));
    expect(kinds.size).toBe(samples.length);
    for (const m of samples) {
      expect(decodeServer(encodeServer(m))).toEqual(m);
    }
    expect(decodeServer('nope')).toBeNull();
    expect(decodeServer('{"x":1}')).toBeNull();
  });
});

describe('protocol: entidades', () => {
  it('pack/unpack preserva o estado (posição em 1/16 de tile)', () => {
    const d = packEntity(ent);
    expect(d[1]).toBe(168);
    expect(d[2]).toBe(321);
    expect(entityFromDelta(d)).toEqual(ent);
  });

  it('flags: tp, run, seated e remoção de seat', () => {
    const e: EntityState = { ...ent, tp: 1, run: true, seat: 'chair-1', pose: 'type', dir: 'up' };
    const d = packEntity(e);
    const into: EntityState = { ...ent };
    unpackEntity(d, into);
    expect(into).toMatchObject({ tp: 1, run: true, pose: 'type', dir: 'up' });
    unpackEntity(packEntity({ ...ent, pose: 'stand', moving: false }), into);
    expect(into.tp).toBeUndefined();
    expect(into.seat).toBeUndefined();
  });

  it('códigos de dir/pose são bijetivos', () => {
    for (const d of DIRS) expect(codeDir(dirCode(d))).toBe(d);
    for (const p of POSE_CODES) expect(codePose(poseCode(p))).toBe(p);
    expect(new Set(POSE_CODES).size).toBe(POSE_CODES.length);
    expect(POSE_CODES.length).toBeLessThanOrEqual(32);
  });
});

describe('protocol: decodeClient', () => {
  it('aceita mensagens válidas', () => {
    expect(decodeClient('{"t":"move_to","x":3,"y":4,"seq":1}')).toEqual({ t: 'move_to', x: 3, y: 4, seq: 1 });
    expect(decodeClient('{"t":"move_dir","dir":null}')).toEqual({ t: 'move_dir', dir: null });
    expect(decodeClient('{"t":"move_dir","dir":"left","run":true}')).toEqual({ t: 'move_dir', dir: 'left', run: true });
    expect(decodeClient('{"t":"stand"}')).toEqual({ t: 'stand' });
  });

  it('use: aceita ids reais de spots do mapa padrão e rejeita lixo', () => {
    const spots = assembleOffice(buildDefaultMap(), 0).spots.filter((s) => USE_SPOT_KINDS.has(s.kind));
    expect(spots.length).toBeGreaterThan(20);
    expect(new Set(spots.map((s) => s.kind))).toEqual(new Set(['coffee', 'water', 'snack', 'fridge', 'sink', 'stall', 'arcade', 'pingpong', 'shelf', 'whiteboard']));
    for (const s of spots) expect(decodeClient(JSON.stringify({ t: 'use', spot: s.id }))).toEqual({ t: 'use', spot: s.id });
    expect(decodeClient('{"t":"use","spot":"copa#f284:coffee"}')).toEqual({ t: 'use', spot: 'copa#f284:coffee' });
    expect(decodeClient('{"t":"use"}')).toBeNull();
    expect(decodeClient('{"t":"use","spot":"a b"}')).toBeNull();
    expect(decodeClient('{"t":"use","spot":"x","extra":1}')).toBeNull();
  });

  it('chat: apara, remove controles, limita 1000', () => {
    const m = decodeClient(JSON.stringify({ t: 'chat', scope: 'global', text: '  oi\u0000 \u0007você\n  ' }));
    expect(m).toEqual({ t: 'chat', scope: 'global', text: 'oi você' });
    expect(decodeClient(JSON.stringify({ t: 'chat', scope: 'global', text: ' \u0000 ' }))).toBeNull();
    expect(decodeClient(JSON.stringify({ t: 'chat', scope: 'global', text: 'a'.repeat(1000) }))).not.toBeNull();
    expect(decodeClient(JSON.stringify({ t: 'chat', scope: 'global', text: 'a'.repeat(1001) }))).toBeNull();
    expect(decodeClient(JSON.stringify({ t: 'chat', scope: 'world', text: 'a' }))).toBeNull();
  });

  it('rejeita números inválidos e direções diagonais', () => {
    for (const bad of [
      '{"t":"move_to","x":1.5,"y":2}', '{"t":"move_to","x":-1,"y":2}', '{"t":"move_to","x":"1","y":2}',
      '{"t":"move_to","x":1e999,"y":2}', '{"t":"move_to","x":99999,"y":2}', '{"t":"move_to","x":1}',
      '{"t":"move_dir","dir":"up-left"}', '{"t":"move_dir","dir":"upleft"}', '{"t":"move_dir","dir":["up","left"]}',
      '{"t":"move_dir","dir":{"x":1,"y":1}}', '{"t":"move_dir"}', '{"t":"move_dir","dir":"up","dx":1}',
    ]) expect(decodeClient(bad), bad).toBeNull();
  });

  it('Dir é 4-way: nenhum valor diagonal é representável', () => {
    expect([...DIRS].sort()).toEqual(['down', 'left', 'right', 'up']);
    for (const d of ['up-left', 'down-right', 'ul', 'dr', 'northeast']) {
      expect(clientMsgSchema.safeParse({ t: 'move_dir', dir: d }).success).toBe(false);
    }
  });

  it('oversize, lixo e tipos errados -> null', () => {
    expect(decodeClient('x'.repeat(5000))).toBeNull();
    expect(decodeClient(JSON.stringify({ t: 'chat', scope: 'global', text: 'a'.repeat(4000) }), 100)).toBeNull();
    for (const s of ['', 'null', '[]', '1', '"t"', '{', '{"t":"nope"}', '{"t":1}']) expect(decodeClient(s), s).toBeNull();
    expect(decodeClient(42 as unknown as string)).toBeNull();
  });

  it('fuzz: 200 JSONs aleatórios -> null', () => {
    const rnd = mulberry32(12345);
    const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];
    const value = (depth: number): unknown => {
      const k = Math.floor(rnd() * (depth > 2 ? 5 : 7));
      switch (k) {
        case 0: return null;
        case 1: return rnd() < 0.5;
        case 2: return Math.round((rnd() - 0.5) * 1e6) / (rnd() < 0.5 ? 1 : 7);
        case 3: return Array.from({ length: 1 + Math.floor(rnd() * 12) }, () => String.fromCharCode(32 + Math.floor(rnd() * 90))).join('');
        case 4: return pick(['up', 'down', 'x', '', 'global']);
        case 5: return Array.from({ length: Math.floor(rnd() * 4) }, () => value(depth + 1));
        default: return obj(depth + 1);
      }
    };
    const obj = (depth: number): Record<string, unknown> => {
      const o: Record<string, unknown> = {};
      const n = Math.floor(rnd() * 5);
      for (let i = 0; i < n; i++) o[pick(['a', 'b', 'x', 'y', 'dir', 'text', 'zone', 'k' + i, 'type'])] = value(depth);
      return o;
    };
    for (let i = 0; i < 200; i++) {
      expect(decodeClient(JSON.stringify(obj(0))), String(i)).toBeNull();
    }
  });
});

describe('ids reais do mapa padrão passam no esquema', () => {
  it('sit/desk_claim/lock com ids do mapa (contêm # e :)', async () => {
    const { buildDefaultMap } = await import('./map/default-map');
    const { assembleOffice } = await import('./map/assemble');
    const a = assembleOffice(buildDefaultMap(), 1);
    const seat = a.spots.find((s) => s.seated)!;
    const desk = a.desks[0];
    const zone = a.zones.find((z) => z.lockable)!;
    expect(decodeClient(JSON.stringify({ t: 'sit', spot: seat.id }))).toMatchObject({ t: 'sit', spot: seat.id });
    expect(decodeClient(JSON.stringify({ t: 'desk_claim', desk: desk.id }))).toMatchObject({ t: 'desk_claim', desk: desk.id });
    expect(decodeClient(JSON.stringify({ t: 'lock', zone: zone.id, locked: true }))).toMatchObject({ t: 'lock', zone: zone.id });
  });
});
