import { describe, expect, it } from 'vitest';
import { STRIP_TILE, gridRows, planTiles, tileSize } from './avbar-layout';

describe('tileSize', () => {
  it('poucos tiles: grandes (16:9)', () => {
    for (const n of [0, 1, 3]) expect(tileSize(n)).toEqual({ w: 208, h: 117 });
  });
  it('4 a 6: 176x99', () => {
    for (const n of [4, 6]) expect(tileSize(n)).toEqual({ w: 176, h: 99 });
  });
  it('mais de 6: pequenos', () => {
    expect(tileSize(7)).toEqual({ w: 144, h: 81 });
    expect(tileSize(20)).toEqual({ w: 144, h: 81 });
  });
});

describe('gridRows', () => {
  it('1 linha enquanto cabe; 2 depois', () => {
    // 1100px / (208+8) = 5 por linha
    expect(gridRows(5, 1100, 208)).toBe(1);
    expect(gridRows(6, 1100, 208)).toBe(2);
    expect(gridRows(30, 1100, 208)).toBe(2);
  });
  it('largura mínima de 1 tile por linha', () => {
    expect(gridRows(1, 50, 208)).toBe(1);
    expect(gridRows(2, 50, 208)).toBe(2);
  });
});

describe('planTiles', () => {
  const keys = ['1:main', '2:main', '3:main', '3:screen'];
  it('sem fixar nem ampliar: ordem original', () => {
    expect(planTiles(keys, null, null)).toEqual({ expanded: null, strip: keys });
  });
  it('fixado vai primeiro', () => {
    expect(planTiles(keys, '3:main', null).strip).toEqual(['3:main', '1:main', '2:main', '3:screen']);
  });
  it('ampliado sai da faixa; fixado continua primeiro nela', () => {
    expect(planTiles(keys, '2:main', '3:screen')).toEqual({ expanded: '3:screen', strip: ['2:main', '1:main', '3:main'] });
  });
  it('chaves que sumiram são ignoradas', () => {
    expect(planTiles(keys, 'x', 'y')).toEqual({ expanded: null, strip: keys });
  });
});
