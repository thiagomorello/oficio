// Camadas: lista de áreas (mostrar/ocultar, clique seleciona e centraliza) e de zonas.
import { t } from '../../i18n';
import { h } from '../../ui/dom';
import type { EditorCtx } from '../context';
import { areaKindLabel, zoneKindLabel } from '../labels';
import { refBounds } from '../geometry';
import { ZONE_COLORS } from '../view';
import { section } from './ui';

export interface LayersPanel {
  el: HTMLElement;
  refresh(): void;
}

export function createLayers(ctx: EditorCtx): LayersPanel {
  const el = h('div', { class: 'med-layers' });
  let lastKey = '';

  function render(): void {
    const doc = ctx.doc();
    const st = ctx.state;
    const selected = new Set(st.selection.map((r) => (r.t === 'area' || r.t === 'zone' ? `${r.t}:${r.id}` : '')));
    const areas = h('ul', { class: 'med-list' });
    for (const a of doc.areas) {
      const hidden = st.hiddenAreas.has(a.id);
      const toggle = hidden ? t('editor.layers.show') : t('editor.layers.hide');
      const eye = h('button', { class: `med-eye${hidden ? ' is-off' : ''}`, type: 'button', title: toggle, text: hidden ? '○' : '●', attrs: { 'aria-label': `${toggle} ${a.name}`, 'aria-pressed': !hidden } });
      eye.addEventListener('click', () => {
        if (hidden) st.hiddenAreas.delete(a.id);
        else st.hiddenAreas.add(a.id);
        st.changed();
      });
      const name = h(
        'button',
        { class: `med-list__name${selected.has(`area:${a.id}`) ? ' is-active' : ''}`, type: 'button' },
        h('span', { text: a.name }),
        h('small', { text: t('editor.layers.areaInfo', { kind: areaKindLabel(a.kind), w: a.rect.w, h: a.rect.h, n: a.furniture.length }) }),
      );
      name.addEventListener('click', () => {
        ctx.select([{ t: 'area', id: a.id }]);
        ctx.centerOn(a.rect);
      });
      areas.append(h('li', { class: hidden ? 'is-hidden' : '' }, eye, name));
    }
    const zones = h('ul', { class: 'med-list' });
    for (const z of doc.zones) {
      const sw = h('span', { class: 'med-swatch med-swatch--sm', style: `background:${z.color ?? ZONE_COLORS[z.kind] ?? '#c8c5ca'}` });
      const info = `${zoneKindLabel(z.kind)}${z.private ? t('editor.layers.private') : ''}${z.lockable ? t('editor.layers.lockable') : ''}${z.capacity ? t('editor.layers.seats', { n: z.capacity }) : ''}`;
      const name = h('button', { class: `med-list__name${selected.has(`zone:${z.id}`) ? ' is-active' : ''}`, type: 'button' }, h('span', { text: z.name }), h('small', { text: info }));
      name.addEventListener('click', () => {
        ctx.setMode({ k: 'zone', id: z.id });
        ctx.select([{ t: 'zone', id: z.id }]);
        const b = refBounds(ctx.doc(), { t: 'zone', id: z.id });
        if (b) ctx.centerOn(b);
      });
      zones.append(h('li', {}, sw, name));
    }
    const showAll = h('button', { class: 'of-btn of-btn--transparent of-btn--sm', type: 'button', text: t('editor.layers.showAll') });
    showAll.disabled = !st.hiddenAreas.size;
    showAll.addEventListener('click', () => {
      st.hiddenAreas.clear();
      st.changed();
    });
    const newZone = h('button', { class: 'of-btn of-btn--transparent of-btn--sm', type: 'button', text: t('editor.layers.newZone') });
    newZone.addEventListener('click', () => {
      ctx.setMode({ k: 'zone', id: null });
      ctx.select([]);
    });
    el.replaceChildren(section(t('editor.layers.areas', { n: doc.areas.length }), showAll, areas), section(t('editor.layers.zones', { n: doc.zones.length }), newZone, zones));
  }

  return {
    el,
    refresh() {
      const st = ctx.state;
      const key = [doc_id(ctx), [...st.hiddenAreas].join(','), st.selection.map((r) => JSON.stringify(r)).join('|')].join('::');
      if (key === lastKey) return;
      lastKey = key;
      render();
    },
  };
}

const ids = new WeakMap<object, number>();
let seq = 0;
/** Identidade do documento (muda a cada alteração). */
function doc_id(ctx: EditorCtx): number {
  const d = ctx.doc();
  let n = ids.get(d);
  if (n === undefined) ids.set(d, (n = ++seq));
  return n;
}
