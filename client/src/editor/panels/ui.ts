// Pequenos construtores de formulário e modal para os painéis do editor (classes `.of-*` da marca).
import { t } from '../../i18n';
import { h } from '../../ui/dom';

let uid = 0;
const nextId = (p: string) => `med-${p}-${++uid}`;

export function section(title: string, ...kids: (Node | null | false | undefined)[]): HTMLElement {
  return h('section', { class: 'med-sec' }, h('h3', { class: 'med-sec__title', text: title }), ...kids);
}

export function row(label: string, input: HTMLElement, hint?: string): HTMLElement {
  const id = input.id || nextId('f');
  input.id = id;
  return h('div', { class: 'med-field' }, h('label', { text: label, attrs: { for: id } }), input, hint ? h('span', { class: 'med-hint', text: hint }) : null);
}

export function textInput(value: string, onCommit: (v: string) => void, o: { name?: string; max?: number; placeholder?: string; readonly?: boolean } = {}): HTMLInputElement {
  const el = h('input', { class: 'of-input of-input--outlined med-input', type: 'text', attrs: { maxlength: o.max, placeholder: o.placeholder, 'data-prop': o.name, readonly: o.readonly, autocomplete: 'off', spellcheck: false } });
  el.value = value;
  el.addEventListener('change', () => onCommit(el.value));
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') el.blur();
  });
  return el;
}

export function numInput(value: number | undefined, onCommit: (v: number | undefined) => void, o: { name?: string; step?: number; min?: number; max?: number; placeholder?: string } = {}): HTMLInputElement {
  const el = h('input', { class: 'of-input of-input--outlined med-input med-input--num', type: 'number', attrs: { step: o.step ?? 1, min: o.min, max: o.max, placeholder: o.placeholder, 'data-prop': o.name } });
  el.value = value === undefined ? '' : String(value);
  el.addEventListener('change', () => {
    const t = el.value.trim();
    if (t === '') return onCommit(undefined);
    const n = Number(t);
    if (Number.isFinite(n)) onCommit(n);
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') el.blur();
  });
  return el;
}

export function selectInput<T extends string>(value: T | undefined, options: readonly (readonly [T, string])[], onCommit: (v: T) => void, o: { name?: string; empty?: string } = {}): HTMLSelectElement {
  const el = h('select', { class: 'of-select of-select--outlined med-input', attrs: { 'data-prop': o.name } });
  if (o.empty !== undefined) el.append(h('option', { text: o.empty, attrs: { value: '' } }));
  for (const [v, l] of options) el.append(h('option', { text: l, attrs: { value: v } }));
  el.value = value ?? '';
  el.addEventListener('change', () => onCommit(el.value as T));
  return el;
}

export function checkbox(label: string, checked: boolean, onChange: (v: boolean) => void, name?: string): HTMLElement {
  const box = h('input', { class: 'of-checkbox', type: 'checkbox', attrs: { 'data-prop': name } });
  box.checked = checked;
  box.addEventListener('change', () => onChange(box.checked));
  return h('label', { class: 'med-check' }, box, h('span', { text: label }));
}

/** Cor #rrggbb (com "limpar" opcional). */
export function colorInput(value: string | undefined, onCommit: (v: string | undefined) => void, o: { name?: string; clearable?: boolean } = {}): HTMLElement {
  const el = h('input', { class: 'med-color', type: 'color', attrs: { 'data-prop': o.name } });
  el.value = value ?? '#808080';
  el.addEventListener('change', () => onCommit(el.value.toLowerCase()));
  const wrap = h('span', { class: 'med-color-wrap' }, el, h('code', { class: 'med-color-code', text: value ?? '—' }));
  if (o.clearable) {
    const b = h('button', { class: 'of-btn of-btn--transparent of-btn--sm', type: 'button', text: t('editor.ui.clear') });
    b.disabled = value === undefined;
    b.addEventListener('click', () => onCommit(undefined));
    wrap.append(b);
  }
  return wrap;
}

export function button(label: string, onClick: () => void, kind: 'primary' | 'secondary' | 'transparent' | 'danger' = 'secondary', title?: string): HTMLButtonElement {
  const cls = kind === 'danger' ? 'of-btn of-btn--transparent of-btn--sm med-danger' : `of-btn of-btn--${kind} of-btn--sm`;
  return h('button', { class: cls, type: 'button', text: label, title, on: { click: () => onClick() } });
}

// ------------------------------------------------------------------ modal

export interface Modal {
  box: HTMLElement;
  close(): void;
}

let openCount = 0;

/** Há algum modal do editor aberto? (atalhos ficam suspensos.) */
export function modalOpen(): boolean {
  return openCount > 0;
}

export function openModal(title: string, content: Node[], o: { wide?: boolean; onClose?: () => void; dismissable?: () => boolean } = {}): Modal {
  const prevFocus = document.activeElement as HTMLElement | null;
  const box = h('div', { class: `of-modal med-modal${o.wide ? ' med-modal--wide' : ''}`, role: 'dialog', attrs: { 'aria-modal': 'true', 'aria-label': title } }, h('h2', { class: 'of-modal__title', text: title }), ...content);
  const overlay = h('div', { class: 'of-modal-overlay' }, box);
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    openCount--;
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    prevFocus?.focus?.();
    o.onClose?.();
  };
  const canDismiss = () => (o.dismissable ? o.dismissable() : true);
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape' && canDismiss()) {
      ev.stopPropagation();
      close();
    }
  };
  overlay.addEventListener('mousedown', (ev) => {
    if (ev.target === overlay && canDismiss()) close();
  });
  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay);
  openCount++;
  box.querySelector<HTMLElement>('input,select,button')?.focus();
  return { box, close };
}

/** Confirmação simples (Promise<boolean>). */
export function confirmDialog(title: string, message: string, ok = t('editor.ui.confirm'), danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    let result = false;
    const okBtn = h('button', { class: `of-btn ${danger ? 'of-btn--secondary med-btn-danger' : 'of-btn--primary'}`, type: 'button', text: ok });
    const cancel = h('button', { class: 'of-btn of-btn--transparent', type: 'button', text: t('common.cancel') });
    const m = openModal(title, [h('p', { class: 'med-modal-text', text: message }), h('div', { class: 'med-modal-actions' }, cancel, okBtn)], { onClose: () => resolve(result) });
    okBtn.addEventListener('click', () => {
      result = true;
      m.close();
    });
    cancel.addEventListener('click', () => m.close());
    okBtn.focus();
  });
}
