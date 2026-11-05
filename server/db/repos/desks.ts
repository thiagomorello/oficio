import type { DeskDecor } from '../../../shared/desk-decor';
import { normalizeDecor } from '../../../shared/desk-decor';
import type { Db } from '../pool';
import type { DeskRow } from '../types';
import { date, num, parseJson, toJson } from './util';

export type ClaimResult = { ok: true; released: string | null } | { ok: false; reason: 'taken' };

export interface DesksRepo {
  all(): Promise<DeskRow[]>;
  ownedBy(userId: number): Promise<DeskRow | null>;
  /**
   * Reivindica `deskId` para `userId`: libera a mesa anterior do usuário (com a decoração) e falha
   * com 'taken' se outra pessoa já é dona. Reivindicar a própria mesa é no-op ok.
   */
  claim(deskId: string, userId: number): Promise<ClaimResult>;
  /** Apaga a linha (e a decoração). Devolve o dono anterior ou null. */
  release(deskId: string): Promise<number | null>;
  /** Grava a decoração (null limpa). false se a mesa não tem dono. */
  setDecor(deskId: string, decor: DeskDecor | null): Promise<boolean>;
  /** Admin: passa a mesa para outro usuário (libera a anterior dele), zera a decoração. Devolve o dono anterior. */
  reassign(deskId: string, userId: number): Promise<number | null>;
  /** Remove as mesas cujo id não está em `ids` (publish de mapa). Devolve os donos liberados. */
  pruneNotIn(ids: string[]): Promise<number[]>;
}

function deskFromDb(r: Record<string, unknown>): DeskRow {
  return {
    desk_id: String(r.desk_id),
    user_id: num(r.user_id),
    decor: normalizeDecor(parseJson(r.decor)),
    claimed_at: date(r.claimed_at) ?? new Date(0),
  };
}

export function createMysqlDesksRepo(db: Db): DesksRepo {
  return {
    async all() {
      const rows = await db.query<Record<string, unknown>>('SELECT * FROM desks ORDER BY desk_id');
      return rows.map(deskFromDb);
    },

    async ownedBy(userId) {
      const rows = await db.query<Record<string, unknown>>('SELECT * FROM desks WHERE user_id = ? LIMIT 1', [userId]);
      return rows[0] ? deskFromDb(rows[0]) : null;
    },

    claim: (deskId, userId) =>
      db.tx(async (t): Promise<ClaimResult> => {
        const cur = await t.query<{ user_id: number }>('SELECT user_id FROM desks WHERE desk_id = ? FOR UPDATE', [deskId]);
        if (cur[0]) return num(cur[0].user_id) === userId ? { ok: true, released: null } : { ok: false, reason: 'taken' };
        const prev = await t.query<{ desk_id: string }>('SELECT desk_id FROM desks WHERE user_id = ? FOR UPDATE', [userId]);
        if (prev[0]) await t.exec('DELETE FROM desks WHERE user_id = ?', [userId]);
        try {
          await t.exec('INSERT INTO desks (desk_id, user_id) VALUES (?, ?)', [deskId, userId]);
        } catch (err) {
          if ((err as { code?: string }).code === 'ER_DUP_ENTRY') return { ok: false, reason: 'taken' };
          throw err;
        }
        return { ok: true, released: prev[0] ? String(prev[0].desk_id) : null };
      }),

    release: (deskId) =>
      db.tx(async (t) => {
        const cur = await t.query<{ user_id: number }>('SELECT user_id FROM desks WHERE desk_id = ? FOR UPDATE', [deskId]);
        if (!cur[0]) return null;
        await t.exec('DELETE FROM desks WHERE desk_id = ?', [deskId]);
        return num(cur[0].user_id);
      }),

    async setDecor(deskId, decor) {
      const normalized = normalizeDecor(decor);
      const res = await db.exec('UPDATE desks SET decor = ? WHERE desk_id = ?', [toJson(normalized), deskId]);
      return res.affectedRows > 0 || (await db.query('SELECT 1 FROM desks WHERE desk_id = ?', [deskId])).length > 0;
    },

    reassign: (deskId, userId) =>
      db.tx(async (t) => {
        const cur = await t.query<{ user_id: number }>('SELECT user_id FROM desks WHERE desk_id = ? FOR UPDATE', [deskId]);
        const prevOwner = cur[0] ? num(cur[0].user_id) : null;
        if (prevOwner === userId) {
          await t.exec('UPDATE desks SET decor = NULL WHERE desk_id = ?', [deskId]);
          return prevOwner;
        }
        await t.exec('DELETE FROM desks WHERE user_id = ? OR desk_id = ?', [userId, deskId]);
        await t.exec('INSERT INTO desks (desk_id, user_id) VALUES (?, ?)', [deskId, userId]);
        return prevOwner;
      }),

    pruneNotIn: (ids) =>
      db.tx(async (t) => {
        const rows = ids.length
          ? await t.query<{ user_id: number }>(`SELECT user_id FROM desks WHERE desk_id NOT IN (${ids.map(() => '?').join(',')}) FOR UPDATE`, ids)
          : await t.query<{ user_id: number }>('SELECT user_id FROM desks FOR UPDATE');
        if (rows.length) {
          if (ids.length) await t.exec(`DELETE FROM desks WHERE desk_id NOT IN (${ids.map(() => '?').join(',')})`, ids);
          else await t.exec('DELETE FROM desks');
        }
        return rows.map((r) => num(r.user_id));
      }),
  };
}
