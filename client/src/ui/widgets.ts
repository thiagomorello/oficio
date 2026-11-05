// Peças visuais reutilizadas pelos painéis (WP0: só o genérico; chips de conta/status/atividade do Habblaud saíram).
import { t } from '../i18n';
import { h, setAttr, setStyleVar } from './dom';

/** Barra de progresso fina; `value` 0–1. */
export function createProgress(label: string): HTMLElement {
  const bar = h('span', { class: 'ui-progress', role: 'progressbar', attrs: { 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': 100 } });
  bar.append(h('span', { class: 'ui-progress__fill' }));
  return bar;
}

export function updateProgress(bar: HTMLElement, done: number, total: number, partial = 0): void {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const partialPct = total > 0 ? Math.round(((done + partial) / total) * 100) : 0;
  setStyleVar(bar, '--p', `${pct}%`);
  setStyleVar(bar, '--pp', `${partialPct}%`);
  setAttr(bar, 'aria-valuenow', String(pct));
  setAttr(bar, 'aria-valuetext', t('shell.progress.ofTotal', { done, total }));
  bar.classList.toggle('is-complete', total > 0 && done === total);
}
