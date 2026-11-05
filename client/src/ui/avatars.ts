// Miniatura da cabeça de um usuário (recorte do sprite do personagem) para barra, lista e cartão.
import type { Appearance, ArtModule } from '../art/api';
import { h } from './dom';
import { thumbCanvas, thumbKey } from './avatar-editor/thumbs';

/** Chave estável da miniatura (para saber quando refazer). */
export function headKey(a: Appearance | null): string {
  return a ? thumbKey('hair', a, 2) : 'none';
}

/** Elemento 40x40 (escala do `size`) com a cabeça, ou a inicial do nome quando não há aparência. */
export function headThumb(art: ArtModule, a: Appearance | null, name: string, cls = ''): HTMLElement {
  const wrap = h('span', { class: `ui-head ${cls}`.trim(), attrs: { 'data-hk': headKey(a), 'aria-hidden': 'true' } });
  fillHead(wrap, art, a, name);
  return wrap;
}

function fillHead(wrap: HTMLElement, art: ArtModule, a: Appearance | null, name: string): void {
  wrap.replaceChildren();
  if (!a) {
    wrap.textContent = (name.trim()[0] ?? '?').toUpperCase();
    return;
  }
  try {
    wrap.append(thumbCanvas(art, 'hair', a, 2));
  } catch {
    wrap.textContent = (name.trim()[0] ?? '?').toUpperCase();
  }
}

/** Atualiza a miniatura só quando a aparência mudou. */
export function updateHead(wrap: HTMLElement, art: ArtModule, a: Appearance | null, name: string): void {
  const k = headKey(a);
  if (wrap.dataset.hk === k && wrap.firstChild) return;
  wrap.dataset.hk = k;
  fillHead(wrap, art, a, name);
}
