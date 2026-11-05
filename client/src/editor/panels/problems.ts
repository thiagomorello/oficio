// Problemas: erros (bloqueiam publicar) e avisos de `validateMap`; clique centraliza a câmera e
// seleciona o item quando dá para identificá-lo.
import type { OfficeMapDoc } from '../../../../shared/map/doc';
import type { MapIssue, MapValidation } from '../../../../shared/map/validate';
import { t, tn } from '../../i18n';
import { h } from '../../ui/dom';
import type { EditorCtx } from '../context';
import { resolve, splitAbsId, type Ref } from '../types';

/** Texto de um problema no idioma atual (retraduz pela chave; cai no `message` de quem validou). */
export function issueText(is: MapIssue): string {
  return is.key ? t(is.key, is.params) : is.message;
}

/** Referência do editor a partir do `ref` de um problema (id absoluto, área, zona ou spot). */
export function refFromIssue(doc: OfficeMapDoc, issue: MapIssue): Ref | null {
  const raw = issue.ref?.split(',')[0];
  if (!raw) return null;
  const abs = splitAbsId(raw);
  if (abs) {
    const local = abs.id.split(':')[0];
    for (const t of ['furn', 'wall', 'rug'] as const) {
      const r: Ref = { t, area: abs.area, id: local };
      if (resolve(doc, r)) return r;
    }
    return null;
  }
  for (const r of [{ t: 'area', id: raw }, { t: 'zone', id: raw }, { t: 'spot', id: raw }] as Ref[]) if (resolve(doc, r)) return r;
  return null;
}

export interface ProblemsPanel {
  el: HTMLElement;
  render(v: MapValidation | null, pending: boolean): void;
}

export function createProblems(ctx: EditorCtx): ProblemsPanel {
  const el = h('div', { class: 'med-problems' });
  return {
    el,
    render(v, pending) {
      el.replaceChildren();
      if (!v) {
        el.append(h('p', { class: 'med-hint', text: pending ? t('editor.problems.validating') : t('editor.problems.noDoc') }));
        return;
      }
      const head = h(
        'div',
        { class: 'med-problems__head' },
        h('span', { class: `of-badge ${v.errors.length ? 'of-badge--danger' : 'of-badge--success'}`, text: tn('editor.problems.errors', v.errors.length) }),
        h('span', { class: `of-badge ${v.warnings.length ? 'of-badge--warn' : 'of-badge--gray'}`, text: tn('editor.problems.warnings', v.warnings.length) }),
        pending ? h('span', { class: 'med-hint', text: t('editor.problems.updating') }) : null,
      );
      el.append(head);
      if (!v.errors.length && !v.warnings.length) {
        el.append(h('p', { class: 'med-ok', text: t('editor.problems.none') }));
        return;
      }
      const list = h('ul', { class: 'med-issues' });
      for (const is of [...v.errors, ...v.warnings]) {
        const b = h(
          'button',
          { class: `med-issue med-issue--${is.severity}`, type: 'button', title: is.at ? t('editor.problems.showOnMap') : undefined },
          h('span', { class: 'med-issue__dot' }),
          h('span', { class: 'med-issue__body' }, h('code', { text: is.code }), h('span', { text: issueText(is) })),
        );
        b.addEventListener('click', () => {
          const ref = refFromIssue(ctx.doc(), is);
          if (ref) ctx.select([ref]);
          if (is.at) ctx.centerOn(is.at);
        });
        list.append(h('li', {}, b));
      }
      el.append(list);
    },
  };
}
