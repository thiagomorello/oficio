// Ajuda ("?"): controles e atalhos do escritório.
import { onLocaleChange, t, type MessageKey } from '../i18n';
import { h, iconButton, prefersReducedMotion } from './dom';
import { ICONS } from './icons';

export type HelpSection = 'controls';

/** Tecla literal (`W`, `Esc`) ou nome traduzido (`{ key: 'shell.help.key.click' }`). */
export type KeyCap = string | { key: MessageKey };

/** Atalhos: teclas + chave da descrição (traduzida na hora de desenhar). */
export const SHORTCUTS: ReadonlyArray<readonly [readonly KeyCap[], MessageKey]> = [
  [['W', 'A', 'S', 'D', '←', '↑', '→', '↓'], 'shell.help.move'],
  [[{ key: 'shell.help.key.rightClick' }], 'shell.help.menu'],
  [[{ key: 'shell.help.key.click' }], 'shell.help.click'],
  [['Shift'], 'shell.help.run'],
  [['E'], 'shell.help.sit'],
  [['X'], 'shell.help.stand'],
  [['1', '2', '3', '4'], 'shell.help.emotes'],
  [['Enter'], 'shell.help.talk'],
  [['['], 'shell.help.chat'],
  [[']'], 'shell.help.people'],
  [['M'], 'shell.help.minimap'],
  [['F'], 'shell.help.follow'],
  [['0'], 'shell.help.overview'],
  [['?'], 'shell.help.thisHelp'],
  [['Esc'], 'shell.help.escape'],
];

function keys(list: readonly KeyCap[]): HTMLElement {
  return h('span', { class: 'ui-keys' }, ...list.map((k) => h('kbd', { class: 'ui-kbd', text: typeof k === 'string' ? k : t(k.key) })));
}

export class HelpDialog {
  readonly el: HTMLDialogElement;
  private sections = new Map<HelpSection, HTMLElement>();
  private readonly title: HTMLElement;
  private readonly close: HTMLButtonElement;
  private readonly body: HTMLElement;
  private readonly offLocale: () => void;

  constructor() {
    this.close = iconButton(ICONS.close, '', () => this.el.close(), 'ui-icon-btn--sm');
    this.title = h('h2', { attrs: { id: 'ui-help-title' } });
    this.body = h('div', { class: 'ui-dialog__body' });
    this.el = h(
      'dialog',
      { class: 'ui-dialog ui-help of-modal', attrs: { 'aria-labelledby': 'ui-help-title' } },
      h('div', { class: 'ui-dialog__head' }, this.title, this.close),
      this.body,
    );
    // Clique no fundo (fora do conteúdo) fecha.
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.el.close();
    });
    this.render();
    this.offLocale = onLocaleChange(() => this.render());
  }

  /** (Re)desenha os textos no idioma atual. */
  private render(): void {
    this.title.textContent = t('shell.help.title');
    this.close.title = t('shell.help.close');
    this.close.setAttribute('aria-label', t('shell.help.close'));
    const shortcuts = h('dl', { class: 'ui-shortcuts' }, ...SHORTCUTS.flatMap(([k, text]) => [h('dt', {}, keys(k)), h('dd', { text: t(text) })]));
    const controls = h('section', { class: 'ui-help__usage' }, h('h3', { text: t('shell.help.controls'), tabIndex: -1 }), shortcuts);
    this.sections.set('controls', controls);
    this.body.replaceChildren(controls);
  }

  open(section?: HelpSection): void {
    if (!this.el.open) this.el.showModal();
    const target = section ? this.sections.get(section) : undefined;
    if (!target) return;
    requestAnimationFrame(() => target.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' }));
  }

  toggle(): void {
    if (this.el.open) this.el.close();
    else this.open();
  }

  get isOpen(): boolean {
    return this.el.open;
  }

  destroy(): void {
    this.offLocale();
    this.el.remove();
  }
}
