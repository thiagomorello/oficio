// Modal "Dispositivos" (centralizado, acima de tudo): microfone, câmera e alto-falante com o atual
// preselecionado, medidor de nível do microfone (LiveKit) e "Testar som". Esc ou clique fora fecham.
import { Track, createAudioAnalyser, type LocalAudioTrack, type Room } from 'livekit-client';
import { t } from '../i18n';
import { h } from '../ui/dom';
import { mountDevicePickers, type DeviceSwitcher } from './devices';

export interface DevicesModalManager extends DeviceSwitcher {
  readonly room: Room | null;
}

let openModal: { close(): void } | null = null;

/** Tom curto de teste na saída escolhida (quando o navegador deixa escolher). Nunca lança. */
export function playTestTone(sinkId?: string): void {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ac = new Ctor();
    const sink = (ac as unknown as { setSinkId?: (id: string) => Promise<void> }).setSinkId;
    if (sinkId && sink) void sink.call(ac, sinkId).catch(() => undefined);
    const t = ac.currentTime + 0.02;
    const notes: [number, number][] = [[660, 0], [880, 0.18]];
    for (const [f, dt] of notes) {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + dt);
      g.gain.exponentialRampToValueAtTime(0.2, t + dt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.35);
      o.connect(g).connect(ac.destination);
      o.start(t + dt);
      o.stop(t + dt + 0.4);
    }
    setTimeout(() => void ac.close().catch(() => undefined), 1200);
  } catch {
    // sem áudio: ignora
  }
}

/** Abre o modal (só um por vez). Devolve `close`. */
export function openDevicesModal(manager: DevicesModalManager): { close(): void } {
  openModal?.close();
  const prevFocus = document.activeElement as HTMLElement | null;

  const body = h('div', { class: 'av-devmodal__body' });
  const pickers = mountDevicePickers(body, manager);

  // medidor de nível do microfone
  const bar = h('div', { class: 'av-meter__bar' });
  const meter = h('div', { class: 'av-meter', role: 'meter', attrs: { 'aria-label': t('av.meter.label'), 'aria-valuemin': 0, 'aria-valuemax': 100 } }, bar);
  const meterNote = h('p', { class: 'of-caption av-devmodal__note', text: t('av.meter.hint') });
  const meterRow = h('div', { class: 'av-devices__row' }, h('span', { class: 'of-caption', text: t('av.meter.label') }), meter, meterNote);

  const testBtn = h('button', { class: 'of-btn of-btn--sm', type: 'button', text: t('av.testSound') });
  testBtn.addEventListener('click', () => {
    const sel = body.querySelector<HTMLSelectElement>('select[id*="audiooutput"]');
    playTestTone(sel && !sel.closest('[hidden]') ? sel.value || undefined : undefined);
  });
  const closeBtn = h('button', { class: 'of-btn of-btn--primary of-btn--sm', type: 'button', text: t('common.close') });
  const actions = h('div', { class: 'av-devmodal__actions' }, testBtn, closeBtn);

  const title = h('h2', { class: 'of-modal__title', text: t('av.devices.title'), attrs: { id: 'av-devmodal-title' } });
  const modal = h('div', { class: 'of-modal av-devmodal', role: 'dialog', attrs: { 'aria-modal': 'true', 'aria-labelledby': 'av-devmodal-title' } }, title, body, meterRow, actions);
  body.after(meterRow);
  // fora do #ui: `ui-root` traz os tokens da marca (sem ele o modal fica transparente)
  const overlay = h('div', { class: 'ui-root of-modal-overlay av-devmodal-overlay' }, modal);
  document.body.append(overlay);

  let analyser: ReturnType<typeof createAudioAnalyser> | null = null;
  let analyserTrack: LocalAudioTrack | null = null;
  let raf = 0;
  const stopAnalyser = (): void => {
    try {
      analyser?.cleanup();
    } catch {
      // ignora
    }
    analyser = null;
    analyserTrack = null;
  };
  const micTrack = (): LocalAudioTrack | null => {
    const pub = manager.room?.localParticipant?.getTrackPublication(Track.Source.Microphone);
    const t = pub?.audioTrack;
    return t && !pub?.isMuted ? (t as LocalAudioTrack) : null;
  };
  const tick = (): void => {
    raf = requestAnimationFrame(tick);
    try {
      const t = micTrack();
      if (t !== analyserTrack) {
        stopAnalyser();
        if (t) {
          analyser = createAudioAnalyser(t, { fftSize: 512, smoothingTimeConstant: 0.6 });
          analyserTrack = t;
        }
      }
      meterNote.hidden = !!analyser;
      const v = analyser ? Math.min(1, analyser.calculateVolume() * 2.2) : 0;
      bar.style.width = `${Math.round(v * 100)}%`;
      meter.setAttribute('aria-valuenow', String(Math.round(v * 100)));
    } catch {
      stopAnalyser();
    }
  };
  raf = requestAnimationFrame(tick);

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    cancelAnimationFrame(raf);
    stopAnalyser();
    pickers.destroy();
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    if (openModal === handle) openModal = null;
    try {
      prevFocus?.focus?.();
    } catch {
      // ignora
    }
  };
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      close();
    }
  };
  document.addEventListener('keydown', onKey, true);
  // Teclas digitadas no modal não chegam ao mundo (atalhos do jogo).
  overlay.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') ev.stopPropagation();
  });
  overlay.addEventListener('pointerdown', (ev) => {
    if (ev.target === overlay) close();
  });
  closeBtn.addEventListener('click', close);
  const handle = { close };
  openModal = handle;
  closeBtn.focus();
  return handle;
}
