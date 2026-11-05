// Saída para os sockets: cada mensagem é codificada uma vez e enviada a todos; quem acumula mais
// de 1 MiB sem ler (rede travada/aba congelada) é desconectado em vez de inflar a memória do servidor.
import { WebSocket } from 'ws';
import { encodeServer, type ServerMsg } from '../../shared/protocol';

export const MAX_BUFFERED = 1024 * 1024;

/** Conexão do ponto de vista do mundo (o socket real ou um fake nos testes). */
export interface Conn {
  /** Envia um frame já codificado. */
  sendRaw(data: string): void;
  close(code?: number, reason?: string): void;
  isOpen(): boolean;
  /** IP de origem (sessions_log). */
  readonly ip?: string | null;
}

export function send(conn: Conn, msg: ServerMsg): void {
  conn.sendRaw(encodeServer(msg));
}

/** Codifica uma vez e envia para todas as conexões (menos `except`). */
export function broadcast(conns: Iterable<Conn>, msg: ServerMsg, except?: Conn | null): void {
  let data: string | null = null;
  for (const c of conns) {
    if (c === except || !c.isOpen()) continue;
    data ??= encodeServer(msg);
    c.sendRaw(data);
  }
}

/** Adapta um socket `ws` para `Conn`, com o corte por `bufferedAmount`. */
export function wsConn(ws: WebSocket, ip?: string | null): Conn {
  return {
    ip: ip ?? null,
    isOpen: () => ws.readyState === WebSocket.OPEN,
    sendRaw(data) {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (ws.bufferedAmount > MAX_BUFFERED) {
        ws.close(1013, 'too slow');
        // Se nem o close sair, derruba.
        setTimeout(() => ws.terminate(), 2_000).unref?.();
        return;
      }
      ws.send(data);
    },
    close(code = 1000, reason = '') {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close(code, reason);
    },
  };
}
