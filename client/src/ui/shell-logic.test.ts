import { describe, expect, it } from 'vitest';
import type { ChatMessage, UserPublic } from '../../../shared/model';
import { badgeText, countUnread, messagesFor, prepareChatText, resolveActiveScope, scopeAvailability, zoneOfUser } from './chat-logic';
import { fitProjection, miniToWorld, viewToMini, worldToMini } from './minimap-logic';
import { buildRows, filterRows, sortRows } from './participants-logic';

const msg = (id: number, from: number, scope: ChatMessage['scope'], zone: string | null = null): ChatMessage => ({ id, scope, zone, from, name: `u${from}`, text: 't', ts: id });

describe('chat', () => {
  it('conta não lidas só de outras pessoas', () => {
    const m = [msg(1, 2, 'global'), msg(2, 1, 'global'), msg(3, 2, 'near'), msg(4, 3, 'room', 'z')];
    expect(countUnread(m, 0, 1)).toBe(3);
    expect(countUnread(m, 3, 1)).toBe(1);
    expect(countUnread(m, 4, 1)).toBe(0);
    expect(countUnread([], 0, null)).toBe(0);
  });
  it('selo', () => {
    expect(badgeText(0)).toBe('');
    expect(badgeText(7)).toBe('7');
    expect(badgeText(250)).toBe('99+');
  });
  it('aba Sala depende da zona', () => {
    const name = (id: string) => (id === 'z1' ? 'Reunião 1' : undefined);
    expect(scopeAvailability('room', null, name)).toEqual({ enabled: false, label: 'Sala' });
    expect(scopeAvailability('room', 'z1', name)).toEqual({ enabled: true, label: 'Reunião 1' });
    expect(scopeAvailability('room', 'zx', name).label).toBe('Sala');
    expect(scopeAvailability('near', null, name)).toEqual({ enabled: true, label: 'Perto' });
    expect(resolveActiveScope('room', null)).toBe('global');
    expect(resolveActiveScope('room', 'z1')).toBe('room');
    expect(resolveActiveScope('near', null)).toBe('near');
  });
  it('zona do usuário', () => {
    const zones = [
      { id: 'a', locked: false, members: [1, 2] },
      { id: 'b', locked: false, members: [3] },
    ];
    expect(zoneOfUser(zones, 3)).toBe('b');
    expect(zoneOfUser(zones, 9)).toBeNull();
    expect(zoneOfUser(zones, null)).toBeNull();
  });
  it('filtra por aba e limita', () => {
    const m = [msg(1, 2, 'global'), msg(2, 2, 'room', 'a'), msg(3, 2, 'room', 'b'), msg(4, 2, 'global'), msg(5, 2, 'global')];
    expect(messagesFor(m, 'room', 'a').map((x) => x.id)).toEqual([2]);
    expect(messagesFor(m, 'global', null, 2).map((x) => x.id)).toEqual([4, 5]);
  });
  it('prepara o texto', () => {
    expect(prepareChatText('   ')).toBeNull();
    expect(prepareChatText('  oi ')).toBe('oi');
    expect(prepareChatText('x'.repeat(1200))?.length).toBe(1000);
  });
});

describe('participantes', () => {
  const u = (id: number, name: string, status: UserPublic['status'], role: string | null = null): UserPublic => ({ id, name, role, appearance: null, status });
  const users = new Map([
    [1, u(1, 'Zélia', 'away')],
    [2, u(2, 'Ana', 'available', 'Designer')],
    [3, u(3, 'Álvaro', 'busy')],
    [4, u(4, 'Bia', 'available')],
    [5, u(5, 'Offline', 'available')],
  ]);
  const rows = buildRows({
    users,
    online: [1, 2, 3, 4, 99],
    zones: [{ id: 'sala', locked: false, members: [3] }],
    ghosts: new Set([4]),
    media: new Map([[2, { mic: true, cam: false }]]),
    selfId: 1,
  });
  it('monta só os online conhecidos', () => {
    expect(rows.map((r) => r.id).sort()).toEqual([1, 2, 3, 4]);
    expect(rows.find((r) => r.id === 3)?.zoneId).toBe('sala');
    expect(rows.find((r) => r.id === 2)?.mic).toBe(true);
  });
  it('ordena: você, disponíveis por nome, ocupados, fantasmas por último', () => {
    expect(sortRows(rows).map((r) => r.name)).toEqual(['Zélia', 'Ana', 'Álvaro', 'Bia']);
  });
  it('busca sem acento e por sala/cargo', () => {
    const zn = (id: string) => (id === 'sala' ? 'Sala de Reunião' : undefined);
    expect(filterRows(rows, 'alvaro', zn).map((r) => r.id)).toEqual([3]);
    expect(filterRows(rows, 'reuniao', zn).map((r) => r.id)).toEqual([3]);
    expect(filterRows(rows, 'design', zn).map((r) => r.id)).toEqual([2]);
    expect(filterRows(rows, '  ', zn)).toHaveLength(4);
  });
});

describe('minimapa', () => {
  it('encaixa e centraliza', () => {
    const p = fitProjection(1000, 500, 200, 200, 0);
    expect(p.scale).toBeCloseTo(0.2);
    expect(p.ox).toBeCloseTo(0);
    expect(p.oy).toBeCloseTo(50);
    expect(fitProjection(0, 0, 10, 10)).toEqual({ scale: 1, ox: 0, oy: 0 });
  });
  it('projeta e volta', () => {
    const p = fitProjection(1000, 500, 200, 200, 0);
    const m = worldToMini(p, 500, 250);
    expect(m).toEqual({ x: 100, y: 100 });
    const w = miniToWorld(p, m.x, m.y, 1000, 500);
    expect(w.x).toBeCloseTo(500);
    expect(w.y).toBeCloseTo(250);
    expect(miniToWorld(p, -50, 999, 1000, 500)).toEqual({ x: 0, y: 500 });
  });
  it('recorta o retângulo visível', () => {
    const p = fitProjection(1000, 500, 200, 200, 0);
    const r = viewToMini(p, { x0: -100, y0: 0, x1: 500, y1: 250 }, 200, 200);
    expect(r.x).toBe(0);
    expect(r.w).toBeCloseTo(100);
    expect(r.h).toBeCloseTo(50);
  });
});

import { connectionBanner } from './connection';
import { setLocale, t } from '../i18n';
import { statusLabel } from './participants-logic';
import { flashTitle } from './sound-cues';

describe('faixa de conexão', () => {
  it('estados', () => {
    expect(connectionBanner('open', 0, null)).toBeNull();
    expect(connectionBanner('connecting', 0, null)?.retry).toBe(false);
    expect(connectionBanner('reconnecting', 4000, null)?.text).toContain('4 s');
    expect(connectionBanner('reconnecting', 0, null)?.retry).toBe(true);
    expect(connectionBanner('open', 0, 'replaced')?.text).toContain('outra aba');
    expect(connectionBanner('closed', 0, 'disabled')?.retry).toBe(false);
  });
});

describe('textos do shell seguem o idioma atual', () => {
  it('en e pt-BR', () => {
    try {
      setLocale('en');
      expect(scopeAvailability('room', null, () => undefined).label).toBe('Room');
      expect(statusLabel('dnd')).toBe('Do not disturb');
      expect(connectionBanner('reconnecting', 4000, null)?.text).toBe('No connection. Retrying in 4 s…');
      expect(flashTitle('Office', 2)).toBe('(2) new messages · Office');
      expect(t('shell.desk.ownedBy', { name: 'Bia' })).toBe("Bia's desk");
    } finally {
      setLocale('pt-BR');
    }
    expect(scopeAvailability('room', null, () => undefined).label).toBe('Sala');
    expect(statusLabel('dnd')).toBe('Não perturbe');
    expect(t('shell.desk.ownedBy', { name: 'Bia' })).toBe('Mesa de Bia');
  });
});
