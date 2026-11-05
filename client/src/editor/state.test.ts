import { describe, expect, it } from 'vitest';
import { shortcutFor } from './shortcuts';
import { canPublish, DEFAULT_PREFS, EditorState, escape, modeForKey, nextDocState, nextGesture, nextPublishState, rememberMode, type Gesture, type Mode } from './state';

describe('modos', () => {
  it('teclas V B F G A Z D S W T', () => {
    const kinds = ['v', 'b', 'f', 'g', 'a', 'z', 'd', 's', 'w', 't'].map((k) => modeForKey(k, DEFAULT_PREFS)?.k);
    expect(kinds).toEqual(['select', 'place', 'floor', 'rug', 'area', 'zone', 'doorway', 'spawn', 'wallItem', 'spot']);
    expect(modeForKey('x', DEFAULT_PREFS)).toBeNull();
    expect(modeForKey('Z', DEFAULT_PREFS)).toEqual({ k: 'zone', id: null });
  });

  it('a tecla do modo volta ao último parâmetro usado', () => {
    const prefs = rememberMode(DEFAULT_PREFS, { k: 'place', kind: 'sofa', variant: 'up' });
    expect(modeForKey('b', prefs)).toEqual({ k: 'place', kind: 'sofa', variant: 'up' });
    const p2 = rememberMode(prefs, { k: 'floor', kind: 'wood', tint: '#3d3530', tintK: 0.65, brush: 'tile' });
    expect(modeForKey('f', p2)).toMatchObject({ kind: 'wood', brush: 'tile' });
    expect(rememberMode(p2, { k: 'select' })).toBe(p2);
  });

  it('EditorState.setMode lembra e zera o gesto', () => {
    const s = new EditorState();
    s.gesture = { k: 'pressing', sx: 0, sy: 0, button: 0, pan: false };
    s.setMode({ k: 'rug', color: '#c9149d' });
    expect(s.gesture.k).toBe('idle');
    expect(s.prefs.rug.color).toBe('#c9149d');
  });
});

describe('Esc', () => {
  const place: Mode = { k: 'place', kind: 'desk' };
  const sel = [{ t: 'area' as const, id: 'x' }];

  it('primeiro cancela o gesto, depois volta a Selecionar, depois limpa a seleção', () => {
    let s = { mode: place, gesture: { k: 'dragging', kind: 'rect', sx: 0, sy: 0 } as Gesture, selection: sel };
    s = { ...s, ...escape(s) } as typeof s;
    expect(s.gesture.k).toBe('idle');
    expect(s.mode.k).toBe('place');
    s = { ...s, ...escape(s) } as typeof s;
    expect(s.mode.k).toBe('select');
    expect(s.selection).toHaveLength(1);
    s = { ...s, ...escape(s) } as typeof s;
    expect(s.selection).toHaveLength(0);
  });

  it('EditorState.escape', () => {
    const st = new EditorState();
    st.setMode({ k: 'zone', id: 'z1' });
    st.selection = [...sel];
    st.escape();
    expect(st.mode).toEqual({ k: 'select' });
    st.escape();
    expect(st.selection).toEqual([]);
  });

  it('atalho Esc', () => {
    expect(shortcutFor({ key: 'Escape' })).toEqual({ a: 'escape' });
  });
});

describe('gestos', () => {
  it('pressionar → arrastar só depois do limiar; botão do meio/Espaço fazem pan', () => {
    let g: Gesture = { k: 'idle' };
    g = nextGesture(g, { t: 'down', sx: 10, sy: 10, button: 0, space: false });
    expect(g.k).toBe('pressing');
    g = nextGesture(g, { t: 'move', sx: 12, sy: 11, kind: 'rect' });
    expect(g.k).toBe('pressing');
    g = nextGesture(g, { t: 'move', sx: 30, sy: 10, kind: 'move' });
    expect(g).toMatchObject({ k: 'dragging', kind: 'move' });
    expect(nextGesture(g, { t: 'up' }).k).toBe('idle');

    let p: Gesture = nextGesture({ k: 'idle' }, { t: 'down', sx: 0, sy: 0, button: 0, space: true });
    p = nextGesture(p, { t: 'move', sx: 50, sy: 0, kind: 'rect' });
    expect(p).toMatchObject({ k: 'dragging', kind: 'pan' });
    const mid = nextGesture(nextGesture({ k: 'idle' }, { t: 'down', sx: 0, sy: 0, button: 1, space: false }), { t: 'move', sx: 0, sy: 40, kind: 'rect' });
    expect(mid).toMatchObject({ kind: 'pan' });
    expect(nextGesture(mid, { t: 'pinch' }).k).toBe('pinch');
    expect(nextGesture({ k: 'pinch' }, { t: 'down', sx: 0, sy: 0, button: 0, space: false }).k).toBe('pinch');
  });
});

describe('documento e publicação', () => {
  it('estados do documento', () => {
    expect(nextDocState('clean', 'edit')).toBe('dirty');
    expect(nextDocState('dirty', 'save')).toBe('saving');
    expect(nextDocState('saving', 'edit')).toBe('saving');
    expect(nextDocState('saving', 'saved')).toBe('saved');
    expect(nextDocState('saving', 'saved-dirty')).toBe('dirty');
    expect(nextDocState('saving', 'conflict')).toBe('conflict');
    expect(nextDocState('conflict', 'edit')).toBe('conflict');
    expect(nextDocState('conflict', 'save')).toBe('conflict');
    expect(nextDocState('saving', 'error')).toBe('dirty');
    expect(nextDocState('conflict', 'load')).toBe('clean');
  });

  it('publicar só com o documento salvo', () => {
    expect(canPublish('clean', 'idle')).toBe(true);
    expect(canPublish('saved', 'idle')).toBe(true);
    expect(canPublish('saved', 'done')).toBe(true);
    expect(canPublish('saved', 'error')).toBe(true);
    expect(canPublish('dirty', 'idle')).toBe(false);
    expect(canPublish('saving', 'idle')).toBe(false);
    expect(canPublish('conflict', 'idle')).toBe(false);
    expect(canPublish('saved', 'validating')).toBe(false);
    expect(canPublish('saved', 'publishing')).toBe(false);
    expect(canPublish('saved', 'confirm')).toBe(false);
  });

  it('sequência da publicação', () => {
    let p = nextPublishState('idle', 'start');
    expect(p).toBe('validating');
    expect(nextPublishState(p, 'confirm')).toBe('validating'); // não confirma antes de validar
    p = nextPublishState(p, 'validated');
    expect(p).toBe('confirm');
    p = nextPublishState(p, 'confirm');
    expect(p).toBe('publishing');
    expect(nextPublishState(p, 'close')).toBe('publishing'); // não fecha no meio
    expect(nextPublishState(p, 'fail')).toBe('error');
    expect(nextPublishState('error', 'confirm')).toBe('publishing'); // tentar de novo
    expect(nextPublishState(p, 'published')).toBe('done');
    expect(nextPublishState('done', 'close')).toBe('idle');
    expect(nextPublishState('validating', 'fail')).toBe('error');
  });

  it('EditorState.docEvent registra a hora do salvamento', () => {
    const s = new EditorState();
    s.docEvent('edit');
    s.docEvent('save');
    expect(s.doc).toBe('saving');
    s.docEvent('saved');
    expect(s.doc).toBe('saved');
    expect(s.savedAt).toBeInstanceOf(Date);
  });
});

describe('atalhos', () => {
  it('mapeia as combinações', () => {
    expect(shortcutFor({ key: 'z', ctrlKey: true })).toEqual({ a: 'undo' });
    expect(shortcutFor({ key: 'Z', ctrlKey: true, shiftKey: true })).toEqual({ a: 'redo' });
    expect(shortcutFor({ key: 'y', metaKey: true })).toEqual({ a: 'redo' });
    expect(shortcutFor({ key: 'P', ctrlKey: true, shiftKey: true })).toEqual({ a: 'publish' });
    expect(shortcutFor({ key: 's', ctrlKey: true })).toEqual({ a: 'save' });
    expect(shortcutFor({ key: 'd', ctrlKey: true })).toEqual({ a: 'duplicate' });
    expect(shortcutFor({ key: 'd' })).toEqual({ a: 'mode', kind: 'doorway' });
    expect(shortcutFor({ key: 'R', shiftKey: true })).toEqual({ a: 'rotate', reverse: true });
    expect(shortcutFor({ key: 'Delete' })).toEqual({ a: 'delete' });
    expect(shortcutFor({ key: '3' })).toEqual({ a: 'overlay', k: 'zones' });
    expect(shortcutFor({ key: '+' })).toEqual({ a: 'zoom', steps: 1 });
    expect(shortcutFor({ key: '0' })).toEqual({ a: 'fit' });
    expect(shortcutFor({ key: 'h' })).toEqual({ a: 'help' });
  });
});
