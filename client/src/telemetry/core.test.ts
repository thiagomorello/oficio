import { describe, expect, it } from 'vitest';
import { BEACON_MAX_BYTES, FrameStats, JumpDetector, MAX_QUEUED, TelemetryQueue, clipData, createFlusher, errorData, newSessionId, telemetryDisabled, type PostFn } from './core';

describe('telemetria (cliente): fila', () => {
  it('teto de 200: os mais antigos saem e contam como descartados', () => {
    const q = new TelemetryQueue();
    for (let i = 0; i < MAX_QUEUED + 5; i++) q.push('sample', { i }, i);
    expect(q.size).toBe(MAX_QUEUED);
    expect(q.dropped).toBe(5);
    expect(q.take(1)[0]!.data).toEqual({ i: 5 });
  });

  it('`due` com 50 eventos; `take` no máximo 100; kind inválido é ignorado', () => {
    const q = new TelemetryQueue();
    q.push('Inválido!', {}, 0);
    expect(q.size).toBe(0);
    for (let i = 0; i < 49; i++) q.push('socket', {}, i);
    expect(q.due).toBe(false);
    q.push('socket', {}, 49);
    expect(q.due).toBe(true);
    for (let i = 0; i < 100; i++) q.push('socket', {}, i);
    expect(q.take(500)).toHaveLength(100);
    expect(q.size).toBe(50);
  });

  it('requeue devolve na frente sem passar do teto', () => {
    const q = new TelemetryQueue(5);
    for (let i = 0; i < 5; i++) q.push('a', { i }, i);
    const b = q.take(3);
    q.push('a', { i: 5 }, 5);
    q.push('a', { i: 6 }, 6);
    q.requeue(b);
    expect(q.size).toBe(5);
    expect(q.dropped).toBe(2);
    expect(q.take().map((x) => x.data.i)).toEqual([2, 3, 4, 5, 6]);
  });

  it('clipData corta textos > 1 KB e resume data > 4 KB', () => {
    expect(String(clipData({ s: 'x'.repeat(3000) }).s)).toHaveLength(1024);
    const big = clipData({ a: 'x'.repeat(1000), b: 'y'.repeat(1000), c: 'z'.repeat(1000), d: 'w'.repeat(1000), e: 'v'.repeat(1000) });
    expect(big.truncated).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(big)).length).toBeLessThanOrEqual(4096);
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc;
    expect(clipData(cyc)).toEqual({ unserializable: true });
  });
});

describe('telemetria (cliente): quadros e saltos', () => {
  it('FPS médio e pior quadro; quadros de aba oculta não contam', () => {
    const f = new FrameStats();
    for (let i = 0; i < 9; i++) f.add(1000 / 60);
    f.add(50);
    f.add(5000);
    const s = f.take();
    expect(s.frames).toBe(10);
    expect(s.worstMs).toBe(50);
    expect(s.fps).toBeCloseTo(10_000 / (9 * (1000 / 60) + 50), 0);
    expect(f.take()).toEqual({ fps: null, worstMs: null, frames: 0 });
  });

  it('salto > 24 px num quadro; reset esquece a posição', () => {
    const j = new JumpDetector();
    expect(j.feed({ x: 0, y: 0 })).toBeNull();
    expect(j.feed({ x: 3, y: 0 })).toBeNull();
    expect(j.feed({ x: 27, y: 0 })).toBeNull(); // exatamente 24: não conta
    expect(j.feed({ x: 60, y: 0 })).toMatchObject({ dist: 33, from: { x: 27, y: 0 }, to: { x: 60, y: 0 } });
    j.reset();
    expect(j.feed({ x: 500, y: 500 })).toBeNull();
    expect(j.feed(null)).toBeNull();
    expect(j.feed({ x: 0, y: 0 })).toBeNull();
  });
});

describe('telemetria (cliente): envio', () => {
  const fill = (q: TelemetryQueue, n: number) => {
    for (let i = 0; i < n; i++) q.push('sample', { i }, i);
  };

  it('envia até 100, descarta no 2xx, devolve no 5xx/rede, para no 401', async () => {
    const q = new TelemetryQueue();
    fill(q, 150);
    const sent: { n: number; beacon: boolean }[] = [];
    let status = 204;
    const post: PostFn = async (body, o) => {
      sent.push({ n: (JSON.parse(body) as { items: unknown[] }).items.length, beacon: o.beacon });
      if (status < 0) throw new Error('rede');
      return status;
    };
    const fl = createFlusher({ queue: q, sessionId: 'sess-12345678', post });
    await fl.flush();
    expect(sent.at(-1)).toEqual({ n: 100, beacon: false });
    expect(q.size).toBe(50);
    status = 503;
    await fl.flush();
    expect(q.size).toBe(50);
    status = -1;
    await fl.flush();
    expect(q.size).toBe(50);
    status = 400;
    await fl.flush();
    expect(q.size).toBe(0);
    fill(q, 3);
    status = 401;
    await fl.flush();
    expect(fl.stopped).toBe(true);
    fill(q, 3);
    const before = sent.length;
    await fl.flush();
    expect(sent.length).toBe(before);
  });

  it('offline não envia; um lote por vez', async () => {
    const q = new TelemetryQueue();
    fill(q, 10);
    let online = false;
    let release: (n: number) => void = () => undefined;
    let calls = 0;
    const post: PostFn = () => {
      calls++;
      return new Promise<number>((ok) => (release = ok));
    };
    const fl = createFlusher({ queue: q, sessionId: 'sess-12345678', post, online: () => online });
    await fl.flush();
    expect(calls).toBe(0);
    online = true;
    const p = fl.flush();
    fill(q, 1);
    await fl.flush(); // em andamento: não manda outro
    expect(calls).toBe(1);
    release(204);
    await p;
    expect(q.size).toBe(1);
  });

  it('beacon: no máximo 50 itens e corpo < 60 KB, sem devolver', async () => {
    const q = new TelemetryQueue();
    for (let i = 0; i < 80; i++) q.push('js_error', { stack: 'x'.repeat(1000), i }, i);
    let body = '';
    const fl = createFlusher({
      queue: q,
      sessionId: 'sess-12345678',
      post: async (b) => {
        body = b;
        return 0;
      },
    });
    await fl.flush({ beacon: true });
    const items = (JSON.parse(body) as { items: unknown[] }).items;
    expect(items.length).toBeLessThanOrEqual(50);
    expect(body.length).toBeLessThanOrEqual(BEACON_MAX_BYTES);
    expect(q.size).toBe(30);
  });
});

describe('telemetria (cliente): utilidades', () => {
  it('sessão aleatória, desligar por localStorage, resumo de erro', () => {
    const a = newSessionId();
    expect(a).toMatch(/^[a-z0-9]{8,40}$/);
    expect(newSessionId()).not.toBe(a);
    expect(telemetryDisabled({ getItem: () => 'off' })).toBe(true);
    expect(telemetryDisabled({ getItem: () => null })).toBe(false);
    expect(
      telemetryDisabled({
        getItem: () => {
          throw new Error('bloqueado');
        },
      }),
    ).toBe(false);
    const e = errorData(new TypeError('boom'), { type: 'error' });
    expect(e).toMatchObject({ name: 'TypeError', message: 'boom', type: 'error' });
    expect(String(e.stack).length).toBeLessThanOrEqual(1024);
    expect(errorData('texto')).toEqual({ message: 'texto' });
  });
});
