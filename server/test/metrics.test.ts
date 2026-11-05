import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setQuiet } from '../log';
import { addUser, startTestServer, type TestServer } from './http';

setQuiet(true);

const NAMES = ['office_online_users', 'office_ws_connections', 'office_tick_duration_ms', 'office_chat_messages_total', 'process_uptime_seconds', 'nodejs_heap_used_bytes'];

let srv: TestServer;
afterEach(async () => {
  await srv?.close();
});

describe('GET /metrics', () => {
  beforeEach(async () => {
    srv = await startTestServer();
  });

  it('responde 200 em texto Prometheus com as métricas do escritório', async () => {
    const res = await fetch(`${srv.base}/metrics`);
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain; version=0.0.4');
    for (const name of NAMES) expect(text).toContain(`# TYPE ${name} `);
    expect(text).toContain('office_online_users 0');
    expect(text).toContain('office_tick_duration_ms{stat="max"} ');
  });

  it('conta logins bem-sucedidos', async () => {
    await addUser(srv.repos);
    const ok = await srv.req('POST', '/api/auth/login', { email: 'ana@example.com', password: 'senha-boa-123' });
    expect(ok.status).toBe(200);
    const text = await (await fetch(`${srv.base}/metrics`)).text();
    expect(text).toContain('office_logins_total 1');
  });

  it('rejeita métodos que não sejam GET/HEAD', async () => {
    const res = await fetch(`${srv.base}/metrics`, { method: 'POST' });
    expect(res.status).toBe(405);
  });
});

describe('GET /metrics com METRICS_TOKEN', () => {
  beforeEach(async () => {
    srv = await startTestServer({ config: { metricsToken: 'tok-metricas-teste' } });
  });

  it('exige Authorization: Bearer com o token certo', async () => {
    expect((await fetch(`${srv.base}/metrics`)).status).toBe(401);
    expect((await fetch(`${srv.base}/metrics`, { headers: { Authorization: 'Bearer errado' } })).status).toBe(401);
    expect((await fetch(`${srv.base}/metrics`, { headers: { Authorization: 'Basic dG9rLW1ldHJpY2FzLXRlc3Rl' } })).status).toBe(401);
    const ok = await fetch(`${srv.base}/metrics`, { headers: { Authorization: 'Bearer tok-metricas-teste' } });
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain('office_chat_messages_total');
  });
});
