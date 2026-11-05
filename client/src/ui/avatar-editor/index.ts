// Montador de avatar (Adendo B.3). `openAvatarEditor` abre um modal com prévia, abas por seção, presets
// e aleatório; o estado é um rascunho que passa por `normalizeAppearance` a cada mudança.
import { appearanceSchema, displayNameSchema, normalizeAppearance } from '../../../../shared/validate/appearance';
import { hasMessage } from '../../../../shared/i18n';
import type { Appearance, ArtModule } from '../../art/api';
import { t } from '../../i18n';
import { h } from '../dom';
import { createPreviewStrip, type PreviewStrip } from './preview';
import { applyPreset } from './presets';
import { randomAll, randomSection, type SectionId } from './random';
import { SECTION_ORDER, accessoryLabel, buildSection, sectionLabel, type SectionCtx } from './sections';
import './styles.css';

export interface AvatarEditorOptions {
  art: ArtModule;
  initial: Appearance;
  displayName: string;
  /** `first`: primeiro acesso (sem cancelar; oferece "Usar aleatório e continuar"). */
  mode: 'first' | 'edit';
  save: (a: Appearance, displayName: string) => Promise<void>;
  onClose?: () => void;
}

const DESKTOP_QUERY = '(min-width: 900px)';
const DICE =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="15.5" cy="8.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="8.5" cy="15.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="15.5" cy="15.5" r="1.3" fill="currentColor" stroke="none"/></svg>';
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Mensagens de validação viajam como chave de i18n (shared/validate/appearance.ts); texto solto passa direto. */
const issueText = (msg: string): string => (hasMessage(msg) ? t(msg) : msg);

function diceButton(label: string, text: string | null, onClick: () => void, extra = ''): HTMLButtonElement {
  const b = h('button', { class: `of-btn of-btn--secondary of-btn--sm of-dice ${extra}`.trim(), type: 'button', title: label, attrs: { 'aria-label': label }, on: { click: onClick } });
  b.innerHTML = DICE;
  if (text) b.append(h('span', { text }));
  return b;
}

export function openAvatarEditor(opts: AvatarEditorOptions): { close(): void } {
  const { art, mode } = opts;
  const previouslyFocused = document.activeElement as HTMLElement | null;

  let draft: Appearance = normalizeAppearance({ ...opts.initial });
  const baseline = JSON.stringify(draft);
  const baseName = opts.displayName;
  let name = opts.displayName;
  let active: SectionId = 'body';
  let saving = false;
  let closed = false;
  const ui = { showMoreFacial: false };
  let previewScale = 0;
  let preview: PreviewStrip | null = null;

  // ------------------------------------------------------------ esqueleto
  const mq = window.matchMedia(DESKTOP_QUERY);
  const previewHost = h('div', { class: 'of-avatar__preview' });
  const nameInput = h('input', {
    class: 'of-input',
    type: 'text',
    attrs: { id: 'of-avatar-name', maxlength: 24, autocomplete: 'nickname', 'data-k': 'name' },
  });
  nameInput.value = name;
  const nameError = h('div', { class: 'of-field-error', hidden: true, attrs: { role: 'alert' } });
  const globalDice = diceButton(t('avatar.roll.allTitle'), t('avatar.roll.all'), () => rollAll(), 'of-avatar__roll');

  const tabs = h('div', { class: 'of-tabs', role: 'tablist', attrs: { 'aria-label': t('avatar.tabsLabel') } });
  const tabButtons = new Map<SectionId, HTMLButtonElement>();
  for (const id of SECTION_ORDER) {
    const b = h('button', {
      class: 'of-tab',
      type: 'button',
      role: 'tab',
      text: sectionLabel(id),
      attrs: { id: `of-avatar-tab-${id}`, 'aria-controls': 'of-avatar-panel', 'data-k': `tab:${id}` },
      on: { click: () => selectTab(id) },
    });
    tabButtons.set(id, b);
    tabs.append(b);
  }
  const panelTitle = h('h2', { class: 'of-avatar__panel-title' });
  const panelDice = diceButton(t('avatar.roll.sectionTitle'), t('avatar.roll.section'), () => rollSection());
  const panelBody = h('div', { class: 'of-avatar__panel-body' });
  const panel = h(
    'div',
    { class: 'of-avatar__panel', role: 'tabpanel', attrs: { id: 'of-avatar-panel' } },
    h('div', { class: 'of-avatar__panel-head' }, panelTitle, panelDice),
    panelBody,
  );

  const notice = h('div', { class: 'of-avatar__notice', attrs: { 'aria-live': 'polite' } });
  const saveLabel = (): string => (mode === 'first' ? t('avatar.action.saveContinue') : t('common.save'));
  const cancelBtn = h('button', { class: 'of-btn of-btn--transparent', type: 'button', text: t('common.cancel'), on: { click: () => cancel() } });
  const luckyBtn = h('button', { class: 'of-btn of-btn--secondary', type: 'button', text: t('avatar.action.useRandom'), on: { click: () => void useRandom() } });
  const saveBtn = h('button', { class: 'of-btn of-btn--primary', type: 'button', text: saveLabel(), on: { click: () => void save() } });
  const footer = h('footer', { class: 'of-avatar__footer' }, notice, mode === 'first' ? luckyBtn : cancelBtn, saveBtn);
  const toasts = h('div', { class: 'of-avatar__toasts', attrs: { 'aria-live': 'polite' } });

  const left = h(
    'div',
    { class: 'of-avatar__left' },
    previewHost,
    h('div', { class: 'of-avatar__meta' }, h('label', { class: 'of-label', text: t('avatar.displayName'), attrs: { for: 'of-avatar-name' } }), h('div', { class: 'of-avatar__name' }, nameInput, globalDice), nameError),
  );
  const right = h('div', { class: 'of-avatar__right' }, tabs, panel);
  const title = mode === 'first' ? t('avatar.title.first') : t('avatar.title.edit');
  const box = h(
    'div',
    { class: 'of-avatar__box', role: 'dialog', attrs: { 'aria-modal': 'true', 'aria-labelledby': 'of-avatar-title' } },
    h('header', { class: 'of-avatar__header' }, h('h1', { class: 'of-avatar__title', text: title, attrs: { id: 'of-avatar-title' } })),
    h('div', { class: 'of-avatar__body' }, left, right),
    footer,
    toasts,
  );
  const root = h('div', { class: 'ui-root of-avatar of-avatar__overlay' }, box);

  // ------------------------------------------------------------ estado
  const issues = (): string[] => {
    const r = appearanceSchema.safeParse(draft);
    const out = r.success ? [] : r.error.issues.map((i) => i.message);
    if (!displayNameSchema.safeParse(name).success) out.push('nome');
    return out;
  };
  const dirty = (): boolean => JSON.stringify(draft) !== baseline || name.trim() !== baseName.trim();

  function toast(text: string, kind: 'error' | 'info' = 'error'): void {
    const el = h('div', { class: `of-toast of-toast--${kind}`, role: kind === 'error' ? 'alert' : 'status', text });
    toasts.append(el);
    setTimeout(() => el.remove(), 5000);
  }

  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  function setNotice(text: string): void {
    notice.textContent = text;
    clearTimeout(noticeTimer);
    if (text) noticeTimer = setTimeout(() => (notice.textContent = ''), 5000);
  }

  function ensurePreview(): void {
    const scale = mq.matches ? 6 : 3;
    if (preview && scale === previewScale) return;
    preview?.destroy();
    previewScale = scale;
    preview = createPreviewStrip(art, { scale, appearance: draft });
    previewHost.replaceChildren(preview.el, preview.controls);
  }

  function updateChrome(): void {
    preview?.setAppearance(draft);
    const nameOk = displayNameSchema.safeParse(name).success;
    nameInput.classList.toggle('is-invalid', !nameOk);
    nameInput.setAttribute('aria-invalid', nameOk ? 'false' : 'true');
    nameError.hidden = nameOk;
    nameError.textContent = nameOk ? '' : t('avatar.nameHint');
    const valid = issues().length === 0;
    saveBtn.disabled = saving || !valid || (mode === 'edit' && !dirty());
    cancelBtn.disabled = saving;
    luckyBtn.disabled = saving;
    saveBtn.textContent = saving ? t('avatar.action.saving') : saveLabel();
  }

  const ctx: SectionCtx = {
    art,
    get draft() {
      return draft;
    },
    ui,
    set(patch, quiet = false) {
      const before = draft;
      draft = normalizeAppearance({ ...draft, ...patch } as Appearance);
      if (draft.accessory !== before.accessory && !('accessory' in patch)) {
        setNotice(t('avatar.notice.accessorySwapped', { name: accessoryLabel(draft.accessory) }));
      }
      if (quiet) updateChrome();
      else refresh();
    },
    applyPreset(p) {
      draft = applyPreset(draft, p);
      refresh();
    },
    rerender: () => renderPanel(),
  };

  function renderPanel(): void {
    const focusKey = (document.activeElement as HTMLElement | null)?.getAttribute?.('data-k') ?? null;
    const scroll = panel.scrollTop;
    panelTitle.textContent = sectionLabel(active);
    panelBody.replaceChildren(buildSection(active, ctx));
    panelBody.scrollTop = 0;
    panel.scrollTop = scroll;
    if (focusKey) {
      const el = Array.from(root.querySelectorAll<HTMLElement>('[data-k]')).find((e) => e.getAttribute('data-k') === focusKey);
      el?.focus({ preventScroll: true });
    }
  }

  function refresh(): void {
    renderPanel();
    updateChrome();
  }

  function selectTab(id: SectionId, focus = false): void {
    active = id;
    for (const [k, b] of tabButtons) {
      b.setAttribute('aria-selected', k === id ? 'true' : 'false');
      b.tabIndex = k === id ? 0 : -1;
      b.classList.toggle('is-active', k === id);
    }
    panel.setAttribute('aria-labelledby', `of-avatar-tab-${id}`);
    panel.scrollTop = 0;
    renderPanel();
    if (focus) tabButtons.get(id)?.focus();
    tabButtons.get(id)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  function rollAll(): void {
    draft = randomAll(draft.look);
    setNotice('');
    refresh();
  }
  function rollSection(): void {
    draft = randomSection(active, draft, draft.look);
    refresh();
  }

  // ------------------------------------------------------------ ações
  async function doSave(a: Appearance): Promise<void> {
    saving = true;
    updateChrome();
    try {
      await opts.save(a, name.trim());
      saving = false;
      finish();
    } catch (e) {
      saving = false;
      toast(e instanceof Error && e.message ? issueText(e.message) : t('avatar.error.saveFailed'));
      updateChrome();
    }
  }
  async function save(): Promise<void> {
    if (saving || issues().length > 0 || (mode === 'edit' && !dirty())) return;
    await doSave(draft);
  }
  async function useRandom(): Promise<void> {
    if (saving || !displayNameSchema.safeParse(name).success) {
      updateChrome();
      nameInput.focus();
      return;
    }
    draft = randomAll(draft.look);
    refresh();
    await doSave(draft);
  }
  function cancel(): void {
    if (mode === 'first' || saving) return;
    finish();
  }
  function finish(): void {
    if (closed) return;
    closed = true;
    preview?.destroy();
    mq.removeEventListener('change', onMq);
    document.removeEventListener('keydown', onKey, true);
    clearTimeout(noticeTimer);
    root.remove();
    document.documentElement.classList.remove('of-avatar-open');
    previouslyFocused?.focus?.({ preventScroll: true });
    opts.onClose?.();
  }

  // ------------------------------------------------------------ teclado e foco
  const isTextTarget = (t: EventTarget | null): boolean => {
    const el = t as HTMLElement | null;
    return !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'checkbox'));
  };
  function onKey(ev: KeyboardEvent): void {
    if (closed) return;
    if (ev.key === 'Escape') {
      if (mode === 'edit') {
        ev.preventDefault();
        ev.stopPropagation();
        cancel();
      }
      return;
    }
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      void save();
      return;
    }
    if (ev.key === 'Tab') {
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((e) => e.offsetParent !== null || e === document.activeElement);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const cur = document.activeElement as HTMLElement | null;
      if (!cur || !root.contains(cur)) {
        ev.preventDefault();
        first.focus();
      } else if (ev.shiftKey && cur === first) {
        ev.preventDefault();
        last.focus();
      } else if (!ev.shiftKey && cur === last) {
        ev.preventDefault();
        first.focus();
      }
      return;
    }
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if ((ev.key === 'r' || ev.key === 'R') && !isTextTarget(ev.target)) {
      ev.preventDefault();
      rollAll();
      return;
    }
    if ((ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') && !isTextTarget(ev.target)) {
      const i = SECTION_ORDER.indexOf(active);
      const n = SECTION_ORDER.length;
      ev.preventDefault();
      selectTab(SECTION_ORDER[(i + (ev.key === 'ArrowRight' ? 1 : n - 1)) % n], (ev.target as HTMLElement | null)?.getAttribute?.('role') === 'tab');
    }
  }
  const onMq = (): void => ensurePreview();

  nameInput.addEventListener('input', () => {
    name = nameInput.value;
    updateChrome();
  });
  root.addEventListener('mousedown', (ev) => {
    // Clique fora da caixa não fecha (evita perder edições); só mantém o foco dentro do modal.
    if (ev.target === root) ev.preventDefault();
  });

  // ------------------------------------------------------------ abrir
  document.body.append(root);
  document.documentElement.classList.add('of-avatar-open');
  document.addEventListener('keydown', onKey, true);
  mq.addEventListener('change', onMq);
  ensurePreview();
  selectTab('body');
  updateChrome();
  (mode === 'first' ? nameInput : (tabButtons.get('body') as HTMLElement)).focus({ preventScroll: true });

  return { close: finish };
}
