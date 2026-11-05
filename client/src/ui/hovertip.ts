// Dica flutuante que acompanha um ponto da tela (posição em pixels do viewport).
import { h, setText } from './dom';

export class HoverTip {
  readonly el: HTMLElement;
  private title: HTMLElement;
  private body: HTMLElement;

  constructor() {
    this.title = h('strong', { class: 'ui-tip__name' });
    this.body = h('div', { class: 'ui-tip__line' });
    this.el = h('div', { class: 'ui-tip', attrs: { 'aria-hidden': 'true' } }, this.title, this.body);
  }

  /** Mostra a dica acima do ponto (ou abaixo, se não couber no topo). */
  show(title: string, body: string, p: { x: number; y: number }): void {
    setText(this.title, title);
    setText(this.body, body);
    this.el.classList.add('is-visible');
    const w = this.el.offsetWidth;
    const hgt = this.el.offsetHeight;
    const x = Math.round(Math.min(innerWidth - w - 8, Math.max(8, p.x - w / 2)));
    const below = p.y - hgt - 10 < 72;
    const y = Math.round(below ? p.y + 46 : p.y - hgt - 10);
    this.el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }

  hide(): void {
    this.el.classList.remove('is-visible');
  }
}
