// Helper de testes HTTP: sobe createApp (repos em memória) na porta 0 e oferece um cliente fetch com cookie.
import type { AddressInfo } from 'node:net';
import { createApp, type App } from '../app-factory';
import { hash } from '../auth/password';
import type { Mailer, MailMessage } from '../auth/mailer';
import type { ServerConfig } from '../config';
import { DEFAULT_BRANDING } from '../../shared/branding';
import type { Repos } from '../db/repos/index';
import type { UserRow } from '../db/types';
import { createFakeRepos } from './fakeDb';

export function testConfig(over: Partial<ServerConfig> = {}): ServerConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    dev: false,
    inMemory: false,
    inDocker: false,
    allowedHosts: new Set(),
    jwtSecret: 'test-secret-test-secret-test-secret',
    cookieSecure: true,
    trustProxy: false,
    livekit: { room: 'oficio' },
    mail: {},
    branding: DEFAULT_BRANDING,
    defaultLocale: 'pt-BR',
    rootDir: process.cwd(),
    version: 'test',
    warnings: [],
    ...over,
  };
}

export interface TestServer {
  app: App;
  repos: Repos;
  base: string;
  sent: MailMessage[];
  close(): Promise<void>;
  /** fetch com JSON; `cookie` é o valor `office_session=...`; `headers` extras (ex.: Accept-Language). */
  req(method: string, path: string, body?: unknown, cookie?: string, headers?: Record<string, string>): Promise<{ status: number; headers: Headers; json: any; text: string }>;
}

export async function startTestServer(opts: { config?: Partial<ServerConfig>; mailConfigured?: boolean; repos?: Repos } = {}): Promise<TestServer> {
  const repos = opts.repos ?? createFakeRepos();
  const sent: MailMessage[] = [];
  const mailer: Mailer = {
    configured: opts.mailConfigured ?? false,
    async sendMail(m) {
      sent.push(m);
      return { sent: true };
    },
  };
  const app = await createApp({ config: testConfig(opts.config), repos, mailer });
  await new Promise<void>((ok) => app.server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  return {
    app,
    repos,
    base,
    sent,
    close: () => app.close(),
    async req(method, path, body, cookie, extraHeaders) {
      const headers: Record<string, string> = {};
      if (body !== undefined || method !== 'GET') headers['Content-Type'] = 'application/json';
      if (cookie) headers.Cookie = cookie;
      Object.assign(headers, extraHeaders);
      const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
      const text = await res.text();
      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch {
        // não é JSON
      }
      return { status: res.status, headers: res.headers, json, text };
    },
  };
}

export async function addUser(repos: Repos, over: { email?: string; password?: string; name?: string; admin?: boolean; mustChange?: boolean } = {}): Promise<UserRow> {
  return repos.users.createLocal({
    email: over.email ?? 'ana@example.com',
    name: over.name ?? 'Ana Souza',
    password_hash: await hash(over.password ?? 'senha-boa-123'),
    is_admin: over.admin ?? false,
    must_change_password: over.mustChange ?? false,
  });
}

/** Extrai `office_session=<jwt>` do Set-Cookie. */
export function cookieOf(headers: Headers): string {
  const sc = headers.getSetCookie().find((c) => c.startsWith('office_session='));
  return sc ? sc.split(';')[0] : '';
}
