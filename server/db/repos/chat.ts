import type { Db } from '../pool';
import type { ChatRow, ChatScope } from '../types';
import { date, num } from './util';

export interface NewChatMessage {
  scope: ChatScope;
  zone_id: string | null;
  user_id: number;
  name: string;
  text: string;
  created_at?: Date;
}

export interface ChatRepo {
  insert(m: NewChatMessage): Promise<ChatRow>;
  /**
   * Mensagens mais antigas que `before` (id), em ordem cronológica crescente, no máximo `limit`
   * (as mais recentes dentre elas). `zoneId` filtra o escopo 'room'.
   */
  list(scope: ChatScope, zoneId: string | null, before: number | null, limit: number): Promise<ChatRow[]>;
  /** Apaga mensagens com mais de `days` dias; devolve quantas. */
  purgeOlderThan(days: number): Promise<number>;
}

function chatFromDb(r: Record<string, unknown>): ChatRow {
  return {
    id: num(r.id),
    scope: r.scope === 'room' ? 'room' : r.scope === 'near' ? 'near' : 'global',
    zone_id: r.zone_id == null ? null : String(r.zone_id),
    user_id: num(r.user_id),
    name: String(r.name),
    text: String(r.text),
    created_at: date(r.created_at) ?? new Date(0),
  };
}

export function createMysqlChatRepo(db: Db): ChatRepo {
  return {
    async insert(m) {
      const at = m.created_at ?? new Date();
      const res = await db.exec('INSERT INTO chat_messages (scope, zone_id, user_id, name, text, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
        m.scope,
        m.zone_id,
        m.user_id,
        m.name.slice(0, 190),
        m.text.slice(0, 1000),
        at,
      ]);
      return { id: res.insertId, scope: m.scope, zone_id: m.zone_id, user_id: m.user_id, name: m.name, text: m.text, created_at: at };
    },

    async list(scope, zoneId, before, limit) {
      const where = ['scope = ?'];
      const params: unknown[] = [scope];
      if (scope === 'room') {
        where.push('zone_id = ?');
        params.push(zoneId);
      }
      if (before !== null) {
        where.push('id < ?');
        params.push(before);
      }
      const n = Math.min(Math.max(Math.trunc(limit), 1), 200);
      const rows = await db.query<Record<string, unknown>>(`SELECT * FROM chat_messages WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`, [...params, n]);
      return rows.map(chatFromDb).reverse();
    },

    async purgeOlderThan(days) {
      const cutoff = new Date(Date.now() - days * 86_400_000);
      const res = await db.exec('DELETE FROM chat_messages WHERE created_at < ?', [cutoff]);
      return res.affectedRows;
    },
  };
}
