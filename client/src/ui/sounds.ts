// Sons de notificação (sintetizados, sem arquivos): mensagem recebida, batida na minha sala, alguém
// entrou na minha proximidade, resposta de batida e queda/expulsão. Respeita a preferência `sounds`
// (padrão ligado) e a política de autoplay: o AudioContext só nasce no primeiro gesto do usuário.
// Também pisca o título da aba quando chega mensagem com a aba oculta.
//
// Uso (em main.ts): `const sounds = mountSounds({ store, settings: () => store.self?.settings });`
// e `sounds.destroy()` ao desmontar.
import { DEFAULT_SOUND_SETTINGS } from '../audio/scheduler';
import { SoundBoard } from '../audio/board';
import type { OfficeClientStore } from '../net/world-store';
import { cueFor, flashTitle, newlyHeard, type CueEvent } from './sound-cues';

export interface SoundsOptions {
  store: OfficeClientStore;
  /** Preferências do usuário (lidas a cada evento). `sounds` ausente = ligado. */
  settings?: () => { sounds?: boolean } | null | undefined;
}

export interface SoundsHandle {
  /** Toca um aviso de teste (ex.: botão "Testar som"). Devolve se tocou. */
  test(): boolean;
  destroy(): void;
}

export function mountSounds(opts: SoundsOptions): SoundsHandle {
  const { store } = opts;
  const board = new SoundBoard();
  const enabled = (): boolean => opts.settings?.()?.sounds !== false;

  const unlock = (): void => {
    try {
      board.configure(true, DEFAULT_SOUND_SETTINGS);
      void board.unlock().catch(() => undefined);
    } catch {
      // sem áudio: segue mudo
    }
  };
  const gestureEvents = ['pointerdown', 'keydown', 'touchstart'] as const;
  const onGesture = (): void => {
    unlock();
    for (const e of gestureEvents) window.removeEventListener(e, onGesture, true);
  };
  if (typeof window !== 'undefined') for (const e of gestureEvents) window.addEventListener(e, onGesture, true);

  const emit = (ev: CueEvent): void => {
    try {
      const kind = cueFor(ev, { selfId: store.selfId, enabled: enabled() });
      if (!kind) return;
      board.configure(true, DEFAULT_SOUND_SETTINGS);
      board.play(kind);
    } catch {
      // nunca quebra a interface por causa de um som
    }
  };

  // --- título piscando
  const baseTitle = typeof document !== 'undefined' ? document.title : '';
  let unread = 0;
  const resetTitle = (): void => {
    unread = 0;
    if (typeof document !== 'undefined') document.title = baseTitle;
  };
  const onVisible = (): void => {
    if (!document.hidden) resetTitle();
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', resetTitle);
  }

  let prevHear: number[] | null = null;
  let prevConn = store.connection;
  const offs = [
    store.on('chat', (m) => {
      if (m.from === store.selfId) return;
      emit({ t: 'chat', scope: m.scope, from: m.from });
      if (typeof document !== 'undefined' && document.hidden) {
        unread++;
        document.title = flashTitle(baseTitle, unread);
      }
    }),
    store.on('knock', () => emit({ t: 'knock' })),
    store.on('knock_result', (m) => emit({ t: 'knock_result', allow: m.allow })),
    store.on('kick', () => emit({ t: 'kick' })),
    store.on('av', (av) => {
      const fresh = newlyHeard(prevHear, av.hear, store.selfId);
      prevHear = [...av.hear];
      if (fresh.length) emit({ t: 'near_join' });
    }),
    store.on('reset', () => {
      // novo snapshot (welcome): não toca "pop" por quem já estava
      prevHear = null;
    }),
    store.on('connection', (c) => {
      if (prevConn === 'open' && (c === 'closed' || c === 'reconnecting')) emit({ t: 'disconnect' });
      prevConn = c;
    }),
  ];
  prevHear = store.avSet ? [...store.avSet.hear] : null;

  return {
    test() {
      unlock();
      return board.play('note');
    },
    destroy() {
      for (const off of offs) off();
      if (typeof window !== 'undefined') {
        for (const e of gestureEvents) window.removeEventListener(e, onGesture, true);
        window.removeEventListener('focus', resetTitle);
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisible);
        if (unread) resetTitle();
      }
    },
  };
}
