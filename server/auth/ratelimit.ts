// Limite de tentativas em janela deslizante, em memória (1 réplica).
import type { IncomingMessage } from 'node:http';

export interface RateLimiter {
  /** Segundos até liberar, ou 0 se pode tentar. */
  blockedFor(key: string): number;
  /** Registra uma tentativa que falhou. */
  fail(key: string): void;
  reset(key: string): void;
}

export function createRateLimiter(opts: { max?: number; windowMs?: number; now?: () => number } = {}): RateLimiter {
  const max = opts.max ?? 10;
  const windowMs = opts.windowMs ?? 10 * 60_000;
  const now = opts.now ?? Date.now;
  const hits = new Map<string, number[]>();
  const prune = (key: string): number[] => {
    const t = now();
    const list = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
    if (list.length) hits.set(key, list);
    else hits.delete(key);
    return list;
  };
  return {
    blockedFor(key) {
      const list = prune(key);
      if (list.length < max) return 0;
      return Math.max(1, Math.ceil((list[0] + windowMs - now()) / 1000));
    },
    fail(key) {
      const list = prune(key);
      list.push(now());
      hits.set(key, list);
      if (hits.size > 10_000) for (const k of [...hits.keys()]) prune(k);
    },
    reset(key) {
      hits.delete(key);
    },
  };
}

/** IP do cliente; atrás do proxy (TRUST_PROXY) usa o primeiro item de X-Forwarded-For. */
export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}
