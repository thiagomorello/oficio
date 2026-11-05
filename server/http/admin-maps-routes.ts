// Admin do mapa (A.5): rascunho compartilhado, versões imutáveis, validação (dry-run) e publicação a quente.
// Todas as rotas exigem admin. A publicação segue A.5.1: valida → monta → grava versão/publicada → poda
// mesas no banco → `office.swapMap` (realoca, libera assentos/mesas, avisa os clientes).
import { z } from 'zod';
import { assembleOffice } from '../../shared/map/assemble';
import { buildDefaultMap } from '../../shared/map/default-map';
import { formatZodIssues, mapDocSchema, migrateDoc, MAP_SCHEMA } from '../../shared/map/doc';
import { validateMap, type MapIssue } from '../../shared/map/validate';
import type { Repos } from '../db/repos/index';
import { SETTING_PUBLISHED_MAP_ID } from '../db/repos/settings';
import type { MapRow } from '../db/types';
import type { Office, SwapResult } from '../world/office';
import { statsFromValidation } from '../world/boot-map';
import { DEFAULT_LOCALE, type Locale } from '../../shared/branding';
import { tFor, type ReqTranslator } from '../i18n';
import { HttpError, readJson, sendJson, translateMaybe } from './app';
import type { RouteContext, RouteHandler } from './routes';

/** O doc pode passar de 256 KiB (até 4000 móveis). */
const MAX_DOC_BODY = 4 * 1024 * 1024;

const putDraftBody = z.object({
  doc: z.unknown(),
  /** `updated_at` que o editor viu (ISO); null = espera que não exista rascunho. */
  baseUpdatedAt: z.string().max(64).nullable(),
});

const publishBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    confirmWarnings: z.boolean().optional(),
  })
  .strict();

export type MapRef = 'draft' | number;

export interface PublishResult extends SwapResult {
  id: number;
  version: number;
}

export type PublishOutcome = { ok: true; result: PublishResult } | { ok: false; errors: MapIssue[]; warnings: MapIssue[] };

type MapsDeps = Pick<Repos, 'maps' | 'desks'>;

/** Mensagens da validação do mapa (shared/map/validate) chegam como chaves do i18n ou texto pronto. */
function localizeIssues(issues: MapIssue[], tr: ReqTranslator): MapIssue[] {
  return issues.map((i) => ({ ...i, message: translateMaybe(i.message, tr) }));
}

const rowOut = (r: MapRow) => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  doc: r.doc,
  parent_id: r.parent_id,
  created_by: r.created_by,
  by: r.created_by,
  created_at: r.created_at,
  updated_at: r.updated_at,
  published_at: r.published_at,
  stats: r.stats,
});

async function sourceRow(repos: MapsDeps, ref: MapRef): Promise<MapRow> {
  const row = ref === 'draft' ? await repos.maps.getDraft() : await repos.maps.get(ref);
  if (!row) throw new HttpError(404, ref === 'draft' ? 'server.maps.noDraft' : 'server.maps.notFound');
  return row;
}

/**
 * Sequência de publicação (A.5.1). Exportada para testes. O chamador serializa as chamadas.
 * Rascunho → nova versão (`parent_id = draft.id`) publicada; versão → republicada (rollback).
 */
export async function publishMap(
  repos: MapsDeps,
  office: Office,
  ref: MapRef,
  opts: { name?: string; confirmWarnings?: boolean; by: number | null; /** Idioma do nome automático da versão (opts.name ausente). */ locale?: Locale },
): Promise<PublishOutcome> {
  const row = await sourceRow(repos, ref);
  const v = validateMap(row.doc);
  if (v.errors.length || (v.warnings.length && !opts.confirmWarnings)) return { ok: false, errors: v.errors, warnings: v.warnings };
  const doc = migrateDoc(row.doc);
  const next = assembleOffice(doc, office.layoutVersion + 1);

  let id: number;
  if (row.kind === 'draft') {
    const versions = (await repos.maps.list()).filter((m) => m.kind === 'version').length;
    const ver = await repos.maps.createVersion(doc, opts.name ?? tFor(opts.locale ?? DEFAULT_LOCALE, 'server.maps.versionName', { n: versions + 1 }), row.id, opts.by, statsFromValidation(v), MAP_SCHEMA);
    if (!(await repos.maps.setPublished(ver.id))) {
      await repos.maps.delete(ver.id).catch(() => false);
      throw new HttpError(500, 'server.maps.publishFailed');
    }
    id = ver.id;
  } else {
    if (!(await repos.maps.setPublished(row.id))) throw new HttpError(500, 'server.maps.publishFailed');
    id = row.id;
  }
  await repos.desks.pruneNotIn(next.desks.map((d) => d.id));
  const r = office.swapMap(next, { id });
  return { ok: true, result: { id, version: office.layoutVersion, ...r } };
}

const ROUTE = /^\/api\/admin\/maps(?:\/(draft|default|\d{1,9}))?(?:\/(validate|publish|restore))?$/;

export function createMapRoutes(ctx: RouteContext, office: Office): RouteHandler {
  const { repos, session } = ctx;
  /** Publicações (e restaurações) em fila: nada de duas trocas de mapa entrelaçadas. */
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = chain.then(fn, fn);
    chain = p.catch(() => undefined);
    return p;
  };

  const publishedId = async (): Promise<number | null> => {
    const n = Number.parseInt((await repos.settings.get(SETTING_PUBLISHED_MAP_ID)) ?? '', 10);
    return Number.isFinite(n) ? n : null;
  };

  /** Rascunho atual; se não existe, nasce da versão publicada (ou do mapa em uso). */
  const ensureDraft = async (by: number): Promise<MapRow> => {
    const cur = await repos.maps.getDraft();
    if (cur) return cur;
    const pub = await repos.maps.getPublished();
    if (pub) {
      const r = await repos.maps.restoreToDraft(pub.id, by);
      if (r) return r;
    }
    const s = await repos.maps.saveDraft(office.assembly.doc, null, by, MAP_SCHEMA);
    if (s.ok) return s.row;
    const again = await repos.maps.getDraft();
    if (!again) throw new HttpError(500, 'server.maps.draftCreateFailed');
    return again;
  };

  /** Sobrescreve o rascunho (restaurar padrão), sem checagem de conflito do editor. */
  const overwriteDraft = async (doc: unknown, by: number): Promise<MapRow> => {
    for (let i = 0; i < 3; i++) {
      const cur = await repos.maps.getDraft();
      const s = await repos.maps.saveDraft(doc, cur?.updated_at ?? null, by, MAP_SCHEMA);
      if (s.ok) return s.row;
    }
    throw new HttpError(409, 'server.maps.draftChangedRetry');
  };

  const refOf = (seg: string | undefined): MapRef => {
    if (seg === 'draft') return 'draft';
    const n = Number(seg);
    if (!seg || !Number.isSafeInteger(n) || n <= 0) throw new HttpError(404, 'server.http.notFound');
    return n;
  };

  return async (req, res, url, tr) => {
    const m = ROUTE.exec(url.pathname);
    if (!m) return false;
    const me = await session.requireAdmin(req);
    const method = req.method ?? 'GET';
    const [, seg, action] = m;

    // GET /api/admin/maps
    if (!seg && !action) {
      if (method !== 'GET') throw new HttpError(405, 'server.http.methodNotAllowed');
      const [rows, cur] = await Promise.all([repos.maps.list(), publishedId()]);
      sendJson(res, 200, { current: cur, maps: rows.map((r) => ({ ...r, current: r.id === cur })) });
      return true;
    }

    // POST /api/admin/maps/default
    if (seg === 'default') {
      if (action || method !== 'POST') throw new HttpError(action ? 404 : 405, action ? 'server.http.notFound' : 'server.http.methodNotAllowed');
      sendJson(res, 200, rowOut(await overwriteDraft(buildDefaultMap(tr.locale), me.id)));
      return true;
    }

    if (!action) {
      // /api/admin/maps/draft
      if (seg === 'draft') {
        if (method === 'GET') {
          sendJson(res, 200, rowOut(await ensureDraft(me.id)));
          return true;
        }
        if (method === 'PUT') {
          const b = putDraftBody.safeParse(await readJson(req, MAX_DOC_BODY));
          if (!b.success) throw new HttpError(400, b.error.issues[0]?.message ?? 'server.http.invalidData');
          const doc = mapDocSchema.safeParse(b.data.doc);
          if (!doc.success) {
            sendJson(res, 400, { error: tr.t('server.maps.invalidDocument'), issues: formatZodIssues(doc.error).slice(0, 50) });
            return true;
          }
          let base: Date | null = null;
          if (b.data.baseUpdatedAt !== null) {
            base = new Date(b.data.baseUpdatedAt);
            if (Number.isNaN(base.getTime())) throw new HttpError(400, 'server.maps.invalidBaseUpdatedAt');
          }
          const r = await repos.maps.saveDraft(doc.data, base, me.id, MAP_SCHEMA);
          if (!r.ok) {
            sendJson(res, 409, { error: tr.t('server.maps.draftConflict'), updated_at: r.conflict.updated_at, by: r.conflict.by });
            return true;
          }
          sendJson(res, 200, rowOut(r.row));
          return true;
        }
        throw new HttpError(405, 'server.http.methodNotAllowed');
      }

      // /api/admin/maps/:id
      const id = refOf(seg) as number;
      if (method === 'GET') {
        sendJson(res, 200, rowOut(await sourceRow(repos, id)));
        return true;
      }
      if (method === 'DELETE') {
        const row = await sourceRow(repos, id);
        if (row.id === (await publishedId()) || row.id === office.mapId) throw new HttpError(409, 'server.maps.cannotDeletePublished');
        if (row.kind === 'version') {
          const versions = (await repos.maps.list()).filter((x) => x.kind === 'version').length;
          if (versions <= 1) throw new HttpError(409, 'server.maps.cannotDeleteOnlyVersion');
        }
        await repos.maps.delete(row.id);
        sendJson(res, 200, { ok: true });
        return true;
      }
      throw new HttpError(405, 'server.http.methodNotAllowed');
    }

    if (method !== 'POST') throw new HttpError(405, 'server.http.methodNotAllowed');
    const ref = refOf(seg);

    if (action === 'validate') {
      const row = await sourceRow(repos, ref);
      const v = validateMap(row.doc);
      const preview = v.assembly ? office.relocationPreview(v.assembly) : { moved: 0, releasedSeats: 0, releasedDesks: 0 };
      sendJson(res, 200, {
        errors: localizeIssues(v.errors, tr),
        warnings: localizeIssues(v.warnings, tr),
        stats: statsFromValidation(v),
        wouldMove: preview.moved,
        wouldReleaseSeats: preview.releasedSeats,
        wouldReleaseDesks: preview.releasedDesks,
      });
      return true;
    }

    if (action === 'publish') {
      const b = publishBody.safeParse(await readJson(req));
      if (!b.success) throw new HttpError(400, b.error.issues[0]?.message ?? 'server.http.invalidData');
      const out = await serial(() => publishMap(repos, office, ref, { name: b.data.name, confirmWarnings: b.data.confirmWarnings, by: me.id, locale: tr.locale }));
      if (!out.ok) {
        const msg = tr.t(out.errors.length ? 'server.maps.hasErrors' : 'server.maps.confirmWarnings');
        sendJson(res, 409, { error: msg, errors: localizeIssues(out.errors, tr), warnings: localizeIssues(out.warnings, tr) });
        return true;
      }
      sendJson(res, 200, out.result);
      return true;
    }

    // restore: versão → rascunho
    if (ref === 'draft') throw new HttpError(400, 'server.maps.versionRequired');
    const row = await repos.maps.restoreToDraft(ref, me.id);
    if (!row) throw new HttpError(404, 'server.maps.versionNotFound');
    sendJson(res, 200, rowOut(row));
    return true;
  };
}
