// Integração: createApp em porta 0 + cliente `ws` de verdade, com sessão falsa (cookie office_session=test).
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { createApp, type App } from '../app-factory';
import type { ServerConfig } from '../config';
import { setQuiet } from '../log';
import { DEFAULT_BRANDING } from '../../shared/branding';
import { decodeServer, type ServerMsg } from '../../shared/protocol';
import { createFakeRepos } from '../test/fakeDb';
import { fakeSession, twoAreaDoc } from '../test/world-helpers';

function testConfig(): ServerConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    dev: false,
    inMemory: false,
    inDocker: false,
    allowedHosts: new Set(),
    cookieSecure: false,
    trustProxy: false,
    livekit: { url: 'wss://lk.example.com', apiKey: 'k', apiSecret: 'segredo-segredo-segredo-segredo-123', room: 'oficio' },
    mail: {},
    branding: DEFAULT_BRANDING,
    defaultLocale: 'pt-BR',
    rootDir: process.cwd(),
    version: 'test',
    warnings: [],
  };
}

let app: App | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});
beforeAll(() => setQuiet(true));

async function boot(): Promise<string> {
  app = await createApp({ config: testConfig(), repos: createFakeRepos(), session: fakeSession(), mapDoc: twoAreaDoc() });
  await new Promise<void>((ok) => app!.server.listen(0, '127.0.0.1', ok));
  const { port } = app.server.address() as AddressInfo;
  return `127.0.0.1:${port}`;
}

class Client {
  msgs: ServerMsg[] = [];
  private waiters: { pred: (m: ServerMsg) => boolean; ok: (m: ServerMsg) => void }[] = [];
  closed: Promise<{ code: number }>;
  constructor(readonly ws: WebSocket) {
    ws.on('message', (d) => {
      const m = decodeServer(d.toString());
      if (!m) return;
      this.msgs.push(m);
      this.waiters = this.waiters.filter((w) => (w.pred(m) ? (w.ok(m), false) : true));
    });
    this.closed = new Promise((ok) => ws.on('close', (code) => ok({ code })));
  }
  wait<K extends ServerMsg['t']>(t: K, pred: (m: Extract<ServerMsg, { t: K }>) => boolean = () => true, ms = 3000): Promise<Extract<ServerMsg, { t: K }>> {
    const found = this.msgs.find((m) => m.t === t && pred(m as Extract<ServerMsg, { t: K }>));
    if (found) return Promise.resolve(found as Extract<ServerMsg, { t: K }>);
    return new Promise((ok, fail) => {
      const timer = setTimeout(() => fail(new Error(`timeout esperando ${t}`)), ms);
      this.waiters.push({
        pred: (m) => m.t === t && pred(m as Extract<ServerMsg, { t: K }>),
        ok: (m) => {
          clearTimeout(timer);
          ok(m as Extract<ServerMsg, { t: K }>);
        },
      });
    });
  }
  send(o: unknown): void {
    this.ws.send(JSON.stringify(o));
  }
}

function connect(host: string, cookie: string | null, origin = `http://${host}`): Promise<Client> {
  const headers: Record<string, string> = { origin };
  if (cookie) headers.cookie = cookie;
  const ws = new WebSocket(`ws://${host}/ws`, { headers });
  const c = new Client(ws);
  return new Promise((ok, fail) => {
    ws.once('open', () => ok(c));
    ws.once('unexpected-response', (_req, res) => fail(new Error(`HTTP ${res.statusCode}`)));
    ws.once('error', fail);
  });
}

describe('hub WebSocket', () => {
  it('welcome, move_to com ack e deltas, ping/pong, health e /api/map', async () => {
    const host = await boot();
    const c = await connect(host, 'office_session=test');
    const welcome = await c.wait('welcome');
    expect(welcome.you).toMatchObject({ id: 1, name: 'Pessoa 1' });
    expect(welcome.map).toMatchObject({ id: 0, version: 1 });
    expect(welcome.livekit).toMatchObject({ url: 'wss://lk.example.com', room: 'oficio' });
    expect(welcome.entities.find((e) => e.id === 1)).toMatchObject({ x: 10.5 });

    c.send({ t: 'move_to', x: 13, y: 10, seq: 5 });
    expect(await c.wait('ack')).toEqual({ t: 'ack', seq: 5, x: 13, y: 10 });
    const d = await c.wait('delta', (m) => m.e.some((t) => t[0] === 1));
    expect(d.e[0][0]).toBe(1);

    c.send({ t: 'ping', ts: 123 });
    expect((await c.wait('pong')).ts).toBe(123);

    c.send({ t: 'nada' });
    expect((await c.wait('error')).code).toBe('bad_message');

    const health = (await (await fetch(`http://${host}/api/health`)).json()) as { online: number };
    expect(health.online).toBe(1);

    expect((await fetch(`http://${host}/api/map`)).status).toBe(401);
    const r = await fetch(`http://${host}/api/map`, { headers: { cookie: 'office_session=test' } });
    expect(r.status).toBe(200);
    const etag = r.headers.get('etag');
    expect(etag).toBe(welcome.map.etag);
    const body = (await r.json()) as { id: number; version: number; doc: { name: string } };
    expect(body).toMatchObject({ id: 0, version: 1 });
    expect(body.doc.name).toBe('teste');
    const r304 = await fetch(`http://${host}/api/map`, { headers: { cookie: 'office_session=test', 'if-none-match': etag! } });
    expect(r304.status).toBe(304);

    const tok = await fetch(`http://${host}/api/livekit/token`, { headers: { cookie: 'office_session=test' } });
    expect(tok.status).toBe(200);
    expect(((await tok.json()) as { token: string }).token.split('.')).toHaveLength(3);
    c.ws.close();
  });

  it('recusa sem sessão (401) e com Origin de outro site (403)', async () => {
    const host = await boot();
    await expect(connect(host, null)).rejects.toThrow('HTTP 401');
    await expect(connect(host, 'office_session=test', 'https://evil.example.com')).rejects.toThrow('HTTP 403');
  });

  it('segunda conexão substitui a primeira; outro usuário vê join', async () => {
    const host = await boot();
    const a = await connect(host, 'office_session=test');
    await a.wait('welcome');
    const b = await connect(host, 'office_session=u2');
    await b.wait('welcome');
    expect((await a.wait('join')).user.id).toBe(2);
    const a2 = await connect(host, 'office_session=test');
    await a2.wait('welcome');
    expect(await a.wait('kick')).toEqual({ t: 'kick', reason: 'replaced' });
    expect((await a.closed).code).toBe(4000);
    expect(app!.office.online).toBe(2);
    a2.ws.close();
    b.ws.close();
  });

  it('mais de 30 mensagens/s: error rate_limited e close 1008', async () => {
    const host = await boot();
    const c = await connect(host, 'office_session=test');
    await c.wait('welcome');
    for (let i = 0; i < 40; i++) c.send({ t: 'activity' });
    expect((await c.wait('error', (m) => m.code === 'rate_limited')).code).toBe('rate_limited');
    expect((await c.closed).code).toBe(1008);
  });
});
