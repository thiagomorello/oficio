// Mapa do escritório: GET /api/map ({id, version, doc}) com ETag/If-None-Match e cache em
// localStorage['office.map']. Sem servidor (ou sem a rota), usa o cache ou o mapa de exemplo.
import { assembleOffice } from '../../../shared/map/assemble';
import { migrateDoc, type OfficeMapDoc } from '../../../shared/map/doc';
import type { OfficeAssembly } from '../../../shared/map/types';
import { buildDefaultMap } from '../../../shared/map/default-map';

export const MAP_CACHE_KEY = 'office.map';

export interface LoadedMap {
  id: number;
  version: number;
  etag: string | null;
  doc: OfficeMapDoc;
  assembly: OfficeAssembly;
  source: 'server' | 'cache' | 'sample';
}

interface CachedMap {
  id: number;
  version: number;
  etag: string | null;
  doc: unknown;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readCache(): CachedMap | null {
  try {
    const raw = storage()?.getItem(MAP_CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as CachedMap;
    return c && typeof c.id === 'number' && typeof c.version === 'number' && c.doc ? c : null;
  } catch {
    return null;
  }
}

function writeCache(c: CachedMap): void {
  try {
    storage()?.setItem(MAP_CACHE_KEY, JSON.stringify(c));
  } catch {
    // cota cheia ou armazenamento bloqueado: segue sem cache
  }
}

function finish(id: number, version: number, etag: string | null, raw: unknown, source: LoadedMap['source']): LoadedMap {
  const doc = migrateDoc(raw);
  return { id, version, etag, doc, assembly: assembleOffice(doc, version), source };
}

/** Mapa de exemplo (desenvolvimento sem servidor). */
export function sampleMap(): LoadedMap {
  // Sem servidor: o mapa padrão real do escritório (o de exemplo fica só para testes).
  const doc = buildDefaultMap();
  return { id: 0, version: 0, etag: null, doc, assembly: assembleOffice(doc, 0), source: 'sample' };
}

/**
 * Carrega o mapa publicado. `want` (do `welcome`/`map`) evita a requisição quando o cache já é
 * daquela versão. Nunca rejeita: em último caso devolve o mapa de exemplo.
 */
export async function loadMap(want?: { id: number; version: number }, fetcher: typeof fetch = (...a) => fetch(...a)): Promise<LoadedMap> {
  const cached = readCache();
  if (cached && want && cached.id === want.id && cached.version === want.version) {
    try {
      return finish(cached.id, cached.version, cached.etag, cached.doc, 'cache');
    } catch {
      // cache inválido: busca de novo
    }
  }
  try {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (cached?.etag) headers['if-none-match'] = cached.etag;
    const res = await fetcher('/api/map', { headers, credentials: 'same-origin', cache: 'no-cache' });
    if (res.status === 304 && cached) return finish(cached.id, cached.version, cached.etag, cached.doc, 'cache');
    if (res.ok && (res.headers.get('content-type') ?? '').includes('json')) {
      const body = (await res.json()) as { id: number; version: number; doc: unknown };
      const etag = res.headers.get('etag');
      const out = finish(body.id, body.version, etag, body.doc, 'server');
      writeCache({ id: body.id, version: body.version, etag, doc: body.doc });
      return out;
    }
  } catch (err) {
    console.warn('[mapa] GET /api/map falhou', err);
  }
  if (cached) {
    try {
      return finish(cached.id, cached.version, cached.etag, cached.doc, 'cache');
    } catch {
      // segue para o exemplo
    }
  }
  return sampleMap();
}
