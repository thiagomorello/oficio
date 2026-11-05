// Editor de mapa para admins (/admin/mapa). Carregado sob demanda pela página de admin.
//
// Layout: barra de ferramentas (modos, desfazer, overlays, zoom, salvar/publicar) · canvas · painel
// lateral (Paleta / Propriedades / Camadas / Problemas / Versões) · barra de status (estado do
// documento, zoom, tile sob o cursor, contagem de mesas/assentos/zonas).
//
// Só HTTP: `GET/PUT /api/admin/maps/draft`, `POST /api/admin/maps/{draft|id}/validate|publish`,
// `POST /api/admin/maps/:id/restore`, `POST /api/admin/maps/default`, `GET /api/admin/maps[/:id]`,
// `DELETE /api/admin/maps/:id`.
import './styles.css';
import * as artModule from '../art';
import type { ArtModule } from '../art/api';
import { api as defaultApi } from '../net/api';
import { migrateDoc, type OfficeMapDoc } from '../../../shared/map/doc';
import type { MapIssue, MapValidation } from '../../../shared/map/validate';
import { getLocale, t } from '../i18n';
import { h } from '../ui/dom';
import { Camera } from '../world/camera';
import { loadWorldAssets } from '../world/assets';
import { Autosave, type Conflict, type MapRowDto } from './autosave';
import type { EditorCtx, ToastKind, Tool } from './context';
import { DocStore } from './doc-store';
import { hitTest } from './hit';
import { opLabel, type EditOp } from './ops';
import { createLayers } from './panels/layers';
import { createPalette } from './panels/palette';
import { createProblems } from './panels/problems';
import { createProps } from './panels/props';
import { openPublishDialog } from './panels/publish-dialog';
import { confirmDialog, modalOpen, openModal } from './panels/ui';
import { createVersions, type MapListDto, type MapListItem } from './panels/versions';
import { EditorScene } from './scene';
import { bindShortcuts, shortcutHelp, type Shortcut } from './shortcuts';
import { canPublish, EditorState, MODE_KEYS, modeForKind, modeLabel, OVERLAY_KEYS, overlayLabel, type DocState, type Mode, type ModeKind } from './state';
import { stampLabel } from './stamps-ui';
import { createTools } from './tools/index';
import { pruneRefs, type Ref } from './types';
import { EditorView } from './view';

export interface EditorApi {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  del<T>(path: string): Promise<T>;
}

export interface MapEditorDeps {
  api?: EditorApi;
  art?: ArtModule;
  toast?(text: string, kind?: ToastKind): void;
}

export interface MapEditorHandle {
  destroy(): void;
}

type Tab = 'palette' | 'props' | 'layers' | 'problems' | 'versions';
const TABS: readonly Tab[] = ['palette', 'props', 'layers', 'problems', 'versions'];
const TOOLBAR_MODES: readonly ModeKind[] = ['select', 'place', 'floor', 'rug', 'area', 'zone', 'doorway', 'spawn', 'wallItem', 'spot'];
const KEY_OF: Partial<Record<ModeKind, string>> = Object.fromEntries(Object.entries(MODE_KEYS).map(([k, m]) => [m, k.toUpperCase()]));
const PALETTE_MODES = new Set<Mode['k']>(['place', 'wallItem', 'floor', 'rug', 'stamp', 'spot']);
const VALIDATE_MS = 300;

const hhmm = (d: Date) => d.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' });

export function docStateText(s: DocState, savedAt: Date | null): string {
  switch (s) {
    case 'clean':
      return savedAt ? t('editor.doc.savedAt', { time: hhmm(savedAt) }) : t('editor.doc.noChanges');
    case 'dirty':
      return t('editor.doc.dirty');
    case 'saving':
      return t('editor.doc.saving');
    case 'saved':
      return savedAt ? t('editor.doc.savedAt', { time: hhmm(savedAt) }) : t('editor.doc.saved');
    case 'conflict':
      return t('editor.doc.conflict');
  }
}

/** Monta o editor em `root`. Devolve `destroy()` para desmontar. */
export function mountMapEditor(root: HTMLElement, deps: MapEditorDeps = {}): MapEditorHandle {
  const api = deps.api ?? defaultApi;
  const art = deps.art ?? (artModule as ArtModule);
  const wrap = h('div', { class: 'med' });
  root.append(wrap);

  // ---- avisos
  const toastBox = deps.toast ? null : h('div', { class: 'of-toasts med-toasts', attrs: { 'aria-live': 'polite' } });
  if (toastBox) document.body.append(toastBox);
  const toast = (text: string, kind: ToastKind = 'info'): void => {
    if (deps.toast) return deps.toast(text, kind);
    const el = h('div', { class: `of-alert of-alert--${kind}`, role: kind === 'error' ? 'alert' : 'status', text });
    toastBox!.append(el);
    setTimeout(() => el.remove(), kind === 'error' ? 8000 : 4000);
  };

  const loading = h('div', { class: 'med-loading' }, h('p', { text: t('editor.loading') }));
  wrap.append(loading);

  let destroyed = false;
  let teardown: (() => void) | null = null;

  const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

  void (async () => {
    let row: MapRowDto;
    let doc: OfficeMapDoc;
    try {
      row = await api.get<MapRowDto>('/api/admin/maps/draft');
      doc = migrateDoc(row.doc, getLocale());
    } catch (e) {
      if (destroyed) return;
      loading.replaceChildren(
        h('p', { class: 'of-error-text', text: t('editor.loadError', { error: errText(e) }) }),
        h('button', { class: 'of-btn of-btn--secondary', type: 'button', text: t('editor.restoreDefault.title'), on: { click: () => void restoreDefaultFromError() } }),
      );
      return;
    }
    if (destroyed) return;
    loading.remove();
    teardown = build(row, doc);
  })();

  async function restoreDefaultFromError(): Promise<void> {
    if (!(await confirmDialog(t('editor.restoreDefault.title'), t('editor.restoreDefault.confirmShort'), t('editor.restoreDefault.action')))) return;
    try {
      const row = await api.post<MapRowDto>('/api/admin/maps/default');
      const doc = migrateDoc(row.doc, getLocale());
      loading.remove();
      teardown = build(row, doc);
    } catch (e) {
      toast(t('editor.failed', { error: errText(e) }), 'error');
    }
  }

  function build(row0: MapRowDto, doc0: OfficeMapDoc): () => void {
    const store = new DocStore(doc0);
    const state = new EditorState();
    const scene = new EditorScene();
    const camera = new Camera();
    let preview: { id: number; name: string; doc: OfficeMapDoc } | null = null;
    let issues: readonly MapIssue[] = [];
    let validation: MapValidation | null = null;
    let tools: ReturnType<typeof createTools>;
    let view: EditorView;
    let activeTab: Tab = 'palette';
    let props: ReturnType<typeof createProps>;

    const curDoc = () => preview?.doc ?? store.doc;
    const tool = (): Tool => tools.byMode[state.mode.k];

    const ctx: EditorCtx = {
      store,
      state,
      scene,
      art,
      camera,
      doc: curDoc,
      readOnly: () => !!preview || state.doc === 'conflict',
      exec(op: EditOp) {
        if (ctx.readOnly()) {
          toast(preview ? t('editor.readOnly.preview') : t('editor.readOnly.conflict'), 'warning');
          return false;
        }
        try {
          return store.exec(op);
        } catch (e) {
          toast(t('editor.opFailed', { op: opLabel(op), error: errText(e) }), 'error');
          return false;
        }
      },
      select(refs: Ref[]) {
        state.setSelection(refs);
        // da paleta para as propriedades ao selecionar algo (as outras abas ficam onde estão)
        if (refs.length && activeTab === 'palette' && !PALETTE_MODES.has(state.mode.k)) showTab('props');
      },
      setMode(m: Mode) {
        if (m.k !== state.mode.k) tool().cancel?.();
        state.setMode(m);
        if (PALETTE_MODES.has(m.k) && activeTab === 'props') showTab('palette');
      },
      hit: (wx, wy) => hitTest({ doc: curDoc(), index: scene.index, hidden: state.hiddenAreas, sprite: (x, y) => view.spriteAt(x, y) }, wx, wy),
      hover: null,
      toast,
      redraw: () => view?.redraw(),
      centerOn: (r) => view.centerOn(r),
      focusProp(name) {
        showTab('props');
        props.focus(name);
        props.refresh(true);
      },
    };

    tools = createTools(ctx);

    // ---------------------------------------------------------------- layout
    const modeBtns = new Map<ModeKind, HTMLButtonElement>();
    const modeBar = h('div', { class: 'med-modes', role: 'toolbar', attrs: { 'aria-label': t('editor.toolbar.tools') } });
    for (const k of TOOLBAR_MODES) {
      const b = h('button', { class: 'med-tool', type: 'button', title: `${modeLabel(k)} (${KEY_OF[k] ?? ''})`, attrs: { 'aria-pressed': 'false' } }, h('span', { text: modeLabel(k) }), h('kbd', { text: KEY_OF[k] ?? '' }));
      b.addEventListener('click', () => ctx.setMode(modeForKind(k, state.prefs)));
      modeBtns.set(k, b);
      modeBar.append(b);
    }
    const undoBtn = h('button', { class: 'med-tool', type: 'button', title: t('editor.toolbar.undo'), text: '↶' });
    const redoBtn = h('button', { class: 'med-tool', type: 'button', title: t('editor.toolbar.redo'), text: '↷' });
    undoBtn.addEventListener('click', () => run({ a: 'undo' }));
    redoBtn.addEventListener('click', () => run({ a: 'redo' }));
    const ovBtns = new Map<string, HTMLButtonElement>();
    const ovBar = h('div', { class: 'med-group', role: 'group', attrs: { 'aria-label': t('editor.toolbar.overlays') } });
    OVERLAY_KEYS.forEach((k, i) => {
      const b = h('button', { class: 'med-tool med-tool--toggle', type: 'button', title: `${overlayLabel(k)} (${i + 1})` }, h('span', { text: overlayLabel(k) }), h('kbd', { text: String(i + 1) }));
      b.addEventListener('click', () => state.toggleOverlay(k));
      ovBtns.set(k, b);
      ovBar.append(b);
    });
    const zoomOut = h('button', { class: 'med-tool', type: 'button', title: t('editor.toolbar.zoomOut'), text: '−' });
    const zoomIn = h('button', { class: 'med-tool', type: 'button', title: t('editor.toolbar.zoomIn'), text: '+' });
    const zoomFit = h('button', { class: 'med-tool', type: 'button', title: t('editor.toolbar.fit'), text: t('editor.toolbar.fitLabel') });
    zoomOut.addEventListener('click', () => view.zoomStep(-1));
    zoomIn.addEventListener('click', () => view.zoomStep(1));
    zoomFit.addEventListener('click', () => view.fit());
    const saveBtn = h('button', { class: 'of-btn of-btn--secondary of-btn--sm', type: 'button', text: t('common.save'), title: t('editor.toolbar.saveTitle') });
    saveBtn.addEventListener('click', () => run({ a: 'save' }));
    const defaultBtn = h('button', { class: 'of-btn of-btn--transparent of-btn--sm', type: 'button', text: t('editor.restoreDefault.button'), title: t('editor.restoreDefault.buttonTitle') });
    defaultBtn.addEventListener('click', () => void restoreDefault());
    const publishBtn = h('button', { class: 'of-btn of-btn--primary of-btn--sm', type: 'button', text: t('editor.publish'), title: t('editor.toolbar.publishTitle') });
    publishBtn.addEventListener('click', () => run({ a: 'publish' }));
    const helpBtn = h('button', { class: 'med-tool', type: 'button', title: t('editor.toolbar.help'), text: '?' });
    helpBtn.addEventListener('click', () => showHelp());
    const docPill = h('span', { class: 'med-docstate', attrs: { 'aria-live': 'polite' } });

    const toolbar = h(
      'div',
      { class: 'med-toolbar' },
      modeBar,
      h('div', { class: 'med-group' }, undoBtn, redoBtn),
      ovBar,
      h('div', { class: 'med-group' }, zoomOut, zoomIn, zoomFit),
      h('div', { class: 'med-spacer' }),
      docPill,
      saveBtn,
      defaultBtn,
      publishBtn,
      helpBtn,
    );
    const banner = h('div', { class: 'med-banner', hidden: true, role: 'status' });
    const stage = h('div', { class: 'med-stage' });

    const tabBtns = new Map<Tab, HTMLButtonElement>();
    const tabBar = h('div', { class: 'of-tabs med-tabs', role: 'tablist' });
    const panes = new Map<Tab, HTMLElement>();
    const paneBox = h('div', { class: 'med-pane' });
    for (const tab of TABS) {
      const b = h('button', { class: 'of-tab', type: 'button', role: 'tab', text: t(`editor.tab.${tab}`), attrs: { 'aria-selected': 'false', id: `med-tab-${tab}` } });
      b.addEventListener('click', () => showTab(tab));
      tabBtns.set(tab, b);
      tabBar.append(b);
    }
    const side = h('aside', { class: 'med-side' }, tabBar, paneBox);
    const body = h('div', { class: 'med-body' }, stage, side);
    const stDoc = h('span', { class: 'med-st med-st--doc' });
    const stMode = h('span', { class: 'med-st' });
    const stZoom = h('span', { class: 'med-st' });
    const stTile = h('span', { class: 'med-st' });
    const stCounts = h('span', { class: 'med-st med-st--counts' });
    const status = h('footer', { class: 'med-status' }, stDoc, stMode, stZoom, stTile, h('span', { class: 'med-spacer' }), stCounts);
    wrap.append(toolbar, banner, body, status);

    view = new EditorView(stage, ctx, art, camera, {
      tool,
      issues: () => (state.overlays.problems ? issues : []),
      pointer(p) {
        if (!p) {
          stTile.textContent = '';
          return;
        }
        const d = curDoc();
        const a = d.areas.find((x) => p.tx >= x.rect.x && p.ty >= x.rect.y && p.tx < x.rect.x + x.rect.w && p.ty < x.rect.y + x.rect.h);
        stTile.textContent = `${t('editor.status.tile', { x: p.tx, y: p.ty })}${a ? ` · ${a.name} (${p.tx - a.rect.x}, ${p.ty - a.rect.y})` : ''}`;
      },
    });
    void loadWorldAssets().then((a) => !destroyed && view.setAssets(a));

    // painéis
    const palette = createPalette(ctx);
    props = createProps(ctx, tools.select);
    const layers = createLayers(ctx);
    const problems = createProblems(ctx);
    const versions = createVersions({
      load: () => api.get<MapListDto>('/api/admin/maps'),
      view: (m) => void viewVersion(m),
      restore: (m) => void restoreVersion(m),
      republish: (m) => void republish(m),
      remove: (m) => void removeVersion(m),
    });
    panes.set('palette', palette.el);
    panes.set('props', props.el);
    panes.set('layers', layers.el);
    panes.set('problems', problems.el);
    panes.set('versions', versions.el);

    function showTab(t: Tab): void {
      activeTab = t;
      for (const [k, b] of tabBtns) {
        b.setAttribute('aria-selected', k === t ? 'true' : 'false');
        b.classList.toggle('is-active', k === t);
      }
      paneBox.replaceChildren(panes.get(t)!);
      if (t === 'versions') void versions.reload();
      if (t === 'props') props.refresh();
      if (t === 'layers') layers.refresh();
      if (t === 'problems') problems.render(scene.validated ? scene.validation() : validation, !scene.validated);
    }

    // ---------------------------------------------------------------- autosave
    const autosave = new Autosave(api, store, state, {
      conflict: (c) => showConflict(c),
      error: (m) => toast(m, 'error'),
      saved: () => renderChrome(),
    });
    autosave.loaded(row0);

    function showConflict(c: Conflict): void {
      const when = c.updatedAt ? t('editor.conflict.when', { time: hhmm(new Date(c.updatedAt)) }) : '';
      const who = c.by !== null && c.by !== undefined ? t('editor.conflict.who', { id: c.by }) : '';
      const reload = h('button', { class: 'of-btn of-btn--secondary of-btn--sm', type: 'button', text: t('editor.conflict.reload'), title: t('editor.conflict.reloadTitle') });
      const over = h('button', { class: 'of-btn of-btn--transparent of-btn--sm', type: 'button', text: t('editor.conflict.overwrite'), title: t('editor.conflict.overwriteTitle') });
      reload.addEventListener('click', () => void reloadDraft());
      over.addEventListener('click', () => {
        void autosave.overwrite().then((ok) => {
          if (ok) {
            hideBanner();
            toast(t('editor.conflict.overwritten'), 'success');
          }
        });
      });
      showBanner('conflict', t('editor.conflict.message', { when, who }), reload, over);
    }

    function showBanner(kind: 'conflict' | 'preview', text: string, ...actions: HTMLElement[]): void {
      banner.className = `med-banner med-banner--${kind}`;
      banner.replaceChildren(h('span', { text }), ...actions);
      banner.hidden = false;
    }
    function hideBanner(): void {
      banner.hidden = true;
      banner.replaceChildren();
    }

    function loadRow(row: MapRowDto, msg?: string): void {
      let doc: OfficeMapDoc;
      try {
        doc = migrateDoc(row.doc, getLocale());
      } catch (e) {
        toast(t('editor.invalidDoc', { error: errText(e) }), 'error');
        return;
      }
      preview = null;
      versions.setViewing(null);
      hideBanner();
      autosave.loaded(row);
      state.selection = [];
      store.load(doc);
      state.docEvent('load');
      view.updateBounds();
      view.fit();
      if (msg) toast(msg, 'success');
    }

    async function reloadDraft(): Promise<void> {
      try {
        loadRow(await api.get<MapRowDto>('/api/admin/maps/draft'), t('editor.draftReloaded'));
      } catch (e) {
        toast(t('editor.reloadError', { error: errText(e) }), 'error');
      }
    }

    async function restoreDefault(): Promise<void> {
      if (!(await confirmDialog(t('editor.restoreDefault.title'), t('editor.restoreDefault.confirm'), t('editor.restoreDefault.button')))) return;
      try {
        loadRow(await api.post<MapRowDto>('/api/admin/maps/default'), t('editor.restoreDefault.done'));
      } catch (e) {
        toast(t('editor.restoreDefault.error', { error: errText(e) }), 'error');
      }
    }

    async function viewVersion(m: MapListItem): Promise<void> {
      try {
        const row = await api.get<MapRowDto>(`/api/admin/maps/${m.id}`);
        const doc = migrateDoc(row.doc, getLocale());
        await autosave.flush();
        preview = { id: m.id, name: m.name, doc };
        state.selection = [];
        state.setMode({ k: 'select' });
        versions.setViewing(m.id);
        const back = h('button', { class: 'of-btn of-btn--secondary of-btn--sm', type: 'button', text: t('editor.version.back') });
        const restore = h('button', { class: 'of-btn of-btn--transparent of-btn--sm', type: 'button', text: t('editor.version.restore') });
        back.addEventListener('click', () => exitPreview());
        restore.addEventListener('click', () => void restoreVersion(m));
        showBanner('preview', t('editor.version.viewing', { name: m.name, id: m.id }), back, restore);
        onDocChanged();
        view.updateBounds();
      } catch (e) {
        toast(t('editor.version.openError', { error: errText(e) }), 'error');
      }
    }

    function exitPreview(): void {
      if (!preview) return;
      preview = null;
      versions.setViewing(null);
      hideBanner();
      state.selection = [];
      onDocChanged();
      view.updateBounds();
    }

    async function restoreVersion(m: MapListItem): Promise<void> {
      const extra = store.dirty ? t('editor.version.restoreUnsaved') : '';
      if (!(await confirmDialog(t('editor.version.restore'), t('editor.version.restoreConfirm', { name: m.name, extra }), t('editor.restoreDefault.action')))) return;
      try {
        loadRow(await api.post<MapRowDto>(`/api/admin/maps/${m.id}/restore`), t('editor.version.restored', { name: m.name }));
      } catch (e) {
        toast(t('editor.version.restoreError', { error: errText(e) }), 'error');
      }
    }

    async function republish(m: MapListItem): Promise<void> {
      if (!canPublish('saved', state.publish)) return;
      await openPublishDialog({ api, state, ref: m.id, title: t('editor.version.republishTitle', { name: m.name }), toast, published: () => void versions.reload() });
    }

    async function removeVersion(m: MapListItem): Promise<void> {
      if (!(await confirmDialog(t('editor.version.deleteTitle'), t('editor.version.deleteConfirm', { name: m.name, id: m.id }), t('common.delete'), true))) return;
      try {
        await api.del(`/api/admin/maps/${m.id}`);
        if (preview?.id === m.id) exitPreview();
        toast(t('editor.version.deleted'), 'success');
        await versions.reload();
      } catch (e) {
        toast(t('editor.version.deleteError', { error: errText(e) }), 'error');
      }
    }

    async function publishDraft(): Promise<void> {
      if (preview) return toast(t('editor.publish.backToDraft'), 'warning');
      if (state.doc === 'conflict') return toast(t('editor.publish.resolveConflict'), 'error');
      if (!canPublish(state.doc, state.publish)) {
        const ok = await autosave.flush();
        if (!ok || !canPublish(state.doc, state.publish)) return toast(t('editor.publish.saveFirst'), 'warning');
      }
      await openPublishDialog({
        api,
        state,
        ref: 'draft',
        title: t('editor.publish.draftTitle'),
        defaultName: '',
        toast,
        published: () => {
          if (activeTab === 'versions') void versions.reload();
        },
      });
    }

    function showHelp(): void {
      const close = h('button', { class: 'of-btn of-btn--primary', type: 'button', text: t('common.close') });
      const m = openModal(t('editor.help.title'), [
        h('table', { class: 'of-table med-help' }, h('tbody', {}, ...shortcutHelp().map(([k, d]) => h('tr', {}, h('td', {}, h('kbd', { text: k })), h('td', { text: d }))))),
        h('div', { class: 'med-modal-actions' }, close),
      ]);
      close.addEventListener('click', () => m.close());
    }

    // ---------------------------------------------------------------- atalhos
    function run(s: Shortcut): boolean {
      const ro = ctx.readOnly();
      switch (s.a) {
        case 'mode':
          ctx.setMode(modeForKind(s.kind, state.prefs));
          return true;
        case 'delete':
          tools.select.del();
          return true;
        case 'rotate':
          tools.select.rotate(s.reverse);
          return true;
        case 'variant':
          tools.select.cycle(s.step);
          return true;
        case 'undo':
          if (!ro && store.undo()) toast(t('editor.undone', { op: opLabel(store.peek('redo')!) }), 'info');
          return true;
        case 'redo':
          if (!ro && store.redo()) toast(t('editor.redone', { op: opLabel(store.peek('undo')!) }), 'info');
          return true;
        case 'copy':
          tools.select.copy();
          return true;
        case 'cut':
          tools.select.cut();
          return true;
        case 'paste':
          tools.select.paste();
          return true;
        case 'duplicate':
          tools.select.duplicate();
          return true;
        case 'escape':
          tool().cancel?.();
          state.escape();
          return true;
        case 'zoom':
          view.zoomStep(s.steps);
          return true;
        case 'fit':
          view.fit();
          return true;
        case 'overlay':
          state.toggleOverlay(s.k);
          return true;
        case 'save':
          void autosave.flush().then((ok) => ok && toast(t('editor.draftSaved'), 'success'));
          return true;
        case 'publish':
          void publishDraft();
          return true;
        case 'help':
          showHelp();
          return true;
        case 'nudge':
          if (state.selection.length && state.mode.k === 'select') tools.select.nudge(s.dx, s.dy);
          else {
            camera.panBy(-s.dx * 64, -s.dy * 64);
            view.redraw();
          }
          return true;
      }
    }

    const unbindKeys = bindShortcuts({
      run: (s) => run(s),
      toolKey: (e) => !!tool().key?.(e),
      space(down) {
        if (state.space === down) return;
        state.space = down;
        renderChrome();
      },
      shift(down) {
        state.shift = down;
      },
      active: () => !modalOpen() && !destroyed,
    });

    // ---------------------------------------------------------------- reações
    let validateTimer: ReturnType<typeof setTimeout> | undefined;
    function scheduleValidation(): void {
      clearTimeout(validateTimer);
      if (activeTab === 'problems') problems.render(validation, true);
      validateTimer = setTimeout(() => {
        validation = scene.validation();
        issues = validation ? [...validation.errors, ...validation.warnings] : [];
        if (activeTab === 'problems') problems.render(validation, false);
        tabBtns.get('problems')!.textContent = validation?.errors.length ? t('editor.tab.problemsErrors', { n: validation.errors.length }) : validation?.warnings.length ? t('editor.tab.problemsWarnings', { n: validation.warnings.length }) : t('editor.tab.problems');
        tabBtns.get('problems')!.classList.toggle('has-errors', !!validation?.errors.length);
        renderStatus();
        view.redraw();
      }, VALIDATE_MS);
    }

    let lastSize = '';
    function onDocChanged(): void {
      const doc = curDoc();
      scene.update(doc, state.hiddenAreas);
      view.invalidateMask();
      const sk = `${doc.size.w}x${doc.size.h}`;
      if (sk !== lastSize) {
        lastSize = sk;
        view.updateBounds();
      }
      const pruned = pruneRefs(doc, state.selection);
      if (pruned.length !== state.selection.length) state.selection = pruned;
      scheduleValidation();
      renderPanels();
      renderChrome();
      view.redraw();
    }

    const unStore = store.subscribe((_d, ev) => {
      if (ev.kind !== 'load') {
        state.docEvent('edit');
        autosave.schedule();
      }
      if (!preview) onDocChanged();
    });

    let lastHidden = '';
    const unState = state.subscribe(() => {
      const hk = [...state.hiddenAreas].join(',');
      if (hk !== lastHidden) {
        lastHidden = hk;
        scene.update(curDoc(), state.hiddenAreas);
        view.invalidateMask();
      }
      renderPanels();
      renderChrome();
      view.redraw();
    });

    function renderPanels(): void {
      palette.refresh();
      if (activeTab === 'props') props.refresh();
      if (activeTab === 'layers') layers.refresh();
    }

    function renderStatus(): void {
      const c = scene.counts();
      stCounts.textContent = t('editor.status.counts', { desks: c.desks, seats: c.seats, zones: c.zones });
      stZoom.textContent = t('editor.status.zoom', { pct: Math.round(camera.zoom * 100) });
    }

    function renderChrome(): void {
      const m = state.mode;
      for (const [k, b] of modeBtns) {
        const on = k === m.k || (k === 'place' && m.k === 'stamp');
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
      for (const [k, b] of ovBtns) {
        const on = state.overlays[k as keyof typeof state.overlays];
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
      const ro = ctx.readOnly();
      undoBtn.disabled = ro || !store.canUndo;
      redoBtn.disabled = ro || !store.canRedo;
      const ds = docStateText(state.doc, state.savedAt);
      docPill.textContent = preview ? t('editor.doc.readOnly') : ds;
      docPill.className = `med-docstate med-docstate--${preview ? 'preview' : state.doc}`;
      stDoc.textContent = preview ? t('editor.doc.viewing', { name: preview.name }) : ds;
      saveBtn.disabled = !!preview || state.doc === 'saving' || state.doc === 'conflict' || !store.dirty;
      publishBtn.disabled = !!preview || state.doc === 'conflict' || state.doc === 'saving' || state.publish === 'validating' || state.publish === 'publishing';
      publishBtn.title = state.doc === 'dirty' ? t('editor.toolbar.publishDirtyTitle') : t('editor.toolbar.publishTitle');
      defaultBtn.disabled = !!preview;
      stMode.textContent = m.k === 'stamp' ? t('editor.status.stamp', { label: stampLabel(m.stamp) }) : m.k === 'zone' && m.id ? t('editor.status.zone', { name: curDoc().zones.find((z) => z.id === m.id)?.name ?? m.id }) : modeLabel(m.k);
      view.canvas.style.cursor = state.space ? 'grab' : (tool().cursor ?? 'default');
      renderStatus();
    }

    // zoom muda sem eventos de estado: atualiza o rótulo devagar
    const zoomTimer = setInterval(() => {
      const z = t('editor.status.zoom', { pct: Math.round(camera.zoom * 100) });
      if (stZoom.textContent !== z) stZoom.textContent = z;
    }, 250);

    showTab('palette');
    onDocChanged();
    view.fit(false);

    return () => {
      clearTimeout(validateTimer);
      clearInterval(zoomTimer);
      unbindKeys();
      unStore();
      unState();
      autosave.dispose();
      view.destroy();
    };
  }

  return {
    destroy() {
      destroyed = true;
      teardown?.();
      toastBox?.remove();
      wrap.remove();
    },
  };
}
