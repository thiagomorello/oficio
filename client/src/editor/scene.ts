// Cache de montagem do editor. `areaToLayout` é recalculado só para as áreas cujo objeto mudou (as
// operações fazem cópia-na-escrita), então o `StaticScene` reconstrói só os canvases dessas áreas.
// A montagem completa (grade, zonas, mesas) e a validação são preguiçosas e memoizadas por documento.
import { areaToLayout, assembleOffice } from '../../../shared/map/assemble';
import type { MapArea, OfficeMapDoc } from '../../../shared/map/doc';
import type { AreaLayout, OfficeAssembly } from '../../../shared/map/types';
import { validateMap, type MapValidation } from '../../../shared/map/validate';
import { getLocale, t } from '../i18n';
import { buildFootprintIndex, type FootprintIndex } from './hit';

export interface MapCounts {
  desks: number;
  seats: number;
  zones: number;
  areas: number;
  furniture: number;
}

export class EditorScene {
  private layoutOf = new WeakMap<MapArea, AreaLayout>();
  private doc: OfficeMapDoc | null = null;
  private hiddenKey = '';
  /** Layouts das áreas visíveis (identidade estável para áreas inalteradas). */
  layouts: AreaLayout[] = [];
  /** Muda a cada `update` que altera `layouts`. */
  version = 0;
  index: FootprintIndex = new Map();
  /** Quantas áreas tiveram o layout recalculado no último `update`. */
  rebuilt = 0;
  private asm: { doc: OfficeMapDoc; value: OfficeAssembly | null } | null = null;
  private val: { doc: OfficeMapDoc; value: MapValidation } | null = null;

  /** Sincroniza com o documento; devolve true se algo mudou. */
  update(doc: OfficeMapDoc, hidden: ReadonlySet<string>): boolean {
    const hk = [...hidden].sort().join(',');
    if (doc === this.doc && hk === this.hiddenKey) return false;
    this.doc = doc;
    this.hiddenKey = hk;
    this.rebuilt = 0;
    const out: AreaLayout[] = [];
    for (const a of doc.areas) {
      if (hidden.has(a.id)) continue;
      let l = this.layoutOf.get(a);
      if (!l) {
        try {
          l = areaToLayout(a);
        } catch {
          continue;
        }
        this.layoutOf.set(a, l);
        this.rebuilt++;
      }
      out.push(l);
    }
    this.layouts = out;
    this.index = buildFootprintIndex(doc, hidden);
    this.version++;
    return true;
  }

  /** Montagem completa do documento atual (null se o documento não monta). */
  assembly(): OfficeAssembly | null {
    const doc = this.doc;
    if (!doc) return null;
    if (this.asm?.doc === doc) return this.asm.value;
    let value: OfficeAssembly | null = null;
    try {
      value = assembleOffice(doc, 0);
    } catch {
      value = null;
    }
    this.asm = { doc, value };
    return value;
  }

  /** Validação do documento atual (memoizada). */
  validation(): MapValidation | null {
    const doc = this.doc;
    if (!doc) return null;
    if (this.val?.doc === doc) return this.val.value;
    let value: MapValidation;
    try {
      value = validateMap(doc, getLocale());
    } catch (e) {
      const params = { error: e instanceof Error ? e.message : String(e) };
      value = { errors: [{ code: 'schema', severity: 'error', message: t('map.validate.failed', params), key: 'map.validate.failed', params }], warnings: [], assembly: null };
    }
    this.val = { doc, value };
    return value;
  }

  /** Já validou o documento atual? */
  get validated(): boolean {
    return !!this.doc && this.val?.doc === this.doc;
  }

  counts(): MapCounts {
    const a = this.assembly();
    const doc = this.doc;
    return {
      desks: a?.desks.length ?? 0,
      seats: a ? a.spots.filter((s) => s.seated).length : 0,
      zones: doc?.zones.length ?? 0,
      areas: doc?.areas.length ?? 0,
      furniture: doc ? doc.areas.reduce((n, x) => n + x.furniture.length, 0) : 0,
    };
  }
}
