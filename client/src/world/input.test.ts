import { describe, expect, it } from 'vitest';
import { assembleOffice } from '../../../shared/map/assemble';
import { twoAreaDoc } from '../../../shared/map/test-fixtures';
import { classifyClick, DirKeys, dirKeyId, resolveKey } from './input';

describe('resolveKey', () => {
  it('WASD e setas andam (com Shift também: Shift só corre)', () => {
    expect(resolveKey({ key: 'w', code: 'KeyW' })).toEqual({ kind: 'dir', dir: 'up' });
    expect(resolveKey({ key: 'D', code: 'KeyD', shiftKey: true })).toEqual({ kind: 'dir', dir: 'right' });
    expect(resolveKey({ key: 'ArrowLeft', code: 'ArrowLeft' })).toEqual({ kind: 'dir', dir: 'left' });
    expect(resolveKey({ key: 'ArrowLeft', code: 'ArrowLeft', shiftKey: true })).toEqual({ kind: 'dir', dir: 'left' });
    expect(resolveKey({ key: 'ArrowDown', code: 'ArrowDown', shiftKey: true })).toEqual({ kind: 'dir', dir: 'down' });
    // layout sem `code` (ex.: teclado virtual)
    expect(resolveKey({ key: 's' })).toEqual({ kind: 'dir', dir: 'down' });
  });

  it('atalhos', () => {
    expect(resolveKey({ key: 'e' })).toEqual({ kind: 'sit' });
    expect(resolveKey({ key: 'Enter' })).toEqual({ kind: 'enter' });
    expect(resolveKey({ key: 'X' })).toEqual({ kind: 'stand' });
    expect(resolveKey({ key: '1' })).toEqual({ kind: 'emote', emote: 'raise_hand' });
    expect(resolveKey({ key: '4' })).toEqual({ kind: 'emote', emote: 'stretch' });
    expect(resolveKey({ key: 'm' })).toEqual({ kind: 'minimap' });
    expect(resolveKey({ key: '?' })).toEqual({ kind: 'help' });
    expect(resolveKey({ key: '0' })).toEqual({ kind: 'overview' });
    expect(resolveKey({ key: 'f' })).toEqual({ kind: 'follow' });
    expect(resolveKey({ key: '+' })).toEqual({ kind: 'zoom', steps: 1 });
    expect(resolveKey({ key: '5' })).toBeNull();
    expect(resolveKey({ key: 'q' })).toBeNull();
  });

  it('id estável da tecla: keyup com outra caixa (Shift solto antes) solta a mesma tecla', () => {
    expect(dirKeyId({ key: 'W', code: 'KeyW' })).toBe(dirKeyId({ key: 'w', code: 'KeyW' }));
    expect(dirKeyId({ key: 'W' })).toBe(dirKeyId({ key: 'w' }));
    expect(dirKeyId({ key: 'e', code: 'KeyE' })).toBeNull();
  });
});

describe('DirKeys', () => {
  it('vale a última tecla apertada que ainda está segurada', () => {
    const k = new DirKeys();
    expect(k.press('KeyW', 'up')).toBe('up');
    expect(k.press('KeyD', 'right')).toBe('right');
    expect(k.release('KeyD')).toBe('up');
    expect(k.press('KeyW', 'up')).toBe('up');
    expect(k.release('KeyW')).toBeNull();
    k.press('KeyA', 'left');
    k.clear();
    expect(k.current()).toBeNull();
  });
});

describe('classifyClick', () => {
  const a = assembleOffice(twoAreaDoc(), 1);
  const chair = a.spots.find((s) => s.kind === 'desk' && s.side === 'S')!;
  const desk = a.deskById.get(chair.deskId!)!;

  it('avatar seleciona; assento senta; tampo da mesa abre a mesa; resto anda', () => {
    expect(classifyClick(a, 0, 0, 42)).toEqual({ kind: 'select', id: 42 });
    expect(classifyClick(a, chair.tx, chair.ty, null)).toEqual({ kind: 'sit', spot: chair.id });
    expect(classifyClick(a, desk.tx + 1, desk.ty, null)).toEqual({ kind: 'desk', desk: desk.id });
    expect(classifyClick(a, 10, 10, null)).toEqual({ kind: 'move', tx: 10, ty: 10 });
  });
});
