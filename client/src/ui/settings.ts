// Configurações (popover da barra superior): sons, nomes, ausente automático, volume, minimapa e idioma.
// Salvas em /api/me/settings. O seletor de dispositivos de áudio/vídeo (WP8) entra no slot #settings-devices.
import type { UserSettings } from '../../../shared/model';
import { DEFAULT_SETTINGS } from '../../../shared/model';
import { api } from '../net/api';
import { chooseLocale, LOCALE_NAMES, onLocaleChange, storedLocale, SUPPORTED_LOCALES, t, type Locale, type MessageKey } from '../i18n';
import type { PanelCtx } from './deps';
import { h, setHidden, setText } from './dom';

export interface SettingsPopover {
  readonly el: HTMLElement;
  readonly isOpen: boolean;
  toggle(anchor?: HTMLElement): void;
  close(): void;
  /** Valor atual. */
  get(): UserSettings;
  /** Muda uma opção (grava e aplica). Usado também pelo atalho do minimapa. */
  set(patch: Partial<UserSettings>): void;
  onChange(cb: (s: UserSettings, patch: Partial<UserSettings>) => void): () => void;
  destroy(): void;
}

export function createSettings(ctx: PanelCtx): SettingsPopover {
  const { store, me } = ctx;
  const current = (): UserSettings => ({ ...DEFAULT_SETTINGS, ...(store.self?.settings ?? me.settings) });
  const cbs = new Set<(s: UserSettings, patch: Partial<UserSettings>) => void>();
  let open = false;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let pending: Partial<UserSettings> = {};

  // Textos fixos: elemento + chave, reaplicados na troca de idioma.
  const texts: Array<[HTMLElement, MessageKey]> = [];
  const labeled = (el: HTMLElement, key: MessageKey): HTMLElement => {
    texts.push([el, key]);
    return el;
  };

  const checks = new Map<keyof UserSettings, HTMLInputElement>();
  const row = (key: 'sounds' | 'showNames' | 'autoAway' | 'minimap', label: MessageKey, hint?: MessageKey) => {
    const input = h('input', { class: 'of-checkbox', type: 'checkbox', attrs: { id: `ui-set-${key}` } }) as HTMLInputElement;
    input.addEventListener('change', () => set({ [key]: input.checked }));
    checks.set(key, input);
    return h('label', { class: 'ui-setting', attrs: { for: `ui-set-${key}` } }, input, h('span', {}, labeled(h('span'), label), hint ? labeled(h('span', { class: 'of-caption ui-setting__hint' }), hint) : null));
  };
  const volume = h('input', { class: 'ui-range', type: 'range', attrs: { min: 0, max: 100, step: 5, id: 'ui-set-volume' } }) as HTMLInputElement;
  const volumeText = h('span', { class: 'of-caption ui-setting__value' });
  volume.addEventListener('input', () => {
    volumeText.textContent = `${volume.value}%`;
    set({ volume: Number(volume.value) / 100 });
  });

  // Idioma: "Automático" (navegador/instância) + um por idioma suportado. Persiste no navegador e no servidor.
  const lang = h('select', { class: 'of-select of-select--outlined', attrs: { id: 'ui-set-locale' } }) as HTMLSelectElement;
  const langAuto = labeled(h('option', { attrs: { value: '' } }), 'shell.settings.languageAuto');
  lang.append(langAuto);
  for (const l of SUPPORTED_LOCALES) lang.append(h('option', { text: LOCALE_NAMES[l], attrs: { value: l } }));
  lang.addEventListener('change', () => {
    const v = (lang.value || null) as Locale | null;
    chooseLocale(v);
    // `undefined` limpa localmente; o servidor só recebe chaves presentes no JSON (ver nota no relatório da tarefa).
    set({ locale: v ?? null });
  });

  const closeBtn = h('button', { class: 'ui-icon-btn', type: 'button', text: '×' });
  const devices = h('div', { class: 'ui-settings__devices', attrs: { id: 'settings-devices' } });
  const title = labeled(h('h3'), 'shell.settings.title');
  const el = h(
    'section',
    { class: 'ui-pop ui-settings of-panel of-panel--float', role: 'dialog', attrs: { id: 'ui-settings' }, hidden: true },
    h('header', { class: 'ui-drawer__head' }, title, closeBtn),
    row('sounds', 'shell.settings.sounds'),
    row('showNames', 'shell.settings.showNames'),
    row('autoAway', 'shell.settings.autoAway', 'shell.settings.autoAwayHint'),
    row('minimap', 'shell.settings.minimap', 'shell.settings.minimapHint'),
    h('div', { class: 'ui-setting ui-setting--range' }, labeled(h('label', { attrs: { for: 'ui-set-volume' } }), 'shell.settings.peerVolume'), volume, volumeText),
    h('div', { class: 'ui-setting ui-setting--select' }, labeled(h('label', { attrs: { for: 'ui-set-locale' } }), 'common.language'), lang),
    devices,
  );

  function applyTexts(): void {
    for (const [node, key] of texts) setText(node, t(key));
    volume.setAttribute('aria-label', t('shell.settings.volume'));
    closeBtn.title = t('shell.settings.close');
    closeBtn.setAttribute('aria-label', t('shell.settings.close'));
    el.setAttribute('aria-label', t('shell.settings.title'));
  }

  function sync(): void {
    const s = current();
    for (const [k, input] of checks) input.checked = !!s[k];
    volume.value = String(Math.round(s.volume * 100));
    volumeText.textContent = `${volume.value}%`;
    lang.value = storedLocale() ?? s.locale ?? '';
  }

  function flush(): void {
    saveTimer = null;
    const patch = pending;
    pending = {};
    if (!Object.keys(patch).length) return;
    api.put('/api/me/settings', { patch }).catch(() => ctx.notify(t('shell.settings.saveError'), 'warn'));
  }

  function set(patch: Partial<UserSettings>): void {
    const next = { ...current(), ...patch };
    if (store.self) store.self.settings = next;
    me.settings = next;
    Object.assign(pending, patch);
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 400);
    sync();
    for (const cb of cbs) cb(next, patch);
  }

  let anchorEl: HTMLElement | null = null;
  function place(): void {
    if (!anchorEl) return;
    const a = anchorEl.getBoundingClientRect();
    const w = el.offsetWidth || 320;
    el.style.top = `${Math.round(a.bottom + 8)}px`;
    el.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, Math.round(a.right - w)))}px`;
  }
  function setOpen(v: boolean, anchor?: HTMLElement): void {
    if (v === open) return;
    open = v;
    setHidden(el, !v);
    if (anchor) anchorEl = anchor;
    anchorEl?.setAttribute('aria-expanded', String(v));
    if (v) {
      sync();
      place();
      document.addEventListener('pointerdown', onOutside, true);
      document.addEventListener('keydown', onKey, true);
    } else {
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('keydown', onKey, true);
    }
  }
  function onOutside(e: Event): void {
    const t = e.target as Node | null;
    if (t && (el.contains(t) || anchorEl?.contains(t))) return;
    setOpen(false);
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      setOpen(false);
      anchorEl?.focus();
    }
  }
  closeBtn.addEventListener('click', () => setOpen(false));
  addEventListener('resize', place);
  const offLocale = onLocaleChange(() => {
    applyTexts();
    if (open) place();
  });
  applyTexts();
  sync();

  return {
    el,
    get isOpen() {
      return open;
    },
    toggle: (anchor) => setOpen(!open, anchor),
    close: () => setOpen(false),
    get: current,
    set,
    onChange(cb) {
      cbs.add(cb);
      return () => void cbs.delete(cb);
    },
    destroy() {
      setOpen(false);
      if (saveTimer) {
        clearTimeout(saveTimer);
        flush();
      }
      offLocale();
      removeEventListener('resize', place);
      el.remove();
    },
  };
}
