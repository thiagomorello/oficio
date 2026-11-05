// Paletas por estilo e seletor de cores (`.of-swatch`, com cor personalizada via <input type=color> oculto).
import { HAIR_BRAND, JACKET_COLORS, LIGHT_ACCENTS, SHIRT_COLORS, TIE_COLORS, TOP_COLORS } from '../../../../shared/validate/appearance-options';
import { isFreeColor } from '../../../../shared/validate/appearance';
import { t } from '../../i18n';
import { h } from '../dom';

export const BRAND_COLORS: readonly string[] = HAIR_BRAND;

/** Cores da peça de cima conforme o estilo. */
export function topColorsFor(style: string): readonly string[] {
  if (style === 'shirt_tie') return SHIRT_COLORS;
  if (style === 'jacket') return JACKET_COLORS;
  return TOP_COLORS;
}

/** Cores do detalhe (gravata, listra, camisa por baixo...) conforme o estilo. */
export function accentColorsFor(style: string): readonly string[] {
  if (style === 'shirt_tie') return TIE_COLORS;
  return [...new Set<string>([...LIGHT_ACCENTS, ...TOP_COLORS])];
}

export interface SwatchGroup {
  label: string;
  colors: readonly string[];
}

export interface ColorPickerOpts {
  /** Chave base para `data-k` (restaurar o foco após redesenhar). */
  key: string;
  groups: readonly SwatchGroup[];
  value: string;
  /** `quiet`: alteração contínua do seletor nativo (não redesenhar o painel). */
  onPick(color: string, quiet?: boolean): void;
  /** Permite cor livre (hex). `onPick` só é chamado com cores válidas (luminância). */
  custom?: boolean;
}

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

export function swatchButton(color: string, selected: boolean, key: string, onClick: () => void, title?: string): HTMLButtonElement {
  const b = h('button', {
    class: 'of-swatch' + (selected ? ' is-selected' : ''),
    type: 'button',
    title: title ?? color,
    style: `--swatch:${color}`,
    attrs: { 'aria-pressed': selected ? 'true' : 'false', 'aria-label': title ?? color, 'data-k': key },
    on: { click: onClick },
  });
  if (selected) b.append(h('span', { class: 'of-swatch__check', text: '✓', attrs: { 'aria-hidden': 'true' } }));
  return b;
}

export function colorPicker(o: ColorPickerOpts): HTMLElement {
  const root = h('div', { class: 'of-colors' });
  const inGroups = o.groups.some((g) => g.colors.some((c) => same(c, o.value)));
  for (const g of o.groups) {
    if (g.colors.length === 0) continue;
    const row = h('div', { class: 'of-swatches', role: 'group', attrs: { 'aria-label': g.label } });
    for (const c of g.colors) row.append(swatchButton(c, same(c, o.value), `${o.key}:${c}`, () => o.onPick(c)));
    root.append(h('div', { class: 'of-colors__group' }, o.groups.length > 1 || o.custom ? h('div', { class: 'of-colors__label', text: g.label }) : null, row));
  }
  if (o.custom) {
    const hint = h('div', { class: 'of-colors__hint', hidden: true, text: t('avatar.color.outOfRange') });
    const input = h('input', { type: 'color', class: 'of-swatch__input', tabIndex: -1, attrs: { 'aria-label': t('avatar.color.custom'), 'data-k': `${o.key}:custom` } });
    input.value = /^#[0-9a-f]{6}$/i.test(o.value) ? o.value.toLowerCase() : '#888888';
    const isCustom = !inGroups;
    const label = h(
      'label',
      { class: 'of-swatch of-swatch--custom' + (isCustom ? ' is-selected' : ''), title: t('avatar.color.custom'), style: `--swatch:${isCustom ? o.value : 'transparent'}` },
      isCustom
        ? h('span', { class: 'of-swatch__check', text: '✓', attrs: { 'aria-hidden': 'true' } })
        : h('span', { class: 'of-swatch__plus', text: '+', attrs: { 'aria-hidden': 'true' } }),
      input,
    );
    const apply = (quiet: boolean): void => {
      const v = input.value.toLowerCase();
      hint.hidden = isFreeColor(v);
      if (!hint.hidden) return;
      label.style.setProperty('--swatch', v);
      o.onPick(v, quiet);
    };
    input.addEventListener('input', () => apply(true));
    input.addEventListener('change', () => apply(false));
    root.append(h('div', { class: 'of-colors__group' }, h('div', { class: 'of-colors__label', text: t('avatar.color.customGroup') }), h('div', { class: 'of-swatches' }, label), hint));
  }
  return root;
}
