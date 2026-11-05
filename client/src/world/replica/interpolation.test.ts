import { describe, expect, it } from 'vitest';
import { FLAG_MOVING, FLAG_RUN, FLAG_SEATED } from '../../../../shared/model';
import { pushSample, type Sample } from '../../net/world-store';
import { EXTRAPOLATE_MS, INTERP_DELAY_MS, renderTime, sampleAt, stepDelay, targetDelay } from './interpolation';
import { INTERP_MAX_MS } from '../../../../shared/map/tile';

const S = (ts: number, x: number, y: number, flags = FLAG_MOVING, pose: Sample['pose'] = 'walk'): Sample => ({ ts, x, y, dir: 'right', pose, flags });

describe('sampleAt', () => {
  it('buffer vazio -> null; uma amostra -> ela, parada', () => {
    expect(sampleAt([], 0)).toBeNull();
    const r = sampleAt([S(100, 10, 20, 0, 'stand')], 500)!;
    expect(r).toMatchObject({ x: 10, y: 20, moving: false, pose: 'stand' });
  });

  it('interpola linearmente entre as amostras que cercam o instante', () => {
    const buf = [S(0, 0, 0), S(100, 10, 0), S(200, 20, 0)];
    expect(sampleAt(buf, 50)).toMatchObject({ x: 5, y: 0, moving: true, pose: 'walk', dir: 'right' });
    expect(sampleAt(buf, 150)!.x).toBeCloseTo(15);
    // antes da primeira: segura a primeira
    expect(sampleAt(buf, -50)!.x).toBe(0);
  });

  it('pose de corrida enquanto anda com FLAG_RUN; parada usa a pose do servidor (sem walk)', () => {
    const run = [S(0, 0, 0, FLAG_MOVING | FLAG_RUN, 'run'), S(100, 20, 0, FLAG_MOVING | FLAG_RUN, 'run')];
    expect(sampleAt(run, 50)!.pose).toBe('run');
    const still = [S(0, 5, 5, 0, 'type'), S(100, 5, 5, FLAG_SEATED, 'type')];
    expect(sampleAt(still, 80)).toMatchObject({ pose: 'type', moving: false, seated: true });
    const stopped = [S(0, 0, 0, 0, 'walk'), S(100, 0, 0, 0, 'walk')];
    expect(sampleAt(stopped, 50)!.pose).toBe('stand');
  });

  it('extrapola até 100 ms depois da última amostra e então segura', () => {
    const buf = [S(0, 0, 0), S(100, 10, 0)];
    expect(sampleAt(buf, 150)!.x).toBeCloseTo(15);
    expect(sampleAt(buf, 100 + EXTRAPOLATE_MS)!.x).toBeCloseTo(20);
    expect(sampleAt(buf, 900)!.x).toBeCloseTo(20);
    // parado: não extrapola
    const stop = [S(0, 0, 0), S(100, 10, 0, 0, 'stand')];
    expect(sampleAt(stop, 300)!.x).toBe(10);
  });

  it('renderTime atrasa o piso (100 ms) sem atraso informado', () => {
    expect(renderTime(10_000)).toBe(9_900);
    expect(renderTime(10_000, 250)).toBe(9_750);
  });
});

describe('pushSample', () => {
  it('depois de um silêncio insere uma amostra de espera (não arrasta o avatar)', () => {
    const buf: Sample[] = [];
    pushSample(buf, S(0, 0, 0, 0, 'stand'));
    pushSample(buf, S(5000, 16, 0));
    expect(buf.map((s) => s.ts)).toEqual([0, 4950, 5000]);
    // em 4975 está na metade do último intervalo (a espera não arrasta o avatar)
    expect(sampleAt(buf, 4975)!.x).toBeCloseTo(8);
    expect(sampleAt(buf, 2500)!.x).toBe(0);
  });

  it('teleporte zera; amostra antiga é descartada; janela de ~1 s', () => {
    const buf: Sample[] = [];
    for (let t = 0; t <= 2000; t += 100) pushSample(buf, S(t, t / 10, 0));
    expect(buf[0].ts).toBeGreaterThanOrEqual(900);
    pushSample(buf, S(1500, 0, 0));
    expect(buf[buf.length - 1].ts).toBe(2000);
    pushSample(buf, { ...S(2100, 99, 99), flags: 8 });
    expect(buf).toHaveLength(1);
    expect(buf[0].x).toBe(99);
  });
});

describe('atraso adaptativo', () => {
  it('sem medida usa o piso; com latência soma intervalo + p90 + folga, com teto', () => {
    expect(targetDelay([], 50)).toBe(INTERP_DELAY_MS);
    const lags = Array.from({ length: 100 }, (_, i) => (i < 90 ? 40 : 300));
    // p90 = 300 (o 91º valor) -> 50 + 300 + 30 = 380
    expect(targetDelay(lags, 50)).toBe(380);
    expect(targetDelay(Array(100).fill(10), 50)).toBe(INTERP_DELAY_MS);
    expect(targetDelay(Array(100).fill(60), 50)).toBe(140);
    expect(targetDelay(Array(100).fill(5000), 50)).toBe(INTERP_MAX_MS);
  });

  it('muda no máximo 10 % do frame: o relógio de desenho nunca volta', () => {
    expect(stepDelay(100, 300, 16)).toBeCloseTo(101.6);
    expect(stepDelay(300, 100, 16)).toBeCloseTo(298.4);
    expect(stepDelay(100, 100.5, 16)).toBe(100.5);
    // relógio de desenho = now - delay: avança mesmo com o atraso subindo
    let delay = 100;
    let prev = renderTime(0, delay);
    for (let now = 16; now < 2000; now += 16) {
      delay = stepDelay(delay, 380, 16);
      const rt = renderTime(now, delay);
      expect(rt).toBeGreaterThan(prev);
      prev = rt;
    }
  });
});
