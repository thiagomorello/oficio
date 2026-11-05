import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DeskDecor } from '../../shared/desk-decor';
import { setQuiet } from '../log';
import { addUser, cookieOf, startTestServer, type TestServer } from './http';

setQuiet(true);

let srv: TestServer;
let cookie: string;
let userId: number;
let calls: Array<{ deskId: string; userId: number; decor: DeskDecor | null }>;

beforeEach(async () => {
  srv = await startTestServer();
  userId = (await addUser(srv.repos)).id;
  const r = await srv.req('POST', '/api/auth/login', { email: 'ana@example.com', password: 'senha-boa-123' });
  cookie = cookieOf(r.headers);
  calls = [];
  const orig = srv.app.hooks.onDeskDecor;
  srv.app.hooks.onDeskDecor = (deskId, uid, decor) => {
    calls.push({ deskId, userId: uid, decor });
    orig?.(deskId, uid, decor);
  };
});
afterEach(async () => {
  await srv.close();
});

const decor: DeskDecor = { slots: { left: { kind: 'mug', variant: 'red' }, back: { kind: 'lamp', variant: 'black' } } };

describe('PUT/DELETE /api/me/desk/decor', () => {
  it('409 sem mesa', async () => {
    const r = await srv.req('PUT', '/api/me/desk/decor', { decor }, cookie);
    expect(r.status).toBe(409);
    expect((await srv.req('DELETE', '/api/me/desk/decor', undefined, cookie)).status).toBe(409);
    expect(calls).toHaveLength(0);
  });

  it('exige login', async () => {
    expect((await srv.req('PUT', '/api/me/desk/decor', { decor })).status).toBe(401);
  });

  it('grava decoração válida e chama o hook', async () => {
    await srv.repos.desks.claim('desk-1', userId);
    const r = await srv.req('PUT', '/api/me/desk/decor', { decor }, cookie);
    expect(r.status).toBe(200);
    expect((await srv.repos.desks.ownedBy(userId))?.decor).toEqual(decor);
    expect(calls).toEqual([{ deskId: 'desk-1', userId, decor }]);
    expect(srv.app.office.desks.get('desk-1')?.decor).toEqual(decor);
  });

  it('400 para decoração inválida', async () => {
    await srv.repos.desks.claim('desk-1', userId);
    for (const bad of [
      { slots: { left: { kind: 'lamp', variant: 'black' } } },
      { slots: { left: { kind: 'mug', variant: 'nope' } } },
      { slots: {}, extra: 1 },
      null,
    ]) {
      expect((await srv.req('PUT', '/api/me/desk/decor', { decor: bad }, cookie)).status).toBe(400);
    }
    expect(calls).toHaveLength(0);
    expect((await srv.repos.desks.ownedBy(userId))?.decor).toBeNull();
  });

  it('DELETE limpa e avisa com decor null', async () => {
    await srv.repos.desks.claim('desk-1', userId);
    await srv.req('PUT', '/api/me/desk/decor', { decor }, cookie);
    const r = await srv.req('DELETE', '/api/me/desk/decor', undefined, cookie);
    expect(r.status).toBe(200);
    expect((await srv.repos.desks.ownedBy(userId))?.decor).toBeNull();
    expect(calls[1]).toEqual({ deskId: 'desk-1', userId, decor: null });
  });

  it('liberar a mesa apaga a decoração', async () => {
    await srv.repos.desks.claim('desk-1', userId);
    await srv.req('PUT', '/api/me/desk/decor', { decor }, cookie);
    await srv.repos.desks.release('desk-1');
    await srv.repos.desks.claim('desk-1', userId);
    expect((await srv.repos.desks.ownedBy(userId))?.decor).toBeNull();
  });
});
