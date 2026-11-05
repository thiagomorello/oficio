import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { effectiveMasterPassword, tempPassword, tokenPair, verify, hash } from '../auth/password';
import { createRateLimiter } from '../auth/ratelimit';
import { signSession, verifySession } from '../auth/jwt';
import { createMailer, templates } from '../auth/mailer';
import { ACC_COLORS, BOTTOM_COLORS, EYES, HAIR_NATURAL_COLORS, SHOE_COLORS, SKINS, TOP_COLORS } from '../../shared/validate/appearance-options';
import { setQuiet } from '../log';
import { addUser, cookieOf, startTestServer, testConfig, type TestServer } from './http';

setQuiet(true);

let srv: TestServer;
beforeEach(async () => {
  srv = await startTestServer();
});
afterEach(async () => {
  await srv.close();
});

const PW = 'senha-boa-123';
const login = (email = 'ana@example.com', password = PW) => srv.req('POST', '/api/auth/login', { email, password });

describe('login', () => {
  it('ok: devolve o usuário e cookie com os atributos certos', async () => {
    await addUser(srv.repos);
    const r = await login();
    expect(r.status).toBe(200);
    expect(r.json.user).toMatchObject({ email: 'ana@example.com', isAdmin: false, mustChangePassword: false });
    const sc = r.headers.getSetCookie().find((c) => c.startsWith('office_session='))!;
    expect(sc).toContain('Path=/');
    expect(sc).toContain('HttpOnly');
    expect(sc).toContain('SameSite=Lax');
    expect(sc).toContain('Max-Age=2592000');
    expect(sc).toContain('Secure');
    expect(r.json.user.password_hash).toBeUndefined();
  });

  it('cookie sem Secure com OFFICE_COOKIE_SECURE=0', async () => {
    await srv.close();
    srv = await startTestServer({ config: { cookieSecure: false } });
    await addUser(srv.repos);
    const sc = (await login()).headers.getSetCookie()[0];
    expect(sc).not.toContain('Secure');
  });

  it('e-mail em outra caixa funciona', async () => {
    await addUser(srv.repos);
    expect((await login('ANA@Example.com')).status).toBe(200);
  });

  it('senha errada e e-mail desconhecido: 401 com a mesma mensagem', async () => {
    await addUser(srv.repos);
    const a = await login('ana@example.com', 'errada-errada');
    const b = await login('ninguem@example.com', 'qualquer-coisa');
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.json).toEqual({ error: 'E-mail ou senha inválidos' });
    expect(b.json).toEqual(a.json);
    expect(a.headers.getSetCookie()).toHaveLength(0);
  });

  it('conta desativada: 403 code disabled', async () => {
    const u = await addUser(srv.repos);
    await srv.repos.users.update(u.id, { status: 'disabled' });
    const r = await login();
    expect(r.status).toBe(403);
    expect(r.json.code).toBe('disabled');
  });

  it('rate limit: 11ª tentativa errada vira 429 com Retry-After (mesmo com a senha certa)', async () => {
    await addUser(srv.repos);
    for (let i = 0; i < 10; i++) expect((await login('ana@example.com', 'errada-errada')).status).toBe(401);
    const r = await login();
    expect(r.status).toBe(429);
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
    // outro e-mail não é afetado
    expect((await login('outra@example.com', 'x')).status).toBe(401);
  });

  it('exige JSON e valida o corpo', async () => {
    expect((await srv.req('POST', '/api/auth/login', { email: 'x' })).status).toBe(400);
    const res = await fetch(`${srv.base}/api/auth/login`, { method: 'POST', body: 'a=b', headers: { 'Content-Type': 'text/plain' } });
    expect(res.status).toBe(415);
  });

  it('logout limpa o cookie', async () => {
    const r = await srv.req('POST', '/api/auth/logout', {});
    expect(r.status).toBe(200);
    expect(r.headers.getSetCookie()[0]).toMatch(/^office_session=;.*Max-Age=0/);
  });
});

describe('GET /api/me', () => {
  it('sem cookie: 401; com cookie: usuário + needsAvatar + deskId', async () => {
    const u = await addUser(srv.repos);
    expect((await srv.req('GET', '/api/me')).status).toBe(401);
    const cookie = cookieOf((await login()).headers);
    let me = await srv.req('GET', '/api/me', undefined, cookie);
    expect(me.status).toBe(200);
    expect(me.json).toMatchObject({ id: u.id, name: 'Ana Souza', email: 'ana@example.com', needsAvatar: true, deskId: null, appearance: null });
    expect(me.json.settings.volume).toBe(1);
    await srv.repos.desks.claim('A1-1', u.id);
    me = await srv.req('GET', '/api/me', undefined, cookie);
    expect(me.json.deskId).toBe('A1-1');
  });

  it('cookie adulterado, conta desativada: 401', async () => {
    const u = await addUser(srv.repos);
    const cookie = cookieOf((await login()).headers);
    expect((await srv.req('GET', '/api/me', undefined, cookie + 'x')).status).toBe(401);
    await srv.repos.users.update(u.id, { status: 'disabled' });
    srv.app.session.invalidateAll();
    expect((await srv.req('GET', '/api/me', undefined, cookie)).status).toBe(401);
  });
});

const goodAppearance = () => ({
  skin: SKINS[0],
  hair: HAIR_NATURAL_COLORS[0].toUpperCase(),
  hairStyle: 'short',
  eyes: EYES[0],
  top: TOP_COLORS[0],
  topAccent: '#F4F4F0',
  topStyle: 'tshirt',
  bottom: BOTTOM_COLORS[0],
  shoes: SHOE_COLORS[0],
  accessory: 'none',
  accessoryColor: ACC_COLORS.none[0],
  lanyard: null,
  look: 'f',
});

describe('PUT /api/me/appearance e settings', () => {
  it('valida, normaliza, salva e dispara o gancho', async () => {
    const u = await addUser(srv.repos);
    const calls: unknown[][] = [];
    srv.app.hooks.onAppearanceChanged = (...a) => void calls.push(a);
    const cookie = cookieOf((await login()).headers);

    const bad = await srv.req('PUT', '/api/me/appearance', { appearance: { ...goodAppearance(), hairStyle: 'nope' }, displayName: 'Ana' }, cookie);
    expect(bad.status).toBe(400);
    expect(bad.json.issues.length).toBeGreaterThan(0);
    const badName = await srv.req('PUT', '/api/me/appearance', { appearance: goodAppearance(), displayName: '<b>' }, cookie);
    expect(badName.status).toBe(400);

    const ok = await srv.req('PUT', '/api/me/appearance', { appearance: goodAppearance(), displayName: '  Aninha  ' }, cookie);
    expect(ok.status).toBe(200);
    expect(ok.json.name).toBe('Aninha');
    expect(ok.json.needsAvatar).toBe(false);
    expect(ok.json.appearance.hair).toBe(HAIR_NATURAL_COLORS[0].toLowerCase());
    expect(ok.json.appearance.facialHair).toBe('none');
    const row = await srv.repos.users.byId(u.id);
    expect(row?.display_name).toBe('Aninha');
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(u.id);
    expect(calls[0][2]).toBe('Aninha');
    // o cache da sessão foi invalidado
    expect((await srv.req('GET', '/api/me', undefined, cookie)).json.name).toBe('Aninha');
  });

  it('exige sessão', async () => {
    expect((await srv.req('PUT', '/api/me/appearance', { appearance: goodAppearance(), displayName: 'Ana' })).status).toBe(401);
  });

  it('settings: mescla parcial e rejeita valores inválidos', async () => {
    await addUser(srv.repos);
    const cookie = cookieOf((await login()).headers);
    const ok = await srv.req('PUT', '/api/me/settings', { patch: { sounds: false, volume: 0.5 } }, cookie);
    expect(ok.status).toBe(200);
    expect(ok.json.settings).toMatchObject({ sounds: false, volume: 0.5, showNames: true });
    expect((await srv.req('PUT', '/api/me/settings', { patch: { volume: 2 } }, cookie)).status).toBe(400);
    expect((await srv.req('PUT', '/api/me/settings', { patch: { hack: true } }, cookie)).status).toBe(400);
    const again = await srv.req('PUT', '/api/me/settings', { patch: { minimap: false } }, cookie);
    expect(again.json.settings).toMatchObject({ sounds: false, minimap: false });
    // idioma: salva, rejeita desconhecido e `null` volta ao automático (chave some)
    expect((await srv.req('PUT', '/api/me/settings', { patch: { locale: 'en' } }, cookie)).json.settings).toMatchObject({ locale: 'en' });
    expect((await srv.req('PUT', '/api/me/settings', { patch: { locale: 'fr' } }, cookie)).status).toBe(400);
    const auto = await srv.req('PUT', '/api/me/settings', { patch: { locale: null } }, cookie);
    expect(auto.status).toBe(200);
    expect(auto.json.settings).not.toHaveProperty('locale');
    expect(auto.json.settings).toMatchObject({ sounds: false, minimap: false });
  });
});

describe('reset de senha', () => {
  it('forgot sem SendGrid: manual:true e nenhum token vaza; sempre 200', async () => {
    await addUser(srv.repos);
    const a = await srv.req('POST', '/api/auth/forgot', { email: 'ana@example.com' });
    const b = await srv.req('POST', '/api/auth/forgot', { email: 'ninguem@example.com' });
    expect(a.status).toBe(200);
    expect(a.json).toEqual({ ok: true, manual: true });
    expect(b.json).toEqual(a.json);
    expect(srv.sent).toHaveLength(0);
  });

  it('forgot com e-mail configurado envia o link; reset consome o token uma única vez', async () => {
    await srv.close();
    srv = await startTestServer({ mailConfigured: true, config: { publicUrl: 'https://office.example.com' } });
    const u = await addUser(srv.repos);
    const f = await srv.req('POST', '/api/auth/forgot', { email: 'ana@example.com' });
    expect(f.json).toEqual({ ok: true });
    expect(srv.sent).toHaveLength(1);
    const m = /https:\/\/office\.example\.com\/login\?reset=([\w-]+)/.exec(srv.sent[0].text);
    expect(m).toBeTruthy();
    const token = m![1];

    expect((await srv.req('POST', '/api/auth/reset', { token, password: 'curta' })).status).toBe(400);
    const r1 = await srv.req('POST', '/api/auth/reset', { token, password: 'nova-senha-456' });
    expect(r1.status).toBe(200);
    expect((await srv.req('POST', '/api/auth/reset', { token, password: 'outra-senha-789' })).status).toBe(400);
    expect((await login('ana@example.com', PW)).status).toBe(401);
    expect((await login('ana@example.com', 'nova-senha-456')).status).toBe(200);
    expect((await srv.repos.users.byId(u.id))?.password_version).toBe(u.password_version + 1);
  });

  it('token inexistente: 400', async () => {
    expect((await srv.req('POST', '/api/auth/reset', { token: 'x'.repeat(43), password: 'nova-senha-456' })).status).toBe(400);
  });
});

describe('change-password', () => {
  it('troca a senha, sobe password_version e derruba o cookie antigo; o novo vale', async () => {
    const u = await addUser(srv.repos);
    const old = cookieOf((await login()).headers);
    const wrong = await srv.req('POST', '/api/auth/change-password', { current: 'errada-errada', password: 'nova-senha-456' }, old);
    expect(wrong.status).toBe(400);
    const noCurrent = await srv.req('POST', '/api/auth/change-password', { password: 'nova-senha-456' }, old);
    expect(noCurrent.status).toBe(400);
    const weak = await srv.req('POST', '/api/auth/change-password', { current: PW, password: 'ana@example.com' }, old);
    expect(weak.status).toBe(400);

    const ok = await srv.req('POST', '/api/auth/change-password', { current: PW, password: 'nova-senha-456' }, old);
    expect(ok.status).toBe(200);
    expect((await srv.repos.users.byId(u.id))?.password_version).toBe(u.password_version + 1);
    expect((await srv.req('GET', '/api/me', undefined, old)).status).toBe(401);
    const fresh = cookieOf(ok.headers);
    expect(fresh).not.toBe('');
    expect((await srv.req('GET', '/api/me', undefined, fresh)).status).toBe(200);
  });

  it('com troca obrigatória não exige a senha atual e limpa o flag', async () => {
    const u = await addUser(srv.repos, { mustChange: true });
    const cookie = cookieOf((await login()).headers);
    expect((await srv.req('GET', '/api/me', undefined, cookie)).json.mustChangePassword).toBe(true);
    const ok = await srv.req('POST', '/api/auth/change-password', { password: 'nova-senha-456' }, cookie);
    expect(ok.status).toBe(200);
    expect(ok.json.user.mustChangePassword).toBe(false);
    expect((await srv.repos.users.byId(u.id))?.must_change_password).toBe(false);
  });

  it('exige sessão', async () => {
    expect((await srv.req('POST', '/api/auth/change-password', { password: 'nova-senha-456' })).status).toBe(401);
  });
});

describe('portão de páginas', () => {
  it('sem sessão: 302 para /login?next=', async () => {
    const r = await srv.req('GET', '/');
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/login?next=%2F');
    const a = await srv.req('GET', '/admin/mapa?x=1');
    expect(a.status).toBe(302);
    expect(a.headers.get('location')).toBe('/login?next=%2Fadmin%2Fmapa%3Fx%3D1');
  });

  it('troca de senha pendente: 302 para /login?change=1', async () => {
    await addUser(srv.repos, { mustChange: true });
    const cookie = cookieOf((await login()).headers);
    const r = await srv.req('GET', '/', undefined, cookie);
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/login?change=1');
  });

  it('/admin sem ser admin: 403 HTML; admin e usuário comum passam do portão; /login é livre', async () => {
    await addUser(srv.repos);
    await addUser(srv.repos, { email: 'chefe@example.com', admin: true });
    const user = cookieOf((await login()).headers);
    const adm = cookieOf((await login('chefe@example.com')).headers);
    const denied = await srv.req('GET', '/admin', undefined, user);
    expect(denied.status).toBe(403);
    expect(denied.text).toContain('Acesso restrito');
    // sem dist/client no teste, o estático responde 503: o que importa é não ser 302/403
    expect((await srv.req('GET', '/admin', undefined, adm)).status).not.toBe(403);
    expect((await srv.req('GET', '/admin', undefined, adm)).status).not.toBe(302);
    expect((await srv.req('GET', '/', undefined, user)).status).not.toBe(302);
    expect((await srv.req('GET', '/login')).status).not.toBe(302);
  });
});

describe('idioma por requisição', () => {
  it('Accept-Language: en -> 401 JSON e página 403 em inglês; ?lang= vence o cabeçalho', async () => {
    const en = { 'Accept-Language': 'en-US,en;q=0.9' };
    expect((await srv.req('GET', '/api/me')).json).toEqual({ error: 'não autenticado' }); // padrão da instância (pt-BR no teste)
    expect((await srv.req('GET', '/api/me', undefined, undefined, en)).json).toEqual({ error: 'not authenticated' });
    expect((await srv.req('GET', '/api/me?lang=pt-BR', undefined, undefined, en)).json).toEqual({ error: 'não autenticado' });

    await addUser(srv.repos);
    const user = cookieOf((await login()).headers);
    const denied = await srv.req('GET', '/admin', undefined, user, en);
    expect(denied.status).toBe(403);
    expect(denied.text).toContain('<html lang="en">');
    expect(denied.text).toContain('Restricted area');
    expect(denied.text).toContain('This area is for administrators only.');
    expect(denied.text).not.toContain('Acesso restrito');

    const bad = await srv.req('POST', '/api/auth/login', { email: 'ana@example.com', password: 'errada' }, undefined, en);
    expect(bad.json).toEqual({ error: 'Invalid e-mail or password' });
  });

  it('e-mails saem no idioma do usuário (settings.locale) ou da requisição, com ?lang= no link', async () => {
    await srv.close();
    srv = await startTestServer({ mailConfigured: true, config: { publicUrl: 'https://office.example.com' } });
    const u = await addUser(srv.repos);
    await srv.req('POST', '/api/auth/forgot', { email: u.email }, undefined, { 'Accept-Language': 'en' });
    expect(srv.sent[0].subject).toBe('Reset your Oficio password');
    expect(srv.sent[0].text).toContain('/login?reset=');
    expect(srv.sent[0].text).toContain('&lang=en');
    expect(srv.sent[0].html).toContain('<html lang="en">');

    await srv.repos.users.update(u.id, { settings: { locale: 'pt-BR' } });
    await srv.req('POST', '/api/auth/forgot', { email: u.email }, undefined, { 'Accept-Language': 'en' });
    expect(srv.sent[1].subject).toBe('Redefinir sua senha do Oficio');
    expect(srv.sent[1].text).toContain('&lang=pt-BR');

    expect(templates.invite('Abc123xyz789', undefined, undefined, 'en').subject).toBe('Your access to Oficio');
    expect(templates.invite('Abc123xyz789').text).toContain('Temporary password: Abc123xyz789');
    expect(templates.invite('Abc123xyz789', 'https://x/login', undefined, 'pt-BR').text).toContain('Senha temporária: Abc123xyz789');
  });
});

describe('módulos de auth', () => {
  it('password: hash/verify, $2y$, senha mestra só em dev, temp e tokens', async () => {
    const h = await hash('abc12345');
    expect(await verify('abc12345', h)).toBe(true);
    expect(await verify('outra', h)).toBe(false);
    expect(await verify('abc12345', h.replace('$2b$', '$2y$'))).toBe(true);
    expect(await verify('mestra', h, 'mestra')).toBe(true);
    expect(effectiveMasterPassword({ dev: false, loginMasterPassword: 'm' }, false)).toBeUndefined();
    expect(effectiveMasterPassword({ dev: true, loginMasterPassword: 'm' })).toBe('m');
    expect(tempPassword()).toHaveLength(12);
    const t = tokenPair();
    expect(t.raw).toMatch(/^[\w-]{43}$/);
    expect(t.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('senha mestra ignorada em produção no login', async () => {
    await srv.close();
    srv = await startTestServer({ config: { dev: false, loginMasterPassword: 'mestra-123' } });
    await addUser(srv.repos);
    expect((await login('ana@example.com', 'mestra-123')).status).toBe(401);
  });

  it('jwt: ida e volta, segredo errado e lixo', () => {
    const t = signSession({ sub: '7', pv: 3, adm: true }, 's'.repeat(32));
    expect(verifySession(t, 's'.repeat(32))).toEqual({ userId: 7, pv: 3 });
    expect(verifySession(t, 'x'.repeat(32))).toBeNull();
    expect(verifySession('lixo', 's'.repeat(32))).toBeNull();
  });

  it('ratelimit: janela deslizante', () => {
    let now = 0;
    const rl = createRateLimiter({ max: 2, windowMs: 1000, now: () => now });
    rl.fail('k');
    rl.fail('k');
    expect(rl.blockedFor('k')).toBe(1);
    now = 1001;
    expect(rl.blockedFor('k')).toBe(0);
  });

  it('mailer: sem config não envia; com config chama o SendGrid e nunca lança', async () => {
    expect(await createMailer(testConfig()).sendMail({ to: 'a@b.c', subject: 's', html: 'h', text: 't' })).toEqual({ sent: false });
    const calls: { url: string; init: RequestInit }[] = [];
    const ok = createMailer({ mail: { sendgridApiKey: 'SG.k', from: 'suporte@example.com' } }, (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch);
    expect(await ok.sendMail({ to: 'a@b.c', ...templates.reset('https://x/login?reset=abc') })).toEqual({ sent: true });
    expect(calls[0].url).toBe('https://api.sendgrid.com/v3/mail/send');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer SG.k');
    const boom = createMailer({ mail: { sendgridApiKey: 'k', from: 'f@x.y' } }, (async () => {
      throw new Error('rede');
    }) as unknown as typeof fetch);
    expect(await boom.sendMail({ to: 'a@b.c', subject: 's', html: 'h', text: 't' })).toEqual({ sent: false });
    expect(templates.invite('Abc123xyz789').html).toContain('Abc123xyz789');
  });
});
