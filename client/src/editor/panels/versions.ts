// Versões: `GET /api/admin/maps` com Ver / Restaurar para o rascunho / Publicar de novo / Excluir.
import { getLocale, t } from '../../i18n';
import { h } from '../../ui/dom';
import { relativeTime } from '../../ui/format';
import { button, section } from './ui';

export interface MapListItem {
  id: number;
  kind: 'draft' | 'version';
  name: string;
  created_at: string;
  updated_at?: string;
  published_at: string | null;
  created_by: number | null;
  stats: { desks?: number; seats?: number; zones?: number; errors?: number; warnings?: number } | null;
  current: boolean;
}

export interface MapListDto {
  current: number | null;
  maps: MapListItem[];
}

export interface VersionsActions {
  load(): Promise<MapListDto>;
  view(item: MapListItem): void;
  restore(item: MapListItem): void;
  republish(item: MapListItem): void;
  remove(item: MapListItem): void;
}

export interface VersionsPanel {
  el: HTMLElement;
  reload(): Promise<void>;
  /** Id em visualização (destaca a linha). */
  setViewing(id: number | null): void;
}

const fmt = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  return `${new Date(t).toLocaleString(getLocale(), { dateStyle: 'short', timeStyle: 'short' })} (${relativeTime(t, Date.now())})`;
};

export function createVersions(a: VersionsActions): VersionsPanel {
  const el = h('div', { class: 'med-versions' });
  const list = h('ul', { class: 'med-vlist' });
  const status = h('p', { class: 'med-hint', text: t('common.loading') });
  let viewing: number | null = null;
  let data: MapListDto | null = null;
  const reloadBtn = button(t('editor.versions.refresh'), () => void panel.reload(), 'transparent');
  el.append(section(t('editor.versions.title'), reloadBtn, status, list));

  function render(): void {
    list.replaceChildren();
    if (!data) return;
    const versions = data.maps.filter((m) => m.kind === 'version');
    status.textContent = versions.length ? '' : t('editor.versions.none');
    status.hidden = !versions.length ? false : true;
    for (const m of versions) {
      const s = m.stats ?? {};
      const badges = h('span', { class: 'med-vbadges' });
      if (m.current) badges.append(h('span', { class: 'of-badge of-badge--success', text: t('editor.versions.published') }));
      if (viewing === m.id) badges.append(h('span', { class: 'of-badge of-badge--blue', text: t('editor.versions.viewing') }));
      const del = button(t('common.delete'), () => a.remove(m), 'danger');
      del.disabled = m.current || versions.length <= 1;
      if (del.disabled) del.title = m.current ? t('editor.versions.cantDeleteCurrent') : t('editor.versions.cantDeleteOnly');
      const again = button(t('editor.versions.republish'), () => a.republish(m), 'transparent', t('editor.versions.republishTitle'));
      again.disabled = m.current;
      const stats = t('editor.versions.stats', { desks: s.desks ?? 0, seats: s.seats ?? 0, zones: s.zones ?? 0, warnings: s.warnings ? t('editor.versions.statsWarnings', { n: s.warnings }) : '' });
      list.append(
        h(
          'li',
          { class: `med-vitem${m.current ? ' is-current' : ''}${viewing === m.id ? ' is-viewing' : ''}` },
          h('div', { class: 'med-vitem__head' }, h('strong', { text: m.name }), badges),
          h('span', { class: 'med-hint', text: t('editor.versions.publishedAt', { id: m.id, when: fmt(m.published_at) }) }),
          h('span', { class: 'med-hint', text: stats }),
          h('div', { class: 'med-actions' }, button(viewing === m.id ? t('editor.versions.viewingBtn') : t('editor.versions.view'), () => a.view(m), 'transparent'), button(t('editor.versions.restore'), () => a.restore(m), 'transparent'), again, del),
        ),
      );
    }
  }

  const panel: VersionsPanel = {
    el,
    async reload() {
      status.hidden = false;
      status.textContent = t('common.loading');
      try {
        data = await a.load();
        render();
      } catch (e) {
        status.textContent = t('editor.versions.loadError', { error: e instanceof Error ? e.message : t('editor.error.unknown') });
      }
    },
    setViewing(id) {
      viewing = id;
      render();
    },
  };
  return panel;
}
