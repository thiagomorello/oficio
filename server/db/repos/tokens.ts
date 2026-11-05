import type { Db } from '../pool';
import type { TokenKind, TokenRow } from '../types';
import { date, num } from './util';

export interface TokensRepo {
  create(kind: TokenKind, userId: number, tokenHash: string, expiresAt: Date): Promise<void>;
  /** Marca como usado e devolve a linha; null se não existe, expirou ou já foi usado. Atômico. */
  consume(tokenHash: string): Promise<TokenRow | null>;
}

export function createMysqlTokensRepo(db: Db): TokensRepo {
  return {
    async create(kind, userId, tokenHash, expiresAt) {
      await db.exec('INSERT INTO password_tokens (user_id, kind, token_hash, expires_at) VALUES (?, ?, ?, ?)', [userId, kind, tokenHash, expiresAt]);
    },
    async consume(tokenHash) {
      const now = new Date();
      const res = await db.exec('UPDATE password_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?', [now, tokenHash, now]);
      if (res.affectedRows !== 1) return null;
      const rows = await db.query<Record<string, unknown>>('SELECT * FROM password_tokens WHERE token_hash = ? LIMIT 1', [tokenHash]);
      const r = rows[0];
      if (!r) return null;
      return {
        id: num(r.id),
        user_id: num(r.user_id),
        kind: r.kind === 'invite' ? 'invite' : 'reset',
        token_hash: String(r.token_hash),
        expires_at: date(r.expires_at) ?? now,
        used_at: date(r.used_at),
        created_at: date(r.created_at) ?? now,
      };
    },
  };
}
