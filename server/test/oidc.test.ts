// Login único (OIDC): configuração, rota de início (PKCE + cookie transitório), callback com `openid-client`
// simulado (conta nova, vínculo pelo e-mail, domínio, e-mail não verificado, claim de admin, state inválido,
// criação desativada) e o bloco `oidc` do /api/config.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { claimGrantsAdmin, displayNameFromClaims, emailDomainAllowed, externalIdFor, safeNextPath, verifyPending } from '../auth/oidc';
import { loadConfig, parseOidcConfig, providerLabelFromIssuer } from '../config';
import { setQuiet } from '../log';
import { addUser, cookieOf, startTestServer, type TestServer } from './http';

setQuiet(true);

const ISSUER = 'https://idp.example.com';
const SECRET = 'test-secret-test-secret-test-secret';

// Estado compartilhado com o mock (hoisted porque `vi.mock` sobe para o topo do módulo).
const mocks = vi.hoisted(() => ({
  issuer: 'https://idp.example.com',
  claims: {} as Record<string, unknown>,
  userinfo: null as Record<string, unknown> | null,
  discoveryFailures: 0,
  discoveryCalls: 0,
  grantCalls: 0,
  lastChecks: null as Record<string, unknown> | null,
  reset() {
    this.claims = {};
    this.userinfo = null;
    this.discoveryFailures = 0;
    this.discoveryCalls = 0;
    this.grantCalls = 0;
    this.lastChecks = null;
  },
}));

vi.mock('openid-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('openid-client')>();
  const metadata = {
    issuer: mocks.issuer,
    authorization_endpoint: `${mocks.issuer}/authorize`,
    token_endpoint: `${mocks.issuer}/token`,
    userinfo_endpoint: `${mocks.issuer}/userinfo`,
    code_challenge_methods_supported: ['S256'],
  };
  return {
    ...actual,
    // Sem rede: a descoberta devolve uma Configuration real montada a partir de metadados fixos.
    discovery: vi.fn(async (_server: URL, clientId: string, secret?: unknown) => {
      mocks.discoveryCalls++;
      if (mocks.discoveryFailures > 0) {
        mocks.discoveryFailures--;
        throw new Error('ECONNREFUSED');
      }
      return new actual.Configuration(metadata, clientId, typeof secret === 'string' ? secret : undefined);
    }),
    authorizationCodeGrant: vi.fn(async (_cfg: unknown, currentUrl: URL, checks: Record<string, unknown>) => {
      mocks.grantCalls++;
      mocks.lastChecks = checks;
      if (currentUrl.searchParams.get('code') !== 'good-code') throw new Error('invalid_grant');
      return {
        access_token: 'access-token-never-logged',
        token_type: 'bearer',
        claims: () => ({ iss: mocks.issuer, aud: 'cid', nonce: checks.expectedNonce, ...mocks.claims }),
        expiresIn: () => 3600,
      };
    }),
    fetchUserInfo: vi.fn(async () => {
      if (!mocks.userinfo) throw new Error('userinfo unavailable');
      return mocks.userinfo;
    }),
  };
});

const oidcEnv = (extra: Record<string, string> = {}): Record<string, string> => ({ OIDC_ISSUER: ISSUER, OIDC_CLIENT_ID: 'cid', OIDC_CLIENT_SECRET: 'shh-client-secret', ...extra });

async function startWithOidc(extra: Record<string, string> = {}, over: Record<string, unknown> = {}): Promise<TestServer> {
  return startTestServer({ config: { oidc: parseOidcConfig(oidcEnv(extra), []), ...over } });
}

/** Começa o fluxo: devolve a URL de autorização, o cookie transitório e o state que ele guarda. */
async function begin(srv: TestServer, next?: string): Promise<{ location: URL; cookie: string; state: string; token: string }> {
  const r = await srv.req('GET', `/api/auth/oidc/start${next ? `?next=${encodeURIComponent(next)}` : ''}`);
  expect(r.status).toBe(302);
  const location = new URL(r.headers.get('location')!);
  const sc = r.headers.getSetCookie().find((c) => c.startsWith('office_oidc='))!;
  expect(sc).toBeDefined();
  const cookie = sc.split(';')[0]!;
  const token = cookie.slice('office_oidc='.length);
  const pending = verifyPending(token, SECRET);
  expect(pending).not.toBeNull();
  return { location, cookie, state: pending!.state, token };
}

async function finish(srv: TestServer, opts: { cookie?: string; state?: string; code?: string; query?: string }) {
  const q = opts.query ?? `code=${opts.code ?? 'good-code'}&state=${encodeURIComponent(opts.state ?? '')}`;
  return srv.req('GET', `/api/auth/oidc/callback?${q}`, undefined, opts.cookie);
}

/** Fluxo completo com as claims dadas. */
async function signIn(srv: TestServer, claims: Record<string, unknown>, next?: string) {
  mocks.claims = claims;
  const b = await begin(srv, next);
  return finish(srv, { cookie: b.cookie, state: b.state });
}

const errorOf = (r: { status: number; headers: Headers }): string | null => {
  expect(r.status).toBe(302);
  return new URL(r.headers.get('location')!, 'http://x').searchParams.get('error');
};

beforeEach(() => mocks.reset());

describe('config: OIDC_*', () => {
  it('desativado sem as três variáveis; aviso quando parcial', () => {
    const w: string[] = [];
    expect(parseOidcConfig({}, w).enabled).toBe(false);
    expect(w).toEqual([]);
    const partial = parseOidcConfig({ OIDC_ISSUER: ISSUER, OIDC_CLIENT_ID: 'cid' }, w);
    expect(partial.enabled).toBe(false);
    expect(w.join('\n')).toContain('OIDC_CLIENT_SECRET');
  });

  it('ativado com issuer, client id e secret; padrões aplicados', () => {
    const w: string[] = [];
    const c = parseOidcConfig(oidcEnv({ OIDC_ISSUER: `${ISSUER}/` }), w);
    expect(c).toMatchObject({ enabled: true, issuer: ISSUER, clientId: 'cid', clientSecret: 'shh-client-secret', scopes: 'openid email profile', autoCreate: true, allowedDomains: [], passwordLogin: true, label: 'Example' });
    expect(c.adminClaim).toBeUndefined();
    expect(w).toEqual([]);
  });

  it('rótulo: derivado do host ou OIDC_BUTTON_LABEL', () => {
    expect(providerLabelFromIssuer('https://accounts.google.com')).toBe('Google');
    expect(providerLabelFromIssuer('https://login.microsoftonline.com/tenant/v2.0')).toBe('Microsoft');
    expect(providerLabelFromIssuer('https://keycloak.acme.com/realms/office')).toBe('Keycloak');
    expect(providerLabelFromIssuer('https://sso.acme.com')).toBe('Acme');
    expect(providerLabelFromIssuer('https://id.acme.com.br')).toBe('Acme');
    expect(providerLabelFromIssuer('https://10.0.0.5:8080')).toBe('Single sign-on');
    expect(parseOidcConfig(oidcEnv({ OIDC_BUTTON_LABEL: 'Acme SSO' }), []).label).toBe('Acme SSO');
  });

  it('escopos, domínios, claim de admin e login por senha', () => {
    const w: string[] = [];
    const c = parseOidcConfig(oidcEnv({ OIDC_SCOPES: 'email profile groups', OIDC_ALLOWED_DOMAINS: ' Acme.com, @example.org ', OIDC_ADMIN_CLAIM: 'groups', OIDC_ADMIN_VALUES: 'oficio-admins, it', OIDC_PASSWORD_LOGIN: '0', OIDC_AUTO_CREATE: 'false' }), w);
    expect(c.scopes).toBe('openid email profile groups');
    expect(c.allowedDomains).toEqual(['acme.com', 'example.org']);
    expect(c.adminClaim).toBe('groups');
    expect(c.adminValues).toEqual(['oficio-admins', 'it']);
    expect(c.passwordLogin).toBe(false);
    expect(c.autoCreate).toBe(false);
    expect(w).toEqual([]);
  });

  it('OIDC_PASSWORD_LOGIN=0 sem SSO é ignorado com aviso; claim sem valores é ignorada', () => {
    const w: string[] = [];
    const c = parseOidcConfig({ OIDC_PASSWORD_LOGIN: '0' }, w);
    expect(c.passwordLogin).toBe(true);
    expect(w.join('\n')).toContain('OIDC_PASSWORD_LOGIN=0 ignored');
    const w2: string[] = [];
    const c2 = parseOidcConfig(oidcEnv({ OIDC_ADMIN_CLAIM: 'groups' }), w2);
    expect(c2.adminClaim).toBeUndefined();
    expect(w2.join('\n')).toContain('OIDC_ADMIN_VALUES');
  });

  it('issuer inválido desativa com aviso; loadConfig expõe cfg.oidc', () => {
    const w: string[] = [];
    expect(parseOidcConfig(oidcEnv({ OIDC_ISSUER: 'not a url' }), w).enabled).toBe(false);
    expect(w.join('\n')).toContain('Invalid OIDC_ISSUER');
    const cfg = loadConfig([], { ...oidcEnv(), OFFICE_JWT_SECRET: 'x', DATABASE_URL: 'mysql://u:p@h/db' });
    expect(cfg.oidc.enabled).toBe(true);
    expect(cfg.warnings.some((x) => x.includes('OIDC'))).toBe(false);
  });
});

describe('helpers', () => {
  it('emailDomainAllowed, claimGrantsAdmin, displayNameFromClaims, safeNextPath, externalIdFor', () => {
    expect(emailDomainAllowed('a@Acme.com', [])).toBe(true);
    expect(emailDomainAllowed('a@Acme.com', ['acme.com'])).toBe(true);
    expect(emailDomainAllowed('a@other.com', ['acme.com'])).toBe(false);
    const m = { adminClaim: 'groups', adminValues: ['oficio-admins'] };
    expect(claimGrantsAdmin({ groups: ['dev', 'oficio-admins'] }, m)).toBe(true);
    expect(claimGrantsAdmin({ groups: 'oficio-admins dev' }, m)).toBe(true);
    expect(claimGrantsAdmin({ groups: ['dev'] }, m)).toBe(false);
    expect(claimGrantsAdmin({}, m)).toBe(false);
    expect(claimGrantsAdmin({ groups: ['oficio-admins'] }, { adminClaim: undefined, adminValues: [] })).toBe(false);
    expect(displayNameFromClaims({ name: ' Ana Souza ' }, 'ana@x.com')).toBe('Ana Souza');
    expect(displayNameFromClaims({ given_name: 'Ana', family_name: 'Souza' }, 'ana@x.com')).toBe('Ana Souza');
    expect(displayNameFromClaims({}, 'ana.souza@x.com')).toBe('ana.souza');
    expect(safeNextPath('/admin?x=1')).toBe('/admin?x=1');
    expect(safeNextPath('//evil.com')).toBe('/');
    expect(safeNextPath('/login')).toBe('/');
    expect(safeNextPath('/api/me')).toBe('/');
    expect(safeNextPath(null)).toBe('/');
    expect(externalIdFor(ISSUER, 'abc')).toBe('oidc:https://idp.example.com|abc');
  });
});

describe('GET /api/config', () => {
  let srv: TestServer;
  afterEach(() => srv.close());

  it('sem SSO: oidc desativado e login por senha ligado', async () => {
    srv = await startTestServer();
    const r = await srv.req('GET', '/api/config');
    expect(r.json.oidc).toEqual({ enabled: false, label: '', passwordLogin: true });
  });

  it('com SSO: expõe enabled/label/passwordLogin e nenhum segredo', async () => {
    srv = await startWithOidc({ OIDC_PASSWORD_LOGIN: '0', OIDC_BUTTON_LABEL: 'Acme' });
    const r = await srv.req('GET', '/api/config');
    expect(r.json.oidc).toEqual({ enabled: true, label: 'Acme', passwordLogin: false });
    expect(r.text).not.toContain('shh-client-secret');
    expect(r.text).not.toContain('cid');
    expect(r.text).not.toContain(ISSUER);
  });
});

describe('GET /api/auth/oidc/start', () => {
  let srv: TestServer;
  afterEach(() => srv.close());

  it('redireciona ao provedor com PKCE S256, state, nonce e redirect_uri; cookie transitório HttpOnly', async () => {
    srv = await startWithOidc();
    const r = await srv.req('GET', '/api/auth/oidc/start?next=%2Fadmin');
    expect(r.status).toBe(302);
    const loc = new URL(r.headers.get('location')!);
    expect(loc.origin + loc.pathname).toBe(`${ISSUER}/authorize`);
    expect(loc.searchParams.get('client_id')).toBe('cid');
    expect(loc.searchParams.get('response_type')).toBe('code');
    expect(loc.searchParams.get('scope')).toBe('openid email profile');
    expect(loc.searchParams.get('code_challenge_method')).toBe('S256');
    expect(loc.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(loc.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(loc.searchParams.get('nonce')).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(loc.searchParams.get('redirect_uri')).toBe(`${srv.base.replace('http://', 'https://')}/api/auth/oidc/callback`);
    const sc = r.headers.getSetCookie().find((c) => c.startsWith('office_oidc='))!;
    expect(sc).toContain('HttpOnly');
    expect(sc).toContain('SameSite=Lax');
    expect(sc).toContain('Secure');
    expect(sc).toContain('Path=/api/auth/oidc');
    expect(sc).toContain('Max-Age=600');
    const pending = verifyPending(sc.split(';')[0]!.slice('office_oidc='.length), SECRET)!;
    expect(pending.state).toBe(loc.searchParams.get('state'));
    expect(pending.nonce).toBe(loc.searchParams.get('nonce'));
    expect(pending.next).toBe('/admin');
    expect(pending.verifier.length).toBeGreaterThan(40);
    // Nenhum cookie de sessão é emitido no início.
    expect(cookieOf(r.headers)).toBe('');
  });

  it('OFFICE_PUBLIC_URL define o redirect_uri; cookie sem Secure com OFFICE_COOKIE_SECURE=0', async () => {
    srv = await startWithOidc({}, { publicUrl: 'https://office.example.com/', cookieSecure: false });
    const r = await srv.req('GET', '/api/auth/oidc/start');
    expect(new URL(r.headers.get('location')!).searchParams.get('redirect_uri')).toBe('https://office.example.com/api/auth/oidc/callback');
    expect(r.headers.getSetCookie().find((c) => c.startsWith('office_oidc='))).not.toContain('Secure');
  });

  it('SSO desativado: 404; POST: 405', async () => {
    srv = await startTestServer();
    expect((await srv.req('GET', '/api/auth/oidc/start')).status).toBe(404);
    expect((await srv.req('GET', '/api/auth/oidc/callback?code=x&state=y')).status).toBe(404);
    await srv.close();
    srv = await startWithOidc();
    expect((await srv.req('POST', '/api/auth/oidc/start', {})).status).toBe(405);
  });

  it('descoberta falhando: /login?error=oidc_unavailable sem derrubar o processo; a próxima tentativa refaz a descoberta', async () => {
    srv = await startWithOidc();
    mocks.discoveryFailures = 1;
    const r = await srv.req('GET', '/api/auth/oidc/start');
    expect(errorOf(r)).toBe('oidc_unavailable');
    expect(r.headers.getSetCookie().some((c) => c.startsWith('office_oidc='))).toBe(false);
    const ok = await srv.req('GET', '/api/auth/oidc/start');
    expect(new URL(ok.headers.get('location')!).pathname).toBe('/authorize');
    expect(mocks.discoveryCalls).toBe(2);
    // Descoberta em cache: a terceira ida não chama o provedor de novo.
    await srv.req('GET', '/api/auth/oidc/start');
    expect(mocks.discoveryCalls).toBe(2);
  });

  it('rate limit por IP: a 31ª ida em 10 minutos vira /login?error=oidc_rate_limited', async () => {
    srv = await startWithOidc();
    for (let i = 0; i < 30; i++) expect((await srv.req('GET', '/api/auth/oidc/start')).headers.get('location')).toContain('/authorize');
    expect(errorOf(await srv.req('GET', '/api/auth/oidc/start'))).toBe('oidc_rate_limited');
  });
});

describe('GET /api/auth/oidc/callback', () => {
  let srv: TestServer;
  beforeEach(async () => {
    srv = await startWithOidc({ OIDC_ADMIN_CLAIM: 'groups', OIDC_ADMIN_VALUES: 'oficio-admins' });
  });
  afterEach(() => srv.close());

  it('conta nova criada no primeiro login: sessão emitida, external_id, senha inutilizável, sem troca obrigatória', async () => {
    const r = await signIn(srv, { sub: 'sub-1', email: 'Nova@Example.com', email_verified: true, name: 'Nova Pessoa' });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/');
    const session = cookieOf(r.headers);
    expect(session).toMatch(/^office_session=.+/);
    // Cookie transitório apagado.
    expect(r.headers.getSetCookie().find((c) => c.startsWith('office_oidc='))).toContain('Max-Age=0');
    const u = (await srv.repos.users.byEmail('nova@example.com'))!;
    expect(u).toMatchObject({ name: 'Nova Pessoa', external_id: 'oidc:https://idp.example.com|sub-1', is_admin: false, must_change_password: false, status: 'active' });
    expect(u.password_hash).toMatch(/^\$2[aby]\$/);
    // A sessão vale para /api/me.
    const me = await srv.req('GET', '/api/me', undefined, session);
    expect(me.status).toBe(200);
    // PKCE e nonce foram exigidos na troca do código.
    expect(mocks.lastChecks).toMatchObject({ pkceCodeVerifier: expect.any(String), expectedNonce: expect.any(String), expectedState: expect.any(String) });
    // Segundo login acha pela identidade, mesmo com outro e-mail no provedor.
    const r2 = await signIn(srv, { sub: 'sub-1', email: 'renamed@example.com', email_verified: true });
    expect(r2.headers.get('location')).toBe('/');
    expect((await srv.repos.users.list()).total).toBe(1);
  });

  it('`next` capturado no início é respeitado (e saneado)', async () => {
    const r = await signIn(srv, { sub: 's', email: 'a@example.com', email_verified: true }, '/admin?tab=users');
    expect(r.headers.get('location')).toBe('/admin?tab=users');
    const r2 = await signIn(srv, { sub: 's', email: 'a@example.com', email_verified: true }, '//evil.com');
    expect(r2.headers.get('location')).toBe('/');
  });

  it('e-mail já cadastrado: vincula a conta sem mexer na senha nem no nome', async () => {
    const local = await addUser(srv.repos, { email: 'ana@example.com', name: 'Ana Souza' });
    const r = await signIn(srv, { sub: 'ana-sub', email: 'ANA@example.com', email_verified: true, name: 'Other Name' });
    expect(r.headers.get('location')).toBe('/');
    const u = (await srv.repos.users.byId(local.id))!;
    expect(u.external_id).toBe('oidc:https://idp.example.com|ana-sub');
    expect(u.password_hash).toBe(local.password_hash);
    expect(u.password_version).toBe(local.password_version);
    expect(u.name).toBe('Ana Souza');
    // A senha continua funcionando (login por senha segue ligado).
    expect((await srv.req('POST', '/api/auth/login', { email: 'ana@example.com', password: 'senha-boa-123' })).status).toBe(200);
  });

  it('domínio não permitido: /login?error=oidc_domain e nenhuma conta criada', async () => {
    await srv.close();
    srv = await startWithOidc({ OIDC_ALLOWED_DOMAINS: 'acme.com' });
    expect(errorOf(await signIn(srv, { sub: 'x', email: 'x@other.com', email_verified: true }))).toBe('oidc_domain');
    expect((await srv.repos.users.list()).total).toBe(0);
    expect(cookieOf((await signIn(srv, { sub: 'y', email: 'y@acme.com', email_verified: true })).headers)).toContain('office_session=');
  });

  it('email_verified=false: oidc_email_unverified; sem e-mail: oidc_no_email', async () => {
    expect(errorOf(await signIn(srv, { sub: 'x', email: 'x@example.com', email_verified: false }))).toBe('oidc_email_unverified');
    expect(errorOf(await signIn(srv, { sub: 'x' }))).toBe('oidc_no_email');
    expect((await srv.repos.users.list()).total).toBe(0);
  });

  it('e-mail ausente no ID token é buscado no userinfo', async () => {
    mocks.userinfo = { sub: 'u1', email: 'info@example.com', email_verified: true, name: 'From Userinfo' };
    const r = await signIn(srv, { sub: 'u1' });
    expect(r.headers.get('location')).toBe('/');
    expect((await srv.repos.users.byEmail('info@example.com'))?.name).toBe('From Userinfo');
  });

  it('claim de admin: concede quando bate; não remove quem é admin localmente; não promove sem a claim', async () => {
    const r = await signIn(srv, { sub: 'adm', email: 'adm@example.com', email_verified: true, groups: ['dev', 'oficio-admins'] });
    expect(r.status).toBe(302);
    expect((await srv.repos.users.byEmail('adm@example.com'))?.is_admin).toBe(true);

    const localAdmin = await addUser(srv.repos, { email: 'boss@example.com', admin: true });
    await signIn(srv, { sub: 'boss', email: 'boss@example.com', email_verified: true, groups: ['dev'] });
    expect((await srv.repos.users.byId(localAdmin.id))?.is_admin).toBe(true);

    await signIn(srv, { sub: 'plain', email: 'plain@example.com', email_verified: true, groups: ['dev'] });
    expect((await srv.repos.users.byEmail('plain@example.com'))?.is_admin).toBe(false);

    // Conta existente promovida quando a claim passa a vir (grupos no userinfo também valem).
    mocks.userinfo = { sub: 'plain', groups: ['oficio-admins'] };
    await signIn(srv, { sub: 'plain', email: 'plain@example.com', email_verified: true });
    expect((await srv.repos.users.byEmail('plain@example.com'))?.is_admin).toBe(true);
  });

  it('state inválido, cookie ausente ou reutilizado, erro do provedor', async () => {
    mocks.claims = { sub: 's', email: 's@example.com', email_verified: true };
    const b = await begin(srv);
    expect(errorOf(await finish(srv, { cookie: b.cookie, state: 'forged' }))).toBe('oidc_state');
    expect(errorOf(await finish(srv, { state: b.state }))).toBe('oidc_state');
    expect(errorOf(await finish(srv, { cookie: 'office_oidc=garbage', state: b.state }))).toBe('oidc_state');
    expect(mocks.grantCalls).toBe(0);
    expect(errorOf(await finish(srv, { cookie: b.cookie, query: `error=access_denied&state=${b.state}` }))).toBe('oidc_denied');
    expect(errorOf(await finish(srv, { cookie: b.cookie, query: `error=server_error&state=${b.state}` }))).toBe('oidc_failed');
    // Código recusado pelo provedor na troca.
    expect(errorOf(await finish(srv, { cookie: b.cookie, state: b.state, code: 'bad-code' }))).toBe('oidc_failed');
    expect((await srv.repos.users.list()).total).toBe(0);
    // O fluxo certo ainda funciona depois dos erros.
    expect((await finish(srv, { cookie: b.cookie, state: b.state })).headers.get('location')).toBe('/');
  });

  it('OIDC_AUTO_CREATE=0: quem não tem conta recebe oidc_no_account; quem tem entra', async () => {
    await srv.close();
    srv = await startWithOidc({ OIDC_AUTO_CREATE: '0' });
    expect(errorOf(await signIn(srv, { sub: 'n', email: 'nobody@example.com', email_verified: true }))).toBe('oidc_no_account');
    expect((await srv.repos.users.list()).total).toBe(0);
    await addUser(srv.repos, { email: 'ana@example.com' });
    expect(cookieOf((await signIn(srv, { sub: 'a', email: 'ana@example.com', email_verified: true })).headers)).toContain('office_session=');
  });

  it('conta desativada: oidc_disabled, sem sessão', async () => {
    const u = await addUser(srv.repos, { email: 'off@example.com' });
    await srv.repos.users.update(u.id, { status: 'disabled' });
    const r = await signIn(srv, { sub: 'off', email: 'off@example.com', email_verified: true });
    expect(errorOf(r)).toBe('oidc_disabled');
    expect(cookieOf(r.headers)).toBe('');
  });

  it('lista do admin mostra source=sso para contas vinculadas', async () => {
    const admin = await addUser(srv.repos, { email: 'root@example.com', admin: true });
    await signIn(srv, { sub: 'sso-1', email: 'sso@example.com', email_verified: true });
    const login = await srv.req('POST', '/api/auth/login', { email: admin.email, password: 'senha-boa-123' });
    const list = await srv.req('GET', '/api/admin/users', undefined, cookieOf(login.headers));
    expect(list.status).toBe(200);
    const bySource = Object.fromEntries(list.json.rows.map((r: { email: string; source: string }) => [r.email, r.source]));
    expect(bySource).toEqual({ 'root@example.com': 'local', 'sso@example.com': 'sso' });
    // Redefinir a senha de uma conta SSO pelo painel continua funcionando.
    const sso = (await srv.repos.users.byEmail('sso@example.com'))!;
    const reset = await srv.req('POST', `/api/admin/users/${sso.id}/reset-password`, {}, cookieOf(login.headers));
    expect(reset.status).toBe(200);
    expect(reset.json.tempPassword).toBeTypeOf('string');
    expect((await srv.req('POST', '/api/auth/login', { email: 'sso@example.com', password: reset.json.tempPassword })).status).toBe(200);
  });
});

describe('OIDC_PASSWORD_LOGIN=0', () => {
  let srv: TestServer;
  afterEach(() => srv.close());

  it('POST /api/auth/login responde 403 password_login_disabled; o SSO continua', async () => {
    srv = await startWithOidc({ OIDC_PASSWORD_LOGIN: '0' });
    await addUser(srv.repos);
    const r = await srv.req('POST', '/api/auth/login', { email: 'ana@example.com', password: 'senha-boa-123' });
    expect(r.status).toBe(403);
    expect(r.json.code).toBe('password_login_disabled');
    expect(cookieOf(r.headers)).toBe('');
    expect(cookieOf((await signIn(srv, { sub: 'a', email: 'ana@example.com', email_verified: true })).headers)).toContain('office_session=');
  });
});
