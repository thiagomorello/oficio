// Entrada do escritório: teclado (andar, sentar, emotes, atalhos), clique (selecionar, sentar,
// mesa, andar até) e câmera (arrastar, pinça, roda). As regras de tecla e de clique são funções
// puras (`resolveKey`, `DirKeys`, `classifyClick`), testadas no node.
import type { Dir, Emote } from '../../../shared/model';
import { deskAtTile } from '../../../shared/map/desks';
import type { OfficeAssembly } from '../../../shared/map/types';
import type { Camera } from './camera';

export type KeyAction =
  /** Tecla de direção (WASD/setas): o chamador acompanha keydown/keyup via `DirKeys`. */
  | { kind: 'dir'; dir: Dir }
  /** `E`: sentar no assento livre a ≤ 1 tile. */
  | { kind: 'sit' }
  /** `Enter`: senta se houver assento perto e estiver em pé; senão foca o chat. */
  | { kind: 'enter' }
  | { kind: 'stand' }
  | { kind: 'emote'; emote: Emote }
  | { kind: 'minimap' }
  | { kind: 'help' }
  | { kind: 'overview' }
  | { kind: 'follow' }
  | { kind: 'zoom'; steps: number };

/** Emotes das teclas 1..4. */
export const EMOTE_KEYS: readonly Emote[] = ['raise_hand', 'cheer', 'laugh', 'stretch'];

const DRAG_THRESHOLD = 5;

const DIR_CODES: Readonly<Record<string, Dir>> = {
  KeyW: 'up',
  KeyA: 'left',
  KeyS: 'down',
  KeyD: 'right',
  ArrowUp: 'up',
  ArrowLeft: 'left',
  ArrowDown: 'down',
  ArrowRight: 'right',
};

const DIR_KEYS: Readonly<Record<string, Dir>> = {
  w: 'up',
  a: 'left',
  s: 'down',
  d: 'right',
  arrowup: 'up',
  arrowleft: 'left',
  arrowdown: 'down',
  arrowright: 'right',
};

/** Identificador estável de uma tecla de direção (code quando houver; senão a tecla). */
export function dirKeyId(e: { key: string; code?: string }): string | null {
  if (e.code && DIR_CODES[e.code]) return e.code;
  const k = e.key.toLowerCase();
  return DIR_KEYS[k] ? k : null;
}

/** Direção de uma tecla (code/key) ou null. */
export function dirOfKey(e: { key: string; code?: string }): Dir | null {
  if (e.code && DIR_CODES[e.code]) return DIR_CODES[e.code];
  return DIR_KEYS[e.key.toLowerCase()] ?? null;
}

/** Ação de uma tecla apertada (sem modificadores Ctrl/Meta/Alt), ou null se não é do mundo. */
export function resolveKey(e: { key: string; code?: string; shiftKey?: boolean }): KeyAction | null {
  const dir = dirOfKey(e);
  // Shift + direção (WASD ou setas) corre; a câmera se move arrastando o mapa.
  if (dir) return { kind: 'dir', dir };
  switch (e.key) {
    case 'e':
    case 'E':
      return { kind: 'sit' };
    case 'Enter':
      return { kind: 'enter' };
    case 'x':
    case 'X':
      return { kind: 'stand' };
    case '1':
    case '2':
    case '3':
    case '4':
      return { kind: 'emote', emote: EMOTE_KEYS[Number(e.key) - 1] };
    case 'm':
    case 'M':
      return { kind: 'minimap' };
    case '?':
      return { kind: 'help' };
    case '0':
      return { kind: 'overview' };
    case 'f':
    case 'F':
      return { kind: 'follow' };
    case '+':
    case '=':
      return { kind: 'zoom', steps: 1 };
    case '-':
    case '_':
      return { kind: 'zoom', steps: -1 };
    default:
      return null;
  }
}

/**
 * Teclas de direção seguradas: a direção vale a da última apertada que ainda está segurada.
 * `press`/`release` devolvem a direção resultante (null = nenhuma).
 */
export class DirKeys {
  private held: { id: string; dir: Dir }[] = [];

  press(id: string, dir: Dir): Dir | null {
    this.held = this.held.filter((h) => h.id !== id);
    this.held.push({ id, dir });
    return dir;
  }

  release(id: string): Dir | null {
    this.held = this.held.filter((h) => h.id !== id);
    return this.current();
  }

  clear(): void {
    this.held = [];
  }

  current(): Dir | null {
    return this.held.length ? this.held[this.held.length - 1].dir : null;
  }
}

export type ClickAction =
  | { kind: 'select'; id: number }
  | { kind: 'sit'; spot: string }
  | { kind: 'desk'; desk: string }
  | { kind: 'move'; tx: number; ty: number };

/** O que um clique faz: avatar -> seleciona; assento -> senta; mesa -> menu da mesa; senão anda. */
export function classifyClick(assembly: Pick<OfficeAssembly, 'spots' | 'deskAtTile' | 'deskById'>, tx: number, ty: number, avatarHit: number | null, world?: { x: number; y: number }): ClickAction {
  if (avatarHit !== null) return { kind: 'select', id: avatarHit };
  const seat = seatNearPoint(assembly, tx, ty, world);
  if (seat) return { kind: 'sit', spot: seat };
  const desk = deskAtTile(assembly, tx, ty);
  if (desk) return { kind: 'desk', desk: desk.id };
  return { kind: 'move', tx, ty };
}

/** Assento sob o ponto: pelo pixel (cadeiras deslocadas com dx/dy) ou, sem ponto, pelo tile. */
export function seatNearPoint(assembly: Pick<OfficeAssembly, 'spots'>, tx: number, ty: number, world?: { x: number; y: number }): string | null {
  if (world) {
    let best: { id: string; d: number } | null = null;
    for (const s of assembly.spots) {
      if (!s.seated) continue;
      const dx = Math.abs(s.x - world.x);
      const dy = Math.abs(s.y - 6 - world.y);
      if (dx <= 9 && dy <= 12) {
        const d = dx + dy;
        if (!best || d < best.d) best = { id: s.id, d };
      }
    }
    if (best) return best.id;
  }
  for (const s of assembly.spots) if (s.seated && s.tx === tx && s.ty === ty) return s.id;
  return null;
}

export interface InputHandlers {
  /** Avatar sob o ponto da tela (id) ou null. */
  pick(sx: number, sy: number): number | null;
  click(sx: number, sy: number, hit: number | null, e: { shiftKey: boolean }): void;
  /** Botão direito / toque longo. */
  rightClick(sx: number, sy: number, hit: number | null): void;
  doubleClick(sx: number, sy: number, hit: number | null): void;
  hover(sx: number, sy: number, inside: boolean): void;
  /** O usuário mexeu na câmera (deixa de seguir). */
  interact(): void;
  zoomStep(steps: number, sx?: number, sy?: number): void;
  key(action: Exclude<KeyAction, { kind: 'dir' | 'zoom' }>): void;
  /** Direção segurada mudou (null = soltou todas). */
  dir(dir: Dir | null, run: boolean): void;
}

/** Há um diálogo modal/popover aberto, ou o foco do teclado está dentro de um? */
function modalOpen(target: HTMLElement | null): boolean {
  if (target?.closest?.('dialog, [popover], [role="dialog"], [aria-modal="true"]')) return true;
  if (typeof document === 'undefined') return false;
  if (document.querySelector('dialog[open], [aria-modal="true"]')) return true;
  try {
    return !!document.querySelector(':popover-open');
  } catch {
    return false;
  }
}

function typingIn(t: HTMLElement | null): boolean {
  return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

export function attachInput(canvas: HTMLCanvasElement, camera: Camera, h: InputHandlers): () => void {
  const pointers = new Map<number, { x: number; y: number }>();
  let downX = 0;
  let downY = 0;
  let dragging = false;
  let pinch: { dist: number; zoom: number; cx: number; cy: number } | null = null;
  let wheelAcc = 0;
  let wheelSettle: ReturnType<typeof setTimeout> | null = null;
  let lastTap = { t: 0, x: 0, y: 0 };
  const dirs = new DirKeys();
  let run = false;
  let sentDir: Dir | null = null;
  let sentRun = false;
  canvas.style.touchAction = 'none';
  canvas.style.cursor = 'default';

  const emitDir = () => {
    const d = dirs.current();
    const r = d ? run : false;
    if (d === sentDir && r === sentRun) return;
    sentDir = d;
    sentRun = r;
    h.dir(d, r);
  };

  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const p = local(e);
    pointers.set(e.pointerId, p);
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // ponteiro já liberado
    }
    if (pointers.size === 1) {
      downX = p.x;
      downY = p.y;
      dragging = false;
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: camera.zoom, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      dragging = true;
      h.interact();
    }
  };

  const onMove = (e: PointerEvent) => {
    const p = local(e);
    const prev = pointers.get(e.pointerId);
    if (!prev) {
      if (e.pointerType === 'mouse') h.hover(p.x, p.y, true);
      return;
    }
    pointers.set(e.pointerId, p);
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      camera.panBy(cx - pinch.cx, cy - pinch.cy);
      camera.zoomAt(pinch.zoom * (dist / pinch.dist), cx, cy, Date.now(), false);
      pinch.cx = cx;
      pinch.cy = cy;
      return;
    }
    if (!dragging && Math.hypot(p.x - downX, p.y - downY) > DRAG_THRESHOLD) {
      dragging = true;
      canvas.style.cursor = 'grabbing';
      h.interact();
    }
    if (dragging) camera.panBy(p.x - prev.x, p.y - prev.y);
  };

  const onUp = (e: PointerEvent) => {
    const p = local(e);
    const had = pointers.delete(e.pointerId);
    if (!had) return;
    if (pinch && pointers.size < 2) {
      pinch = null;
      camera.settle(Date.now());
      return;
    }
    if (pointers.size > 0) return;
    canvas.style.cursor = 'default';
    if (dragging) {
      dragging = false;
      return;
    }
    const hit = h.pick(p.x, p.y);
    if (e.pointerType !== 'mouse') {
      const now = performance.now();
      if (now - lastTap.t < 320 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 24) {
        h.doubleClick(p.x, p.y, hit);
        lastTap = { t: 0, x: 0, y: 0 };
        return;
      }
      lastTap = { t: now, x: p.x, y: p.y };
    }
    h.click(p.x, p.y, hit, { shiftKey: e.shiftKey });
  };

  const onCancel = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!pointers.size) {
      dragging = false;
      canvas.style.cursor = 'default';
    }
  };

  const onLeave = () => h.hover(0, 0, false);

  const onCtx = (e: MouseEvent) => {
    e.preventDefault();
    const p = local(e);
    h.rightClick(p.x, p.y, h.pick(p.x, p.y));
  };

  const onDbl = (e: MouseEvent) => {
    const p = local(e);
    h.doubleClick(p.x, p.y, h.pick(p.x, p.y));
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = local(e);
    const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    if (e.ctrlKey) {
      // pinça do trackpad: zoom contínuo, encaixa num nível nítido ao parar
      camera.zoomAt(camera.zoom * Math.exp(-delta * 0.012), p.x, p.y, Date.now(), false);
      if (wheelSettle) clearTimeout(wheelSettle);
      wheelSettle = setTimeout(() => camera.settle(Date.now()), 180);
      return;
    }
    wheelAcc += delta;
    if (Math.abs(wheelAcc) >= 50) {
      h.zoomStep(wheelAcc < 0 ? 1 : -1, p.x, p.y);
      wheelAcc = 0;
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (typingIn(t) || modalOpen(t)) return;
    if (e.key === 'Shift') {
      run = true;
      emitDir();
      return;
    }
    const action = resolveKey(e);
    if (!action) return;
    e.preventDefault();
    if (action.kind === 'dir') {
      const id = dirKeyId(e);
      if (!id || e.repeat) return;
      run = e.shiftKey;
      dirs.press(id, action.dir);
      emitDir();
      return;
    }
    if (e.repeat && action.kind !== 'zoom') return;
    if (action.kind === 'zoom') h.zoomStep(action.steps);
    else h.key(action);
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === 'Shift') {
      run = false;
      emitDir();
      return;
    }
    const id = dirKeyId(e);
    if (!id) return;
    dirs.release(id);
    emitDir();
  };

  const onBlur = () => {
    dirs.clear();
    run = false;
    emitDir();
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('dblclick', onDbl);
  canvas.addEventListener('contextmenu', onCtx);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  return () => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onCancel);
    canvas.removeEventListener('pointerleave', onLeave);
    canvas.removeEventListener('dblclick', onDbl);
    canvas.removeEventListener('contextmenu', onCtx);
    canvas.removeEventListener('wheel', onWheel);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    if (wheelSettle) clearTimeout(wheelSettle);
  };
}
