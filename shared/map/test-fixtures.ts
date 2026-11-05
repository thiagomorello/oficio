// Documentos mínimos para os testes de shared/map (não usado em produção).
import { createDocBuilder } from './doc-builder';
import type { OfficeMapDoc } from './doc';

/**
 * 20×14 tiles:
 * - `sala` (0,0,10,8): 4 paredes, porta sul em lx 4 (w 2), código "S1", ilha com 1 par
 *   (desk_back (2,3) + desk (2,4) + office_chair_front (2,2) + office_chair (2,5), dx 8), placa `sign`;
 *   zona privada/trancável `sala` = interior (1,2,8,5).
 * - `corr` (0,8,20,6): corredor sem paredes; spawn em (10,10).
 */
export function twoAreaDoc(): OfficeMapDoc {
  const b = createDocBuilder({ w: 20, h: 14 });
  const sala = b.area('sala', { x: 0, y: 0, w: 10, h: 8 }, { name: 'Sala Um', code: 'S1', kind: 'room' });
  sala.door('south', 4, 2);
  sala.furn('desk_back', 2, 3, { variant: 'dark' });
  sala.furn('desk', 2, 4, { variant: 'dark' });
  sala.furn('office_chair_front', 2, 2, { variant: 'black', dx: 8 });
  sala.furn('office_chair', 2, 5, { variant: 'black', dx: 8 });
  const sign = sala.wall('sign', 5, { label: 'Sala Um' });
  sala.area.signId = sign;
  b.area('corr', { x: 0, y: 8, w: 20, h: 6 }, { name: 'Corredor', kind: 'corridor', walls: false });
  b.zone({ id: 'sala', name: 'Sala Um', kind: 'meeting', rects: [{ x: 1, y: 2, w: 8, h: 5 }], private: true, lockable: true, capacity: 2, signId: `sala/${sign}` });
  b.spawn(10, 10);
  return b.build();
}

/** Cópia profunda (para mutar nos testes sem afetar o memo do assemble). */
export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
