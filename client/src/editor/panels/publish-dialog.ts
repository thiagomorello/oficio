// Diálogo de publicação: `POST /api/admin/maps/:ref/validate` (dry-run) mostra contagens, erros (que
// bloqueiam), avisos (cada um precisa ser marcado) e o impacto ("X pessoas serão movidas, Y assentos e
// Z mesas liberados"); confirmar faz `POST /api/admin/maps/:ref/publish {name?, confirmWarnings}`.
import type { MapIssue } from '../../../../shared/map/validate';
import { t, tn } from '../../i18n';
import { h } from '../../ui/dom';
import type { ToastKind } from '../context';
import type { EditorState } from '../state';
import { issueText } from './problems';
import { openModal } from './ui';

export interface ValidateDto {
  errors: MapIssue[];
  warnings: MapIssue[];
  stats: { desks?: number; seats?: number; zones?: number; warnings?: number; errors?: number } | null;
  wouldMove: number;
  wouldReleaseSeats: number;
  wouldReleaseDesks: number;
}

export interface PublishDto {
  id: number;
  version: number;
  moved: number;
  releasedSeats: number;
  releasedDesks: number;
}

export interface PublishApi {
  post<T>(path: string, body?: unknown): Promise<T>;
}

export interface PublishOpts {
  api: PublishApi;
  state: EditorState;
  /** 'draft' ou o id de uma versão (publicar de novo / rollback). */
  ref: 'draft' | number;
  title: string;
  /** Nome sugerido para a nova versão (só rascunho). */
  defaultName?: string;
  toast(text: string, kind?: ToastKind): void;
  published(r: PublishDto): void;
}

/** Frase de impacto da publicação. */
export function impactText(v: Pick<ValidateDto, 'wouldMove' | 'wouldReleaseSeats' | 'wouldReleaseDesks'>): string {
  return t('editor.publish.impact', {
    moved: tn('editor.publish.moved', v.wouldMove),
    seats: tn('editor.publish.seats', v.wouldReleaseSeats),
    desks: tn('editor.publish.desks', v.wouldReleaseDesks),
    released: tn('editor.publish.released', v.wouldReleaseSeats + v.wouldReleaseDesks),
  });
}

function issueList(list: readonly MapIssue[], withChecks: boolean, onChange?: () => void): { el: HTMLElement; checks: HTMLInputElement[] } {
  const ul = h('ul', { class: 'med-issues med-issues--dialog' });
  const checks: HTMLInputElement[] = [];
  for (const is of list) {
    const body = h('span', { class: 'med-issue__body' }, h('code', { text: is.code }), h('span', { text: issueText(is) }));
    if (withChecks) {
      const c = h('input', { class: 'of-checkbox', type: 'checkbox' });
      c.addEventListener('change', () => onChange?.());
      checks.push(c);
      ul.append(h('li', {}, h('label', { class: `med-issue med-issue--${is.severity}` }, c, body)));
    } else ul.append(h('li', {}, h('div', { class: `med-issue med-issue--${is.severity}` }, h('span', { class: 'med-issue__dot' }), body)));
  }
  return { el: ul, checks };
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : t('editor.error.unknown'));

export async function openPublishDialog(o: PublishOpts): Promise<void> {
  const { api, state } = o;
  state.publishEvent('start');
  const base = `/api/admin/maps/${o.ref}`;
  let v: ValidateDto;
  try {
    v = await api.post<ValidateDto>(`${base}/validate`);
  } catch (e) {
    state.publishEvent('fail');
    o.toast(t('editor.publish.validateError', { error: errMsg(e) }), 'error');
    return;
  }
  state.publishEvent('validated');

  const body = h('div', { class: 'med-publish' });
  const err = h('p', { class: 'of-error-text', role: 'alert' });
  const name = h('input', { class: 'of-input of-input--outlined', type: 'text', attrs: { maxlength: 120, placeholder: t('editor.publish.namePlaceholder'), id: 'med-pub-name' } });
  name.value = o.defaultName ?? '';
  const publish = h('button', { class: 'of-btn of-btn--primary', type: 'button', text: t('editor.publish') });
  const cancel = h('button', { class: 'of-btn of-btn--transparent', type: 'button', text: t('common.cancel') });
  let checks: HTMLInputElement[] = [];

  const gate = () => {
    publish.disabled = v.errors.length > 0 || checks.some((c) => !c.checked) || state.publish === 'publishing';
  };

  const render = () => {
    const s = v.stats ?? {};
    body.replaceChildren(
      h(
        'dl',
        { class: 'med-stats med-stats--row' },
        ...([
          [t('editor.publish.stat.desks'), s.desks ?? 0],
          [t('editor.publish.stat.seats'), s.seats ?? 0],
          [t('editor.publish.stat.zones'), s.zones ?? 0],
          [t('editor.publish.stat.errors'), v.errors.length],
          [t('editor.publish.stat.warnings'), v.warnings.length],
        ] as const).flatMap(([k, n]) => [h('dt', { text: k }), h('dd', { text: String(n) })]),
      ),
      h('p', { class: 'med-impact', text: impactText(v) }),
    );
    if (v.errors.length) body.append(h('h3', { class: 'med-sec__title med-sec__title--error', text: t('editor.publish.errorsTitle') }), issueList(v.errors, false).el);
    if (v.warnings.length) {
      const w = issueList(v.warnings, true, gate);
      checks = w.checks;
      const all = h('input', { class: 'of-checkbox', type: 'checkbox' });
      all.addEventListener('change', () => {
        for (const c of checks) c.checked = all.checked;
        gate();
      });
      body.append(h('h3', { class: 'med-sec__title med-sec__title--warn', text: t('editor.publish.warningsTitle') }), h('label', { class: 'med-check' }, all, h('span', { text: t('editor.publish.ackAll') })), w.el);
    } else checks = [];
    if (o.ref === 'draft') body.append(h('div', { class: 'med-field' }, h('label', { text: t('editor.publish.versionName'), attrs: { for: 'med-pub-name' } }), name));
    gate();
  };
  render();

  const m = openModal(o.title, [body, err, h('div', { class: 'med-modal-actions' }, cancel, publish)], {
    wide: true,
    dismissable: () => state.publish !== 'publishing',
    onClose: () => state.publishEvent('close'),
  });
  cancel.addEventListener('click', () => m.close());
  publish.addEventListener('click', () => {
    err.textContent = '';
    state.publishEvent('confirm');
    gate();
    cancel.disabled = true;
    const payload: { name?: string; confirmWarnings: boolean } = { confirmWarnings: v.warnings.length > 0 };
    if (o.ref === 'draft' && name.value.trim()) payload.name = name.value.trim().slice(0, 120);
    api
      .post<PublishDto>(`${base}/publish`, payload)
      .then((r) => {
        state.publishEvent('published');
        m.close();
        o.toast(t('editor.publish.done', { id: r.id, moved: r.moved, seats: r.releasedSeats, desks: r.releasedDesks }), 'success');
        o.published(r);
      })
      .catch((e: unknown) => {
        state.publishEvent('fail');
        cancel.disabled = false;
        const b = (e as { body?: { errors?: MapIssue[]; warnings?: MapIssue[] } }).body;
        if (b?.errors || b?.warnings) {
          v = { ...v, errors: b.errors ?? [], warnings: b.warnings ?? [] };
          render();
        }
        err.textContent = t('editor.publish.error', { error: errMsg(e) });
        gate();
      });
  });
}
