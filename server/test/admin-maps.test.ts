import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assembleOffice } from '../../shared/map/assemble';
import { buildDefaultMap } from '../../shared/map/default-map';
import type { OfficeMapDoc } from '../../shared/map/doc';
import { publishMap } from '../http/admin-maps-routes';
import { setQuiet } from '../log';
import { fallbackMapDoc } from '../world/fallback-map';
import { addUser, cookieOf, startTestServer, type TestServer } from './http';
import { FakeConn, makeWorld, sessionUser } from './world-helpers';

setQuiet(true);

let srv: TestServer;
let admin: string;
let adminId: number;

afterEach(async () => {
  await srv.close();
});

async function loginAs(email: string): Promise<string> {
  const r = await srv.req('POST', '/api/auth/login', { email, password: 'senha-boa-123' });
  expect(r.status).toBe(200);
  return cookieOf(r.headers);
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** Grava `doc` como rascunho (cria ou sobrescreve) e devolve a resposta. */
async function putDraft(doc: OfficeMapDoc) {
  const cur = await srv.req('GET', '/api/admin/maps/draft', undefined, admin);
  expect(cur.status).toBe(200);
  const r = await srv.req('PUT', '/api/admin/maps/draft', { doc, baseUpdatedAt: cur.json.updated_at }, admin);
  expect(r.status).toBe(200);
  return r;
}

beforeEach(async () => {
  srv = await startTestServer();
  adminId = (await addUser(srv.repos, { email: 'chefe@example.com', name: 'Chefe', admin: true })).id;
  admin = await loginAs('chefe@example.com');
});

describe('admin: mapas', () => {
  it('não admin recebe 403 e anônimo 401', async () => {
    await addUser(srv.repos, { email: 'ana@example.com' });
    const c = await loginAs('ana@example.com');
    for (const [m, p] of [
      ['GET', '/api/admin/maps'],
      ['GET', '/api/admin/maps/draft'],
      ['PUT', '/api/admin/maps/draft'],
      ['POST', '/api/admin/maps/draft/validate'],
      ['POST', '/api/admin/maps/draft/publish'],
      ['POST', '/api/admin/maps/default'],
      ['POST', '/api/admin/maps/1/restore'],
      ['GET', '/api/admin/maps/1'],
      ['DELETE', '/api/admin/maps/1'],
    ] as const) {
      expect((await srv.req(m, p, m === 'GET' || m === 'DELETE' ? undefined : {}, c)).status, `${m} ${p}`).toBe(403);
    }
    expect((await srv.req('GET', '/api/admin/maps')).status).toBe(401);
  });

  it('rascunho: GET cria a partir do mapa em uso, PUT grava, PUT com base velha → 409', async () => {
    const g = await srv.req('GET', '/api/admin/maps/draft', undefined, admin);
    expect(g.status).toBe(200);
    expect(g.json.kind).toBe('draft');
    expect(g.json.doc).toEqual(srv.app.office.assembly.doc);
    const base = g.json.updated_at as string;

    const doc = clone(g.json.doc as OfficeMapDoc);
    doc.name = 'editado';
    const p = await srv.req('PUT', '/api/admin/maps/draft', { doc, baseUpdatedAt: base }, admin);
    expect(p.status).toBe(200);
    expect(p.json.doc.name).toBe('editado');
    expect(p.json.updated_at).not.toBe(base);

    const stale = await srv.req('PUT', '/api/admin/maps/draft', { doc, baseUpdatedAt: base }, admin);
    expect(stale.status).toBe(409);
    expect(stale.json).toMatchObject({ updated_at: p.json.updated_at, by: adminId });

    const bad = await srv.req('PUT', '/api/admin/maps/draft', { doc: { schema: 1, name: 'x' }, baseUpdatedAt: p.json.updated_at }, admin);
    expect(bad.status).toBe(400);

    // continua um único rascunho
    const list = await srv.req('GET', '/api/admin/maps', undefined, admin);
    expect(list.json.maps.filter((m: { kind: string }) => m.kind === 'draft')).toHaveLength(1);
  });

  it('GET draft nasce da versão publicada quando há uma', async () => {
    const v = await srv.repos.maps.createVersion(buildDefaultMap(), 'Mapa padrão', null, null, null);
    await srv.repos.maps.setPublished(v.id);
    const g = await srv.req('GET', '/api/admin/maps/draft', undefined, admin);
    expect(g.json.parent_id).toBe(v.id);
    expect(g.json.doc).toEqual(buildDefaultMap());
  });

  it('validate do mapa padrão: 0 erros, estatísticas e dry-run', async () => {
    expect((await srv.req('POST', '/api/admin/maps/default', {}, admin)).status).toBe(200);
    const r = await srv.req('POST', '/api/admin/maps/draft/validate', {}, admin);
    expect(r.status).toBe(200);
    expect(r.json.errors).toEqual([]);
    expect(r.json.stats).toMatchObject({ desks: 72, errors: 0 });
    expect(r.json).toMatchObject({ wouldMove: 0, wouldReleaseSeats: 0, wouldReleaseDesks: 0 });
    expect((await srv.req('POST', '/api/admin/maps/999/validate', {}, admin)).status).toBe(404);
  });

  it('publicar o rascunho cria versão, move `current`, troca ETag e o mapa em uso', async () => {
    const before = await srv.req('GET', '/api/map', undefined, admin);
    expect(before.status).toBe(200);
    const oldTag = before.headers.get('etag')!;
    expect((await fetch(srv.base + '/api/map', { headers: { Cookie: admin, 'If-None-Match': oldTag } })).status).toBe(304);

    const doc = fallbackMapDoc();
    doc.name = 'nova';
    await putDraft(doc);
    const pub = await srv.req('POST', '/api/admin/maps/draft/publish', { name: 'Primeira' }, admin);
    expect(pub.status).toBe(200);
    expect(pub.json).toMatchObject({ moved: 0, releasedSeats: 0, releasedDesks: 0 });
    expect(pub.json.version).toBe(srv.app.office.layoutVersion);
    expect(srv.app.office.mapId).toBe(pub.json.id);

    const list = await srv.req('GET', '/api/admin/maps', undefined, admin);
    expect(list.json.current).toBe(pub.json.id);
    const ver = list.json.maps.find((m: { id: number }) => m.id === pub.json.id);
    expect(ver).toMatchObject({ kind: 'version', name: 'Primeira', current: true });
    expect(ver.published_at).toBeTruthy();
    expect(ver.parent_id).toBe(list.json.maps.find((m: { kind: string }) => m.kind === 'draft').id);

    const after = await fetch(srv.base + '/api/map', { headers: { Cookie: admin, 'If-None-Match': oldTag } });
    expect(after.status).toBe(200);
    expect(after.headers.get('etag')).not.toBe(oldTag);
    const body = (await after.json()) as { id: number; version: number; doc: OfficeMapDoc };
    expect(body).toMatchObject({ id: pub.json.id, version: pub.json.version });
    expect(body.doc.name).toBe('nova');

    // segunda publicação: nome padrão "Versão <n>"; a anterior deixa de ser a atual
    await putDraft(fallbackMapDoc());
    const pub2 = await srv.req('POST', '/api/admin/maps/draft/publish', {}, admin);
    expect(pub2.status).toBe(200);
    const list2 = await srv.req('GET', '/api/admin/maps', undefined, admin);
    expect(list2.json.maps.find((m: { id: number }) => m.id === pub2.json.id)).toMatchObject({ name: 'Versão 2', current: true });
    expect(list2.json.maps.find((m: { id: number }) => m.id === pub.json.id).current).toBe(false);

    // rollback: republicar a primeira versão
    const rb = await srv.req('POST', `/api/admin/maps/${pub.json.id}/publish`, {}, admin);
    expect(rb.status).toBe(200);
    expect(rb.json.id).toBe(pub.json.id);
    expect(srv.app.office.mapId).toBe(pub.json.id);
    expect(srv.app.office.assembly.doc.name).toBe('nova');
  });

  it('publicar doc com erros → 409 e nada muda', async () => {
    const doc = fallbackMapDoc();
    doc.spawn = [{ x: 50, y: 50 }]; // fora do mapa
    await putDraft(doc);
    const v0 = srv.app.office.layoutVersion;
    const tag0 = srv.app.office.etag;
    const r = await srv.req('POST', '/api/admin/maps/draft/publish', { confirmWarnings: true }, admin);
    expect(r.status).toBe(409);
    expect(r.json.errors.length).toBeGreaterThan(0);
    expect(srv.app.office.layoutVersion).toBe(v0);
    expect(srv.app.office.etag).toBe(tag0);
    const list = await srv.req('GET', '/api/admin/maps', undefined, admin);
    expect(list.json.maps.filter((m: { kind: string }) => m.kind === 'version')).toHaveLength(0);
  });

  it('warnings exigem confirmWarnings', async () => {
    const doc = fallbackMapDoc();
    doc.areas[0].floors = []; // floor_missing (warning)
    await putDraft(doc);
    const v = await srv.req('POST', '/api/admin/maps/draft/validate', {}, admin);
    expect(v.json.errors).toEqual([]);
    expect(v.json.warnings.length).toBeGreaterThan(0);
    const r = await srv.req('POST', '/api/admin/maps/draft/publish', {}, admin);
    expect(r.status).toBe(409);
    expect(r.json.errors).toEqual([]);
    const ok = await srv.req('POST', '/api/admin/maps/draft/publish', { confirmWarnings: true }, admin);
    expect(ok.status).toBe(200);
  });

  it('quem está num tile que fica bloqueado é movido; validate prevê', async () => {
    const office = srv.app.office;
    await office.join(sessionUser(77), new FakeConn());
    office.teleport(77, 3, 3);
    const doc = fallbackMapDoc();
    doc.areas[0].blocked = [{ x: 2, y: 2, w: 3, h: 3 }];
    await putDraft(doc);

    const v = await srv.req('POST', '/api/admin/maps/draft/validate', {}, admin);
    expect(v.json.errors).toEqual([]);
    expect(v.json.wouldMove).toBe(1);
    expect(office.posOf(77)).toMatchObject({ tx: 3, ty: 3 }); // dry-run não mexe

    const r = await srv.req('POST', '/api/admin/maps/draft/publish', { confirmWarnings: true }, admin);
    expect(r.status).toBe(200);
    expect(r.json.moved).toBeGreaterThanOrEqual(1);
    const p = office.posOf(77)!;
    expect(office.assembly.grid.walkable(p.tx, p.ty)).toBe(true);
  });

  it('mesa reivindicada que some do mapa é liberada no banco e no mundo', async () => {
    const owner = await addUser(srv.repos, { email: 'bia@example.com' });
    expect(await srv.repos.desks.claim('velha#f1', owner.id)).toMatchObject({ ok: true });
    await srv.app.office.load();
    await putDraft(fallbackMapDoc());
    const v = await srv.req('POST', '/api/admin/maps/draft/validate', {}, admin);
    expect(v.json.wouldReleaseDesks).toBe(1);
    const r = await srv.req('POST', '/api/admin/maps/draft/publish', { confirmWarnings: true }, admin);
    expect(r.status).toBe(200);
    expect(r.json.releasedDesks).toBe(1);
    expect(await srv.repos.desks.all()).toEqual([]);
    expect(srv.app.office.desks.size).toBe(0);
  });

  it('restore e default gravam o rascunho; GET :id; excluir a atual/única → 409', async () => {
    const d = fallbackMapDoc();
    d.name = 'v1';
    await putDraft(d);
    const p1 = await srv.req('POST', '/api/admin/maps/draft/publish', { confirmWarnings: true }, admin);
    expect(p1.status).toBe(200);

    expect((await srv.req('DELETE', `/api/admin/maps/${p1.json.id}`, undefined, admin)).status).toBe(409);

    const def = await srv.req('POST', '/api/admin/maps/default', {}, admin);
    expect(def.status).toBe(200);
    expect(def.json.doc).toEqual(buildDefaultMap('pt-BR'));

    const res = await srv.req('POST', `/api/admin/maps/${p1.json.id}/restore`, {}, admin);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ kind: 'draft', parent_id: p1.json.id });
    expect(res.json.doc.name).toBe('v1');
    expect((await srv.req('POST', '/api/admin/maps/999/restore', {}, admin)).status).toBe(404);

    const one = await srv.req('GET', `/api/admin/maps/${p1.json.id}`, undefined, admin);
    expect(one.status).toBe(200);
    expect(one.json.doc.name).toBe('v1');

    // segunda versão publicada: a primeira deixa de ser atual e pode ser excluída
    const p2 = await srv.req('POST', '/api/admin/maps/draft/publish', { confirmWarnings: true }, admin);
    expect(p2.status).toBe(200);
    expect((await srv.req('DELETE', `/api/admin/maps/${p2.json.id}`, undefined, admin)).status).toBe(409);
    expect((await srv.req('DELETE', `/api/admin/maps/${p1.json.id}`, undefined, admin)).status).toBe(200);
    expect((await srv.req('GET', `/api/admin/maps/${p1.json.id}`, undefined, admin)).status).toBe(404);
  });

  it('excluir a única versão (não publicada no mundo) → 409', async () => {
    const v = await srv.repos.maps.createVersion(fallbackMapDoc(), 'só', null, null, null);
    expect((await srv.req('DELETE', `/api/admin/maps/${v.id}`, undefined, admin)).status).toBe(409);
  });
});

describe('publishMap (sequência)', () => {
  it('rascunho → versão publicada, poda mesas e troca o mapa', async () => {
    const w = makeWorld(fallbackMapDoc());
    await w.repos.maps.saveDraft(buildDefaultMap(), null, 1);
    await w.repos.desks.claim('nao-existe#f9', 5);
    await w.office.load();
    const out = await publishMap(w.repos, w.office, 'draft', { by: 1 });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.releasedDesks).toBe(1);
    expect((await w.repos.maps.getPublished())?.id).toBe(out.result.id);
    expect(w.office.mapId).toBe(out.result.id);
    expect(w.office.assembly.desks.length).toBe(assembleOffice(buildDefaultMap(), 0).desks.length);
    expect(await w.repos.desks.all()).toEqual([]);
  });
});
