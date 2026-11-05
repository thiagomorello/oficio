import type { Db } from '../pool';
import type { MapListRow, MapRow } from '../types';
import { SETTING_PUBLISHED_MAP_ID } from './settings';
import { date, num, numOrNull, parseJson, toJson } from './util';

export type SaveDraftResult =
  | { ok: true; row: MapRow }
  /** Alguém salvou o rascunho depois de `baseUpdatedAt`. */
  | { ok: false; conflict: { updated_at: Date; by: number | null } };

export interface MapsRepo {
  /** Versão apontada por `published_map_id` (null se não há). */
  getPublished(): Promise<MapRow | null>;
  /** O único rascunho compartilhado (null se não existe). */
  getDraft(): Promise<MapRow | null>;
  /**
   * Grava o rascunho. `baseUpdatedAt` = `updated_at` que o editor viu (null = espera que não exista).
   * Conflito quando o do banco difere.
   */
  saveDraft(doc: unknown, baseUpdatedAt: Date | null, by: number | null, docSchema?: number): Promise<SaveDraftResult>;
  list(): Promise<MapListRow[]>;
  get(id: number): Promise<MapRow | null>;
  /** Cria uma versão imutável (ainda não publicada). */
  createVersion(doc: unknown, name: string, parentId: number | null, by: number | null, stats: Record<string, unknown> | null, docSchema?: number): Promise<MapRow>;
  /** Marca `published_at = agora` e aponta `published_map_id`. false se não existe ou é rascunho. */
  setPublished(id: number): Promise<boolean>;
  /** Apaga uma linha (versão ou rascunho). A regra "não a atual nem a última" fica na rota. */
  delete(id: number): Promise<boolean>;
  /** Copia o doc de uma versão para o rascunho (cria ou sobrescreve). */
  restoreToDraft(id: number, by: number | null): Promise<MapRow | null>;
}

export function mapFromDb(r: Record<string, unknown>): MapRow {
  return {
    id: num(r.id),
    kind: r.kind === 'draft' ? 'draft' : 'version',
    name: String(r.name),
    doc: parseJson<unknown>(r.doc),
    doc_schema: num(r.doc_schema),
    parent_id: numOrNull(r.parent_id),
    created_by: numOrNull(r.created_by),
    created_at: date(r.created_at) ?? new Date(0),
    updated_at: date(r.updated_at) ?? new Date(0),
    published_at: date(r.published_at),
    stats: parseJson<Record<string, unknown>>(r.stats),
  };
}

export function createMysqlMapsRepo(db: Db): MapsRepo {
  const get = async (id: number): Promise<MapRow | null> => {
    const rows = await db.query<Record<string, unknown>>('SELECT * FROM office_maps WHERE id = ? LIMIT 1', [id]);
    return rows[0] ? mapFromDb(rows[0]) : null;
  };
  return {
    get,

    async getPublished() {
      const rows = await db.query<{ v: string }>('SELECT v FROM office_settings WHERE k = ? LIMIT 1', [SETTING_PUBLISHED_MAP_ID]);
      const id = Number.parseInt(rows[0]?.v ?? '', 10);
      return Number.isFinite(id) ? get(id) : null;
    },

    async getDraft() {
      const rows = await db.query<Record<string, unknown>>("SELECT * FROM office_maps WHERE kind = 'draft' ORDER BY id LIMIT 1");
      return rows[0] ? mapFromDb(rows[0]) : null;
    },

    saveDraft: (doc, baseUpdatedAt, by, docSchema = 1) =>
      db.tx(async (t): Promise<SaveDraftResult> => {
        const cur = await t.query<Record<string, unknown>>("SELECT * FROM office_maps WHERE kind = 'draft' ORDER BY id LIMIT 1 FOR UPDATE");
        const fetch = async (id: number): Promise<MapRow> => {
          const r = await t.query<Record<string, unknown>>('SELECT * FROM office_maps WHERE id = ?', [id]);
          return mapFromDb(r[0]!);
        };
        if (!cur[0]) {
          if (baseUpdatedAt !== null) return { ok: false, conflict: { updated_at: new Date(0), by: null } };
          const res = await t.exec("INSERT INTO office_maps (kind, name, doc, doc_schema, created_by) VALUES ('draft', 'Rascunho', ?, ?, ?)", [toJson(doc), docSchema, by]);
          return { ok: true, row: await fetch(res.insertId) };
        }
        const row = mapFromDb(cur[0]);
        if (baseUpdatedAt === null || row.updated_at.getTime() !== baseUpdatedAt.getTime()) {
          return { ok: false, conflict: { updated_at: row.updated_at, by: row.created_by } };
        }
        // created_by guarda quem salvou por último o rascunho (usado no 409 {updated_at, by})
        await t.exec('UPDATE office_maps SET doc = ?, doc_schema = ?, created_by = ?, updated_at = ? WHERE id = ?', [toJson(doc), docSchema, by, new Date(), row.id]);
        return { ok: true, row: await fetch(row.id) };
      }),

    async list() {
      const rows = await db.query<Record<string, unknown>>(
        'SELECT id, kind, name, doc_schema, parent_id, created_by, created_at, updated_at, published_at, stats FROM office_maps ORDER BY (kind = \'draft\') DESC, id DESC',
      );
      return rows.map((r) => {
        const { doc: _doc, ...rest } = mapFromDb({ ...r, doc: null });
        return rest;
      });
    },

    async createVersion(doc, name, parentId, by, stats, docSchema = 1) {
      const res = await db.exec("INSERT INTO office_maps (kind, name, doc, doc_schema, parent_id, created_by, stats) VALUES ('version', ?, ?, ?, ?, ?, ?)", [
        name.slice(0, 120),
        toJson(doc),
        docSchema,
        parentId,
        by,
        toJson(stats),
      ]);
      const row = await get(res.insertId);
      if (!row) throw new Error('map not found after insert');
      return row;
    },

    setPublished: (id) =>
      db.tx(async (t) => {
        const rows = await t.query<{ kind: string }>('SELECT kind FROM office_maps WHERE id = ? FOR UPDATE', [id]);
        if (!rows[0] || rows[0].kind !== 'version') return false;
        await t.exec('UPDATE office_maps SET published_at = ? WHERE id = ?', [new Date(), id]);
        await t.exec('INSERT INTO office_settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)', [SETTING_PUBLISHED_MAP_ID, String(id)]);
        return true;
      }),

    async delete(id) {
      const res = await db.exec('DELETE FROM office_maps WHERE id = ?', [id]);
      return res.affectedRows > 0;
    },

    restoreToDraft: (id, by) =>
      db.tx(async (t) => {
        const src = await t.query<Record<string, unknown>>("SELECT * FROM office_maps WHERE id = ? AND kind = 'version'", [id]);
        if (!src[0]) return null;
        const s = mapFromDb(src[0]);
        const cur = await t.query<{ id: number }>("SELECT id FROM office_maps WHERE kind = 'draft' ORDER BY id LIMIT 1 FOR UPDATE");
        let draftId: number;
        if (cur[0]) {
          draftId = num(cur[0].id);
          await t.exec('UPDATE office_maps SET doc = ?, doc_schema = ?, parent_id = ?, created_by = ?, updated_at = ? WHERE id = ?', [toJson(s.doc), s.doc_schema, s.id, by, new Date(), draftId]);
        } else {
          const res = await t.exec("INSERT INTO office_maps (kind, name, doc, doc_schema, parent_id, created_by) VALUES ('draft', 'Rascunho', ?, ?, ?, ?)", [toJson(s.doc), s.doc_schema, s.id, by]);
          draftId = res.insertId;
        }
        const r = await t.query<Record<string, unknown>>('SELECT * FROM office_maps WHERE id = ?', [draftId]);
        return mapFromDb(r[0]!);
      }),
  };
}
