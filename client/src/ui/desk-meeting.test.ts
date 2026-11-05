import { describe, expect, it, vi } from 'vitest';
import { deskDecorSchema, type DeskDecor } from '../../../shared/desk-decor';
import type { ZoneDef } from '../../../shared/map/types';
import type { ZoneState } from '../../../shared/model';
import { buildDeskMenu, goToMyDesk } from './context-menu';
import { decorKey, decorUnchanged, slotAllows, withSlotItem } from './desk-decor-popover';
import { currentMeetingZone, isKnockKey, nearLockedDoor } from './meeting';

const zone = (id: string, doors: Array<[number, number]>, lockable = true): ZoneDef =>
  ({ id, name: id, lockable, doorTiles: doors.map(([x, y]) => ({ x, y })) }) as unknown as ZoneDef;
const asm = (...zs: ZoneDef[]) => ({ zoneById: new Map(zs.map((z) => [z.id, z])) });
const st = (id: string, locked: boolean, members: number[] = []): ZoneState => ({ id, locked, members });

describe('nearLockedDoor', () => {
  const a = asm(zone('sala', [[10, 10], [10, 11]]));
  it('perto da porta de sala trancada', () => {
    const zones = new Map([['sala', st('sala', true, [2])]]);
    expect(nearLockedDoor(a, { id: 1, tx: 12, ty: 12 }, zones)?.id).toBe('sala');
    expect(nearLockedDoor(a, { id: 1, tx: 13, ty: 10 }, zones)).toBeNull();
  });
  it('ignora sala destrancada e sala da qual sou membro', () => {
    expect(nearLockedDoor(a, { id: 1, tx: 10, ty: 9 }, new Map([['sala', st('sala', false)]]))).toBeNull();
    expect(nearLockedDoor(a, { id: 1, tx: 10, ty: 9 }, [st('sala', true, [1])])).toBeNull();
  });
  it('escolhe a mais próxima', () => {
    const b = asm(zone('a', [[0, 0]]), zone('b', [[3, 0]]));
    expect(nearLockedDoor(b, { id: 1, tx: 3, ty: 2 }, [st('a', true), st('b', true)])?.id).toBe('b');
  });
});

describe('currentMeetingZone / isKnockKey', () => {
  it('só salas lockable em que sou membro', () => {
    const a = asm(zone('sala', [[0, 0]]), zone('aberta', [[1, 1]], false));
    expect(currentMeetingZone(a, 1, [st('aberta', false, [1])])).toBeNull();
    expect(currentMeetingZone(a, 1, [st('sala', false, [1])])?.def.id).toBe('sala');
    expect(currentMeetingZone(a, 2, [st('sala', false, [1])])).toBeNull();
  });
  it('tecla K ignora campos de texto e modificadores', () => {
    expect(isKnockKey({ key: 'k' })).toBe(true);
    expect(isKnockKey({ key: 'K', target: { tagName: 'DIV' } })).toBe(true);
    expect(isKnockKey({ key: 'k', target: { tagName: 'INPUT' } })).toBe(false);
    expect(isKnockKey({ key: 'k', ctrlKey: true })).toBe(false);
    expect(isKnockKey({ key: 'j' })).toBe(false);
  });
});

describe('decoração: diff e edição', () => {
  const mug: DeskDecor = { slots: { left: { kind: 'mug', variant: 'red' } } };
  it('detecta mudança e equivalência', () => {
    expect(decorUnchanged(null, { slots: {} })).toBe(true);
    expect(decorUnchanged(mug, { slots: { left: { kind: 'mug', variant: 'red' } } })).toBe(true);
    expect(decorUnchanged(mug, { slots: { left: { kind: 'mug', variant: 'blue' } } })).toBe(false);
    expect(decorUnchanged(mug, null)).toBe(false);
    expect(decorKey(null)).toBe('');
  });
  it('withSlotItem respeita slots, variantes e remove', () => {
    expect(slotAllows('lamp', 'left')).toBe(false);
    expect(withSlotItem(null, 'left', 'lamp').slots.left).toBeUndefined();
    const d1 = withSlotItem(null, 'back', 'lamp');
    expect(d1.slots.back).toEqual({ kind: 'lamp', variant: 'yellow' });
    const d2 = withSlotItem(d1, 'back', 'lamp', 'black');
    expect(d2.slots.back?.variant).toBe('black');
    expect(withSlotItem(d2, 'back', 'lamp').slots.back?.variant).toBe('black');
    expect(withSlotItem(d2, 'back', 'pennant').slots.back).toEqual({ kind: 'pennant', variant: 'yellow' });
    expect(withSlotItem(d2, 'back', null).slots).toEqual({});
    expect(withSlotItem(mug, 'left', 'mug', 'nope').slots.left?.variant).toBe('red');
    expect(deskDecorSchema.safeParse(d2).success).toBe(true);
  });
});

describe('menu de contexto da mesa', () => {
  const desk = { id: 'A#d1', label: 'A1-01' };
  const name = (id: number) => (id === 7 ? 'Bia' : `#${id}`);
  it('livre -> reivindicar', () => {
    const m = buildDeskMenu(desk, undefined, 1, name);
    expect(m.items.map((i) => i.id)).toEqual(['claim']);
    expect(buildDeskMenu(desk, { id: desk.id, userId: null, decor: null }, 1, name, true).items[0].label).toMatch(/troca/);
  });
  it('minha -> decorar + liberar', () => {
    expect(buildDeskMenu(desk, { id: desk.id, userId: 1, decor: null }, 1, name).items.map((i) => i.id)).toEqual(['decorate', 'release']);
  });
  it('de outra pessoa -> só o nome do dono', () => {
    const m = buildDeskMenu(desk, { id: desk.id, userId: 7, decor: null }, 1, name);
    expect(m.items).toHaveLength(1);
    expect(m.items[0]).toMatchObject({ id: 'info', label: 'Mesa de Bia', disabled: true });
  });
});

describe('goToMyDesk', () => {
  const assembly = { deskById: new Map([['A#d1', { id: 'A#d1', spotId: 'spot-1' }]]) };
  const world = { minimapSource: () => ({ assembly }) } as never;
  it('senta no spot da minha mesa', () => {
    const sit = vi.fn(() => true);
    const store = { selfId: 1, desks: new Map([['A#d1', { id: 'A#d1', userId: 1, decor: null }]]) } as never;
    expect(goToMyDesk({ store, world, replica: { sit } })).toBe(true);
    expect(sit).toHaveBeenCalledWith('spot-1');
  });
  it('sem mesa não faz nada', () => {
    const sit = vi.fn(() => true);
    const store = { selfId: 1, desks: new Map([['A#d1', { id: 'A#d1', userId: 2, decor: null }]]) } as never;
    expect(goToMyDesk({ store, world, replica: { sit } })).toBe(false);
    expect(sit).not.toHaveBeenCalled();
  });
});
