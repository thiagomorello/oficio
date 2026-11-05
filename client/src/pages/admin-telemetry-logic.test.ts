import { describe, expect, it } from 'vitest';
import { countLevel, fpsLevel, kindLabel, niceRange, rttLevel, shortData, sparkSeries } from './admin-telemetry-logic';

describe('painel de telemetria: regras', () => {
  it('cores do RTT (< 80 verde, < 200 amarelo, senão vermelho) e do FPS', () => {
    expect([rttLevel(null), rttLevel(10), rttLevel(79.9), rttLevel(80), rttLevel(199), rttLevel(200)]).toEqual(['none', 'ok', 'ok', 'warn', 'warn', 'bad']);
    expect([fpsLevel(null), fpsLevel(60), fpsLevel(40), fpsLevel(12)]).toEqual(['none', 'ok', 'warn', 'bad']);
    expect([countLevel(0), countLevel(2), countLevel(9)]).toEqual(['none', 'warn', 'bad']);
  });

  it('rótulos e resumo do data por tipo', () => {
    expect(kindLabel('pos_jump')).toBe('Salto do avatar');
    expect(kindLabel('desconhecido')).toBe('desconhecido');
    expect(shortData('sample', { rtt: 42.4, fps: 59.9, worstFrameMs: 33, online: 7, av: { status: 'connected' } })).toBe(
      'rtt 42.4 ms · fps 59.9 · pior quadro 33 ms · online 7 · A/V connected',
    );
    expect(shortData('moved_reject', { reason: 'far', server: { x: 10, y: 20 }, client: { x: 90, y: 20 }, dist: 80 })).toBe('far · servidor (10, 20) · cliente (90, 20) · 80 px');
    expect(shortData('ws_drop', { code: 1006, durationMs: 61_000 })).toBe('código 1006 · 61 s conectado');
    expect(shortData('js_error', { message: 'x'.repeat(500) }).length).toBe(160);
    expect(shortData('visibility', { hidden: true, pagehide: true })).toBe('página fechada');
  });

  it('série da sparkline: só samples, em ordem crescente, valores ausentes viram null', () => {
    const s = sparkSeries([
      { id: 3, userId: 1, sessionId: 's', kind: 'sample', at: '2026-10-15T12:00:20Z', data: { rtt: 30, fps: 60 } },
      { id: 2, userId: 1, sessionId: 's', kind: 'js_error', at: '2026-10-15T12:00:15Z', data: {} },
      { id: 1, userId: 1, sessionId: 's', kind: 'sample', at: '2026-10-15T12:00:10Z', data: { fps: 58 } },
    ]);
    expect(s).toEqual([
      { t: Date.parse('2026-10-15T12:00:10Z'), rtt: null, fps: 58 },
      { t: Date.parse('2026-10-15T12:00:20Z'), rtt: 30, fps: 60 },
    ]);
  });

  it('niceRange garante faixa mínima e não fica negativo', () => {
    expect(niceRange([], 10)).toEqual([0, 10]);
    expect(niceRange([60, 60], 20)).toEqual([50, 70]);
    expect(niceRange([2, 3], 20)).toEqual([0, 13]);
    expect(niceRange([10, 300], 10)).toEqual([10, 300]);
  });
});
