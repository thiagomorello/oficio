import { describe, expect, it } from 'vitest';
import { backoffDelay, median, OfficeSocket, type WebSocketLike } from './socket';

class FakeWs implements WebSocketLike {
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  sent: string[] = [];
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code, reason: '' });
  }
  recv(o: unknown) {
    this.onmessage?.({ data: JSON.stringify(o) });
  }
}

function setup() {
  const sockets: FakeWs[] = [];
  const timers: { fn: () => void; ms: number; dead: boolean }[] = [];
  const redirects: string[] = [];
  let now = 1000;
  const s = new OfficeSocket({
    url: 'ws://x/ws',
    create: () => {
      const w = new FakeWs();
      sockets.push(w);
      return w;
    },
    now: () => now,
    redirect: (p) => redirects.push(p),
    schedule: (fn, ms) => {
      const t = { fn, ms, dead: false };
      timers.push(t);
      return () => void (t.dead = true);
    },
  });
  return { s, sockets, timers, redirects, setNow: (v: number) => (now = v) };
}

describe('OfficeSocket', () => {
  it('backoff 2 s -> 30 s e mediana', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(backoffDelay)).toEqual([2000, 4000, 8000, 16000, 30000, 30000, 30000]);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('reconecta com backoff crescente e zera ao abrir', () => {
    const { s, sockets, timers } = setup();
    const retries: number[] = [];
    s.on('retry', (ms) => retries.push(ms));
    s.connect();
    sockets[0].drop();
    timers.filter((t) => t.ms >= 2000 && !t.dead).at(-1)!.fn();
    sockets[1].drop();
    expect(retries).toEqual([2000, 4000]);
    timers.filter((t) => t.ms === 4000).at(-1)!.fn();
    sockets[2].open();
    expect(s.state).toBe('open');
    sockets[2].drop();
    expect(retries.at(-1)).toBe(2000);
  });

  it('relógio: offset = mediana das últimas 5 medidas', () => {
    const { s, sockets, setNow } = setup();
    s.connect();
    sockets[0].open();
    // ida e volta de 100 ms; servidor 5 s adiantado
    for (const extra of [0, 0, 0, 900, 0]) {
      setNow(2000);
      const ts = 1900;
      s.onPong(ts, 1950 + 5000 + extra);
    }
    expect(s.offset).toBe(5000);
    expect(s.rtt).toBe(100);
    setNow(3000);
    expect(s.serverNow()).toBe(8000);
  });

  it('kick: sessão/desativado -> /login; substituído -> não reconecta', () => {
    const a = setup();
    a.s.connect();
    a.sockets[0].open();
    a.sockets[0].recv({ t: 'kick', reason: 'session' });
    expect(a.redirects).toEqual(['/login']);
    expect(a.s.state).toBe('closed');

    const b = setup();
    b.s.connect();
    b.sockets[0].open();
    b.sockets[0].recv({ t: 'kick', reason: 'replaced' });
    b.sockets[0].drop();
    expect(b.redirects).toEqual([]);
    expect(b.sockets).toHaveLength(1);
    expect(b.s.state).toBe('closed');
  });

  it('send só com a conexão aberta', () => {
    const { s, sockets } = setup();
    s.connect();
    expect(s.send({ t: 'stand' })).toBe(false);
    sockets[0].open();
    expect(s.send({ t: 'stand' })).toBe(true);
    expect(sockets[0].sent.at(-1)).toBe('{"t":"stand"}');
  });
});
