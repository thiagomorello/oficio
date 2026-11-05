// Menu suspenso genérico (usado pelo avatar e pelo seletor de status da barra superior).
import { h } from './dom';

export interface MenuItem {
  label: string;
  onSelect?: () => void;
  /** Marca o item atual (ex.: status ativo). */
  checked?: boolean;
  disabled?: boolean;
  /** Linha divisória antes do item. */
  dividerBefore?: boolean;
  /** Se informado, o item vira um link. */
  href?: string;
}

export interface OpenMenu {
  close(): void;
  readonly el: HTMLElement;
}

/** Abre um menu abaixo (ou acima, se faltar espaço) do `anchor`, alinhado à direita ou à esquerda. */
export function openMenu(host: HTMLElement, anchor: HTMLElement, items: readonly MenuItem[], opts: { align?: 'left' | 'right'; onClose?: () => void } = {}): OpenMenu {
  const list = h('ul', { class: 'of-menu ui-menu', role: 'menu' });
  const buttons: HTMLElement[] = [];
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    removeEventListener('resize', close);
    list.remove();
    anchor.setAttribute('aria-expanded', 'false');
    opts.onClose?.();
  };

  for (const it of items) {
    if (it.dividerBefore) list.append(h('li', { role: 'separator' }, h('hr', { class: 'of-menu__divider' })));
    const content = [it.checked ? h('span', { class: 'ui-menu__check', text: '✓', attrs: { 'aria-hidden': 'true' } }) : h('span', { class: 'ui-menu__check' }), it.label];
    const el: HTMLElement = it.href
      ? h('a', { class: 'of-menu__item', role: 'menuitem', attrs: { href: it.href } }, ...content)
      : h('button', { class: 'of-menu__item', type: 'button', role: it.checked !== undefined ? 'menuitemradio' : 'menuitem', attrs: { 'aria-checked': it.checked === undefined ? undefined : String(it.checked) } }, ...content);
    if (it.disabled) {
      el.setAttribute('aria-disabled', 'true');
      if (el instanceof HTMLButtonElement) el.disabled = true;
    } else {
      el.addEventListener('click', () => {
        close();
        it.onSelect?.();
      });
      buttons.push(el);
    }
    list.append(h('li', { role: 'none' }, el));
  }

  host.append(list);
  anchor.setAttribute('aria-expanded', 'true');
  const a = anchor.getBoundingClientRect();
  const m = list.getBoundingClientRect();
  const left = opts.align === 'left' ? a.left : a.right - m.width;
  const below = a.bottom + 6;
  const top = below + m.height > innerHeight - 8 ? Math.max(8, a.top - 6 - m.height) : below;
  list.style.left = `${Math.max(8, Math.min(left, innerWidth - m.width - 8))}px`;
  list.style.top = `${top}px`;

  function onOutside(e: Event): void {
    const t = e.target as Node | null;
    if (t && (list.contains(t) || anchor.contains(t))) return;
    close();
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      anchor.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const i = buttons.indexOf(document.activeElement as HTMLElement);
      const n = buttons.length;
      if (!n) return;
      const down = e.key === 'ArrowDown';
      buttons[i < 0 ? (down ? 0 : n - 1) : (i + (down ? 1 : n - 1)) % n].focus();
    }
  }
  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('keydown', onKey, true);
  addEventListener('resize', close);
  buttons[0]?.focus();
  return { close, el: list };
}
