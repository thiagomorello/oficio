// Carimbos ("stamps") de conjuntos de móveis: os mesmos que o mapa padrão usa e que o editor oferece.
// Todos operam sobre o `AreaHandle` do doc-builder em coordenadas LOCAIS à área (ids "f<seq>" do
// documento, nunca reusados). Os que criam zona recebem o `DocBuilder` e gravam a zona em tiles
// absolutos. Puros e determinísticos (mesma chamada → mesmo documento).
import type { AreaHandle, DocBuilder } from './doc-builder';
import type { MapDoorway, TileRect } from './doc';
import type { WallStyle } from './furniture';
import { FLOORS, FURNITURE_VARIANTS, WALLS, type FloorPreset } from './palette';

/** Retângulo local da área -> absoluto. */
export function localToAbs(area: AreaHandle, r: TileRect): TileRect {
  return { x: area.area.rect.x + r.x, y: area.area.rect.y + r.y, w: r.w, h: r.h };
}

// ------------------------------------------------------------------ ilha de mesas

export interface IslandOpts {
  /** Pares de mesas face a face (1..3). Padrão 3. */
  pairs?: 1 | 2 | 3;
  deskVariant?: string;
  chairVariant?: string;
}

/** Tamanho (tiles) de uma ilha: `2·pairs × 4`. */
export function islandSize(pairs: 1 | 2 | 3 = 3): { w: number; h: number } {
  return { w: 2 * pairs, h: 4 };
}

/**
 * Ilha de mesas com canto em (lx, ly). Par i (coluna lx+2i): `office_chair_front` (ly, dx 8) ·
 * `desk_back` (ly+1) · `desk` (ly+2) · `office_chair` (ly+3, dx 8). Devolve os ids das mesas, na
 * ordem (desk_back, desk) de cada par.
 */
export function stampIsland(area: AreaHandle, lx: number, ly: number, o: IslandOpts = {}): string[] {
  const pairs = o.pairs ?? 3;
  const desk = o.deskVariant ?? FURNITURE_VARIANTS.desk;
  const chair = o.chairVariant ?? FURNITURE_VARIANTS.chairOpen;
  const desks: string[] = [];
  for (let i = 0; i < pairs; i++) {
    const x = lx + 2 * i;
    area.furn('office_chair_front', x, ly, { variant: chair, dx: 8 });
    desks.push(area.furn('desk_back', x, ly + 1, { variant: desk }));
    desks.push(area.furn('desk', x, ly + 2, { variant: desk }));
    area.furn('office_chair', x, ly + 3, { variant: chair, dx: 8 });
  }
  return desks;
}

// ------------------------------------------------------------------ sala de reunião

export interface MeetingRoomOpts {
  seats: 4 | 8 | 12;
  /** Porta (padrão: sul, lx 7, w 2). */
  door?: MapDoorway;
  wall?: WallStyle;
  /** `MapArea.floorTint` (identidade da sala). */
  tint?: string;
  floor?: FloorPreset;
  tv?: boolean;
  whiteboard?: boolean;
  /** Texto da placa (padrão: `name`). */
  label?: string;
  /** Id da zona `meeting` (padrão: o id da sala). */
  zoneId?: string;
}

/**
 * Sala de reunião completa: área com 4 paredes, porta de 2 tiles, placa central na face norte
 * (whiteboard em lcx 3,5 e tv em lcx 12, opcionais), 1/2/3 `meeting_table` lado a lado no centro com
 * 4/8/12 banquetas (2 em cima e 2 embaixo de cada mesa) e a zona `meeting` privada/trancável sobre o
 * interior, com `capacity = seats` e `signId` = a placa.
 */
export function stampMeetingRoom(b: DocBuilder, id: string, name: string, code: string | undefined, rect: TileRect, o: MeetingRoomOpts): AreaHandle {
  const a = b.area(id, rect, {
    name,
    ...(code ? { code } : {}),
    kind: 'room',
    walls: { north: true, south: true, west: true, east: true, style: o.wall ?? WALLS.meeting },
    floor: o.floor ?? FLOORS.roomCarpet,
    doorways: [o.door ?? { side: 'south', lx: 7, w: 2 }],
    ...(o.tint ? { floorTint: o.tint } : {}),
  });
  const sign = a.wall('sign', rect.w / 2, { label: o.label ?? name });
  a.area.signId = sign;
  if (o.whiteboard) a.wall('whiteboard', 3.5);
  if (o.tv) a.wall('tv', Math.min(12, rect.w - 4));

  const tables = o.seats / 4;
  const bw = 3 * tables;
  const x0 = Math.floor((rect.w - bw) / 2);
  const y0 = Math.floor(rect.h / 2) - 1;
  for (let t = 0; t < tables; t++) a.furn('meeting_table', x0 + 3 * t, y0);
  for (const y of [y0 - 1, y0 + 2]) {
    for (let t = 0; t < tables; t++) {
      a.furn('stool', x0 + 3 * t, y);
      a.furn('stool', x0 + 3 * t + 2, y);
    }
  }

  // interior (sem paredes) = zona
  const interior: TileRect = { x: 1, y: 2, w: rect.w - 2, h: rect.h - 3 };
  b.zone({ id: o.zoneId ?? id, name, kind: 'meeting', rects: [localToAbs(a, interior)], private: true, lockable: true, capacity: o.seats, signId: `${id}/${sign}` });
  return a;
}

// ------------------------------------------------------------------ mesa de almoço

export interface LunchTableOpts {
  /** Cria a zona `lunch` (privada, não trancável, capacidade 12) com este id/nome. */
  zone?: { id: string; name: string; color?: string };
}

/**
 * Mesa comprida de almoço com canto em (lx, ly): 3 `meeting_table` lado a lado em ly+1 (9×2) e
 * 12 `cafe_chair` — 6 em ly ('down') e 6 em ly+3 ('up'), nas colunas 0,2,3,5,6,8. Footprint 9×4.
 * A zona (se pedida) cobre o footprint + 1 coluna de cada lado, para as duas fileiras de cadeiras
 * formarem uma única entrada. Devolve o retângulo LOCAL da zona.
 */
export function stampLunchTable(b: DocBuilder, area: AreaHandle, lx: number, ly: number, o: LunchTableOpts = {}): TileRect {
  for (let t = 0; t < 3; t++) area.furn('meeting_table', lx + 3 * t, ly + 1);
  for (const [y, dir] of [
    [ly, 'down'],
    [ly + 3, 'up'],
  ] as const) {
    for (let t = 0; t < 3; t++) {
      area.furn('cafe_chair', lx + 3 * t, y, { variant: dir });
      area.furn('cafe_chair', lx + 3 * t + 2, y, { variant: dir });
    }
  }
  const zone: TileRect = { x: lx - 1, y: ly, w: 11, h: 4 };
  if (o.zone) b.zone({ id: o.zone.id, name: o.zone.name, kind: 'lunch', rects: [localToAbs(area, zone)], private: true, lockable: false, capacity: 12, ...(o.zone.color ? { color: o.zone.color } : {}) });
  return zone;
}

// ------------------------------------------------------------------ cabine telefônica

export interface PhoneBoothOpts {
  zone: { id: string; name: string };
  plant?: string;
}

/**
 * Cabine telefônica com canto em (lx, ly), footprint 3×3: planta pequena ao fundo (lx+1, ly),
 * `glass_partition` 'v' em (lx, ly+1) e (lx+2, ly+1), poltrona 'down' em (lx+1, ly+1); a entrada é
 * (lx+1, ly+2). Zona `phone` privada 1×2 (poltrona + entrada), capacidade 1. Devolve o retângulo
 * LOCAL da zona.
 */
export function stampPhoneBooth(b: DocBuilder, area: AreaHandle, lx: number, ly: number, o: PhoneBoothOpts): TileRect {
  area.furn('plant_small', lx + 1, ly, { variant: o.plant ?? 'fern' });
  area.furn('glass_partition', lx, ly + 1, { variant: 'v' });
  area.furn('armchair', lx + 1, ly + 1, { variant: 'down' });
  area.furn('glass_partition', lx + 2, ly + 1, { variant: 'v' });
  const zone: TileRect = { x: lx + 1, y: ly + 1, w: 1, h: 2 };
  b.zone({ id: o.zone.id, name: o.zone.name, kind: 'phone', rects: [localToAbs(area, zone)], private: true, lockable: false, capacity: 1 });
  return zone;
}
