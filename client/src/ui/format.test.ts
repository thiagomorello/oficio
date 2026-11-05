import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n';
import { formatCountdown, formatDuration, formatElapsed, formatInt, plural, relativeTime } from './format';

const S = 1_000;
const M = 60 * S;
const H = 60 * M;
const D = 24 * H;

afterEach(() => setLocale('pt-BR'));

describe('relativeTime', () => {
  it('pt-BR', () => {
    const now = 10 * D;
    expect(relativeTime(now - 2 * S, now)).toBe('agora');
    expect(relativeTime(now - 30 * S, now)).toBe('há 30 s');
    expect(relativeTime(now - 5 * M, now)).toBe('há 5 min');
    expect(relativeTime(now - 3 * H, now)).toBe('há 3 h');
    expect(relativeTime(now - 4 * D, now)).toBe('há 4 d');
    expect(relativeTime(Number.NaN, now)).toBe('agora');
  });
  it('en', () => {
    setLocale('en');
    const now = 10 * D;
    expect(relativeTime(now - 2 * S, now)).toBe('now');
    expect(relativeTime(now - 5 * M, now)).toBe('5 min ago');
    expect(relativeTime(now - 4 * D, now)).toBe('4 d ago');
  });
});

describe('formatDuration / formatCountdown / formatElapsed', () => {
  it('durações', () => {
    expect(formatDuration(12 * S)).toBe('12 s');
    expect(formatDuration(3 * M)).toBe('3 min');
    expect(formatDuration(2 * H + 10 * M)).toBe('2 h 10 min');
    expect(formatDuration(2 * H)).toBe('2 h');
    expect(formatDuration(3 * D + 4 * H)).toBe('3 d 4 h');
    expect(formatDuration(-5)).toBe('0 s');
  });
  it('contagem regressiva nos dois idiomas', () => {
    const now = 0;
    expect(formatCountdown(now, now)).toBe('agora');
    expect(formatCountdown(now + 30 * S, now)).toBe('em menos de 1 min');
    expect(formatCountdown(now + 2 * H + 10 * M, now)).toBe('em 2 h 10 min');
    setLocale('en');
    expect(formatCountdown(now + 30 * S, now)).toBe('in less than 1 min');
    expect(formatCountdown(now + 5 * M, now)).toBe('in 5 min');
  });
  it('cronômetro', () => {
    expect(formatElapsed(7 * S)).toBe('0:07');
    expect(formatElapsed(12 * M + 31 * S)).toBe('12:31');
    expect(formatElapsed(H + 2 * M + 10 * S)).toBe('1:02:10');
    expect(formatElapsed(D + 2 * H)).toBe('1 d 2 h');
    expect(formatElapsed(-1)).toBe('0:00');
    expect(formatElapsed(Number.NaN)).toBe('0:00');
  });
});

describe('números', () => {
  it('formatInt segue o idioma', () => {
    expect(formatInt(1234567)).toBe('1.234.567');
    setLocale('en');
    expect(formatInt(1234567)).toBe('1,234,567');
  });
  it('plural', () => {
    expect(plural(1, 'mesa', 'mesas')).toBe('1 mesa');
    expect(plural(3, 'mesa', 'mesas')).toBe('3 mesas');
    expect(plural(0, 'mesa', 'mesas')).toBe('0 mesas');
  });
});
