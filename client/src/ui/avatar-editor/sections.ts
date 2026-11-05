// Seções (abas) do montador. Constroem o DOM a partir do rascunho; as listas vêm de appearance-options,
// então novas opções (tranças, hijab, vestido...) aparecem sozinhas quando entram nas listas.
import {
  ACCESSORIES,
  ACC_COLORS,
  BOTTOM_COLORS,
  BOTTOM_STYLES,
  EYES,
  FACIAL_HAIR,
  HAIR_FUN,
  HAIR_NATURAL_COLORS,
  HAIR_STYLES,
  HAIR_W,
  LANYARDS,
  LANYARD_DEFAULT,
  MAKEUP,
  SHOE_COLORS,
  SKINS,
  TOP_STYLES,
} from '../../../../shared/validate/appearance-options';
import { findIncompatibility } from '../../../../shared/validate/appearance';
import { hasMessage } from '../../../../shared/i18n';
import type { Appearance, ArtModule } from '../../art/api';
import { t } from '../../i18n';
import { h } from '../dom';
import { PRESETS, type Preset } from './presets';
import type { SectionId } from './random';
import { BRAND_COLORS, accentColorsFor, colorPicker, swatchButton, topColorsFor } from './swatches';
import { thumbCanvas } from './thumbs';

export interface SectionCtx {
  art: ArtModule;
  draft: Appearance;
  /** Estado de UI que sobrevive aos redesenhos. */
  ui: { showMoreFacial: boolean };
  /** Aplica campos ao rascunho (passa por normalizeAppearance). `quiet`: não redesenhar o painel. */
  set(patch: Record<string, unknown>, quiet?: boolean): void;
  applyPreset(p: Preset): void;
  rerender(): void;
}

export const SECTION_ORDER: readonly SectionId[] = ['body', 'face', 'hair', 'top', 'bottom', 'shoes', 'accessories', 'badge'];
/** Nome da aba no idioma atual (`avatar.section.<id>`). */
export const sectionLabel = (id: SectionId): string => t(`avatar.section.${id}`);

/**
 * Rótulo de uma opção: a chave é `avatar.<grupo>.<id>` (hair, top, bottom, acc, facial, makeup, incompat).
 * Opção nova sem mensagem cadastrada aparece pelo próprio id, para não sumir da tela.
 */
const label = (group: 'hair' | 'top' | 'bottom' | 'acc' | 'facial' | 'makeup', k: string): string => {
  const key = `avatar.${group}.${k}`;
  return hasMessage(key) ? t(key) : k;
};
export const accessoryLabel = (k: string): string => label('acc', k);
/** Texto da regra de incompatibilidade (`avatar.incompat.<id>`), com fallback genérico. */
const incompatText = (id: string): string => {
  const key = `avatar.incompat.${id}`;
  return hasMessage(key) ? t(key) : t('avatar.incompat.generic');
};

// ------------------------------------------------------------------ peças reutilizáveis

function chip(text: string, selected: boolean, key: string, onClick: () => void, o: { disabled?: boolean; title?: string } = {}): HTMLButtonElement {
  return h('button', {
    class: 'of-chip' + (selected ? ' is-selected' : ''),
    type: 'button',
    text,
    title: o.title,
    attrs: { 'aria-pressed': selected ? 'true' : 'false', 'aria-disabled': o.disabled ? 'true' : undefined, 'data-k': key },
    on: { click: () => { if (!o.disabled) onClick(); } },
  });
}

function optionCard(canvas: HTMLCanvasElement | null, text: string, selected: boolean, key: string, onClick: () => void, o: { disabled?: boolean; title?: string } = {}): HTMLButtonElement {
  return h(
    'button',
    {
      class: 'of-opt' + (selected ? ' is-selected' : '') + (o.disabled ? ' is-disabled' : ''),
      type: 'button',
      title: o.title ?? text,
      attrs: { 'aria-pressed': selected ? 'true' : 'false', 'aria-disabled': o.disabled ? 'true' : undefined, 'data-k': key },
      on: { click: () => { if (!o.disabled) onClick(); } },
    },
    canvas ? h('span', { class: 'of-opt__thumb' }, canvas) : null,
    h('span', { class: 'of-opt__label', text }),
  );
}

function field(title: string, ...children: (Node | null)[]): HTMLElement {
  return h('div', { class: 'of-field' }, h('h3', { class: 'of-field__title', text: title }), ...children);
}

function swatchRow(colors: readonly string[], value: string, key: string, onPick: (c: string) => void): HTMLElement {
  return h('div', { class: 'of-swatches' }, ...colors.map((c) => swatchButton(c, c.toLowerCase() === value.toLowerCase(), `${key}:${c}`, () => onPick(c))));
}

// ------------------------------------------------------------------ seções

function bodySection(c: SectionCtx): HTMLElement {
  const d = c.draft;
  const presets = h(
    'div',
    { class: 'of-presets', role: 'group', attrs: { 'aria-label': t('avatar.field.presets') } },
    ...PRESETS.map((p) => {
      const demo = { ...d, ...p.values } as Appearance;
      return optionCard(thumbCanvas(c.art, 'full', demo, 2), t(p.label), false, `preset:${p.id}`, () => c.applyPreset(p), { title: t(p.description) });
    }),
  );
  const looks = h(
    'div',
    { class: 'of-looks', role: 'radiogroup', attrs: { 'aria-label': t('avatar.field.body') } },
    ...(['f', 'm'] as const).map((l) =>
      h(
        'button',
        {
          class: 'of-opt of-opt--look' + (d.look === l ? ' is-selected' : ''),
          type: 'button',
          role: 'radio',
          attrs: { 'aria-checked': d.look === l ? 'true' : 'false', 'data-k': `look:${l}` },
          on: { click: () => c.set({ look: l }) },
        },
        h('span', { class: 'of-opt__thumb' }, thumbCanvas(c.art, 'full', { ...d, look: l }, 2)),
        h('span', { class: 'of-opt__label', text: t(`avatar.look.${l}`) }),
      ),
    ),
  );
  return h(
    'div',
    { class: 'of-section-body' },
    field(t('avatar.field.presets'), h('p', { class: 'of-hint', text: t('avatar.field.presetsHint') }), presets),
    field(t('avatar.field.body'), looks),
    field(t('avatar.field.skin'), swatchRow(SKINS, d.skin, 'skin', (s) => c.set({ skin: s }))),
  );
}

function faceSection(c: SectionCtx): HTMLElement {
  const d = c.draft;
  const hijab = (d.accessory as string) === 'hijab';
  const fh = d.facialHair ?? 'none';
  const collapsed = d.look === 'f' && !c.ui.showMoreFacial && fh === 'none';
  const shown = collapsed ? FACIAL_HAIR.filter((f) => f === 'none') : FACIAL_HAIR;
  const facial = h(
    'div',
    { class: 'of-chips' },
    ...shown.map((f) =>
      chip(label('facial', f), fh === f, `facial:${f}`, () => c.set({ facialHair: f }), {
        disabled: hijab && f !== 'none',
        title: hijab && f !== 'none' ? t('avatar.incompat.hijab_facial') : undefined,
      }),
    ),
    collapsed ? chip(t('avatar.showMore'), false, 'facial:more', () => { c.ui.showMoreFacial = true; c.rerender(); }) : null,
  );
  const mk = d.makeup ?? 'none';
  return h(
    'div',
    { class: 'of-section-body' },
    field(t('avatar.field.eyes'), swatchRow(EYES, d.eyes, 'eyes', (e) => c.set({ eyes: e }))),
    field(t('avatar.field.facialHair'), facial),
    field(t('avatar.field.makeup'), h('div', { class: 'of-chips' }, ...MAKEUP.map((m) => chip(label('makeup', m), mk === m, `makeup:${m}`, () => c.set({ makeup: m }))))),
    field(
      t('avatar.field.freckles'),
      h(
        'label',
        { class: 'of-checkbox' },
        h('input', {
          type: 'checkbox',
          attrs: { checked: d.freckles ? true : undefined, 'data-k': 'freckles' },
          on: { change: (ev) => c.set({ freckles: (ev.target as HTMLInputElement).checked }) },
        }),
        h('span', { text: t('avatar.freckles.with') }),
      ),
    ),
  );
}

function hairSection(c: SectionCtx): HTMLElement {
  const d = c.draft;
  const w = HAIR_W[d.look] as Readonly<Record<string, number>>;
  // Ordem sugerida pelo look (peso decrescente); tudo continua disponível.
  const styles = [...HAIR_STYLES].sort((a, b) => (w[b] ?? 1) - (w[a] ?? 1));
  const grid = h(
    'div',
    { class: 'of-grid' },
    ...styles.map((s) => {
      const conflict = findIncompatibility({ ...d, hairStyle: s });
      const name = label('hair', s);
      return optionCard(thumbCanvas(c.art, 'hair', { ...d, hairStyle: s, accessory: 'none' } as Appearance), name, d.hairStyle === s, `hair:${s}`, () => c.set({ hairStyle: s }), {
        title: conflict ? t('avatar.hair.swapsAccessory', { name }) : name,
      });
    }),
  );
  return h(
    'div',
    { class: 'of-section-body' },
    field(t('avatar.field.style'), grid),
    field(
      t('avatar.field.hairColor'),
      colorPicker({
        key: 'haircolor',
        value: d.hair,
        custom: true,
        groups: [
          { label: t('avatar.palette.natural'), colors: HAIR_NATURAL_COLORS },
          { label: t('avatar.palette.fun'), colors: HAIR_FUN },
          { label: t('avatar.palette.brand'), colors: BRAND_COLORS },
        ],
        onPick: (col, quiet) => c.set({ hair: col }, quiet),
      }),
    ),
  );
}

function topSection(c: SectionCtx): HTMLElement {
  const d = c.draft;
  const grid = h(
    'div',
    { class: 'of-grid' },
    ...TOP_STYLES.map((s) =>
      optionCard(thumbCanvas(c.art, 'top', { ...d, topStyle: s } as Appearance), label('top', s), d.topStyle === s, `top:${s}`, () => {
        // Troca de estilo: se a cor atual não existe na paleta do novo estilo, cai no primeiro item dela.
        const pal = topColorsFor(s);
        const acc = accentColorsFor(s);
        const patch: Record<string, unknown> = { topStyle: s };
        if ((s === 'shirt_tie' || s === 'jacket') && !pal.includes(d.top)) patch.top = pal[0];
        if (s === 'shirt_tie' && !acc.includes(d.topAccent)) patch.topAccent = acc[0];
        c.set(patch);
      }),
    ),
  );
  const accentTitle = d.topStyle === 'shirt_tie' ? t('avatar.field.tie') : t('avatar.field.accent');
  return h(
    'div',
    { class: 'of-section-body' },
    field(t('avatar.field.style'), grid),
    field(
      t('avatar.field.topColor'),
      colorPicker({
        key: 'topcolor',
        value: d.top,
        custom: true,
        groups: [
          { label: t('avatar.palette.default'), colors: topColorsFor(d.topStyle) },
          { label: t('avatar.palette.brand'), colors: BRAND_COLORS },
        ],
        onPick: (col, quiet) => c.set({ top: col }, quiet),
      }),
    ),
    field(accentTitle, colorPicker({ key: 'topaccent', value: d.topAccent, groups: [{ label: accentTitle, colors: accentColorsFor(d.topStyle) }], onPick: (col) => c.set({ topAccent: col }) })),
  );
}

function bottomSection(c: SectionCtx): HTMLElement {
  const d = c.draft;
  const cur = d.bottomStyle ?? 'pants';
  const styles = h(
    'div',
    { class: 'of-grid of-grid--sm' },
    ...BOTTOM_STYLES.map((s) =>
      optionCard(thumbCanvas(c.art, 'bottom', { ...d, bottomStyle: s } as Appearance), label('bottom', s), cur === s, `bottom:${s}`, () => c.set({ bottomStyle: s })),
    ),
  );
  return h(
    'div',
    { class: 'of-section-body' },
    field(t('avatar.field.style'), styles),
    (cur as string) === 'dress'
      ? h('p', { class: 'of-hint', text: t('avatar.dressHint') })
      : field(
          t('avatar.field.color'),
          colorPicker({ key: 'bottomcolor', value: d.bottom, custom: true, groups: [{ label: t('avatar.palette.default'), colors: BOTTOM_COLORS }], onPick: (col, quiet) => c.set({ bottom: col }, quiet) }),
        ),
  );
}

function shoesSection(c: SectionCtx): HTMLElement {
  const d = c.draft;
  return h(
    'div',
    { class: 'of-section-body' },
    field(t('avatar.field.shoesColor'), colorPicker({ key: 'shoes', value: d.shoes, custom: true, groups: [{ label: t('avatar.palette.default'), colors: SHOE_COLORS }], onPick: (col, quiet) => c.set({ shoes: col }, quiet) })),
  );
}

function accessoriesSection(c: SectionCtx): HTMLElement {
  const d = c.draft;
  const colorsOf = (a: string): readonly string[] => (ACC_COLORS as Record<string, readonly string[]>)[a] ?? ACC_COLORS.none;
  const grid = h(
    'div',
    { class: 'of-grid' },
    ...ACCESSORIES.map((a) => {
      const rule = findIncompatibility({ ...d, accessory: a });
      const color = d.accessory === a ? d.accessoryColor : colorsOf(a)[0];
      return optionCard(
        a === 'none' ? null : thumbCanvas(c.art, 'accessory', { ...d, accessory: a, accessoryColor: color } as Appearance),
        label('acc', a),
        d.accessory === a,
        `acc:${a}`,
        () => c.set({ accessory: a, accessoryColor: colorsOf(a)[0] }),
        { disabled: !!rule, title: rule ? incompatText(rule.id) : label('acc', a) },
      );
    }),
  );
  const colors = colorsOf(d.accessory);
  return h(
    'div',
    { class: 'of-section-body' },
    field(t('avatar.field.accessory'), grid),
    d.accessory !== 'none' && colors.length > 1
      ? field(t('avatar.field.accessoryColor'), swatchRow(colors, d.accessoryColor, 'acccolor', (col) => c.set({ accessoryColor: col })))
      : null,
  );
}

function badgeSection(c: SectionCtx): HTMLElement {
  const d = c.draft;
  const lanyards = [LANYARD_DEFAULT, ...LANYARDS];
  return h(
    'div',
    { class: 'of-section-body' },
    field(
      t('avatar.field.badge'),
      h(
        'div',
        { class: 'of-chips' },
        chip(t('avatar.badge.none'), d.lanyard === null, 'badge:none', () => c.set({ lanyard: null })),
      ),
      swatchRow(lanyards, d.lanyard ?? '', 'badge', (col) => c.set({ lanyard: col })),
    ),
  );
}

const BUILDERS: Readonly<Record<SectionId, (c: SectionCtx) => HTMLElement>> = {
  body: bodySection, face: faceSection, hair: hairSection, top: topSection, bottom: bottomSection, shoes: shoesSection,
  accessories: accessoriesSection, badge: badgeSection,
};

export function buildSection(id: SectionId, ctx: SectionCtx): HTMLElement {
  return BUILDERS[id](ctx);
}
