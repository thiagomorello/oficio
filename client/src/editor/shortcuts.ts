// Atalhos do editor. `shortcutFor` é puro (testável); `bindShortcuts` liga no documento e ignora
// teclas digitadas em campos de texto (menos Esc, Ctrl+S, Ctrl+Z/Y).
import { t } from '../i18n';
import type { Overlays } from './state';
import { MODE_KEYS, OVERLAY_KEYS, type ModeKind } from './state';

export type Shortcut =
  | { a: 'mode'; kind: ModeKind }
  | { a: 'delete' }
  | { a: 'rotate'; reverse: boolean }
  | { a: 'variant'; step: number }
  | { a: 'undo' }
  | { a: 'redo' }
  | { a: 'copy' }
  | { a: 'cut' }
  | { a: 'paste' }
  | { a: 'duplicate' }
  | { a: 'escape' }
  | { a: 'zoom'; steps: number }
  | { a: 'fit' }
  | { a: 'overlay'; k: keyof Overlays }
  | { a: 'save' }
  | { a: 'publish' }
  | { a: 'help' }
  | { a: 'nudge'; dx: number; dy: number };

export interface KeyLike {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

export function shortcutFor(e: KeyLike): Shortcut | null {
  const ctrl = !!(e.ctrlKey || e.metaKey);
  const shift = !!e.shiftKey;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (ctrl) {
    if (shift && k === 'p') return { a: 'publish' };
    if (k === 'z') return shift ? { a: 'redo' } : { a: 'undo' };
    if (k === 'y') return { a: 'redo' };
    if (k === 's') return { a: 'save' };
    if (k === 'c') return { a: 'copy' };
    if (k === 'x') return { a: 'cut' };
    if (k === 'v') return { a: 'paste' };
    if (k === 'd') return { a: 'duplicate' };
    if (k === '=' || k === '+') return { a: 'zoom', steps: 1 };
    if (k === '-') return { a: 'zoom', steps: -1 };
    if (k === '0') return { a: 'fit' };
    return null;
  }
  if (e.altKey) return null;
  switch (k) {
    case 'Escape':
      return { a: 'escape' };
    case 'Delete':
    case 'Backspace':
      return { a: 'delete' };
    case 'r':
      return { a: 'rotate', reverse: shift };
    case 'c':
      return { a: 'variant', step: shift ? -1 : 1 };
    case '+':
    case '=':
      return { a: 'zoom', steps: 1 };
    case '-':
    case '_':
      return { a: 'zoom', steps: -1 };
    case '0':
      return { a: 'fit' };
    case 'h':
    case '?':
      return { a: 'help' };
    case 'ArrowUp':
      return { a: 'nudge', dx: 0, dy: -1 };
    case 'ArrowDown':
      return { a: 'nudge', dx: 0, dy: 1 };
    case 'ArrowLeft':
      return { a: 'nudge', dx: -1, dy: 0 };
    case 'ArrowRight':
      return { a: 'nudge', dx: 1, dy: 0 };
  }
  if (/^[1-4]$/.test(k)) return { a: 'overlay', k: OVERLAY_KEYS[Number(k) - 1] };
  const mode = MODE_KEYS[k];
  if (mode && !shift) return { a: 'mode', kind: mode };
  return null;
}

/** Lista para a ajuda (H): [tecla(s), descrição], no idioma atual. */
export function shortcutHelp(): readonly [string, string][] {
  return [
    ['V B F G A Z D S W T', t('editor.help.modes')],
    ['Del', t('editor.help.delete')],
    ['R / Shift+R', t('editor.help.rotate')],
    ['C', t('editor.help.variant')],
    [t('editor.help.key.arrows'), t('editor.help.nudge')],
    ['Ctrl+Z · Ctrl+Shift+Z / Ctrl+Y', t('editor.help.undoRedo')],
    ['Ctrl+C / X / V / D', t('editor.help.clipboard')],
    [t('editor.help.key.shiftClick'), t('editor.help.shiftClick')],
    [t('editor.help.key.altDrag'), t('editor.help.altDrag')],
    [t('editor.help.key.spaceDrag'), t('editor.help.spaceDrag')],
    ['+ / - / 0', t('editor.help.zoom')],
    ['1 2 3 4', t('editor.help.overlays')],
    ['Ctrl+S', t('editor.help.save')],
    ['Ctrl+Shift+P', t('editor.help.publish')],
    ['Esc', t('editor.help.escape')],
    ['H', t('editor.help.help')],
  ];
}

function typing(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export interface ShortcutHandlers {
  run(s: Shortcut, e: KeyboardEvent): boolean;
  /** Tecla da ferramenta ativa (antes dos atalhos globais). */
  toolKey(e: KeyboardEvent): boolean;
  space(down: boolean): void;
  shift(down: boolean): void;
  /** O editor está visível (sem modal aberto)? */
  active(): boolean;
}

export function bindShortcuts(h: ShortcutHandlers): () => void {
  const down = (e: KeyboardEvent) => {
    if (e.key === 'Shift') h.shift(true);
    if (!h.active()) return;
    const inField = typing(e.target);
    if (e.code === 'Space' && !inField) {
      e.preventDefault();
      h.space(true);
      return;
    }
    const s = shortcutFor(e);
    if (inField) {
      // nos campos só valem Esc (sai do campo), Ctrl+S e Ctrl+Shift+P
      if (s?.a === 'escape') (e.target as HTMLElement).blur();
      else if (s && (s.a === 'save' || s.a === 'publish') && h.run(s, e)) e.preventDefault();
      return;
    }
    if (h.toolKey(e)) {
      e.preventDefault();
      return;
    }
    if (s && h.run(s, e)) e.preventDefault();
  };
  const up = (e: KeyboardEvent) => {
    if (e.key === 'Shift') h.shift(false);
    if (e.code === 'Space') h.space(false);
  };
  const blur = () => {
    h.space(false);
    h.shift(false);
  };
  document.addEventListener('keydown', down);
  document.addEventListener('keyup', up);
  window.addEventListener('blur', blur);
  return () => {
    document.removeEventListener('keydown', down);
    document.removeEventListener('keyup', up);
    window.removeEventListener('blur', blur);
  };
}
