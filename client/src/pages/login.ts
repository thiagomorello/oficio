// Página /login: entrar, esqueci a senha, redefinir (?reset=<token>) e troca obrigatória (?change=1).
import '../ui/brand.css';
import './login.css';
import { api, ApiError } from '../net/api';
import { branding, loadBranding, pageTitle } from '../net/branding';
import { chooseLocale, initLocale, LOCALE_NAMES, onLocaleChange, storedLocale, SUPPORTED_LOCALES, t, getLocale } from '../i18n';
import { h } from '../ui/dom';

type View = 'login' | 'forgot' | 'reset' | 'change';

const params = new URLSearchParams(location.search);

/** Só caminhos internos: evita open redirect via ?next=//evil.com. */
export function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\') || raw.startsWith('/login')) return '/';
  return raw;
}
const next = safeNext(params.get('next'));
const resetToken = params.get('reset');

const root = document.getElementById('app');
if (!root) throw new Error('#app ausente');
root.className = 'login-page';

function field(id: string, label: string, type: string, autocomplete: string, value = ''): { wrap: HTMLElement; input: HTMLInputElement } {
  const input = h('input', { class: 'of-input of-input--filled', type, attrs: { id, name: id, autocomplete, required: true, spellcheck: false, autocapitalize: 'off' } });
  input.value = value;
  return { wrap: h('div', { class: 'login-field' }, h('label', { text: label, attrs: { for: id } }), input), input };
}

function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return t('common.tooManyAttempts');
    return err.message;
  }
  return t('common.genericError');
}

/** Seletor de idioma do rodapé: "Automático" + idiomas suportados. */
function languagePicker(): HTMLElement {
  const select = h('select', { class: 'of-select of-select--outlined login-lang', attrs: { 'aria-label': t('common.language') } }) as HTMLSelectElement;
  select.append(h('option', { text: `${t('common.language')}: auto`, attrs: { value: '' } }));
  for (const l of SUPPORTED_LOCALES) select.append(h('option', { text: LOCALE_NAMES[l], attrs: { value: l } }));
  select.value = storedLocale() ?? '';
  select.addEventListener('change', () => chooseLocale((select.value || null) as never));
  return select;
}

let lastEmail = '';

function render(view: View, notice?: string): void {
  root!.replaceChildren();
  const error = h('p', { class: 'login-error', role: 'alert' });
  const submit = h('button', { class: 'of-btn of-btn--primary of-btn--lg', type: 'submit' });
  const setBusy = (busy: boolean, label: string): void => {
    submit.disabled = busy;
    submit.replaceChildren(...(busy ? [h('span', { class: 'login-spinner' }), label] : [label]));
  };
  const form = h('form', { class: 'login-form', attrs: { novalidate: true } });
  const links = h('div', { class: 'login-links' });
  const link = (text: string, to: View): HTMLElement => h('button', { class: 'of-btn of-btn--transparent', type: 'button', text, on: { click: () => draw(to) } });

  const titles: Record<View, [string, string]> = {
    login: [t('login.title.login'), t('login.sub.login')],
    forgot: [t('login.title.forgot'), t('login.sub.forgot')],
    reset: [t('login.title.reset'), t('login.sub.reset')],
    change: [t('login.title.change'), t('login.sub.change')],
  };
  const label = { login: t('login.action.login'), forgot: t('login.action.sendLink'), reset: t('login.action.savePassword'), change: t('login.action.savePassword') }[view];
  setBusy(false, label);

  let run: () => Promise<void>;
  if (view === 'login') {
    const email = field('email', t('login.field.email'), 'email', 'username', lastEmail);
    const pw = field('password', t('login.field.password'), 'password', 'current-password');
    form.append(email.wrap, pw.wrap);
    links.append(link(t('login.link.forgot'), 'forgot'));
    run = async () => {
      lastEmail = email.input.value.trim();
      if (!lastEmail || !pw.input.value) throw new Error(t('login.error.emailAndPassword'));
      const r = await api.post<{ user: { mustChangePassword: boolean } }>('/api/auth/login', { email: lastEmail, password: pw.input.value });
      location.href = r.user.mustChangePassword ? '/login?change=1' : next;
    };
  } else if (view === 'forgot') {
    const email = field('email', t('login.field.email'), 'email', 'username', lastEmail);
    form.append(email.wrap);
    links.append(link(t('login.link.backToLogin'), 'login'));
    run = async () => {
      lastEmail = email.input.value.trim();
      if (!lastEmail) throw new Error(t('login.error.email'));
      const r = await api.post<{ ok: boolean; manual?: boolean }>('/api/auth/forgot', { email: lastEmail });
      draw('login', r.manual ? t('login.notice.mailNotConfigured') : t('login.notice.linkSent'));
    };
  } else {
    const pw = field('new-password', t('login.field.newPassword'), 'password', 'new-password');
    const pw2 = field('new-password2', t('login.field.repeatPassword'), 'password', 'new-password');
    form.append(pw.wrap, pw2.wrap);
    if (view === 'change') links.append(h('button', { class: 'of-btn of-btn--transparent', type: 'button', text: t('login.link.signOut'), on: { click: () => void api.post('/api/auth/logout').finally(() => (location.href = '/login')) } }));
    else links.append(link(t('login.link.backToLogin'), 'login'));
    run = async () => {
      if (pw.input.value.length < 8) throw new Error(t('login.error.passwordLength'));
      if (pw.input.value !== pw2.input.value) throw new Error(t('login.error.passwordMismatch'));
      if (view === 'reset') {
        await api.post('/api/auth/reset', { token: resetToken, password: pw.input.value });
        history.replaceState(null, '', '/login');
        draw('login', t('login.notice.passwordChanged'));
      } else {
        await api.post('/api/auth/change-password', { password: pw.input.value });
        location.href = next;
      }
    };
  }

  form.append(error, submit);
  form.addEventListener('submit', (ev) => {
    ev.preventDefault(); // Enter dentro de um campo dispara submit
    if (submit.disabled) return;
    error.textContent = '';
    setBusy(true, label);
    run().then(
      () => undefined,
      (err: unknown) => {
        error.textContent = err instanceof Error && !(err instanceof ApiError) ? err.message : errorText(err);
        setBusy(false, label);
      },
    );
  });

  const [title, sub] = titles[view];
  root!.append(
    h(
      'main',
      { class: 'login-card' },
      h('img', { class: 'login-logo', attrs: { src: branding().logoUrl, alt: branding().appName, 'data-brand-logo': '' } }),
      h('h1', { class: 'login-title', text: title }),
      h('p', { class: 'login-sub', text: sub }),
      notice ? h('p', { class: 'login-ok', role: 'status', text: notice }) : null,
      form,
      links,
      h('div', { class: 'login-footer' }, languagePicker()),
    ),
  );
  form.querySelector('input')?.focus();
}

/** Idioma primeiro (síncrono: escolha salva/navegador), depois a marca (/api/config traz o padrão da instância). */
initLocale();
let currentView: View = resetToken ? 'reset' : params.has('change') ? 'change' : 'login';
let currentNotice: string | undefined;
const draw = (view: View = currentView, notice?: string): void => {
  currentView = view;
  currentNotice = notice;
  document.title = pageTitle(t('login.pageTitle'));
  render(view, notice);
};
onLocaleChange(() => draw(currentView, currentNotice));
void loadBranding().then((cfg) => {
  if (initLocale(cfg.defaultLocale) === getLocale()) draw();
});
draw();
