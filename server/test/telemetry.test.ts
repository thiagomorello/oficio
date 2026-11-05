import { afterEach, describe, expect, it } from 'vitest';
import { SERVER_SESSION, TELEMETRY_MAX_BATCH, parseSince } from '../../shared/telemetry';
import { percentile, summarizeTelemetry, type NewTelemetryEvent } from '../db/repos/telemetry';
import { setQuiet } from '../log';
import { batchRows, createRateLimiter, createServerSink, parseTelemetryBatch, type TelemetrySink } from '../telemetry/index';
import { createFakeRepos } from './fakeDb';
import { addUser, cookieOf, startTestServer, type TestServer } from './http';
import { hallDoc, makeWorld } from './world-helpers';

setQuiet(true);

const SID = 'sessao-teste-123';
const item = (over: Record<string, unknown> = {}) => ({ kind: 'sample', at: Date.now(), data: { rtt: 40 }, ...over });

describe('telemetria: validação do lote', () => {
  it('aceita um lote válido', () => {
    const r = parseTelemetryBatch({ sessionId: SID, items: [item(), item({ kind: 'js_error', data: { message: 'x' } })] });
    expect(r.ok).toBe(true);
  });

  it('recusa lote vazio, grande demais, kind inválido, data > 4 KB, session inválida/reservada', () => {
    expect(parseTelemetryBatch({ sessionId: SID, items: [] }).ok).toBe(false);
    expect(parseTelemetryBatch({ sessionId: SID, items: Array.from({ length: TELEMETRY_MAX_BATCH + 1 }, () => item()) }).ok).toBe(false);
    expect(parseTelemetryBatch({ sessionId: SID, items: Array.from({ length: TELEMETRY_MAX_BATCH }, () => item()) }).ok).toBe(true);
    expect(parseTelemetryBatch({ sessionId: SID, items: [item({ kind: 'Sample!' })] }).ok).toBe(false);
    expect(parseTelemetryBatch({ sessionId: SID, items: [item({ kind: 'x'.repeat(33) })] }).ok).toBe(false);
    expect(parseTelemetryBatch({ sessionId: SID, items: [item({ data: { s: 'a'.repeat(5000) } })] }).ok).toBe(false);
    expect(parseTelemetryBatch({ sessionId: SID, items: [item({ data: [1, 2] })] }).ok).toBe(false);
    expect(parseTelemetryBatch({ sessionId: SID, items: [item({ at: 'ontem' })] }).ok).toBe(false);
    expect(parseTelemetryBatch({ sessionId: 'curta', items: [item()] }).ok).toBe(false);
    expect(parseTelemetryBatch({ sessionId: 'abc/../def', items: [item()] }).ok).toBe(false);
    expect(parseTelemetryBatch({ sessionId: SERVER_SESSION + 'xxxx', items: [item()] }).ok).toBe(true);
    expect(parseTelemetryBatch(null).ok).toBe(false);
  });

  it('relógio do cliente absurdo vira a hora do servidor', () => {
    const now = Date.parse('2026-10-15T12:00:00Z');
    const rows = batchRows(7, { sessionId: SID, items: [item({ at: now - 1000 }), item({ at: 0 })] }, now);
    expect(rows.map((r) => r.at.getTime())).toEqual([now - 1000, now]);
    expect(rows[0]).toMatchObject({ user_id: 7, session_id: SID, kind: 'sample' });
  });

  it('parseSince: 24h/7d/ISO, limitado à retenção', () => {
    const now = Date.parse('2026-10-15T12:00:00Z');
    expect(parseSince('24h', now).getTime()).toBe(now - 86_400_000);
    expect(parseSince('7d', now).getTime()).toBe(now - 7 * 86_400_000);
    expect(parseSince('90d', now).getTime()).toBe(now - 14 * 86_400_000);
    expect(parseSince('lixo', now).getTime()).toBe(now - 86_400_000);
    expect(parseSince('2026-10-15T11:00:00Z', now).getTime()).toBe(now - 3_600_000);
  });

  it('limite por usuário: rajada de 3, depois 1 a cada 2 s', () => {
    let t = 0;
    const l = createRateLimiter(2000, 3, () => t);
    expect([l.take(1), l.take(1), l.take(1), l.take(1)]).toEqual([true, true, true, false]);
    expect(l.take(2)).toBe(true);
    t += 1000;
    expect(l.take(1)).toBe(false);
    t += 1000;
    expect(l.take(1)).toBe(true);
    expect(l.take(1)).toBe(false);
  });
});

describe('telemetria: resumo (fake)', () => {
  it('percentil nearest-rank', () => {
    expect(percentile([], 0.95)).toBeNull();
    expect(percentile([5], 0.95)).toBe(5);
    expect(percentile(Array.from({ length: 20 }, (_, i) => i + 1), 0.95)).toBe(19);
    expect(percentile(Array.from({ length: 100 }, (_, i) => 100 - i), 0.95)).toBe(95);
  });

  it('médias, p95, contagens e último A/V por usuário', async () => {
    const t0 = Date.parse('2026-10-15T12:00:00Z');
    const r = createFakeRepos({ now: () => new Date(t0) });
    const ev = (user_id: number, kind: string, data: Record<string, unknown>, minsAgo = 1, session_id = 's1-aaaaaaaa'): NewTelemetryEvent => ({
      user_id, session_id, kind, at: new Date(t0 - minsAgo * 60_000), data,
    });
    const rows: NewTelemetryEvent[] = [];
    // usuário 1: 20 amostras rtt 10..200, fps 60/30 alternado
    for (let i = 1; i <= 20; i++) rows.push(ev(1, 'sample', { rtt: i * 10, fps: i % 2 ? 60 : 30, av: { status: i === 20 ? 'connected' : 'connecting' } }, 30 - i));
    rows.push(ev(1, 'sample', { fps: 45 }, 5, 's2-bbbbbbbb')); // sem rtt: não entra na média de rtt
    rows.push(ev(1, 'moved_reject', { reason: 'far' }, 2, SERVER_SESSION));
    rows.push(ev(1, 'moved_reject', { reason: 'far' }, 2)); // visto pelo cliente: não conta em dobro
    rows.push(ev(1, 'pos_jump', { d: 40 }), ev(1, 'pos_jump', { d: 30 }));
    rows.push(ev(1, 'ws_drop', { code: 1006 }, 3, SERVER_SESSION), ev(1, 'ws_disconnect', { code: 1001 }, 3, SERVER_SESSION));
    rows.push(ev(1, 'js_error', { message: 'boom' }));
    rows.push(ev(1, 'av_status', { status: 'reconnecting' }, 0));
    // usuário 2: só evento antigo (fora da janela) + um recente
    rows.push(ev(2, 'sample', { rtt: 999 }, 15 * 24 * 60), ev(2, 'sample', { rtt: 100, fps: 50 }, 10));
    // sem usuário: ignorado
    rows.push({ ...ev(1, 'sample', { rtt: 1 }), user_id: null });
    await r.telemetry.insertMany(rows);

    const sum = await r.telemetry.summary(new Date(t0 - 24 * 3_600_000));
    expect(sum.map((s) => s.user_id)).toEqual([1, 2]);
    const u1 = sum[0]!;
    expect(u1.sessions).toBe(2);
    expect(u1.samples).toBe(21);
    expect(u1.rtt_avg).toBeCloseTo(105);
    expect(u1.rtt_p95).toBe(190);
    expect(u1.fps_avg).toBeCloseTo((10 * 60 + 10 * 30 + 45) / 21);
    expect(u1).toMatchObject({ rejects: 1, jumps: 2, disconnects: 1, errors: 1, last_av: 'reconnecting' });
    expect(u1.last_seen.getTime()).toBe(t0);
    const u2 = sum[1]!;
    expect(u2).toMatchObject({ rtt_avg: 100, rtt_p95: 100, fps_avg: 50, samples: 1, rejects: 0, last_av: null });

    // consulta: filtros e ordem (mais recente primeiro)
    const q = await r.telemetry.query({ userId: 1, kind: 'pos_jump', since: new Date(0), limit: 10 });
    expect(q).toHaveLength(2);
    expect((await r.telemetry.query({ sessionId: 's2-bbbbbbbb', since: new Date(0), limit: 10 })).map((e) => e.data)).toEqual([{ fps: 45 }]);
    expect(await r.telemetry.query({ since: new Date(0), limit: 3 })).toHaveLength(3);

    // retenção
    expect(await r.telemetry.purgeOlderThan(14)).toBe(1);
  });

  it('summarizeTelemetry respeita o `since`', () => {
    const at = new Date(1000);
    expect(summarizeTelemetry([{ id: 1, user_id: 1, session_id: 'x', kind: 'sample', at, data: { rtt: 5 } }], new Date(2000))).toEqual([]);
  });
});

describe('telemetria: sink do servidor e Office', () => {
  it('sink grava em lote no flush/close e nunca lança', async () => {
    const r = createFakeRepos();
    const sink = createServerSink(r.telemetry, { everyMs: 60_000 });
    sink.server(3, 'kick', { reason: 'server' });
    expect(await r.telemetry.query({ since: new Date(0), limit: 10 })).toHaveLength(0);
    await sink.close();
    const rows = await r.telemetry.query({ since: new Date(0), limit: 10 });
    expect(rows).toMatchObject([{ user_id: 3, session_id: SERVER_SESSION, kind: 'kick', data: { reason: 'server' } }]);
  });

  it('Office registra ws_connect, moved_reject (pos), kick e ws_drop/ws_disconnect', async () => {
    const got: { userId: number | null; kind: string; data: Record<string, unknown> }[] = [];
    const sink: TelemetrySink = { server: (userId, kind, data) => void got.push({ userId, kind, data }) };
    const w = makeWorld(hallDoc(), { telemetry: sink });
    const a = await w.join(1);
    w.office.teleport(1, 2, 5);
    w.run(0.5);
    await w.office.handle(1, { t: 'pos', x: 5 * 16 + 8, y: 5 * 16 + 11, dir: 'right', moving: true });
    w.run(0.2);
    w.office.leave(1, a, 1006);
    const b = await w.join(2);
    w.run(1);
    w.office.leave(2, b, 1001);
    await w.join(3);
    w.office.kickUser(3, 'disabled');
    const kinds = got.map((g) => `${g.userId}:${g.kind}`);
    expect(kinds).toEqual(['1:ws_connect', '1:moved_reject', '1:ws_drop', '2:ws_connect', '2:ws_disconnect', '3:ws_connect', '3:kick']);
    expect(got[1]!.data).toMatchObject({ reason: 'blocked', client: { x: 88, y: 91 } });
    expect(got[4]!.data).toMatchObject({ code: 1001, durationMs: 1000 });
    expect(got[6]!.data).toMatchObject({ reason: 'disabled' });
  });

  it('Office sem sink continua funcionando (sink lançando também)', async () => {
    const w = makeWorld(hallDoc(), {
      telemetry: {
        server: () => {
          throw new Error('x');
        },
      },
    });
    const a = await w.join(1);
    w.office.leave(1, a, 1006);
    expect(w.office.online).toBe(0);
  });
});

describe('telemetria: rotas', () => {
  let srv: TestServer;
  afterEach(async () => {
    await srv.close();
  });
  const login = async (email: string): Promise<string> => {
    const r = await srv.req('POST', '/api/auth/login', { email, password: 'senha-boa-123' });
    expect(r.status).toBe(200);
    return cookieOf(r.headers);
  };

  it('usuário envia (204), só admin lê; anônimo 401; lote inválido 400; excesso 429', async () => {
    srv = await startTestServer();
    const ana = await addUser(srv.repos, { email: 'ana@x.com', name: 'Ana' });
    await addUser(srv.repos, { email: 'chefe@x.com', name: 'Chefe', admin: true });
    const c = await login('ana@x.com');
    const admin = await login('chefe@x.com');
    const batch = { sessionId: SID, items: [item({ data: { rtt: 50, fps: 60, av: { status: 'connected' } } }), item({ kind: 'js_error', data: { message: 'oops' } })] };

    expect((await srv.req('POST', '/api/telemetry', batch)).status).toBe(401);
    const ok = await srv.req('POST', '/api/telemetry', batch, c);
    expect(ok.status).toBe(204);
    expect((await srv.req('POST', '/api/telemetry', { sessionId: SID, items: [] }, c)).status).toBe(400);
    expect((await srv.req('GET', '/api/telemetry', undefined, c)).status).toBe(405);
    // rajada estourada
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await srv.req('POST', '/api/telemetry', batch, c)).status);
    expect(statuses).toContain(429);

    expect((await srv.req('GET', '/api/admin/telemetry/summary', undefined, c)).status).toBe(403);
    expect((await srv.req('GET', '/api/admin/telemetry/events', undefined, c)).status).toBe(403);
    expect((await srv.req('GET', '/api/admin/telemetry/summary')).status).toBe(401);

    const sum = await srv.req('GET', '/api/admin/telemetry/summary?since=7d', undefined, admin);
    expect(sum.status).toBe(200);
    expect(sum.json.rows[0]).toMatchObject({ userId: ana.id, name: 'Ana', online: false, rttAvg: 50, rttP95: 50, fpsAvg: 60, errors: expect.any(Number), lastAv: 'connected' });
    const evs = await srv.req('GET', `/api/admin/telemetry/events?user=${ana.id}&kind=js_error&limit=5`, undefined, admin);
    expect(evs.status).toBe(200);
    expect(evs.json.rows[0]).toMatchObject({ userId: ana.id, sessionId: SID, kind: 'js_error', data: { message: 'oops' } });
    expect((await srv.req('GET', '/api/admin/telemetry/events?kind=BAD!', undefined, admin)).status).toBe(400);
  });
});
