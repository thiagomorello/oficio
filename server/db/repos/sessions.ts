import type { Db } from '../pool';
import { num } from './util';

export interface SessionsLogRepo {
  /** Registra uma conexão aberta; devolve o id para `close`. */
  open(userId: number, ip?: string | null): Promise<number>;
  close(sessionId: number): Promise<void>;
  /** Sessões abertas desde `since`. */
  countSince(since: Date): Promise<number>;
}

export function createMysqlSessionsLogRepo(db: Db): SessionsLogRepo {
  return {
    async open(userId, ip) {
      const res = await db.exec('INSERT INTO sessions_log (user_id, opened_at, ip) VALUES (?, ?, ?)', [userId, new Date(), ip?.slice(0, 64) ?? null]);
      return res.insertId;
    },
    async close(sessionId) {
      await db.exec('UPDATE sessions_log SET closed_at = ? WHERE id = ? AND closed_at IS NULL', [new Date(), sessionId]);
    },
    async countSince(since) {
      const rows = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM sessions_log WHERE opened_at >= ?', [since]);
      return num(rows[0]?.n ?? 0);
    },
  };
}
