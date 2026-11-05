// Smoke ponta a ponta: login (cookie) -> /api/me -> /api/map -> WebSocket (welcome) -> move_to (ack + delta) -> /api/health.
import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addUser, cookieOf, startTestServer, type TestServer } from './http';

let srv: TestServer;

beforeAll(async () => {
  srv = await startTestServer();
  await addUser(srv.repos, { email: 'smoke@example.com', password: 'segredo123', name: 'Smoke Teste' });
});
afterAll(async () => {
  await srv.close();
});

async function login(): Promise<string> {
  const res = await fetch(`${srv.base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: srv.base },
    body: JSON.stringify({ email: 'smoke@example.com', password: 'segredo123' }),
  });
  expect(res.status).toBe(200);
  return cookieOf(res.headers);
}

describe('smoke', () => {
  it('login -> me -> mapa -> websocket -> movimento -> health', async () => {
    const cookie = await login();

    const me = await fetch(`${srv.base}/api/me`, { headers: { cookie } });
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as { email: string; needsAvatar?: boolean };
    expect(meBody.email).toBe('smoke@example.com');

    const map = await fetch(`${srv.base}/api/map`, { headers: { cookie } });
    expect(map.status).toBe(200);
    const etag = map.headers.get('etag');
    expect(etag).toBeTruthy();
    const mapBody = (await map.json()) as { doc: { areas: unknown[] } };
    expect(mapBody.doc.areas.length).toBeGreaterThan(0);
    const again = await fetch(`${srv.base}/api/map`, { headers: { cookie, 'if-none-match': etag! } });
    expect(again.status).toBe(304);

    const ws = new WebSocket(`${srv.base.replace('http', 'ws')}/ws`, { headers: { cookie, origin: srv.base } });
    const msgs: Record<string, unknown>[] = [];
    const got = (t: string, timeoutMs = 5000) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const found = msgs.find((m) => m.t === t);
        if (found) return resolve(found);
        const timer = setTimeout(() => reject(new Error(`sem mensagem ${t}`)), timeoutMs);
        const onMsg = (raw: WebSocket.RawData) => {
          const m = JSON.parse(String(raw)) as Record<string, unknown>;
          if (m.t === t) {
            clearTimeout(timer);
            ws.off('message', onMsg);
            resolve(m);
          }
        };
        ws.on('message', onMsg);
      });
    ws.on('message', (raw) => msgs.push(JSON.parse(String(raw)) as Record<string, unknown>));
    await new Promise<void>((ok, bad) => {
      ws.once('open', () => ok());
      ws.once('error', bad);
    });
    const welcome = await got('welcome');
    expect(welcome.map).toMatchObject({ version: expect.any(Number) });

    ws.send(JSON.stringify({ t: 'move_to', x: 8, y: 6, seq: 1 }));
    const ack = await got('ack');
    expect(ack.seq).toBe(1);
    const delta = await got('delta');
    expect(Array.isArray(delta.e)).toBe(true);

    const health = await fetch(`${srv.base}/api/health`);
    expect(health.status).toBe(200);
    const h = (await health.json()) as { ok: boolean; online: number };
    expect(h.ok).toBe(true);
    expect(h.online).toBe(1);

    ws.close();
  });
});
