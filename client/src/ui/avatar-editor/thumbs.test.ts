import { describe, expect, it } from 'vitest';
import { randomAll } from './random';
import { THUMB_CROPS, clampCrop, thumbKey, thumbSize } from './thumbs';

describe('thumbs', () => {
  it('recortes e tamanhos @3x conforme B.3', () => {
    expect(THUMB_CROPS.hair).toEqual({ x: 2, y: 0, w: 20, h: 20 });
    expect(THUMB_CROPS.top).toEqual({ x: 4, y: 16, w: 16, h: 12 });
    expect(THUMB_CROPS.bottom).toEqual({ x: 6, y: 22, w: 12, h: 12 });
    expect(thumbSize('hair')).toEqual({ w: 60, h: 60 });
    expect(thumbSize('top')).toEqual({ w: 48, h: 36 });
    expect(thumbSize('bottom', 2)).toEqual({ w: 24, h: 24 });
  });
  it('todos os recortes cabem no sprite 24x34', () => {
    for (const c of Object.values(THUMB_CROPS)) expect(clampCrop(c, 24, 34)).toEqual(c);
  });
  it('clampCrop corta o que passa dos limites', () => {
    expect(clampCrop({ x: 20, y: 30, w: 10, h: 10 }, 24, 34)).toEqual({ x: 20, y: 30, w: 4, h: 4 });
    expect(clampCrop({ x: -3, y: 0, w: 5, h: 5 }, 24, 34)).toEqual({ x: 0, y: 0, w: 2, h: 5 });
  });
  it('a chave parcial ignora campos que não aparecem no recorte', () => {
    const a = randomAll('f', 9);
    expect(thumbKey('hair', { ...a, shoes: '#ffffff' })).toBe(thumbKey('hair', a));
    expect(thumbKey('hair', { ...a, hair: '#123456' })).not.toBe(thumbKey('hair', a));
    expect(thumbKey('bottom', { ...a, hair: '#123456' })).toBe(thumbKey('bottom', a));
  });
});
