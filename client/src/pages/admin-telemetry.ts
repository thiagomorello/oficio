// /admin/telemetria: resumo por usuário (24 h / 7 d) e linha do tempo de eventos com sparkline de RTT/FPS.
// Carregado sob demanda pela página do admin (chunk separado). Atualiza a cada 30 s.
// Os textos saem de `t()` no momento da montagem: ao trocar o idioma, a página do admin desmonta e monta de novo.
import type { TelemetryEventView, TelemetryUserSummary } from '../../../shared/telemetry';
import { getLocale, t } from '../i18n';
import { api, ApiError } from '../net/api';
import { h } from '../ui/dom';
import { formatClock, relativeTime } from '../ui/format';
import { avLabel, EVENT_KINDS, countLevel, fpsLevel, kindLabel, niceRange, rttLevel, shortData, sparkSeries, type Level, type SparkPoint } from './admin-telemetry-logic';

export interface TelemetryPanelOptions {
  toast(text: string, kind?: 'success' | 'error' | 'info' | 'warning'): void;
}

const REFRESH_MS = 30_000;
const errText = (e: unknown): string => (e instanceof ApiError ? e.message : t('common.genericError'));
const n1 = (v: number | null, suffix = ''): string => (v === null ? '–' : `${Math.round(v)}${suffix}`);
const badge = (text: string, level: Level, title?: string): HTMLElement => h('span', { class: `tel-val tel-val--${level}`, text, title });

/** Data e hora curtas ("15/10 12:00:20") no idioma atual; o formatador é refeito quando o idioma muda. */
const timeFmtCache = new Map<string, Intl.DateTimeFormat>();
function formatTime(d: Date | number): string {
  const locale = getLocale();
  let f = timeFmtCache.get(locale);
  if (!f) timeFmtCache.set(locale, (f = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })));
  return f.format(d);
}

type Col = 'person' | 'online' | 'sessions' | 'rttAvg' | 'rttP95' | 'fpsAvg' | 'rejects' | 'jumps' | 'disconnects' | 'errors' | 'av' | 'lastSeen';
const COLS: readonly Col[] = ['person', 'online', 'sessions', 'rttAvg', 'rttP95', 'fpsAvg', 'rejects', 'jumps', 'disconnects', 'errors', 'av', 'lastSeen'];
const col = (c: Col): string => t(`telemetry.col.${c}`);

export function mountTelemetry(host: HTMLElement, opts: TelemetryPanelOptions): () => void {
  const state = { since: '24h', userId: null as number | null, kind: '', rows: [] as TelemetryUserSummary[] };

  // ---------- barra
  const sinceSel = h('select', { class: 'of-select of-select--outlined', attrs: { 'aria-label': t('telemetry.since.label') } });
  for (const [v, l] of [
    ['24h', t('telemetry.since.24h')],
    ['7d', t('telemetry.since.7d')],
  ] as const)
    sinceSel.append(h('option', { text: l, attrs: { value: v } }));
  const refreshBtn = h('button', { class: 'of-btn of-btn--secondary of-btn--sm', type: 'button', text: t('telemetry.refresh') });
  const updated = h('span', { class: 'of-caption tel-updated', text: '' });
  const toolbar = h('div', { class: 'adm-toolbar' }, sinceSel, refreshBtn, updated);

  // ---------- tabela de usuários
  const tbody = h('tbody');
  const table = h('table', { class: 'of-table adm-table tel-table' }, h('thead', {}, h('tr', {}, ...COLS.map((c) => h('th', { text: col(c), attrs: { scope: 'col' } })))), tbody);
  const emptyMsg = h('p', { class: 'of-caption adm-empty', text: t('telemetry.summary.empty'), hidden: true });

  // ---------- detalhe
  const detailTitle = h('h2', { class: 'tel-detail-title', text: '' });
  const kindSel = h('select', { class: 'of-select of-select--outlined', attrs: { 'aria-label': t('telemetry.kind.filter') } });
  kindSel.append(h('option', { text: t('telemetry.kind.all'), attrs: { value: '' } }));
  for (const k of EVENT_KINDS) kindSel.append(h('option', { text: kindLabel(k), attrs: { value: k } }));
  const closeBtn = h('button', { class: 'of-btn of-btn--transparent of-btn--sm', type: 'button', text: t('common.close') });
  const canvas = h('canvas', { class: 'tel-spark', attrs: { role: 'img', 'aria-label': t('telemetry.spark.label') } });
  const legend = h(
    'div',
    { class: 'tel-legend of-caption' },
    h('span', { class: 'tel-dot tel-dot--rtt' }),
    'RTT (ms)',
    h('span', { class: 'tel-dot tel-dot--fps' }),
    'FPS',
    h('span', { class: 'tel-spark-range', text: '' }),
  );
  const evBody = h('tbody');
  const evTable = h(
    'table',
    { class: 'of-table tel-events' },
    h('thead', {}, h('tr', {}, ...[t('telemetry.ev.when'), t('telemetry.ev.kind'), t('telemetry.ev.session'), t('telemetry.ev.data')].map((label) => h('th', { text: label, attrs: { scope: 'col' } })))),
    evBody,
  );
  const evEmpty = h('p', { class: 'of-caption adm-empty', text: t('telemetry.ev.empty'), hidden: true });
  const detail = h(
    'section',
    { class: 'of-card tel-detail', hidden: true, attrs: { 'aria-label': t('telemetry.detail.label') } },
    h('div', { class: 'tel-detail-head' }, detailTitle, kindSel, closeBtn),
    h('div', { class: 'tel-spark-wrap' }, canvas, legend),
    h('div', { class: 'adm-table-wrap tel-events-wrap' }, evTable, evEmpty),
  );

  host.append(h('p', { class: 'of-caption', text: t('telemetry.intro') }), toolbar, h('div', { class: 'adm-table-wrap' }, table, emptyMsg), detail);

  // ---------- render
  const cell = (c: Col, ...kids: (Node | string)[]): HTMLElement => h('td', { attrs: { 'data-label': col(c) } }, ...kids);

  function renderRows(): void {
    const now = Date.now();
    tbody.replaceChildren(
      ...state.rows.map((r) => {
        const name = r.name ?? `#${r.userId}`;
        const tr = h(
          'tr',
          { class: `tel-row${state.userId === r.userId ? ' is-selected' : ''}`, tabIndex: 0, attrs: { 'aria-label': t('telemetry.viewEventsOf', { name }) } },
          cell('person', h('span', { class: 'adm-name', text: name })),
          cell('online', r.online ? h('span', { class: 'of-badge of-badge--success', text: t('telemetry.online') }) : h('span', { class: 'of-caption', text: '–' })),
          cell('sessions', String(r.sessions)),
          cell('rttAvg', badge(n1(r.rttAvg, ' ms'), rttLevel(r.rttAvg))),
          cell('rttP95', badge(n1(r.rttP95, ' ms'), rttLevel(r.rttP95))),
          cell('fpsAvg', badge(n1(r.fpsAvg), fpsLevel(r.fpsAvg))),
          cell('rejects', badge(String(r.rejects), countLevel(r.rejects, 10))),
          cell('jumps', badge(String(r.jumps), countLevel(r.jumps, 10))),
          cell('disconnects', badge(String(r.disconnects), countLevel(r.disconnects, 3))),
          cell('errors', badge(String(r.errors), countLevel(r.errors, 3))),
          cell('av', r.lastAv ? badge(avLabel(r.lastAv), r.lastAv === 'connected' ? 'ok' : r.lastAv === 'reconnecting' || r.lastAv === 'connecting' ? 'warn' : r.lastAv === 'unavailable' ? 'bad' : 'none') : '–'),
          cell('lastSeen', h('span', { text: relativeTime(Date.parse(r.lastSeen), now), title: formatTime(new Date(r.lastSeen)) })),
        );
        const open = (): void => selectUser(r.userId);
        tr.addEventListener('click', open);
        tr.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            open();
          }
        });
        return tr;
      }),
    );
    table.hidden = state.rows.length === 0;
    emptyMsg.hidden = state.rows.length !== 0;
  }

  function drawSpark(points: SparkPoint[]): void {
    const cssW = Math.max(200, canvas.clientWidth || 600);
    const cssH = 90;
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.height = `${cssH}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    const range = legend.querySelector('.tel-spark-range') as HTMLElement;
    if (points.length < 2) {
      ctx.fillStyle = '#8a8a8a';
      ctx.font = '12px Poppins, system-ui, sans-serif';
      ctx.fillText(t('telemetry.spark.noSamples'), 8, cssH / 2);
      range.textContent = '';
      return;
    }
    const t0 = points[0]!.t;
    const t1 = points[points.length - 1]!.t;
    const pad = 4;
    const x = (ts: number): number => pad + ((ts - t0) / Math.max(1, t1 - t0)) * (cssW - pad * 2);
    const css = getComputedStyle(host);
    const series: { key: 'rtt' | 'fps'; color: string; span: number }[] = [
      { key: 'rtt', color: css.getPropertyValue('--accent').trim() || '#7c9cff', span: 40 },
      { key: 'fps', color: css.getPropertyValue('--blue-300').trim() || '#6fa8ff', span: 20 },
    ];
    const labels: string[] = [];
    // grade leve
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    for (const gy of [0.25, 0.5, 0.75]) {
      ctx.beginPath();
      ctx.moveTo(0, Math.round(cssH * gy) + 0.5);
      ctx.lineTo(cssW, Math.round(cssH * gy) + 0.5);
      ctx.stroke();
    }
    for (const s of series) {
      const vals = points.map((p) => p[s.key]).filter((v): v is number => v !== null);
      if (!vals.length) continue;
      const [lo, hi] = niceRange(vals, s.span);
      const y = (v: number): number => cssH - pad - ((v - lo) / Math.max(1, hi - lo)) * (cssH - pad * 2);
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let started = false;
      let prevT = 0;
      for (const p of points) {
        const v = p[s.key];
        // buraco > 60 s (aba fechada/offline): quebra a linha
        if (v === null || (started && p.t - prevT > 60_000)) {
          started = false;
          if (v === null) continue;
        }
        if (!started) ctx.moveTo(x(p.t), y(v));
        else ctx.lineTo(x(p.t), y(v));
        started = true;
        prevT = p.t;
      }
      ctx.stroke();
      labels.push(`${s.key.toUpperCase()} ${Math.round(Math.min(...vals))}–${Math.round(Math.max(...vals))}`);
    }
    range.textContent = ` · ${labels.join(' · ')} · ${formatTime(new Date(t0))} → ${formatTime(new Date(t1))}`;
  }

  function renderEvents(rows: TelemetryEventView[]): void {
    evBody.replaceChildren(
      ...rows.map((e) =>
        h(
          'tr',
          { class: `tel-ev tel-ev--${e.kind}` },
          h('td', { class: 'tel-ev-time', text: formatTime(new Date(e.at)) }),
          h('td', {}, h('span', { class: `of-badge ${kindBadge(e.kind)}`, text: kindLabel(e.kind) })),
          h('td', { class: 'tel-ev-session', text: e.sessionId === 'server' ? t('telemetry.ev.server') : e.sessionId.slice(0, 8), title: e.sessionId }),
          h('td', { class: 'tel-ev-data', text: shortData(e.kind, e.data), title: JSON.stringify(e.data ?? {}, null, 1).slice(0, 2000) }),
        ),
      ),
    );
    evTable.hidden = rows.length === 0;
    evEmpty.hidden = rows.length !== 0;
  }

  // ---------- dados
  let seq = 0;
  async function loadSummary(): Promise<void> {
    const my = ++seq;
    try {
      const r = await api.get<{ rows: TelemetryUserSummary[] }>(`/api/admin/telemetry/summary?since=${encodeURIComponent(state.since)}`);
      if (my !== seq) return;
      state.rows = r.rows;
      renderRows();
      updated.textContent = t('telemetry.updatedAt', { time: formatClock(Date.now(), true) });
    } catch (e) {
      opts.toast(errText(e), 'error');
    }
  }

  let evSeq = 0;
  async function loadDetail(): Promise<void> {
    const id = state.userId;
    if (id === null) return;
    const my = ++evSeq;
    const base = `/api/admin/telemetry/events?user=${id}&since=${encodeURIComponent(state.since)}`;
    try {
      const [events, samples] = await Promise.all([
        api.get<{ rows: TelemetryEventView[] }>(`${base}&limit=300${state.kind ? `&kind=${encodeURIComponent(state.kind)}` : ''}`),
        api.get<{ rows: TelemetryEventView[] }>(`${base}&kind=sample&limit=1000`),
      ]);
      if (my !== evSeq || state.userId !== id) return;
      renderEvents(events.rows);
      drawSpark(sparkSeries(samples.rows));
    } catch (e) {
      opts.toast(errText(e), 'error');
    }
  }

  function selectUser(id: number | null): void {
    state.userId = id;
    detail.hidden = id === null;
    renderRows();
    if (id === null) return;
    const r = state.rows.find((x) => x.userId === id);
    detailTitle.textContent = t('telemetry.eventsOf', { name: r?.name ?? `#${id}` });
    evBody.replaceChildren();
    void loadDetail();
    detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const refresh = (): void => {
    void loadSummary();
    void loadDetail();
  };
  sinceSel.addEventListener('change', () => {
    state.since = sinceSel.value;
    refresh();
  });
  kindSel.addEventListener('change', () => {
    state.kind = kindSel.value;
    void loadDetail();
  });
  refreshBtn.addEventListener('click', refresh);
  closeBtn.addEventListener('click', () => selectUser(null));

  const timer = window.setInterval(() => {
    if (!document.hidden) refresh();
  }, REFRESH_MS);
  void loadSummary();

  return () => window.clearInterval(timer);
}

function kindBadge(kind: string): string {
  switch (kind) {
    case 'js_error':
    case 'av_error':
    case 'ws_drop':
    case 'avatar_editor_error':
      return 'of-badge--danger';
    case 'moved_reject':
    case 'pos_jump':
    case 'kick':
    case 'map_fallback':
      return 'of-badge--warn';
    case 'sample':
      return 'of-badge--gray';
    case 'av_status':
      return 'of-badge--purple';
    case 'socket':
    case 'ws_connect':
    case 'ws_disconnect':
      return 'of-badge--blue';
    default:
      return 'of-badge--gray';
  }
}
