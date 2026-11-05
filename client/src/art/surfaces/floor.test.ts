// A.7: FLOOR_BASE (usado pelo validateMap para estimar a luminância) bate com a arte real, e o tint
// de 45 % dos pisos não-carpete produz a cor que o validador estima.
import { describe, expect, it } from 'vitest';
import { FLOOR_BASE, FLOOR_TINT_K } from '../../../../shared/map/palette';
import { luminance, mix, toHex } from '../core/color';
import { floorColor } from '../../../../shared/map/validate';
import { floorChunk } from './floor';

type BaseKind = keyof typeof FLOOR_BASE;
const KINDS = Object.keys(FLOOR_BASE) as BaseKind[];

function meanHex(kind: Parameters<typeof floorChunk>[0], tint?: string, tintK?: number): string {
  const b = floorChunk(kind, 1, 2, { seed: 7, tint, tintK });
  let r = 0;
  let g = 0;
  let bl = 0;
  const n = b.data.length / 4;
  for (let i = 0; i < b.data.length; i += 4) {
    r += b.data[i];
    g += b.data[i + 1];
    bl += b.data[i + 2];
  }
  return toHex(r / n, g / n, bl / n);
}

describe('pisos x FLOOR_BASE', () => {
  for (const kind of KINDS) {
    it(`${kind}: cor média dentro de ±0,06 de luminância de FLOOR_BASE`, () => {
      expect(Math.abs(luminance(meanHex(kind)) - luminance(FLOOR_BASE[kind]))).toBeLessThanOrEqual(0.06);
    });

    it(`${kind}: com tint, média ≈ mix(FLOOR_BASE, tint, 0,45)`, () => {
      for (const tint of ['#3d3530', '#50515a', '#e810b3']) {
        const want = luminance(mix(FLOOR_BASE[kind], tint, FLOOR_TINT_K));
        expect(Math.abs(luminance(meanHex(kind, tint)) - want)).toBeLessThanOrEqual(0.06);
      }
    });

    it(`${kind}: tintK controla a mistura e bate com floorColor()`, () => {
      for (const tintK of [0, 0.7, 0.85, 1]) {
        for (const tint of ['#3d3530', '#50515a']) {
          const want = luminance(floorColor(kind, tint, tintK));
          expect(Math.abs(luminance(meanHex(kind, tint, tintK)) - want)).toBeLessThanOrEqual(0.06);
        }
      }
    });
  }

  it('carpet continua usando tint/tint2 direto (sem o passo de 45 %; tintK é ignorado)', () => {
    const tint = '#45454e';
    expect(Math.abs(luminance(meanHex('carpet', tint)) - luminance(tint))).toBeLessThanOrEqual(0.02);
    expect(floorChunk('carpet', 1, 2, { seed: 7, tint, tintK: 1 }).data).toEqual(floorChunk('carpet', 1, 2, { seed: 7, tint }).data);
  });

  it('tintK ausente = FLOOR_TINT_K', () => {
    expect(floorChunk('wood', 0, 0, { seed: 3, tint: '#50515a' }).data).toEqual(floorChunk('wood', 0, 0, { seed: 3, tint: '#50515a', tintK: FLOOR_TINT_K }).data);
  });

  it('sem tint, o piso não muda (o passo só roda com tint)', () => {
    expect(floorChunk('wood', 0, 0, { seed: 3 }).data).toEqual(floorChunk('wood', 0, 0, { seed: 3, tint: undefined }).data);
    expect(floorChunk('wood', 0, 0, { seed: 3, tint: '#000000' }).data).not.toEqual(floorChunk('wood', 0, 0, { seed: 3 }).data);
  });
});
