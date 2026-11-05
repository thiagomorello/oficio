// PreviewStrip: 4 canvases (baixo/esquerda/cima/direita) com o ciclo de poses stand → walk → sit → type.
import type { Appearance, ArtModule, Dir, Pose } from '../../art/api';
import { t, type MessageKey } from '../../i18n';
import { h, prefersReducedMotion } from '../dom';

export const CYCLE_MS = 2400;

interface Step {
  id: string;
  /** Chave de i18n do botão da pose. */
  label: MessageKey;
  pose: Pose;
  seated?: boolean;
  /** Direção forçada (digitando é de costas). */
  dir?: Dir;
}

export const STEPS: readonly Step[] = [
  { id: 'stand', label: 'avatar.pose.stand', pose: 'stand' },
  { id: 'walk', label: 'avatar.pose.walk', pose: 'walk' },
  { id: 'sit', label: 'avatar.pose.sit', pose: 'sit', seated: true },
  { id: 'type', label: 'avatar.pose.type', pose: 'type', seated: true, dir: 'up' },
];

const DIRS: readonly Dir[] = ['down', 'left', 'up', 'right'];

export interface PreviewStrip {
  /** Os 4 canvases. */
  el: HTMLElement;
  /** Botões de pose (Auto + 4 poses). */
  controls: HTMLElement;
  setAppearance(a: Appearance): void;
  destroy(): void;
}

export function createPreviewStrip(art: ArtModule, opts: { scale: number; appearance: Appearance }): PreviewStrip {
  const { scale } = opts;
  let appearance = opts.appearance;
  let auto = !prefersReducedMotion();
  let fixed = 0;
  let dirty = true;
  let lastKey = '';
  let raf = 0;
  const t0 = performance.now();

  const canvases = DIRS.map((d) => {
    const c = h('canvas', { class: 'of-preview__canvas', attrs: { role: 'img', 'aria-label': t('avatar.previewAlt', { dir: t(`avatar.dir.${d}`) }) } });
    c.width = 24 * scale;
    c.height = 34 * scale;
    return c;
  });
  const el = h('div', { class: 'of-preview' }, ...canvases);

  const buttons: HTMLButtonElement[] = [];
  const mark = (): void => {
    buttons.forEach((b, i) => {
      const on = i === 0 ? auto : !auto && fixed === i - 1;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  };
  const mk = (label: string, onClick: () => void): HTMLButtonElement => {
    const b = h('button', { class: 'of-chip of-chip--sm', type: 'button', text: label, on: { click: () => { onClick(); mark(); dirty = true; } } });
    buttons.push(b);
    return b;
  };
  const controls = h(
    'div',
    { class: 'of-preview__poses', role: 'group', attrs: { 'aria-label': t('avatar.poseGroup') } },
    mk(t('avatar.pose.auto'), () => { auto = true; }),
    ...STEPS.map((s, i) => mk(t(s.label), () => { auto = false; fixed = i; })),
  );
  mark();

  function draw(step: Step, frame: number): void {
    canvases.forEach((c, i) => {
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.imageSmoothingEnabled = false;
      const dir = DIRS[i];
      const pose = step.dir && dir !== step.dir ? 'sit' : step.pose;
      const sprite = art.characterSprite({ appearance, dir, pose, frame, seated: step.seated });
      ctx.drawImage(sprite.canvas, 0, 0, sprite.canvas.width, sprite.canvas.height, 0, 0, c.width, c.height);
    });
  }

  function tick(now: number): void {
    const elapsed = now - t0;
    const step = auto ? STEPS[Math.floor(elapsed / CYCLE_MS) % STEPS.length] : STEPS[fixed];
    const reduced = prefersReducedMotion();
    // Cada pose usa a duração real dos quadros; no ciclo automático o relógio reinicia a cada troca de pose.
    const local = auto ? elapsed % CYCLE_MS : elapsed;
    const frame = reduced ? 0 : Math.floor(local / Math.max(1, art.poseFrameDuration(step.pose)));
    const n = Math.max(1, art.poseFrameCount(step.pose));
    const key = `${step.id}|${frame % n}`;
    if (dirty || key !== lastKey) {
      draw(step, frame % n);
      lastKey = key;
      dirty = false;
    }
    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);

  return {
    el,
    controls,
    setAppearance(a) {
      appearance = a;
      dirty = true;
    },
    destroy() {
      cancelAnimationFrame(raf);
    },
  };
}
