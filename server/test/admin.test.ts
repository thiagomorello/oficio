import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setQuiet } from '../log';
import { addUser, cookieOf, startTestServer, type TestServer } from './http';

setQuiet(true);

let srv: TestServer;
afterEach(async () => {
  await srv.close();
});

const PW = 'senha-boa-123';

async function loginAs(email: string, password = PW): Promise<string> {
  const r = await srv.req('POST', '/api/auth/login', { email, password });
  expect(r.status).toBe(200);
  return cookieOf(r.headers);
}

describe('admin: usuários', () => {
  let admin: string;
  let adminId: number;
  beforeEach(async () => {
    srv = await startTestServer();
    adminId = (await addUser(srv.repos, { email: 'chefe@example.com', name: 'Chefe', admin: true })).id;
    admin = await loginAs('chefe@example.com');
  });

  it('não admin recebe 403 e anônimo 401', async () => {
    await addUser(srv.repos, { email: 'ana@example.com' });
    const c = await loginAs('ana@example.com');
    for (const [m, p] of [
      ['GET', '/api/admin/users'],
      ['POST', '/api/admin/users'],
      ['GET', '/api/admin/roles'],
      ['GET', '/api/admin/stats'],
    ] as const) {
      expect((await srv.req(m, p, m === 'POST' ? {} : undefined, c)).status).toBe(403);
    }
    expect((await srv.req('GET', '/api/admin/users')).status).toBe(401);
  });

  it('lista, busca e pagina', async () => {
    for (let i = 0; i < 5; i++) await addUser(srv.repos, { email: `u${i}@x.com`, name: `Pessoa ${i}` });
    await addUser(srv.repos, { email: 'zelia@x.com', name: 'Zélia Rara' });
    const all = await srv.req('GET', '/api/admin/users', undefined, admin);
    expect(all.json.total).toBe(7);
    expect(all.json.rows[0]).toMatchObject({ source: 'local', hasAvatar: false, deskId: null, needsPasswordChange: false });
    expect(all.json.rows[0].password_hash).toBeUndefined();
    const search = await srv.req('GET', '/api/admin/users?search=rara', undefined, admin);
    expect(search.json.rows.map((r: { email: string }) => r.email)).toEqual(['zelia@x.com']);
    const p2 = await srv.req('GET', '/api/admin/users?page=2&pageSize=3', undefined, admin);
    expect(p2.json.total).toBe(7);
    expect(p2.json.rows).toHaveLength(3);
    const p3 = await srv.req('GET', '/api/admin/users?page=3&pageSize=3', undefined, admin);
    expect(p3.json.rows).toHaveLength(1);
  });

  it('filtra por status', async () => {
    const u = await addUser(srv.repos, { email: 'off@x.com' });
    await srv.repos.users.update(u.id, { status: 'disabled' });
    const r = await srv.req('GET', '/api/admin/users?status=disabled', undefined, admin);
    expect(r.json.rows.map((x: { id: number }) => x.id)).toEqual([u.id]);
  });

  it('cria conta local com senha temporária quando não há e-mail configurado', async () => {
    const r = await srv.req('POST', '/api/admin/users', { name: 'Novo Alguém', email: 'Novo@X.com', roleName: 'Suporte' }, admin);
    expect(r.status).toBe(201);
    expect(r.json.emailed).toBe(false);
    expect(r.json.tempPassword).toHaveLength(12);
    expect(r.json.user).toMatchObject({ email: 'novo@x.com', roleName: 'Suporte', source: 'local', needsPasswordChange: true, isAdmin: false });
    expect(srv.sent).toHaveLength(0);
    const l = await srv.req('POST', '/api/auth/login', { email: 'novo@x.com', password: r.json.tempPassword });
    expect(l.status).toBe(200);
    expect(l.json.user.mustChangePassword).toBe(true);
    expect((await srv.req('GET', '/api/admin/roles', undefined, admin)).json.roles).toContain('Suporte');
  });

  it('envia convite por e-mail quando o mailer está configurado', async () => {
    await srv.close();
    srv = await startTestServer({ mailConfigured: true });
    await addUser(srv.repos, { email: 'chefe@example.com', admin: true });
    const c = await loginAs('chefe@example.com');
    const r = await srv.req('POST', '/api/admin/users', { name: 'Novo Alguém', email: 'novo@x.com' }, c);
    expect(r.status).toBe(201);
    expect(r.json.emailed).toBe(true);
    expect(r.json.tempPassword).toBeUndefined();
    expect(srv.sent).toHaveLength(1);
    expect(srv.sent[0].to).toBe('novo@x.com');
  });

  it('e-mail duplicado e dados inválidos', async () => {
    const dup = await srv.req('POST', '/api/admin/users', { name: 'Outro', email: 'CHEFE@example.com' }, admin);
    expect(dup.status).toBe(409);
    expect((await srv.req('POST', '/api/admin/users', { name: 'X', email: 'nao-e-email' }, admin)).status).toBe(400);
  });

  it('não deixa o admin desativar a si mesmo nem remover o próprio admin', async () => {
    expect((await srv.req('PATCH', `/api/admin/users/${adminId}`, { status: 'disabled' }, admin)).status).toBe(409);
    expect((await srv.req('PATCH', `/api/admin/users/${adminId}`, { isAdmin: false }, admin)).status).toBe(409);
  });

  it('com dois admins um pode rebaixar o outro, mas nunca sobra zero', async () => {
    const other = await addUser(srv.repos, { email: 'outro@x.com', admin: true });
    const ok = await srv.req('PATCH', `/api/admin/users/${other.id}`, { isAdmin: false }, admin);
    expect(ok.status).toBe(200);
    expect(ok.json.user.isAdmin).toBe(false);
    expect(await srv.repos.users.countAdmins()).toBe(1);
    // o único admin ativo não pode se rebaixar nem se desativar
    expect((await srv.req('PATCH', `/api/admin/users/${adminId}`, { isAdmin: false }, admin)).status).toBe(409);
    expect((await srv.req('PATCH', `/api/admin/users/${adminId}`, { status: 'disabled' }, admin)).status).toBe(409);
    expect(await srv.repos.users.countAdmins()).toBe(1);
  });

  it('desativar chama o gancho, invalida a sessão e impede o login', async () => {
    const u = await addUser(srv.repos, { email: 'ana@example.com' });
    const ana = await loginAs('ana@example.com');
    const calls: number[] = [];
    srv.app.hooks.onUserDisabled = (id) => calls.push(id);
    const r = await srv.req('PATCH', `/api/admin/users/${u.id}`, { status: 'disabled' }, admin);
    expect(r.status).toBe(200);
    expect(r.json.user.status).toBe('disabled');
    expect(calls).toEqual([u.id]);
    expect((await srv.req('GET', '/api/me', undefined, ana)).status).toBe(401);
    expect((await srv.req('POST', '/api/auth/login', { email: 'ana@example.com', password: PW })).status).toBe(403);
    // reativar não chama o gancho
    await srv.req('PATCH', `/api/admin/users/${u.id}`, { status: 'active', roleName: 'Dev', name: 'Ana S.' }, admin);
    expect(calls).toEqual([u.id]);
    expect((await srv.repos.users.byId(u.id))?.role_name).toBe('Dev');
  });

  it('usuário inexistente é 404 e campos desconhecidos 400', async () => {
    expect((await srv.req('PATCH', '/api/admin/users/9999', { status: 'active' }, admin)).status).toBe(404);
    expect((await srv.req('PATCH', `/api/admin/users/${adminId}`, { password_hash: 'x' }, admin)).status).toBe(400);
  });

  it('resetar a senha derruba a sessão antiga e exige troca', async () => {
    const u = await addUser(srv.repos, { email: 'ana@example.com' });
    const ana = await loginAs('ana@example.com');
    const before = (await srv.repos.users.byId(u.id))!.password_version;
    const r = await srv.req('POST', `/api/admin/users/${u.id}/reset-password`, {}, admin);
    expect(r.status).toBe(200);
    expect(r.json.tempPassword).toHaveLength(12);
    const after = (await srv.repos.users.byId(u.id))!;
    expect(after.password_version).toBe(before + 1);
    expect(after.must_change_password).toBe(true);
    expect((await srv.req('GET', '/api/me', undefined, ana)).status).toBe(401);
    expect((await srv.req('POST', '/api/auth/login', { email: 'ana@example.com', password: PW })).status).toBe(401);
    expect((await srv.req('POST', '/api/auth/login', { email: 'ana@example.com', password: r.json.tempPassword })).status).toBe(200);
  });

  it('libera a mesa do usuário e avisa o gancho', async () => {
    const u = await addUser(srv.repos, { email: 'ana@example.com' });
    await srv.repos.desks.claim('desk-1', u.id);
    const list = await srv.req('GET', '/api/admin/users?search=ana', undefined, admin);
    expect(list.json.rows[0].deskId).toBe('desk-1');
    const calls: [string, number][] = [];
    srv.app.hooks.onDeskReleased = (d, id) => calls.push([d, id]);
    const r = await srv.req('DELETE', `/api/admin/users/${u.id}/desk`, undefined, admin);
    expect(r.status).toBe(200);
    expect(await srv.repos.desks.ownedBy(u.id)).toBeNull();
    expect(calls).toEqual([['desk-1', u.id]]);
    expect((await srv.req('DELETE', `/api/admin/users/${u.id}/desk`, undefined, admin)).status).toBe(404);
  });

  it('estatísticas', async () => {
    const u = await addUser(srv.repos, { email: 'ana@example.com' });
    await srv.repos.desks.claim('desk-1', u.id);
    await srv.repos.sessions.open(u.id);
    srv.app.hooks.onlineCount = () => 3;
    const r = await srv.req('GET', '/api/admin/stats', undefined, admin);
    expect(r.json).toEqual({ online: 3, loginsToday: 1, desksClaimed: 1, usersActive: 2 });
  });
});
