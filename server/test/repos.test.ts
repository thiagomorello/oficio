import { describe, expect, it } from 'vitest';
import type { Repos } from '../db/repos/index';
import type { ImportRow } from '../db/types';
import { createFakeRepos } from './fakeDb';

const HASH = '$2a$10$' + 'a'.repeat(53);
const w = (id: number, over: Partial<ImportRow> = {}): ImportRow => ({
  external_id: String(id), name: `User ${id}`, email: `u${id}@example.com`, password_hash: HASH, role_name: 'Suporte', is_admin: false, ...over,
});

async function mkUser(r: Repos, n: number): Promise<number> {
  return (await r.users.createLocal({ email: `l${n}@x.com`, name: `L${n}`, password_hash: HASH })).id;
}

describe('UsersRepo (fake)', () => {
  it('upsertImported: insere, atualiza, nunca rebaixa is_admin nem mexe em status', async () => {
    const r = createFakeRepos();
    expect(await r.users.upsertImported(w(1, { is_admin: true }))).toBe('inserted');
    let u = (await r.users.byExternalId('1'))!;
    expect(u.is_admin).toBe(true);
    await r.users.update(u.id, { status: 'disabled', display_name: 'Zé' });
    expect(await r.users.upsertImported(w(1, { name: 'Novo Nome', role_name: 'Gerente', is_admin: false, password_hash: '$2a$10$' + 'b'.repeat(53) }))).toBe('updated');
    u = (await r.users.byExternalId('1'))!;
    expect(u).toMatchObject({ name: 'Novo Nome', role_name: 'Gerente', is_admin: true, status: 'disabled', display_name: 'Zé', password_version: 2 });
    // hash igual: versão não sobe
    await r.users.upsertImported(w(1, { password_hash: u.password_hash }));
    expect((await r.users.byExternalId('1'))!.password_version).toBe(2);
  });

  it('createLocal, byEmail (case-insensitive), e-mail duplicado falha', async () => {
    const r = createFakeRepos();
    const u = await r.users.createLocal({ email: 'Ana@X.com', name: 'Ana', password_hash: HASH, must_change_password: true });
    expect(u.email).toBe('ana@x.com');
    expect((await r.users.byEmail('ANA@x.com'))?.id).toBe(u.id);
    await expect(r.users.createLocal({ email: 'ana@x.com', name: 'B', password_hash: HASH })).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
  });

  it('setPassword sobe password_version; list/search/status; countAdmins; roleNames', async () => {
    const r = createFakeRepos();
    const a = await r.users.createLocal({ email: 'a@x.com', name: 'Ana', password_hash: HASH, is_admin: true, role_name: 'Dev' });
    await r.users.createLocal({ email: 'b@x.com', name: 'Bia', password_hash: HASH, role_name: 'Dev' });
    const c = await r.users.createLocal({ email: 'c@x.com', name: 'Caio', password_hash: HASH, is_admin: true, role_name: 'Ops' });
    await r.users.setPassword(a.id, 'h2', { needsChange: true });
    expect(await r.users.byId(a.id)).toMatchObject({ password_hash: 'h2', password_version: 2, must_change_password: true });
    expect(await r.users.countAdmins()).toBe(2);
    await r.users.update(c.id, { status: 'disabled' });
    expect(await r.users.countAdmins()).toBe(1);
    expect(await r.users.roleNames()).toEqual(['Dev', 'Ops']);
    expect((await r.users.list({ search: 'bi' })).rows.map((u) => u.name)).toEqual(['Bia']);
    expect((await r.users.list({ status: 'disabled' })).total).toBe(1);
    const page = await r.users.list({ limit: 1, offset: 1 });
    expect(page.total).toBe(3);
    expect(page.rows).toHaveLength(1);
  });

  it('adoptLocal vincula a conta local ao external_id', async () => {
    const r = createFakeRepos();
    const l = await r.users.createLocal({ email: 'u5@example.com', name: 'Local', password_hash: HASH });
    await r.users.adoptLocal(l.id, w(5, { is_admin: true }));
    expect(await r.users.byExternalId('5')).toMatchObject({ id: l.id, is_admin: true, name: 'User 5' });
  });
});

describe('DesksRepo (fake)', () => {
  it('claim: reivindica, libera a anterior, falha se ocupada', async () => {
    const r = createFakeRepos();
    const [a, b] = [await mkUser(r, 1), await mkUser(r, 2)];
    expect(await r.desks.claim('A1-1', a)).toEqual({ ok: true, released: null });
    expect(await r.desks.claim('A1-1', b)).toEqual({ ok: false, reason: 'taken' });
    expect(await r.desks.claim('A1-1', a)).toEqual({ ok: true, released: null });
    await r.desks.setDecor('A1-1', { slots: { left: { kind: 'mug', variant: 'red' } } });
    expect(await r.desks.claim('A1-2', a)).toEqual({ ok: true, released: 'A1-1' });
    expect((await r.desks.all()).map((d) => d.desk_id)).toEqual(['A1-2']);
    expect((await r.desks.ownedBy(a))?.decor).toBeNull();
    // falha não libera a atual
    expect(await r.desks.claim('A1-2', b)).toEqual({ ok: false, reason: 'taken' });
    expect((await r.desks.ownedBy(a))?.desk_id).toBe('A1-2');
  });

  it('release devolve o dono e apaga a decoração', async () => {
    const r = createFakeRepos();
    const a = await mkUser(r, 1);
    await r.desks.claim('D', a);
    await r.desks.setDecor('D', { slots: { back: { kind: 'lamp', variant: 'black' } } });
    expect(await r.desks.release('D')).toBe(a);
    expect(await r.desks.release('D')).toBeNull();
    await r.desks.claim('D', a);
    expect((await r.desks.ownedBy(a))?.decor).toBeNull();
  });

  it('setDecor valida/normaliza, false sem dono; null limpa', async () => {
    const r = createFakeRepos();
    const a = await mkUser(r, 1);
    expect(await r.desks.setDecor('X', null)).toBe(false);
    await r.desks.claim('X', a);
    await r.desks.setDecor('X', { slots: { left: { kind: 'lamp', variant: 'black' } } }); // lamp não cabe em left
    expect((await r.desks.ownedBy(a))?.decor).toBeNull();
    await r.desks.setDecor('X', { slots: { right: { kind: 'mug', variant: 'blue' } } });
    expect((await r.desks.ownedBy(a))?.decor).toEqual({ slots: { right: { kind: 'mug', variant: 'blue' } } });
    await r.desks.setDecor('X', null);
    expect((await r.desks.ownedBy(a))?.decor).toBeNull();
  });

  it('reassign zera a decoração, devolve dono anterior e libera a mesa antiga do novo dono', async () => {
    const r = createFakeRepos();
    const [a, b] = [await mkUser(r, 1), await mkUser(r, 2)];
    await r.desks.claim('D1', a);
    await r.desks.setDecor('D1', { slots: { right: { kind: 'mug', variant: 'blue' } } });
    await r.desks.claim('D2', b);
    expect(await r.desks.reassign('D1', b)).toBe(a);
    expect(await r.desks.ownedBy(a)).toBeNull();
    expect(await r.desks.ownedBy(b)).toMatchObject({ desk_id: 'D1', decor: null });
    expect((await r.desks.all()).map((d) => d.desk_id)).toEqual(['D1']);
    expect(await r.desks.reassign('D9', a)).toBeNull();
  });

  it('pruneNotIn devolve os donos liberados', async () => {
    const r = createFakeRepos();
    const [a, b, c] = [await mkUser(r, 1), await mkUser(r, 2), await mkUser(r, 3)];
    await r.desks.claim('K1', a);
    await r.desks.claim('K2', b);
    await r.desks.claim('K3', c);
    expect((await r.desks.pruneNotIn(['K1', 'K3'])).sort()).toEqual([b]);
    expect((await r.desks.all()).map((d) => d.desk_id)).toEqual(['K1', 'K3']);
    expect((await r.desks.pruneNotIn([])).sort()).toEqual([a, c].sort());
    expect(await r.desks.all()).toEqual([]);
  });
});

describe('TokensRepo / Chat / Sessions (fake)', () => {
  it('consume é de uso único e respeita expiração', async () => {
    let t = 1_000_000;
    const r = createFakeRepos({ now: () => new Date(t) });
    const u = await mkUser(r, 1);
    await r.tokens.create('reset', u, 'h1', new Date(t + 1000));
    await r.tokens.create('invite', u, 'h2', new Date(t + 1000));
    expect(await r.tokens.consume('nope')).toBeNull();
    expect(await r.tokens.consume('h1')).toMatchObject({ user_id: u, kind: 'reset' });
    expect(await r.tokens.consume('h1')).toBeNull();
    t += 2000;
    expect(await r.tokens.consume('h2')).toBeNull();
  });

  it('chat: list por escopo/zona/before/limit e retenção', async () => {
    let t = Date.parse('2026-10-15T12:00:00Z');
    const r = createFakeRepos({ now: () => new Date(t) });
    const old = await r.chat.insert({ scope: 'global', zone_id: null, user_id: 1, name: 'A', text: 'velha', created_at: new Date(t - 8 * 86_400_000) });
    await r.chat.insert({ scope: 'global', zone_id: null, user_id: 1, name: 'A', text: 'g1' });
    await r.chat.insert({ scope: 'room', zone_id: 'z1', user_id: 1, name: 'A', text: 'r1' });
    const g2 = await r.chat.insert({ scope: 'global', zone_id: null, user_id: 1, name: 'A', text: 'g2' });
    expect((await r.chat.list('room', 'z2', null, 10)).length).toBe(0);
    expect((await r.chat.list('room', 'z1', null, 10)).map((m) => m.text)).toEqual(['r1']);
    expect((await r.chat.list('global', null, null, 2)).map((m) => m.text)).toEqual(['g1', 'g2']);
    expect((await r.chat.list('global', null, g2.id, 10)).map((m) => m.text)).toEqual(['velha', 'g1']);
    expect(await r.chat.purgeOlderThan(7)).toBe(1);
    expect((await r.chat.list('global', null, null, 10)).some((m) => m.id === old.id)).toBe(false);
  });

  it('sessions_log: open/close/countSince', async () => {
    let t = 1000;
    const r = createFakeRepos({ now: () => new Date(t) });
    const s1 = await r.sessions.open(1);
    t = 5000;
    await r.sessions.open(2);
    await r.sessions.close(s1);
    expect(await r.sessions.countSince(new Date(2000))).toBe(1);
    expect(await r.sessions.countSince(new Date(0))).toBe(2);
  });
});

describe('MapsRepo / SettingsRepo (fake)', () => {
  it('draft com controle de conflito por updated_at', async () => {
    const r = createFakeRepos();
    const u = await mkUser(r, 1);
    expect(await r.maps.getDraft()).toBeNull();
    const first = await r.maps.saveDraft({ v: 1 }, null, u);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = await r.maps.saveDraft({ v: 2 }, first.row.updated_at, u);
    expect(second.ok).toBe(true);
    const stale = await r.maps.saveDraft({ v: 3 }, first.row.updated_at, u);
    expect(stale).toMatchObject({ ok: false, conflict: { by: u } });
    expect((await r.maps.getDraft())?.doc).toEqual({ v: 2 });
    expect((await r.maps.saveDraft({ v: 4 }, null, u)).ok).toBe(false);
  });

  it('versões, publicação, restore e delete', async () => {
    const r = createFakeRepos();
    const u = await mkUser(r, 1);
    expect(await r.maps.getPublished()).toBeNull();
    const v1 = await r.maps.createVersion({ n: 1 }, 'v1', null, u, { desks: 72 });
    const v2 = await r.maps.createVersion({ n: 2 }, 'v2', v1.id, u, null);
    expect(await r.maps.setPublished(v2.id)).toBe(true);
    expect((await r.maps.getPublished())?.id).toBe(v2.id);
    expect((await r.maps.get(v2.id))?.published_at).toBeInstanceOf(Date);
    expect(await r.settings.get('published_map_id')).toBe(String(v2.id));
    const d = await r.maps.restoreToDraft(v1.id, u);
    expect(d).toMatchObject({ kind: 'draft', doc: { n: 1 }, parent_id: v1.id });
    expect(await r.maps.setPublished(d!.id)).toBe(false);
    const list = await r.maps.list();
    expect(list[0]!.kind).toBe('draft');
    expect('doc' in list[0]!).toBe(false);
    expect(list.length).toBe(3);
    expect(await r.maps.delete(v1.id)).toBe(true);
    expect(await r.maps.get(v1.id)).toBeNull();
  });

  it('settings get/set', async () => {
    const r = createFakeRepos();
    expect(await r.settings.get('x')).toBeNull();
    await r.settings.set('x', '1');
    await r.settings.set('x', '2');
    expect(await r.settings.get('x')).toBe('2');
  });
});
