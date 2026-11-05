import type { Appearance, UserSettings } from '../../../shared/model';
import type { Db } from '../pool';
import type { AccountStatus, UserRow, ImportRow } from '../types';
import { bool, date, likeEscape, num, parseJson, toJson } from './util';

export interface UserListQuery {
  search?: string;
  status?: AccountStatus | 'all';
  limit?: number;
  offset?: number;
}

export interface UserPatch {
  name?: string;
  display_name?: string | null;
  role_name?: string | null;
  is_admin?: boolean;
  status?: AccountStatus;
  appearance?: Appearance | null;
  settings?: Partial<UserSettings> | null;
  must_change_password?: boolean;
}

export interface CreateLocalUser {
  email: string;
  name: string;
  password_hash: string;
  display_name?: string | null;
  role_name?: string | null;
  is_admin?: boolean;
  must_change_password?: boolean;
}

export interface UsersRepo {
  byId(id: number): Promise<UserRow | null>;
  /** Busca sem diferenciar maiúsculas. */
  byEmail(email: string): Promise<UserRow | null>;
  byExternalId(externalId: string): Promise<UserRow | null>;
  list(q?: UserListQuery): Promise<{ rows: UserRow[]; total: number }>;
  /**
   * Upsert por external_id (importação): atualiza nome/hash/perfil; nunca rebaixa is_admin, nunca mexe em status
   * nem apaga. Se o hash mudou, `password_version` sobe (sessões antigas caem).
   */
  upsertImported(row: ImportRow): Promise<'inserted' | 'updated'>;
  /** Adota uma conta local (sem external_id) pelo e-mail, vinculando-a ao identificador importado. */
  adoptLocal(id: number, row: ImportRow): Promise<void>;
  createLocal(u: CreateLocalUser): Promise<UserRow>;
  update(id: number, patch: UserPatch): Promise<UserRow | null>;
  setPassword(id: number, hash: string, opts: { needsChange: boolean }): Promise<void>;
  touchLastSeen(id: number): Promise<void>;
  roleNames(): Promise<string[]>;
  /** Admins ativos. */
  countAdmins(): Promise<number>;
}

export function userFromDb(r: Record<string, unknown>): UserRow {
  return {
    id: num(r.id),
    external_id: r.external_id == null ? null : String(r.external_id),
    email: String(r.email),
    name: String(r.name),
    display_name: r.display_name == null ? null : String(r.display_name),
    password_hash: String(r.password_hash),
    password_version: num(r.password_version),
    must_change_password: bool(r.must_change_password),
    role_name: r.role_name == null ? null : String(r.role_name),
    is_admin: bool(r.is_admin),
    status: r.status === 'disabled' ? 'disabled' : 'active',
    appearance: parseJson<Appearance>(r.appearance),
    settings: parseJson<Partial<UserSettings>>(r.settings),
    last_seen_at: date(r.last_seen_at),
    created_at: date(r.created_at) ?? new Date(0),
    updated_at: date(r.updated_at) ?? new Date(0),
  };
}

const PATCH_COLUMNS: Record<keyof UserPatch, { col: string; json?: boolean; bool?: boolean }> = {
  name: { col: 'name' },
  display_name: { col: 'display_name' },
  role_name: { col: 'role_name' },
  is_admin: { col: 'is_admin', bool: true },
  status: { col: 'status' },
  appearance: { col: 'appearance', json: true },
  settings: { col: 'settings', json: true },
  must_change_password: { col: 'must_change_password', bool: true },
};

export function createMysqlUsersRepo(db: Db): UsersRepo {
  const one = async (where: string, params: unknown[]): Promise<UserRow | null> => {
    const rows = await db.query<Record<string, unknown>>(`SELECT * FROM users WHERE ${where} LIMIT 1`, params);
    return rows[0] ? userFromDb(rows[0]) : null;
  };
  const repo: UsersRepo = {
    byId: (id) => one('id = ?', [id]),
    byEmail: (email) => one('email = ?', [email.trim().toLowerCase()]),
    byExternalId: (id) => one('external_id = ?', [id]),

    async list(q = {}) {
      const where: string[] = [];
      const params: unknown[] = [];
      if (q.status && q.status !== 'all') {
        where.push('status = ?');
        params.push(q.status);
      }
      const s = q.search?.trim();
      if (s) {
        const like = `%${likeEscape(s)}%`;
        where.push('(name LIKE ? OR email LIKE ? OR display_name LIKE ? OR role_name LIKE ?)');
        params.push(like, like, like, like);
      }
      const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const limit = Math.min(Math.max(Math.trunc(q.limit ?? 50), 1), 500);
      const offset = Math.max(Math.trunc(q.offset ?? 0), 0);
      const total = await db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM users ${w}`, params);
      const rows = await db.query<Record<string, unknown>>(`SELECT * FROM users ${w} ORDER BY name ASC, id ASC LIMIT ? OFFSET ?`, [...params, limit, offset]);
      return { rows: rows.map(userFromDb), total: num(total[0]?.n ?? 0) };
    },

    async upsertImported(r) {
      // password_version vem ANTES de password_hash: o MySQL avalia as atribuições da esquerda p/ a direita.
      const res = await db.exec(
        `INSERT INTO users (external_id, email, name, password_hash, role_name, is_admin)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           name = VALUES(name),
           password_version = IF(password_hash <> VALUES(password_hash), password_version + 1, password_version),
           password_hash = VALUES(password_hash),
           role_name = VALUES(role_name),
           is_admin = GREATEST(is_admin, VALUES(is_admin))`,
        [r.external_id, r.email.trim().toLowerCase(), r.name, r.password_hash, r.role_name, r.is_admin ? 1 : 0],
      );
      // 1 = linha nova; 2 = atualizada; 0 = existente sem mudanças
      return res.affectedRows === 1 ? 'inserted' : 'updated';
    },

    async adoptLocal(id, r) {
      await db.exec(
        `UPDATE users SET external_id = ?, name = ?, role_name = ?, is_admin = GREATEST(is_admin, ?),
           password_version = IF(password_hash <> ?, password_version + 1, password_version), password_hash = ?
         WHERE id = ? AND external_id IS NULL`,
        [r.external_id, r.name, r.role_name, r.is_admin ? 1 : 0, r.password_hash, r.password_hash, id],
      );
    },

    async createLocal(u) {
      const res = await db.exec(
        `INSERT INTO users (email, name, display_name, password_hash, role_name, is_admin, must_change_password)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [u.email.trim().toLowerCase(), u.name, u.display_name ?? null, u.password_hash, u.role_name ?? null, u.is_admin ? 1 : 0, u.must_change_password ? 1 : 0],
      );
      const row = await repo.byId(res.insertId);
      if (!row) throw new Error('user not found after insert');
      return row;
    },

    async update(id, patch) {
      const sets: string[] = [];
      const params: unknown[] = [];
      for (const key of Object.keys(PATCH_COLUMNS) as (keyof UserPatch)[]) {
        const v = patch[key];
        if (v === undefined) continue;
        const meta = PATCH_COLUMNS[key];
        sets.push(`${meta.col} = ?`);
        params.push(meta.json ? toJson(v) : meta.bool ? (v ? 1 : 0) : v);
      }
      if (sets.length) await db.exec(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
      return repo.byId(id);
    },

    async setPassword(id, hash, opts) {
      await db.exec('UPDATE users SET password_hash = ?, password_version = password_version + 1, must_change_password = ? WHERE id = ?', [
        hash,
        opts.needsChange ? 1 : 0,
        id,
      ]);
    },

    async touchLastSeen(id) {
      await db.exec('UPDATE users SET last_seen_at = ? WHERE id = ?', [new Date(), id]);
    },

    async roleNames() {
      const rows = await db.query<{ role_name: string }>('SELECT DISTINCT role_name FROM users WHERE role_name IS NOT NULL ORDER BY role_name');
      return rows.map((r) => r.role_name);
    },

    async countAdmins() {
      const rows = await db.query<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE is_admin = 1 AND status = 'active'");
      return num(rows[0]?.n ?? 0);
    },
  };
  return repo;
}
