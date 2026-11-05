// Mapa do boot: a versão publicada em office_maps ou, na primeira subida, o mapa padrão gravado como versão publicada.
import { DEFAULT_LOCALE, tFor, type Locale } from '../../shared/i18n';
import { buildDefaultMap } from '../../shared/map/default-map';
import { migrateDoc, type OfficeMapDoc } from '../../shared/map/doc';
import { validateMap, type MapValidation } from '../../shared/map/validate';
import type { Repos } from '../db/repos/index';

export interface BootMap { doc: OfficeMapDoc; id: number }

interface LogLike { info(msg: string): void; warn(msg: string): void; error(msg: string): void }

export function mapStats(doc: OfficeMapDoc): Record<string, unknown> {
  return statsFromValidation(validateMap(doc));
}

/** Mesmas estatísticas de `mapStats`, a partir de uma validação já feita. */
export function statsFromValidation(v: MapValidation): Record<string, unknown> {
  const a = v.assembly;
  return { desks: a?.desks.length ?? 0, seats: a ? a.spots.filter((s) => s.seated).length : 0, zones: a?.zones.length ?? 0, warnings: v.warnings.length, errors: v.errors.length };
}

/** `locale` = idioma padrão da instância: nomes/placas do mapa padrão são dados gravados no banco. */
export async function loadBootMap(repos: Pick<Repos, 'maps'>, log: LogLike, locale: Locale = DEFAULT_LOCALE): Promise<BootMap> {
  let published = null;
  try {
    published = await repos.maps.getPublished();
  } catch (err) {
    log.warn(`Could not read the published map: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (published) {
    try {
      const doc = migrateDoc(published.doc);
      const v = validateMap(doc);
      if (v.errors.length) throw new Error(v.errors.map((e) => e.code).join(', '));
      log.info(`Published map #${published.id} ("${published.name}") loaded.`);
      return { doc, id: published.id };
    } catch (err) {
      log.error(`Published map #${published.id} is invalid (${err instanceof Error ? err.message : String(err)}); using the in-memory default map.`);
      return { doc: buildDefaultMap(locale), id: 0 };
    }
  }
  const doc = buildDefaultMap(locale);
  try {
    const row = await repos.maps.createVersion(doc, tFor(locale, 'map.default.versionName'), null, null, mapStats(doc));
    await repos.maps.setPublished(row.id);
    log.info(`First boot: default map stored as published version #${row.id}.`);
    return { doc, id: row.id };
  } catch (err) {
    log.warn(`Could not store the default map (${err instanceof Error ? err.message : String(err)}); continuing in memory.`);
    return { doc, id: 0 };
  }
}
