// Repositórios em memória com a mesma semântica das implementações MySQL (testes e `npm run dev` sem banco).
import { normalizeDecor, type DeskDecor } from '../../shared/desk-decor';
import type { Repos } from '../db/repos/index';
import type { ClaimResult } from '../db/repos/desks';
import type { SaveDraftResult } from '../db/repos/maps';
import { SETTING_PUBLISHED_MAP_ID } from '../db/repos/settings';
import { clampLimit, summarizeTelemetry, type TelemetryEventRow } from '../db/repos/telemetry';
import type { UserPatch } from '../db/repos/users';
import type { ChatRow, DeskRow, MapListRow, MapRow, TokenRow, UserRow } from '../db/types';

const clone = <T>(v: T): T => (v === null || v === undefined ? v : (structuredClone(v) as T));

export interface FakeOptions {
  /** Relógio injetável (testes de expiração/retenção). */
  now?: () => Date;
}

export function createFakeRepos(opts: FakeOptions = {}): Repos {
  const now = opts.now ?? (() => new Date());

  // --- users
  const users = new Map<number, UserRow>();
  let userSeq = 0;
  const emailTaken = (email: string, except?: number): boolean => [...users.values()].some((u) => u.email === email && u.id !== except);

  // --- tokens
  const tokens: TokenRow[] = [];
  let tokenSeq = 0;

  // --- desks
  const desks = new Map<string, DeskRow>();

  // --- chat
  const chat: ChatRow[] = [];
  let chatSeq = 0;

  // --- sessions
  const sessions = new Map<number, { user_id: number; opened_at: Date; closed_at: Date | null }>();
  let sessSeq = 0;

  // --- maps/settings
  const maps = new Map<number, MapRow>();
  let mapSeq = 0;
  const settings = new Map<string, string>();

  // --- telemetry
  const telemetry: TelemetryEventRow[] = [];
  let telSeq = 0;

  let tick = 0;
  /** Garante updated_at estritamente crescente mesmo com relógio congelado. */
  const stamp = (): Date => new Date(Math.max(now().getTime(), tick + 1));
  const bump = (d: Date): Date => {
    tick = d.getTime();
    return d;
  };

  const repos: Repos = {
    users: {
      async byId(id) {
        return clone(users.get(id) ?? null);
      },
      async byEmail(email) {
        const e = email.trim().toLowerCase();
        return clone([...users.values()].find((u) => u.email === e) ?? null);
      },
      async byExternalId(xid) {
        return clone([...users.values()].find((u) => u.external_id === xid) ?? null);
      },
      async list(q = {}) {
        const s = q.search?.trim().toLowerCase();
        let rows = [...users.values()].filter((u) => {
          if (q.status && q.status !== 'all' && u.status !== q.status) return false;
          if (!s) return true;
          return [u.name, u.email, u.display_name ?? '', u.role_name ?? ''].some((f) => f.toLowerCase().includes(s));
        });
        rows.sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
        const total = rows.length;
        const limit = Math.min(Math.max(Math.trunc(q.limit ?? 50), 1), 500);
        const offset = Math.max(Math.trunc(q.offset ?? 0), 0);
        rows = rows.slice(offset, offset + limit);
        return { rows: clone(rows), total };
      },
      async upsertImported(r) {
        const email = r.email.trim().toLowerCase();
        const cur = [...users.values()].find((u) => u.external_id === r.external_id);
        if (cur) {
          if (cur.password_hash !== r.password_hash) cur.password_version += 1;
          cur.name = r.name;
          cur.password_hash = r.password_hash;
          cur.role_name = r.role_name;
          cur.is_admin = cur.is_admin || r.is_admin;
          cur.updated_at = bump(stamp());
          return 'updated';
        }
        if (emailTaken(email)) throw Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });
        const t = bump(stamp());
        const id = ++userSeq;
        users.set(id, {
          id, external_id: r.external_id, email, name: r.name, display_name: null, password_hash: r.password_hash, password_version: 1,
          must_change_password: false, role_name: r.role_name, is_admin: r.is_admin, status: 'active', appearance: null, settings: null,
          last_seen_at: null, created_at: t, updated_at: t,
        });
        return 'inserted';
      },
      async adoptLocal(id, r) {
        const u = users.get(id);
        if (!u || u.external_id !== null) return;
        if (u.password_hash !== r.password_hash) u.password_version += 1;
        u.external_id = r.external_id;
        u.name = r.name;
        u.role_name = r.role_name;
        u.is_admin = u.is_admin || r.is_admin;
        u.password_hash = r.password_hash;
        u.updated_at = bump(stamp());
      },
      async createLocal(c) {
        const email = c.email.trim().toLowerCase();
        if (emailTaken(email)) throw Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });
        if (c.external_id && [...users.values()].some((u) => u.external_id === c.external_id)) throw Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });
        const t = bump(stamp());
        const id = ++userSeq;
        const row: UserRow = {
          id, external_id: c.external_id ?? null, email, name: c.name, display_name: c.display_name ?? null, password_hash: c.password_hash, password_version: 1,
          must_change_password: !!c.must_change_password, role_name: c.role_name ?? null, is_admin: !!c.is_admin, status: 'active',
          appearance: null, settings: null, last_seen_at: null, created_at: t, updated_at: t,
        };
        users.set(id, row);
        return clone(row);
      },
      async update(id, patch: UserPatch) {
        const u = users.get(id);
        if (!u) return null;
        for (const k of Object.keys(patch) as (keyof UserPatch)[]) {
          const v = patch[k];
          if (v !== undefined) (u as unknown as Record<string, unknown>)[k] = clone(v);
        }
        u.updated_at = bump(stamp());
        return clone(u);
      },
      async setPassword(id, hash, o) {
        const u = users.get(id);
        if (!u) return;
        u.password_hash = hash;
        u.password_version += 1;
        u.must_change_password = o.needsChange;
        u.updated_at = bump(stamp());
      },
      async touchLastSeen(id) {
        const u = users.get(id);
        if (u) u.last_seen_at = now();
      },
      async roleNames() {
        return [...new Set([...users.values()].map((u) => u.role_name).filter((r): r is string => !!r))].sort();
      },
      async countAdmins() {
        return [...users.values()].filter((u) => u.is_admin && u.status === 'active').length;
      },
    },

    tokens: {
      async create(kind, userId, tokenHash, expiresAt) {
        if (tokens.some((t) => t.token_hash === tokenHash)) throw Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });
        tokens.push({ id: ++tokenSeq, user_id: userId, kind, token_hash: tokenHash, expires_at: expiresAt, used_at: null, created_at: now() });
      },
      async consume(tokenHash) {
        const t = tokens.find((x) => x.token_hash === tokenHash);
        if (!t || t.used_at || t.expires_at.getTime() <= now().getTime()) return null;
        t.used_at = now();
        return clone(t);
      },
    },

    desks: {
      async all() {
        return [...desks.values()].sort((a, b) => a.desk_id.localeCompare(b.desk_id)).map(clone);
      },
      async ownedBy(userId) {
        return clone([...desks.values()].find((d) => d.user_id === userId) ?? null);
      },
      async claim(deskId, userId): Promise<ClaimResult> {
        const cur = desks.get(deskId);
        if (cur) return cur.user_id === userId ? { ok: true, released: null } : { ok: false, reason: 'taken' };
        const prev = [...desks.values()].find((d) => d.user_id === userId);
        if (prev) desks.delete(prev.desk_id);
        desks.set(deskId, { desk_id: deskId, user_id: userId, decor: null, claimed_at: now() });
        return { ok: true, released: prev?.desk_id ?? null };
      },
      async release(deskId) {
        const cur = desks.get(deskId);
        if (!cur) return null;
        desks.delete(deskId);
        return cur.user_id;
      },
      async setDecor(deskId, decor: DeskDecor | null) {
        const cur = desks.get(deskId);
        if (!cur) return false;
        cur.decor = normalizeDecor(decor);
        return true;
      },
      async reassign(deskId, userId) {
        const cur = desks.get(deskId);
        const prevOwner = cur?.user_id ?? null;
        if (cur && cur.user_id === userId) {
          cur.decor = null;
          return prevOwner;
        }
        for (const d of [...desks.values()]) if (d.user_id === userId) desks.delete(d.desk_id);
        desks.set(deskId, { desk_id: deskId, user_id: userId, decor: null, claimed_at: now() });
        return prevOwner;
      },
      async pruneNotIn(ids) {
        const keep = new Set(ids);
        const released: number[] = [];
        for (const d of [...desks.values()]) {
          if (keep.has(d.desk_id)) continue;
          desks.delete(d.desk_id);
          released.push(d.user_id);
        }
        return released;
      },
    },

    chat: {
      async insert(m) {
        const row: ChatRow = { id: ++chatSeq, scope: m.scope, zone_id: m.zone_id, user_id: m.user_id, name: m.name, text: m.text, created_at: m.created_at ?? now() };
        chat.push(row);
        return clone(row);
      },
      async list(scope, zoneId, before, limit) {
        const rows = chat.filter((c) => c.scope === scope && (scope !== 'room' || c.zone_id === zoneId) && (before === null || c.id < before));
        return clone(rows.slice(-Math.min(Math.max(Math.trunc(limit), 1), 200)));
      },
      async purgeOlderThan(days) {
        const cutoff = now().getTime() - days * 86_400_000;
        const before = chat.length;
        for (let i = chat.length - 1; i >= 0; i--) if (chat[i]!.created_at.getTime() < cutoff) chat.splice(i, 1);
        return before - chat.length;
      },
    },

    sessions: {
      async open(userId) {
        const id = ++sessSeq;
        sessions.set(id, { user_id: userId, opened_at: now(), closed_at: null });
        return id;
      },
      async close(id) {
        const s = sessions.get(id);
        if (s && !s.closed_at) s.closed_at = now();
      },
      async countSince(since) {
        return [...sessions.values()].filter((s) => s.opened_at.getTime() >= since.getTime()).length;
      },
    },

    telemetry: {
      async insertMany(rows) {
        for (const r of rows) {
          telemetry.push({ ...clone(r), id: ++telSeq, session_id: r.session_id.slice(0, 40), kind: r.kind.slice(0, 32) });
        }
        return rows.length;
      },
      async query(q) {
        const rows = telemetry.filter(
          (r) =>
            r.at.getTime() >= q.since.getTime() &&
            (q.userId === undefined || r.user_id === q.userId) &&
            (!q.kind || r.kind === q.kind) &&
            (!q.sessionId || r.session_id === q.sessionId),
        );
        rows.sort((a, b) => b.at.getTime() - a.at.getTime() || b.id - a.id);
        return clone(rows.slice(0, clampLimit(q.limit)));
      },
      async summary(since) {
        return summarizeTelemetry(telemetry, since);
      },
      async purgeOlderThan(days) {
        const cutoff = now().getTime() - days * 86_400_000;
        const before = telemetry.length;
        for (let i = telemetry.length - 1; i >= 0; i--) if (telemetry[i]!.at.getTime() < cutoff) telemetry.splice(i, 1);
        return before - telemetry.length;
      },
    },

    settings: {
      async get(key) {
        return settings.get(key) ?? null;
      },
      async set(key, value) {
        settings.set(key, value);
      },
    },

    maps: {
      async get(id) {
        return clone(maps.get(id) ?? null);
      },
      async getPublished() {
        const id = Number.parseInt(settings.get(SETTING_PUBLISHED_MAP_ID) ?? '', 10);
        return clone(Number.isFinite(id) ? (maps.get(id) ?? null) : null);
      },
      async getDraft() {
        return clone([...maps.values()].find((m) => m.kind === 'draft') ?? null);
      },
      async saveDraft(doc, baseUpdatedAt, by, docSchema = 1): Promise<SaveDraftResult> {
        const cur = [...maps.values()].find((m) => m.kind === 'draft');
        if (!cur) {
          if (baseUpdatedAt !== null) return { ok: false, conflict: { updated_at: new Date(0), by: null } };
          const t = bump(stamp());
          const row: MapRow = {
            id: ++mapSeq, kind: 'draft', name: 'Rascunho', doc: clone(doc), doc_schema: docSchema, parent_id: null, created_by: by,
            created_at: t, updated_at: t, published_at: null, stats: null,
          };
          maps.set(row.id, row);
          return { ok: true, row: clone(row) };
        }
        if (baseUpdatedAt === null || cur.updated_at.getTime() !== baseUpdatedAt.getTime()) {
          return { ok: false, conflict: { updated_at: cur.updated_at, by: cur.created_by } };
        }
        cur.doc = clone(doc);
        cur.doc_schema = docSchema;
        cur.created_by = by;
        cur.updated_at = bump(stamp());
        return { ok: true, row: clone(cur) };
      },
      async list() {
        const rows = [...maps.values()].sort((a, b) => Number(b.kind === 'draft') - Number(a.kind === 'draft') || b.id - a.id);
        return rows.map((m): MapListRow => {
          const { doc: _doc, ...rest } = clone(m);
          return rest;
        });
      },
      async createVersion(doc, name, parentId, by, stats, docSchema = 1) {
        const t = bump(stamp());
        const row: MapRow = {
          id: ++mapSeq, kind: 'version', name: name.slice(0, 120), doc: clone(doc), doc_schema: docSchema, parent_id: parentId, created_by: by,
          created_at: t, updated_at: t, published_at: null, stats: clone(stats),
        };
        maps.set(row.id, row);
        return clone(row);
      },
      async setPublished(id) {
        const m = maps.get(id);
        if (!m || m.kind !== 'version') return false;
        m.published_at = now();
        settings.set(SETTING_PUBLISHED_MAP_ID, String(id));
        return true;
      },
      async delete(id) {
        return maps.delete(id);
      },
      async restoreToDraft(id, by) {
        const src = maps.get(id);
        if (!src || src.kind !== 'version') return null;
        let d = [...maps.values()].find((m) => m.kind === 'draft');
        const t = bump(stamp());
        if (d) {
          d.doc = clone(src.doc);
          d.doc_schema = src.doc_schema;
          d.parent_id = src.id;
          d.created_by = by;
          d.updated_at = t;
        } else {
          d = { id: ++mapSeq, kind: 'draft', name: 'Rascunho', doc: clone(src.doc), doc_schema: src.doc_schema, parent_id: src.id, created_by: by, created_at: t, updated_at: t, published_at: null, stats: null };
          maps.set(d.id, d);
        }
        return clone(d);
      },
    },
  };
  return repos;
}
