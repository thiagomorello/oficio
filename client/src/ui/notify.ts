// Notificações (opt-in): Notification do navegador para alertas com a aba oculta e o contador no título da aba.
import { branding } from '../net/branding';

export type NotificationState = 'unsupported' | 'default' | 'granted' | 'denied';

export function notificationState(): NotificationState {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

/** Pede permissão de notificação ao ligar a opção. Devolve o estado final. */
export async function enableBrowserNotifications(): Promise<NotificationState> {
  const state = notificationState();
  if (state === 'unsupported' || state === 'denied' || state === 'granted') return state;
  try {
    return await Notification.requestPermission();
  } catch {
    return notificationState();
  }
}

/** Título da aba com o contador de pendências: "(2) Oficio". */
export function setTitleCount(count: number): void {
  const base = branding().appName;
  const title = count > 0 ? `(${count}) ${base}` : base;
  if (document.title !== title) document.title = title;
}

/** Notificação do navegador, só com a aba oculta e a permissão concedida. */
export function notifyHidden(title: string, body: string, onClick?: () => void): void {
  if (!document.hidden || notificationState() !== 'granted') return;
  try {
    const n = new Notification(title, { body });
    n.onclick = () => {
      window.focus();
      onClick?.();
      n.close();
    };
  } catch {
    // Alguns navegadores só permitem notificações via service worker.
  }
}
