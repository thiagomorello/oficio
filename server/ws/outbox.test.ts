import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { broadcast, MAX_BUFFERED, wsConn, type Conn } from './outbox';

function fakeWs(buffered: number) {
  const sent: string[] = [];
  const closed: number[] = [];
  const ws = {
    readyState: WebSocket.OPEN,
    bufferedAmount: buffered,
    send: (d: string) => void sent.push(d),
    close: (code: number) => void closed.push(code),
    terminate: () => undefined,
  };
  return { ws: ws as unknown as WebSocket, sent, closed };
}

describe('outbox', () => {
  it('codifica uma vez e pula (fechando) quem tem mais de 1 MiB pendente', () => {
    const ok = fakeWs(0);
    const slow = fakeWs(MAX_BUFFERED + 1);
    const conns: Conn[] = [wsConn(ok.ws), wsConn(slow.ws)];
    broadcast(conns, { t: 'leave', id: 3 });
    expect(ok.sent).toEqual(['{"t":"leave","id":3}']);
    expect(slow.sent).toEqual([]);
    expect(slow.closed).toEqual([1013]);
  });
});
