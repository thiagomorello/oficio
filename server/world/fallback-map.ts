// Mapa mínimo embutido, usado só quando ninguém injeta um documento (`deps.mapDoc`) e ainda não há
// mapa publicado. O mapa padrão de verdade (`shared/map/default-map.ts`) e o repositório de mapas
// entram em outro pacote.
import { DEFAULT_LOCALE, tFor, type Locale } from '../../shared/i18n';
import { createDocBuilder } from '../../shared/map/doc-builder';
import type { OfficeMapDoc } from '../../shared/map/doc';

/** `locale` = idioma padrão da instância (os rótulos do mapa são dados, gerados num idioma concreto). */
export function fallbackMapDoc(locale: Locale = DEFAULT_LOCALE): OfficeMapDoc {
  const b = createDocBuilder({ w: 24, h: 16 }, tFor(locale, 'map.fallback.name'));
  b.area('hall', { x: 0, y: 0, w: 24, h: 16 }, { name: tFor(locale, 'map.fallback.office'), kind: 'open' });
  b.spawn(11, 8).spawn(12, 8).spawn(11, 9).spawn(12, 9);
  return b.build();
}
