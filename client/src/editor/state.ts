// Máquina de estados do editor: modo (ferramenta), gesto do ponteiro, estado do documento (salvamento)
// e da publicação. As transições são funções puras (testadas no node); `EditorState` só as guarda e
// avisa quem escuta.
import type { FloorKind, FurnitureKind } from '../../../shared/map/furniture';
import type { MapSpot } from '../../../shared/map/doc';
import { t } from '../i18n';
import type { Ref } from './types';

export type ModeKind = 'select' | 'place' | 'floor' | 'rug' | 'area' | 'zone' | 'doorway' | 'spawn' | 'wallItem' | 'spot' | 'stamp';

export type StampKind = 'island' | 'meeting' | 'lunch' | 'booth';
export interface StampSpec {
  kind: StampKind;
  /** Ilha: pares (1..3). Sala: lugares (4/8/12). */
  size?: number;
}

export type Mode =
  | { k: 'select' }
  | { k: 'place'; kind: FurnitureKind; variant?: string }
  | { k: 'floor'; kind: FloorKind | 'erase'; tint?: string; tint2?: string; tintK?: number; brush: 'tile' | 'rect' }
  | { k: 'rug'; color: string }
  | { k: 'area' }
  | { k: 'zone'; id: string | null }
  | { k: 'doorway' }
  | { k: 'spawn' }
  | { k: 'wallItem'; kind: FurnitureKind; variant?: string; on?: 'face' | 'south' }
  | { k: 'spot'; kind: MapSpot['kind'] }
  | { k: 'stamp'; stamp: StampSpec };

/** Último parâmetro usado em cada modo (a tecla do modo volta a ele). */
export interface ModePrefs {
  place: Extract<Mode, { k: 'place' }>;
  floor: Extract<Mode, { k: 'floor' }>;
  rug: Extract<Mode, { k: 'rug' }>;
  wallItem: Extract<Mode, { k: 'wallItem' }>;
  spot: Extract<Mode, { k: 'spot' }>;
  stamp: Extract<Mode, { k: 'stamp' }>;
}

export const DEFAULT_PREFS: ModePrefs = {
  place: { k: 'place', kind: 'desk', variant: 'dark' },
  floor: { k: 'floor', kind: 'carpet', tint: '#45454e', tint2: '#4c4c56', brush: 'rect' },
  rug: { k: 'rug', color: '#b79303' },
  wallItem: { k: 'wallItem', kind: 'painting' },
  spot: { k: 'spot', kind: 'talk' },
  stamp: { k: 'stamp', stamp: { kind: 'island', size: 3 } },
};

/** Teclas de modo (sem modificadores). */
export const MODE_KEYS: Readonly<Record<string, ModeKind>> = {
  v: 'select',
  b: 'place',
  f: 'floor',
  g: 'rug',
  a: 'area',
  z: 'zone',
  d: 'doorway',
  s: 'spawn',
  w: 'wallItem',
  t: 'spot',
};

/** Nome traduzido do modo (ferramenta). */
export function modeLabel(k: ModeKind): string {
  return t(`editor.mode.${k}`);
}

/** Nome traduzido de um overlay (camada de ajuda). */
export function overlayLabel(k: keyof Overlays): string {
  return t(`editor.overlay.${k}`);
}

/** Modo correspondente a uma tecla, com o último parâmetro usado. */
export function modeForKind(kind: ModeKind, prefs: ModePrefs): Mode {
  switch (kind) {
    case 'place':
    case 'floor':
    case 'rug':
    case 'wallItem':
    case 'spot':
    case 'stamp':
      return prefs[kind];
    case 'zone':
      return { k: 'zone', id: null };
    default:
      return { k: kind } as Mode;
  }
}

export function modeForKey(key: string, prefs: ModePrefs): Mode | null {
  const kind = MODE_KEYS[key.toLowerCase()];
  return kind ? modeForKind(kind, prefs) : null;
}

/** Guarda o parâmetro do modo como preferência. */
export function rememberMode(prefs: ModePrefs, m: Mode): ModePrefs {
  switch (m.k) {
    case 'place':
    case 'floor':
    case 'rug':
    case 'wallItem':
    case 'spot':
    case 'stamp':
      return { ...prefs, [m.k]: m };
    default:
      return prefs;
  }
}

// ------------------------------------------------------------------ gesto do ponteiro

export const DRAG_THRESHOLD = 4;

export type DragKind = 'rect' | 'move' | 'pan' | 'paint';
export type Gesture =
  | { k: 'idle' }
  | { k: 'pressing'; sx: number; sy: number; button: number; pan: boolean }
  | { k: 'dragging'; kind: DragKind; sx: number; sy: number }
  | { k: 'pinch' };

export type GestureEvent =
  | { t: 'down'; sx: number; sy: number; button: number; space: boolean }
  | { t: 'move'; sx: number; sy: number; kind: Exclude<DragKind, 'pan'> }
  | { t: 'up' }
  | { t: 'pinch' }
  | { t: 'cancel' };

/** Transição do gesto. O botão do meio, o direito ou Espaço+arrastar fazem pan. */
export function nextGesture(g: Gesture, ev: GestureEvent): Gesture {
  switch (ev.t) {
    case 'down':
      if (g.k === 'pinch') return g;
      return { k: 'pressing', sx: ev.sx, sy: ev.sy, button: ev.button, pan: ev.space || ev.button === 1 || ev.button === 2 };
    case 'move':
      if (g.k !== 'pressing') return g;
      if (Math.hypot(ev.sx - g.sx, ev.sy - g.sy) < DRAG_THRESHOLD) return g;
      return { k: 'dragging', kind: g.pan ? 'pan' : ev.kind, sx: g.sx, sy: g.sy };
    case 'pinch':
      return { k: 'pinch' };
    case 'up':
    case 'cancel':
      return { k: 'idle' };
  }
}

// ------------------------------------------------------------------ Esc

/**
 * `Esc`: primeiro cancela o gesto em andamento; depois volta ao modo seleção; no modo seleção limpa a
 * seleção.
 */
export function escape(s: { mode: Mode; gesture: Gesture; selection: readonly Ref[] }): { mode: Mode; gesture: Gesture; selection: readonly Ref[] } {
  if (s.gesture.k !== 'idle') return { ...s, gesture: { k: 'idle' } };
  if (s.mode.k !== 'select') return { ...s, mode: { k: 'select' } };
  return { ...s, selection: [] };
}

// ------------------------------------------------------------------ documento (salvamento)

export type DocState = 'clean' | 'dirty' | 'saving' | 'saved' | 'conflict';
export type DocEvent = 'edit' | 'save' | 'saved' | 'saved-dirty' | 'conflict' | 'error' | 'load';

/**
 * - edit: alteração local → dirty (em `saving` continua `saving`; o autosave regrava depois; em
 *   `conflict` fica em conflito até a pessoa decidir).
 * - save: começa a gravar; saved: gravou e nada mudou nesse meio-tempo; saved-dirty: gravou mas houve
 *   alteração durante a gravação; conflict: 409; error: falha de rede/validação (continua sujo).
 * - load: documento (re)carregado do servidor.
 */
export function nextDocState(s: DocState, ev: DocEvent): DocState {
  switch (ev) {
    case 'edit':
      return s === 'saving' || s === 'conflict' ? s : 'dirty';
    case 'save':
      return s === 'conflict' ? s : 'saving';
    case 'saved':
      return 'saved';
    case 'saved-dirty':
      return 'dirty';
    case 'conflict':
      return 'conflict';
    case 'error':
      return 'dirty';
    case 'load':
      return 'clean';
  }
}

// ------------------------------------------------------------------ publicação

export type PublishState = 'idle' | 'validating' | 'confirm' | 'publishing' | 'done' | 'error';
export type PublishEvent = 'start' | 'validated' | 'confirm' | 'published' | 'fail' | 'close';

/** Publicar só com o documento gravado no servidor e sem outra publicação em andamento. */
export function canPublish(doc: DocState, pub: PublishState): boolean {
  return (doc === 'clean' || doc === 'saved') && (pub === 'idle' || pub === 'done' || pub === 'error');
}

export function nextPublishState(s: PublishState, ev: PublishEvent): PublishState {
  switch (ev) {
    case 'start':
      return s === 'idle' || s === 'done' || s === 'error' ? 'validating' : s;
    case 'validated':
      return s === 'validating' ? 'confirm' : s;
    case 'confirm':
      return s === 'confirm' || s === 'error' ? 'publishing' : s;
    case 'published':
      return s === 'publishing' ? 'done' : s;
    case 'fail':
      return s === 'validating' || s === 'publishing' ? 'error' : s;
    case 'close':
      return s === 'publishing' || s === 'validating' ? s : 'idle';
  }
}

// ------------------------------------------------------------------ overlays

export interface Overlays {
  grid: boolean;
  walk: boolean;
  zones: boolean;
  problems: boolean;
}

export const OVERLAY_KEYS: readonly (keyof Overlays)[] = ['grid', 'walk', 'zones', 'problems'];

// ------------------------------------------------------------------ estado vivo

export type StateListener = (s: EditorState) => void;

export class EditorState {
  mode: Mode = { k: 'select' };
  prefs: ModePrefs = DEFAULT_PREFS;
  gesture: Gesture = { k: 'idle' };
  doc: DocState = 'clean';
  publish: PublishState = 'idle';
  selection: Ref[] = [];
  overlays: Overlays = { grid: true, walk: false, zones: true, problems: true };
  hiddenAreas = new Set<string>();
  /** Espaço pressionado (pan). */
  space = false;
  /** Shift pressionado (mantém o modo depois de colocar). */
  shift = false;
  /** Data/hora da última gravação. */
  savedAt: Date | null = null;
  private listeners = new Set<StateListener>();

  subscribe(fn: StateListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  changed(): void {
    for (const fn of [...this.listeners]) fn(this);
  }

  setMode(m: Mode): void {
    this.mode = m;
    this.prefs = rememberMode(this.prefs, m);
    this.gesture = { k: 'idle' };
    this.changed();
  }

  setSelection(refs: Ref[]): void {
    this.selection = refs;
    this.changed();
  }

  docEvent(ev: DocEvent): void {
    const n = nextDocState(this.doc, ev);
    if (ev === 'saved' || ev === 'saved-dirty') this.savedAt = new Date();
    if (n === this.doc && ev !== 'saved') return;
    this.doc = n;
    this.changed();
  }

  publishEvent(ev: PublishEvent): void {
    const n = nextPublishState(this.publish, ev);
    if (n === this.publish) return;
    this.publish = n;
    this.changed();
  }

  toggleOverlay(k: keyof Overlays): void {
    this.overlays = { ...this.overlays, [k]: !this.overlays[k] };
    this.changed();
  }

  escape(): void {
    const r = escape(this);
    this.mode = r.mode;
    this.gesture = r.gesture;
    this.selection = [...r.selection];
    this.changed();
  }
}
