// Regras puras da camada de texto do mundo (plaquinhas, pílulas) e do enquadramento.
import { describe, expect, it } from 'vitest';
import { overviewFrame } from '../camera';
import { plateText, STATUS_COLORS, zonePillAnchor } from './overlay';

describe('plaquinhas das mesas', () => {
  it('primeiro nome do dono, senão o rótulo; no máximo 8 caracteres', () => {
    expect(plateText({ label: 'A-01', code: 'A-01' }, 'Ana Beatriz Souza')).toBe('Ana');
    expect(plateText({ label: 'A-01', code: 'A-01' }, null)).toBe('A-01');
    expect(plateText({ label: '', code: 'B-02' }, null)).toBe('B-02');
    expect(plateText({ label: 'x', code: 'x' }, 'Maximiliano')).toBe('Maximili');
  });
});

describe('pílulas das salas', () => {
  it('ficam sobre os tiles de porta; sem porta, no topo do retângulo', () => {
    expect(zonePillAnchor({ doorTiles: [{ x: 4, y: 8 }, { x: 5, y: 8 }], rects: [] })).toEqual({ x: 5 * 16, y: 6 * 16 });
    expect(zonePillAnchor({ doorTiles: [], rects: [{ x: 2, y: 3, w: 4, h: 2 }] })).toEqual({ x: 4 * 16, y: 3 * 16 });
  });

  it('cores de status da marca', () => {
    expect(STATUS_COLORS.available).toBe('#048c22');
    expect(STATUS_COLORS.busy).toBe('#e30b2f');
    expect(STATUS_COLORS.away).toBe('#8a8a90');
  });
});

describe('visão geral', () => {
  const building = { x: 0, y: 0, w: 4 * 16 * 16, h: 29 * 16 };

  it('enquadra o prédio na área livre (fora dos painéis), com folga para as placas acima', () => {
    const free = overviewFrame(building, 1440, 900, { top: 0, right: 0, bottom: 0, left: 0 });
    const ui = overviewFrame(building, 1440, 900, { top: 64, right: 0, bottom: 200, left: 320 });
    expect(ui.zoom).toBeLessThan(free.zoom);
    const h = (building.h + 3.5 * 16) * ui.zoom;
    expect(h).toBeLessThanOrEqual(900 - 64 - 200 - 30);
    expect(ui.cy).toBeGreaterThan(building.h / 2);
    expect(ui.dy).toBeGreaterThan(0);
  });
});
