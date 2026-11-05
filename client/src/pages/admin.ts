// Página /admin: gestão de usuários (lista, busca, ações, novo usuário) e estatísticas.
// Idioma primeiro (síncrono), depois a marca (/api/config traz o padrão da instância) e só então o DOM. Ao trocar o
// idioma, cabeçalho/abas e a lista de usuários são redesenhados; a telemetria é remontada; o editor de mapa fica como está
// (trabalho não salvo) e cuida dos próprios textos.
import '../ui/brand.css';
import './admin.css';
import { chooseLocale, initLocale, LOCALE_NAMES, onLocaleChange, storedLocale, SUPPORTED_LOCALES, t, tn } from '../i18n';
import { api, ApiError } from '../net/api';
import { branding, loadBranding, pageTitle } from '../net/branding';
import { copyText, h } from '../ui/dom';
import { relativeTime } from '../ui/format';

interface AdminUser {
  id: number;
  name: string;
  email: string;
  roleName: string | null;
  isAdmin: boolean;
  status: 'active' | 'disabled';
  source: 'imported' | 'local';
  lastSeen: string | null;
  hasAvatar: boolean;
  deskId: string | null;
  needsPasswordChange: boolean;
}
interface Stats {
  online: number;
  loginsToday: number;
  desksClaimed: number;
  usersActive: number;
}
type Delivery = { emailed: true } | { emailed: false; tempPassword: string };

const PAGE_SIZE = 50;
/** /admin/mapa abre o editor de mapa (mesmo HTML de /admin). */
const onMapPage = /^\/admin\/mapa\/?$/.test(location.pathname);
/** /admin/telemetria abre o painel de telemetria (chunk separado). */
const onTelemetryPage = /^\/admin\/telemetria\/?$/.test(location.pathname);
const onUsersPage = !onMapPage && !onTelemetryPage;
const root = document.getElementById('app');
if (!root) throw new Error('#app ausente');
root.className = 'adm';

initLocale();

const errText = (e: unknown): string => (e instanceof ApiError ? e.message : t('common.genericError'));

// ---------- avisos ----------
const toastBox = h('div', { class: 'of-toasts', attrs: { 'aria-live': 'polite' } });
function toast(text: string, kind: 'success' | 'error' | 'info' | 'warning' = 'info'): void {
  const el = h('div', { class: `of-alert of-alert--${kind}`, role: kind === 'error' ? 'alert' : 'status', text });
  toastBox.append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 8000 : 5000);
}

// ---------- cabeçalho ----------
/** Seletor de idioma: "Automático" + idiomas suportados (mesma abordagem da tela de login). */
function languagePicker(): HTMLElement {
  const select = h('select', { class: 'of-select of-select--outlined adm-lang', attrs: { 'aria-label': t('common.language') } }) as HTMLSelectElement;
  select.append(h('option', { text: `${t('common.language')}: auto`, attrs: { value: '' } }));
  for (const l of SUPPORTED_LOCALES) select.append(h('option', { text: LOCALE_NAMES[l], attrs: { value: l } }));
  select.value = storedLocale() ?? '';
  select.addEventListener('change', () => chooseLocale((select.value || null) as never));
  return select;
}
function buildHeader(): HTMLElement {
  return h(
    'header',
    { class: 'adm-header' },
    h('img', { class: 'adm-logo', attrs: { src: branding().logoUrl, alt: branding().appName, 'data-brand-logo': '' } }),
    h('h1', { class: 'adm-title', text: t('admin.title') }),
    languagePicker(),
    h('a', { class: 'adm-back', text: t('common.backToOffice'), attrs: { href: '/' } }),
  );
}
function buildTabs(): HTMLElement {
  const tab = (active: boolean, text: string, href: string): HTMLElement => h('a', { class: `of-tab${active ? ' is-active' : ''}`, text, attrs: { href, 'aria-current': active ? 'page' : undefined } });
  return h(
    'nav',
    { class: 'of-tabs adm-tabs', attrs: { 'aria-label': t('admin.tabs.label') } },
    tab(onUsersPage, t('admin.tabs.users'), '/admin'),
    tab(onMapPage, t('admin.tabs.map'), '/admin/mapa'),
    tab(onTelemetryPage, t('admin.tabs.telemetry'), '/admin/telemetria'),
  );
}

// ---------- modais ----------
function openModal(title: string, ...content: Node[]): { close(): void; box: HTMLElement } {
  const prevFocus = document.activeElement as HTMLElement | null;
  const box = h('div', { class: 'of-modal', role: 'dialog', attrs: { 'aria-modal': 'true', 'aria-label': title } }, h('h2', { class: 'of-modal__title', text: title }), ...content);
  const overlay = h('div', { class: 'of-modal-overlay' }, box);
  const close = (): void => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    prevFocus?.focus?.();
  };
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') close();
  };
  overlay.addEventListener('mousedown', (ev) => {
    if (ev.target === overlay) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  box.querySelector<HTMLElement>('input,select,button')?.focus();
  return { close, box };
}

/** Mostra o resultado de criar/resetar: senha temporária copiável (uma única vez) ou aviso de e-mail. */
function showResult(title: string, temp: string | undefined, email: string): void {
  let m: ReturnType<typeof openModal>;
  const done = h('button', { class: 'of-btn of-btn--primary', type: 'button', text: t('admin.done'), on: { click: () => m.close() } });
  const kids: Node[] = [];
  if (temp === undefined) {
    kids.push(h('p', { text: t('admin.result.inviteSent', { email }) }));
  } else {
    const code = h('code', { class: 'adm-temp', text: temp });
    const copy = h('button', { class: 'of-btn of-btn--secondary', type: 'button', text: t('admin.copy') });
    copy.addEventListener('click', () => {
      void copyText(temp).then((ok) => {
        copy.textContent = ok ? t('admin.copied') : t('admin.copyManually');
      });
    });
    kids.push(h('p', { text: t('admin.result.tempPassword', { email }) }), h('div', { class: 'adm-temp-box' }, code, copy));
  }
  kids.push(h('div', { class: 'adm-modal-actions' }, done));
  m = openModal(title, ...kids);
}

// ---------- usuários ----------
/** Filtros e página atuais: sobrevivem ao redesenho por troca de idioma. */
const state = { search: '', status: 'all', page: 1, total: 0 };
let closeMenu: (() => void) | null = null;

/** Monta a aba de usuários (estatísticas, filtros, tabela, paginação) e dispara as cargas iniciais. */
function mountUsers(): HTMLElement {
  // ---------- estatísticas ----------
  const statEls = {
    online: h('strong', { text: '–' }),
    loginsToday: h('strong', { text: '–' }),
    desksClaimed: h('strong', { text: '–' }),
    usersActive: h('strong', { text: '–' }),
  };
  const statCard = (label: string, value: HTMLElement): HTMLElement => h('div', { class: 'of-card adm-stat' }, value, h('span', { class: 'of-caption', text: label }));
  const statsStrip = h(
    'section',
    { class: 'adm-stats', attrs: { 'aria-label': t('admin.stats.label') } },
    statCard(t('admin.stats.online'), statEls.online),
    statCard(t('admin.stats.loginsToday'), statEls.loginsToday),
    statCard(t('admin.stats.desksClaimed'), statEls.desksClaimed),
    statCard(t('admin.stats.usersActive'), statEls.usersActive),
  );
  async function loadStats(): Promise<void> {
    try {
      const s = await api.get<Stats>('/api/admin/stats');
      for (const k of Object.keys(statEls) as (keyof Stats)[]) statEls[k].textContent = String(s[k]);
    } catch (e) {
      toast(errText(e), 'error');
    }
  }

  // ---------- filtros ----------
  const searchInput = h('input', { class: 'of-input of-input--outlined adm-search', type: 'search', attrs: { placeholder: t('admin.search.placeholder'), 'aria-label': t('admin.search.label'), autocomplete: 'off' } });
  searchInput.value = state.search;
  const statusSel = h('select', { class: 'of-select of-select--outlined', attrs: { 'aria-label': t('admin.filter.status') } });
  for (const [v, l] of [
    ['all', t('admin.filter.all')],
    ['active', t('admin.filter.active')],
    ['disabled', t('admin.filter.disabled')],
  ] as const)
    statusSel.append(h('option', { text: l, attrs: { value: v } }));
  statusSel.value = state.status;
  const newBtn = h('button', { class: 'of-btn of-btn--primary', type: 'button', text: t('admin.action.newUser') });
  const toolbar = h('div', { class: 'adm-toolbar' }, searchInput, statusSel, newBtn);

  let debounce: ReturnType<typeof setTimeout> | undefined;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      state.search = searchInput.value.trim();
      state.page = 1;
      void loadUsers();
    }, 300);
  });
  statusSel.addEventListener('change', () => {
    state.status = statusSel.value;
    state.page = 1;
    void loadUsers();
  });

  // ---------- tabela ----------
  const cols = { name: t('admin.col.name'), email: t('admin.col.email'), role: t('admin.col.role'), status: t('admin.col.status'), source: t('admin.col.source'), lastSeen: t('admin.col.lastSeen'), desk: t('admin.col.desk') };
  const tbody = h('tbody');
  const table = h(
    'table',
    { class: 'of-table adm-table' },
    h('thead', {}, h('tr', {}, ...[...Object.values(cols), ''].map((label) => h('th', { text: label, attrs: { scope: 'col' } })))),
    tbody,
  );
  const emptyMsg = h('p', { class: 'of-caption adm-empty', text: t('admin.users.empty'), hidden: true });
  const pager = h('div', { class: 'adm-pager' });

  function cell(label: string, ...kids: (Node | string)[]): HTMLElement {
    return h('td', { attrs: { 'data-label': label } }, ...kids);
  }

  function renderRows(rows: AdminUser[]): void {
    tbody.replaceChildren();
    const now = Date.now();
    for (const u of rows) {
      const name = h('span', { class: 'adm-name', text: u.name });
      const flags = h('span', { class: 'adm-flags' });
      if (u.isAdmin) flags.append(h('span', { class: 'of-badge of-badge--purple', text: t('admin.badge.admin') }));
      if (u.needsPasswordChange) flags.append(h('span', { class: 'of-badge of-badge--warn', text: t('admin.badge.tempPassword') }));
      const actions = h('button', { class: 'of-btn of-btn--transparent of-btn--sm adm-actions-btn', type: 'button', text: t('admin.actions'), attrs: { 'aria-haspopup': 'menu', 'aria-label': t('admin.actionsFor', { name: u.name }) } });
      actions.addEventListener('click', (ev) => {
        ev.stopPropagation();
        openMenu(actions, u);
      });
      const tr = h(
        'tr',
        { class: u.status === 'disabled' ? 'is-disabled' : '' },
        cell(cols.name, name, flags),
        cell(cols.email, u.email),
        cell(cols.role, u.roleName ?? '–'),
        cell(cols.status, h('span', { class: `of-badge ${u.status === 'active' ? 'of-badge--success' : 'of-badge--danger'}`, text: u.status === 'active' ? t('admin.status.active') : t('admin.status.disabled') })),
        cell(cols.source, h('span', { class: `of-badge ${u.source === 'imported' ? 'of-badge--blue' : 'of-badge--gray'}`, text: u.source === 'imported' ? t('admin.source.imported') : t('admin.source.local') })),
        cell(cols.lastSeen, u.lastSeen ? relativeTime(Date.parse(u.lastSeen), now) : t('admin.never')),
        cell(cols.desk, u.deskId ?? '–'),
        cell('', actions),
      );
      tbody.append(tr);
    }
    emptyMsg.hidden = rows.length > 0;
    table.hidden = rows.length === 0;
  }

  function renderPager(): void {
    const pages = Math.max(1, Math.ceil(state.total / PAGE_SIZE));
    const prev = h('button', { class: 'of-btn of-btn--secondary of-btn--sm', type: 'button', text: t('admin.pager.prev') });
    const next = h('button', { class: 'of-btn of-btn--secondary of-btn--sm', type: 'button', text: t('admin.pager.next') });
    prev.disabled = state.page <= 1;
    next.disabled = state.page >= pages;
    prev.addEventListener('click', () => {
      state.page--;
      void loadUsers();
    });
    next.addEventListener('click', () => {
      state.page++;
      void loadUsers();
    });
    pager.replaceChildren(h('span', { class: 'of-caption', text: `${tn('admin.users.count', state.total)} · ${t('admin.pager.pageOf', { page: state.page, pages })}` }), prev, next);
  }

  let loadSeq = 0;
  async function loadUsers(): Promise<void> {
    const seq = ++loadSeq;
    const q = new URLSearchParams({ search: state.search, status: state.status, page: String(state.page), pageSize: String(PAGE_SIZE) });
    try {
      const r = await api.get<{ rows: AdminUser[]; total: number }>(`/api/admin/users?${q}`);
      if (seq !== loadSeq) return;
      state.total = r.total;
      renderRows(r.rows);
      renderPager();
    } catch (e) {
      if (seq === loadSeq) toast(errText(e), 'error');
    }
  }

  // ---------- menu de ações ----------
  function openMenu(anchor: HTMLElement, u: AdminUser): void {
    closeMenu?.();
    const item = (label: string, run: () => void | Promise<void>, disabled = false): HTMLElement => {
      const b = h('button', { class: 'of-menu__item', type: 'button', text: label, attrs: { role: 'menuitem' } });
      b.disabled = disabled;
      b.addEventListener('click', () => {
        closeMenu?.();
        void Promise.resolve(run()).catch((e: unknown) => toast(errText(e), 'error'));
      });
      return h('li', { role: 'none' }, b);
    };
    const menu = h(
      'ul',
      { class: 'of-menu adm-menu', role: 'menu' },
      item(u.status === 'active' ? t('admin.action.disable') : t('admin.action.enable'), () =>
        patchUser(u, { status: u.status === 'active' ? 'disabled' : 'active' }, u.status === 'active' ? t('admin.toast.userDisabled') : t('admin.toast.userEnabled')),
      ),
      item(u.isAdmin ? t('admin.action.removeAdmin') : t('admin.action.makeAdmin'), () => patchUser(u, { isAdmin: !u.isAdmin }, u.isAdmin ? t('admin.toast.adminRemoved') : t('admin.toast.nowAdmin'))),
      item(t('admin.action.resetPassword'), () => resetPassword(u)),
      item(
        t('admin.action.releaseDesk'),
        async () => {
          await api.del(`/api/admin/users/${u.id}/desk`);
          toast(t('admin.toast.deskReleased'), 'success');
          await Promise.all([loadUsers(), loadStats()]);
        },
        !u.deskId,
      ),
    );
    const r = anchor.getBoundingClientRect();
    document.body.append(menu);
    const left = Math.max(8, Math.min(r.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8));
    const below = r.bottom + 4 + menu.offsetHeight <= innerHeight;
    menu.style.left = `${left}px`;
    menu.style.top = `${below ? r.bottom + 4 : Math.max(8, r.top - menu.offsetHeight - 4)}px`;
    menu.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
    const onDoc = (ev: Event): void => {
      if (!menu.contains(ev.target as Node)) closeMenu?.();
    };
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') {
        closeMenu?.();
        anchor.focus();
      }
    };
    setTimeout(() => document.addEventListener('click', onDoc), 0);
    document.addEventListener('keydown', onKey);
    closeMenu = () => {
      document.removeEventListener('click', onDoc);
      document.removeEventListener('keydown', onKey);
      menu.remove();
      closeMenu = null;
    };
  }

  async function patchUser(u: AdminUser, patch: Record<string, unknown>, okMsg: string): Promise<void> {
    await api.patch(`/api/admin/users/${u.id}`, patch);
    toast(okMsg, 'success');
    await Promise.all([loadUsers(), loadStats()]);
  }

  async function resetPassword(u: AdminUser): Promise<void> {
    if (!confirm(t('admin.confirm.resetPassword', { name: u.name }))) return;
    const r = await api.post<{ user: AdminUser } & Delivery>(`/api/admin/users/${u.id}/reset-password`);
    await loadUsers();
    showResult(t('admin.result.passwordReset', { name: u.name }), r.emailed ? undefined : r.tempPassword, u.email);
  }

  async function openNewUser(): Promise<void> {
    let roles: string[] = [];
    try {
      roles = (await api.get<{ roles: string[] }>('/api/admin/roles')).roles;
    } catch {
      // segue só com texto livre
    }
    const name = h('input', { class: 'of-input of-input--filled', type: 'text', attrs: { id: 'nu-name', required: true, maxlength: 120, autocomplete: 'off' } });
    const email = h('input', { class: 'of-input of-input--filled', type: 'email', attrs: { id: 'nu-email', required: true, autocomplete: 'off', autocapitalize: 'off', spellcheck: false } });
    const role = h('input', { class: 'of-input of-input--filled', type: 'text', attrs: { id: 'nu-role', list: 'nu-roles', maxlength: 80, autocomplete: 'off', placeholder: t('admin.newUser.rolePlaceholder') } });
    const list = h('datalist', { attrs: { id: 'nu-roles' } }, ...roles.map((r) => h('option', { attrs: { value: r } })));
    const admin = h('input', { class: 'of-checkbox', type: 'checkbox', attrs: { id: 'nu-admin' } });
    const err = h('p', { class: 'of-error-text', role: 'alert' });
    const submit = h('button', { class: 'of-btn of-btn--primary', type: 'submit', text: t('admin.newUser.submit') });
    const field = (label: string, id: string, input: HTMLElement, extra?: Node): HTMLElement => h('div', { class: 'adm-field' }, h('label', { text: label, attrs: { for: id } }), input, extra);
    let m: ReturnType<typeof openModal>;
    const cancel = h('button', { class: 'of-btn of-btn--transparent', type: 'button', text: t('common.cancel'), on: { click: () => m.close() } });
    const form = h(
      'form',
      { class: 'adm-form', attrs: { novalidate: true } },
      field(cols.name, 'nu-name', name),
      field(cols.email, 'nu-email', email),
      field(cols.role, 'nu-role', role, list),
      h('label', { class: 'adm-check' }, admin, ` ${t('admin.newUser.isAdmin')}`),
      err,
      h('div', { class: 'adm-modal-actions' }, cancel, submit),
    );
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      err.textContent = '';
      if (!name.value.trim() || !email.value.includes('@')) {
        err.textContent = t('admin.newUser.error');
        return;
      }
      submit.disabled = true;
      api
        .post<{ user: AdminUser } & Delivery>('/api/admin/users', { name: name.value.trim(), email: email.value.trim(), roleName: role.value.trim() || undefined, isAdmin: admin.checked })
        .then(async (r) => {
          m.close();
          await Promise.all([loadUsers(), loadStats()]);
          showResult(t('admin.result.userCreated'), r.emailed ? undefined : r.tempPassword, r.user.email);
        })
        .catch((e: unknown) => {
          err.textContent = errText(e);
          submit.disabled = false;
        });
    });
    m = openModal(t('admin.newUser.title'), form);
  }
  newBtn.addEventListener('click', () => void openNewUser());

  void loadStats();
  void loadUsers();
  return h('main', { class: 'adm-main' }, statsStrip, toolbar, h('div', { class: 'adm-table-wrap' }, table, emptyMsg), pager);
}

// ---------- montagem ----------
let header: HTMLElement;
let tabs: HTMLElement;
/** Redesenha o cabeçalho e as abas no idioma atual (mesmo lugar no DOM). */
function redrawChrome(): void {
  const nh = buildHeader();
  const nt = buildTabs();
  header.replaceWith(nh);
  tabs.replaceWith(nt);
  header = nh;
  tabs = nt;
}

function mountMapPage(): void {
  // /admin/mapa: o editor vem num chunk separado (só quem abre a aba baixa a arte/editor)
  root!.classList.add('adm--map');
  const host = h('main', { class: 'adm-map', attrs: { 'aria-label': t('admin.map.label') } }, h('p', { class: 'of-caption adm-empty', text: t('admin.map.loading') }));
  root!.append(header, tabs, host, toastBox);
  import('../editor/index')
    .then(({ mountMapEditor }) => {
      host.replaceChildren();
      mountMapEditor(host, { toast });
    })
    .catch(() => {
      host.replaceChildren(h('p', { class: 'of-error-text adm-empty', text: t('admin.map.loadError') }));
    });
}

function mountTelemetryPage(): void {
  const host = h('main', { class: 'adm-main', attrs: { 'aria-label': t('admin.telemetry.label') } }, h('p', { class: 'of-caption adm-empty', text: t('admin.telemetry.loading') }));
  root!.append(header, tabs, host, toastBox);
  import('./admin-telemetry')
    .then(({ mountTelemetry }) => {
      let stop: (() => void) | null = null;
      const start = (): void => {
        stop?.();
        host.replaceChildren();
        host.setAttribute('aria-label', t('admin.telemetry.label'));
        stop = mountTelemetry(host, { toast });
      };
      start();
      onLocaleChange(start);
    })
    .catch(() => {
      host.replaceChildren(h('p', { class: 'of-error-text adm-empty', text: t('admin.telemetry.loadError') }));
    });
}

function mountUsersPage(): void {
  let main = mountUsers();
  root!.append(header, tabs, main, toastBox);
  onLocaleChange(() => {
    closeMenu?.();
    const next = mountUsers();
    main.replaceWith(next);
    main = next;
  });
}

async function boot(): Promise<void> {
  const cfg = await loadBranding();
  initLocale(cfg.defaultLocale);
  const setTitle = (): void => {
    document.title = pageTitle(t('admin.pageTitle'));
  };
  setTitle();
  header = buildHeader();
  tabs = buildTabs();
  onLocaleChange(setTitle);
  onLocaleChange(redrawChrome);
  if (onMapPage) mountMapPage();
  else if (onTelemetryPage) mountTelemetryPage();
  else mountUsersPage();
}

void boot();
