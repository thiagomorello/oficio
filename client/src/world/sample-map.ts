// Escritório de exemplo (pequeno) para desenvolvimento e testes do cliente enquanto o mapa padrão
// (`shared/map/default-map.ts`, WP1b) não existe. Na integração, troque por `buildDefaultMap()`.
import { BRAND_SIGN_LABEL } from '../../../shared/branding';
import { DEFAULT_LOCALE, tFor, type Locale } from '../../../shared/i18n';
import { createDocBuilder } from '../../../shared/map/doc-builder';
import type { OfficeMapDoc } from '../../../shared/map/doc';

/**
 * 40×26 tiles:
 * - `recepcao` (0,0,14,10): placa da marca, balcão, plantas; porta sul.
 * - `sala-rosa` (14,0,12,10): reunião privada/trancável com mesa 3×2 e 4 banquetas; porta sul.
 * - `copa` (26,0,14,10): cafeteira, bebedouro, mesa de café com cadeiras; porta sul.
 * - `corredor` (0,10,40,5): sem paredes; spawn em (5..7,12).
 * - `open` (0,15,40,11): 4 ilhas com 1 par de mesas cada (8 baias); portas norte.
 */
export function buildSampleMap(locale: Locale = DEFAULT_LOCALE): OfficeMapDoc {
  const L = (key: Parameters<typeof tFor>[1]) => tFor(locale, key);
  const b = createDocBuilder({ w: 40, h: 26 }, L('map.sample.name'));
  const style = { base: '#2a292e', trim: '#ffd800', pattern: 'plain' as const };
  const walls = { north: true, south: true, west: true, east: true, style };

  const rec = b.area('recepcao', { x: 0, y: 0, w: 14, h: 10 }, { name: L('map.default.recepcao'), kind: 'reception', walls, floor: { kind: 'marble' } });
  rec.door('south', 6, 2);
  rec.area.signId = rec.wall('sign', 7, { label: BRAND_SIGN_LABEL });
  rec.wall('clock', 3);
  rec.wall('painting', 11);
  rec.furn('reception_desk', 5, 4);
  rec.furn('plant_tall', 1, 2, { variant: 'monstera' });
  rec.furn('plant_tall', 12, 2, { variant: 'palm' });
  rec.furn('sofa', 2, 7, { variant: 'up' });
  rec.rug(5, 6.5, 4, 2, '#e6c81e');

  const sala = b.area('sala-rosa', { x: 14, y: 0, w: 12, h: 10 }, { name: L('map.default.salaRosa'), kind: 'room', walls, floor: { kind: 'carpet', tint: '#34343b', tint2: '#2e2e34' } });
  sala.door('south', 5, 2);
  const sign = sala.wall('sign', 6, { label: L('map.default.salaRosa') });
  sala.area.signId = sign;
  sala.wall('whiteboard', 2.5);
  sala.wall('tv', 9.5);
  sala.furn('meeting_table', 4, 4);
  sala.furn('stool', 4, 3);
  sala.furn('stool', 6, 3);
  sala.furn('stool', 4, 6);
  sala.furn('stool', 6, 6);

  const copa = b.area('copa', { x: 26, y: 0, w: 14, h: 10 }, { name: L('map.default.copa'), kind: 'cafe', walls, floor: { kind: 'tile_check' } });
  copa.door('south', 6, 2);
  copa.area.signId = copa.wall('sign', 7, { label: L('map.default.copa') });
  copa.wall('window', 3);
  copa.wall('window', 11);
  copa.furn('counter', 1, 2);
  copa.furn('coffee_machine', 2, 2);
  copa.furn('counter_sink', 3, 2);
  copa.furn('fridge', 4, 2);
  copa.furn('water_cooler', 12, 2);
  copa.furn('cafe_table', 7, 5);
  copa.furn('cafe_chair', 6, 5, { variant: 'right' });
  copa.furn('cafe_chair', 8, 5, { variant: 'left' });

  b.area('corredor', { x: 0, y: 10, w: 40, h: 5 }, { name: L('map.sample.corridor'), kind: 'corridor', walls: false, floor: { kind: 'concrete' } });

  const open = b.area('open', { x: 0, y: 15, w: 40, h: 11 }, { name: L('map.sample.open'), code: 'A', kind: 'open', walls, floor: { kind: 'carpet', tint: '#34343b', tint2: '#2e2e34' } });
  open.door('north', 4, 2);
  open.door('north', 33, 2);
  open.rug(2, 3, 34, 6, '#c9ab12');
  for (const lx of [4, 12, 22, 30]) {
    open.furn('office_chair_front', lx, 3, { variant: 'black', dx: 8 });
    open.furn('desk_back', lx, 4, { variant: 'dark' });
    open.furn('desk', lx, 5, { variant: 'dark' });
    open.furn('office_chair', lx, 6, { variant: 'black', dx: 8 });
  }
  open.furn('plant_small', 1, 2, { variant: 'fern' });
  open.furn('printer', 38, 2);

  b.zone({ id: 'sala-rosa', name: L('map.default.salaRosa'), kind: 'meeting', rects: [{ x: 15, y: 2, w: 10, h: 7 }], private: true, lockable: true, capacity: 4, signId: `sala-rosa/${sign}` });
  b.zone({ id: 'copa', name: L('map.default.copa'), kind: 'lunch', rects: [{ x: 27, y: 2, w: 12, h: 7 }], private: false, lockable: false });
  b.spawn(5, 12).spawn(6, 12).spawn(7, 12);
  return b.build();
}
