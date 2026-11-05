// Faixa de estado da conexão: conectando, sem conexão (com "Tentar agora") e sessão aberta em outro lugar.
import type { ConnectionState } from '../net/socket';
import { onLocaleChange, t } from '../i18n';
import type { PanelCtx } from './deps';
import { h, setHidden, setText } from './dom';

export interface ConnectionText {
  text: string;
  retry: boolean;
  tone: 'info' | 'warn' | 'error';
}

/** Texto da faixa para um estado de conexão (null = nada a mostrar). Puro (fora do idioma atual). */
export function connectionBanner(state: ConnectionState, retryInMs: number, kicked: 'replaced' | 'disabled' | 'session' | 'server' | null): ConnectionText | null {
  if (kicked === 'replaced') return { text: t('shell.conn.replaced'), retry: true, tone: 'warn' };
  if (kicked === 'disabled') return { text: t('shell.conn.disabled'), retry: false, tone: 'error' };
  if (kicked === 'session') return { text: t('shell.conn.session'), retry: false, tone: 'error' };
  if (kicked === 'server') return { text: t('shell.conn.server'), retry: true, tone: 'warn' };
  switch (state) {
    case 'open':
      return null;
    case 'idle':
    case 'connecting':
      return { text: t('shell.conn.connecting'), retry: false, tone: 'info' };
    case 'closed':
      return { text: t('shell.conn.closed'), retry: true, tone: 'warn' };
    case 'reconnecting':
      return { text: retryInMs > 0 ? t('shell.conn.reconnectingIn', { n: Math.max(1, Math.round(retryInMs / 1000)) }) : t('shell.conn.reconnecting'), retry: true, tone: 'warn' };
  }
}

export function createConnectionBanner(ctx: PanelCtx): { el: HTMLElement; destroy(): void } {
  const { store, socket } = ctx;
  let retryIn = 0;
  let kicked: 'replaced' | 'disabled' | 'session' | 'server' | null = null;
  const text = h('span');
  const retry = h('button', { class: 'of-btn of-btn--primary of-btn--sm', type: 'button' });
  retry.addEventListener('click', () => {
    kicked = null;
    socket.retryNow();
    render();
  });
  const el = h('div', { class: 'ui-conn of-alert', role: 'status', hidden: true }, text, retry);

  function render(): void {
    setText(retry, t('shell.conn.retryNow'));
    const b = connectionBanner(store.connection, retryIn, kicked);
    setHidden(el, !b);
    if (!b) return;
    setText(text, b.text);
    setHidden(retry, !b.retry);
    el.className = `ui-conn of-alert of-alert--${b.tone === 'info' ? 'info' : b.tone === 'error' ? 'error' : 'warning'}`;
  }
  const offs = [
    store.on('connection', (s) => {
      if (s === 'open') kicked = null;
      render();
    }),
    socket.on('retry', (ms) => {
      retryIn = ms;
      render();
    }),
    store.on('kick', (k) => {
      kicked = k.reason;
      render();
    }),
    socket.on('kick', (r) => {
      kicked = r;
      render();
    }),
    onLocaleChange(render),
  ];
  render();
  return {
    el,
    destroy() {
      for (const off of offs) off();
      el.remove();
    },
  };
}
