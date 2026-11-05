// Paleta: carimbos, móveis por categoria (miniaturas dos sprites), itens de parede, pisos, tapetes e
// pontos. Clicar escolhe o modo; a parte de baixo mostra os parâmetros do modo ativo (variante, tint...).
import type { ArtModule } from '../../art/api';
import { FURNITURE, type FurnitureKind } from '../../../../shared/map/furniture';
import { FLOORS, FLOOR_TINT_K, RUGS } from '../../../../shared/map/palette';
import { t } from '../../i18n';
import { h } from '../../ui/dom';
import type { EditorCtx } from '../context';
import { FLOOR_KINDS, floorLabel, floorPresetLabel, furnitureLabel, PALETTE_GROUPS, spotLabel } from '../labels';
import { STAMPS } from '../stamps-ui';
import type { Mode } from '../state';
import { colorInput, row, section, selectInput } from './ui';

const thumbs = new Map<string, HTMLCanvasElement>();

/** Miniatura (40×40) do sprite de um móvel/item. */
export function thumbnail(art: ArtModule, kind: FurnitureKind, variant?: string, size = 40): HTMLCanvasElement {
  const key = `${kind}:${variant ?? ''}:${size}`;
  const hit = thumbs.get(key);
  if (hit) return copyCanvas(hit);
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  c.className = 'med-thumb';
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  try {
    const s = art.furnitureSprites(kind, variant, 0, { seed: 7 });
    const src = s.base.canvas;
    const k = Math.min(size / src.width, size / src.height);
    const scale = k >= 1 ? Math.floor(k) : k;
    const w = src.width * scale;
    const hh = src.height * scale;
    g.drawImage(src, Math.round((size - w) / 2), Math.round((size - hh) / 2), w, hh);
    if (s.front) g.drawImage(s.front.canvas, Math.round((size - w) / 2 + (s.base.ax - s.front.ax) * scale), Math.round((size - hh) / 2 + (s.base.ay - s.front.ay) * scale), s.front.canvas.width * scale, s.front.canvas.height * scale);
  } catch {
    g.fillStyle = '#33333a';
    g.fillRect(8, 8, size - 16, size - 16);
  }
  thumbs.set(key, c);
  return copyCanvas(c);
}

function copyCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  c.className = src.className;
  c.getContext('2d')?.drawImage(src, 0, 0);
  return c;
}

export interface Palette {
  el: HTMLElement;
  /** Atualiza destaques e os parâmetros do modo. */
  refresh(): void;
}

export function createPalette(ctx: EditorCtx): Palette {
  const el = h('div', { class: 'med-palette' });
  const params = h('div', { class: 'med-params' });
  const items: { btn: HTMLElement; match: (m: Mode) => boolean }[] = [];

  const item = (label: string, title: string, visual: Node | null, mode: () => Mode, match: (m: Mode) => boolean): HTMLElement => {
    const btn = h('button', { class: 'med-item', type: 'button', title, attrs: { 'aria-pressed': 'false' } }, visual, h('span', { class: 'med-item__label', text: label }));
    btn.addEventListener('click', () => ctx.setMode(mode()));
    items.push({ btn, match });
    return btn;
  };

  // carimbos
  const stamps = h('div', { class: 'med-grid med-grid--wide' });
  for (const s of STAMPS) {
    stamps.append(item(t(s.label), t(s.hint), null, () => ({ k: 'stamp', stamp: s.spec }), (m) => m.k === 'stamp' && m.stamp.kind === s.spec.kind && m.stamp.size === s.spec.size));
  }
  el.append(section(t('editor.palette.stamps'), stamps));

  // móveis e parede
  for (const grp of PALETTE_GROUPS) {
    const grid = h('div', { class: 'med-grid' });
    for (const kind of grp.kinds) {
      const def = FURNITURE[kind];
      const v0 = def.variants?.[0];
      const size = grp.wall ? t('editor.palette.wallTiles', { n: def.footprint.w }) : `${def.footprint.w}×${def.footprint.h}`;
      grid.append(
        item(
          furnitureLabel(kind),
          `${furnitureLabel(kind)} · ${size}`,
          thumbnail(ctx.art, kind, v0),
          () => {
            const prev = ctx.state.prefs;
            if (grp.wall) return { k: 'wallItem', kind, variant: prev.wallItem.kind === kind ? prev.wallItem.variant : v0 };
            return { k: 'place', kind, variant: prev.place.kind === kind ? prev.place.variant : v0 };
          },
          (m) => (grp.wall ? m.k === 'wallItem' : m.k === 'place') && 'kind' in m && m.kind === kind,
        ),
      );
    }
    el.append(section(t(grp.title), grid));
  }

  // pisos
  const floorGrid = h('div', { class: 'med-grid med-grid--wide' });
  for (const [key, preset] of Object.entries(FLOORS)) {
    const sw = h('span', { class: 'med-swatch', style: `background:${preset.tint ?? '#c9d1dc'}` });
    floorGrid.append(
      item(floorPresetLabel(key), `${floorLabel(preset.kind)} ${preset.tint ?? ''}`, sw, () => ({ k: 'floor', kind: preset.kind, tint: preset.tint, tint2: 'tint2' in preset ? preset.tint2 : undefined, tintK: 'tintK' in preset ? preset.tintK : undefined, brush: ctx.state.prefs.floor.brush }), (m) => m.k === 'floor' && m.kind === preset.kind && m.tint === preset.tint),
    );
  }
  floorGrid.append(item(t('editor.palette.eraser'), t('editor.palette.eraseFloor'), h('span', { class: 'med-swatch med-swatch--erase' }), () => ({ ...ctx.state.prefs.floor, k: 'floor', kind: 'erase' }), (m) => m.k === 'floor' && m.kind === 'erase'));
  el.append(section(t('editor.palette.floors'), floorGrid));

  // tapetes
  const rugGrid = h('div', { class: 'med-grid med-grid--wide' });
  for (const [key, color] of Object.entries(RUGS)) {
    rugGrid.append(item(t('editor.palette.rug', { name: key }), color, h('span', { class: 'med-swatch', style: `background:${color}` }), () => ({ k: 'rug', color }), (m) => m.k === 'rug' && m.color === color));
  }
  el.append(section(t('editor.palette.rugs'), rugGrid));

  // pontos
  const spotGrid = h('div', { class: 'med-grid med-grid--wide' });
  for (const kind of ['talk', 'stand', 'watch'] as const) {
    spotGrid.append(item(spotLabel(kind), t('editor.palette.spot', { kind }), h('span', { class: 'med-dot' }), () => ({ k: 'spot', kind }), (m) => m.k === 'spot' && m.kind === kind));
  }
  el.append(section(t('editor.palette.spots'), spotGrid));

  const wrap = h('div', { class: 'med-palette-wrap' }, params, el);

  function renderParams(): void {
    const m = ctx.state.mode;
    params.replaceChildren();
    if (m.k === 'place' || m.k === 'wallItem') {
      const variants = FURNITURE[m.kind].variants;
      params.append(h('div', { class: 'med-params__head' }, thumbnail(ctx.art, m.kind, m.variant, 48), h('strong', { text: furnitureLabel(m.kind) })));
      if (variants?.length) params.append(row(t('editor.palette.variant'), selectInput(m.variant ?? variants[0], variants.map((v) => [v, v] as const), (v) => ctx.setMode({ ...m, variant: v }))));
      params.append(h('p', { class: 'med-hint', text: m.k === 'place' ? t('editor.palette.placeHint') : t('editor.palette.wallHint') }));
    } else if (m.k === 'floor') {
      params.append(h('div', { class: 'med-params__head' }, h('strong', { text: m.kind === 'erase' ? t('editor.palette.floorEraser') : t('editor.palette.floorKind', { kind: floorLabel(m.kind) }) })));
      if (m.kind !== 'erase') {
        params.append(row(t('editor.palette.type'), selectInput(m.kind, FLOOR_KINDS.map((k) => [k, floorLabel(k)] as const), (v) => ctx.setMode({ ...m, kind: v }))));
        params.append(row(t('editor.palette.tint'), colorInput(m.tint, (v) => ctx.setMode({ ...m, tint: v }), { clearable: true })));
        if (m.kind === 'carpet') params.append(row(t('editor.palette.tint2'), colorInput(m.tint2, (v) => ctx.setMode({ ...m, tint2: v }), { clearable: true })));
        else {
          const k = h('input', { class: 'med-range', type: 'range', attrs: { min: 0, max: 1, step: 0.05 } });
          k.value = String(m.tintK ?? FLOOR_TINT_K);
          k.addEventListener('change', () => ctx.setMode({ ...m, tintK: Number(k.value) }));
          params.append(row(t('editor.palette.tintK', { pct: Math.round((m.tintK ?? FLOOR_TINT_K) * 100) }), k));
        }
      }
      params.append(row(t('editor.palette.brush'), selectInput(m.brush, [['rect', t('editor.palette.brushRect')], ['tile', t('editor.palette.brushTile')]] as const, (v) => ctx.setMode({ ...m, brush: v }))));
    } else if (m.k === 'rug') {
      params.append(row(t('editor.palette.rugColor'), colorInput(m.color, (v) => v && ctx.setMode({ k: 'rug', color: v }))), h('p', { class: 'med-hint', text: t('editor.palette.rugHint') }));
    } else if (m.k === 'stamp') {
      params.append(h('p', { class: 'med-hint', text: t('editor.palette.stampHint') }));
    } else if (m.k === 'spot') {
      params.append(h('p', { class: 'med-hint', text: m.kind === 'talk' ? t('editor.palette.talkHint') : t('editor.palette.spotHint') }));
    }
    params.hidden = !params.childElementCount;
  }

  let lastMode = '';
  return {
    el: wrap,
    refresh() {
      const m = ctx.state.mode;
      const key = JSON.stringify(m);
      if (key === lastMode) return;
      lastMode = key;
      for (const it of items) {
        const on = it.match(m);
        it.btn.classList.toggle('is-active', on);
        it.btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
      renderParams();
    },
  };
}
