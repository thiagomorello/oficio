import type { Db } from './pool';

export type DbHealth = 'ok' | 'error' | 'fake';

/** SELECT 1 com timeout (2 s) e resultado em cache (10 s). Sem `db` => 'fake'. */
export function createDbHealth(db: Db | undefined, opts: { timeoutMs?: number; ttlMs?: number; now?: () => number } = {}): () => Promise<DbHealth> {
  const timeoutMs = opts.timeoutMs ?? 2_000;
  const ttlMs = opts.ttlMs ?? 10_000;
  const now = opts.now ?? Date.now;
  let cached: { at: number; value: DbHealth } | null = null;
  let inflight: Promise<DbHealth> | null = null;
  return async () => {
    if (!db) return 'fake';
    if (cached && now() - cached.at < ttlMs) return cached.value;
    if (inflight) return inflight;
    inflight = (async (): Promise<DbHealth> => {
      let timer: NodeJS.Timeout | undefined;
      try {
        const timeout = new Promise<never>((_, rej) => {
          timer = setTimeout(() => rej(new Error('timeout')), timeoutMs);
        });
        await Promise.race([db.query('SELECT 1'), timeout]);
        return 'ok';
      } catch {
        return 'error';
      } finally {
        clearTimeout(timer);
      }
    })();
    try {
      const value = await inflight;
      cached = { at: now(), value };
      return value;
    } finally {
      inflight = null;
    }
  };
}
