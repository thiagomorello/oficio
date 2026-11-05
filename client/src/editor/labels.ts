// Nomes traduzidos de móveis, pisos, tipos de área/zona e categorias da paleta (chaves em
// shared/i18n/messages/editor.ts e map.ts). Funções, não constantes: o idioma pode mudar em tempo real.
import type { AreaKind, ZoneKind } from '../../../shared/map/doc';
import type { FloorKind, FurnitureKind } from '../../../shared/map/furniture';
import { t, type MessageKey } from '../i18n';

/** Nome do móvel/item de parede (catálogo `map.furniture.*`). */
export function furnitureLabel(kind: FurnitureKind): string {
  return t(`map.furniture.${kind}`);
}

export interface PaletteGroup {
  title: MessageKey;
  wall?: boolean;
  kinds: readonly FurnitureKind[];
}

export const PALETTE_GROUPS: readonly PaletteGroup[] = [
  { title: 'editor.group.office', kinds: ['desk', 'desk_back', 'office_chair', 'office_chair_front', 'bookshelf', 'binder_shelf', 'filing_cabinet', 'printer', 'trash_bin', 'glass_partition'] },
  { title: 'editor.group.meeting', kinds: ['meeting_table', 'stool'] },
  { title: 'editor.group.kitchen', kinds: ['counter', 'counter_sink', 'coffee_machine', 'microwave', 'fridge', 'vending_machine', 'water_cooler', 'cafe_table', 'cafe_chair'] },
  { title: 'editor.group.lounge', kinds: ['sofa', 'armchair', 'coffee_table', 'beanbag', 'pingpong_table', 'arcade', 'floor_lamp'] },
  { title: 'editor.group.receptionRestroom', kinds: ['reception_desk', 'bench', 'toilet_stall', 'sink'] },
  { title: 'editor.group.plants', kinds: ['plant_small', 'plant_tall'] },
  { title: 'editor.group.wall', wall: true, kinds: ['sign', 'whiteboard', 'tv', 'window', 'painting', 'poster', 'clock', 'mirror', 'shelf_wall', 'light_switch', 'elevator'] },
];

export const FLOOR_KINDS: readonly FloorKind[] = ['carpet', 'wood', 'tile_check', 'tile_white', 'concrete', 'marble', 'grass', 'sidewalk', 'street'];

export function floorLabel(kind: FloorKind): string {
  return t(`editor.floor.${kind}`);
}

const FLOOR_PRESET_KEYS: Readonly<Record<string, MessageKey>> = {
  openCarpet: 'editor.floorPreset.openCarpet',
  roomCarpet: 'editor.floorPreset.roomCarpet',
  zenCarpet: 'editor.floorPreset.zenCarpet',
  reception: 'editor.floorPreset.reception',
  corridor: 'editor.floorPreset.corridor',
  praca: 'editor.floorPreset.praca',
  kitchen: 'editor.floorPreset.kitchen',
  restroom: 'editor.floorPreset.restroom',
  lounge: 'editor.floorPreset.lounge',
};

/** Nome de um preset de piso de `FLOORS` (a chave do preset quando não há tradução). */
export function floorPresetLabel(key: string): string {
  const k = FLOOR_PRESET_KEYS[key];
  return k ? t(k) : key;
}

export const AREA_KINDS: readonly AreaKind[] = ['reception', 'restroom', 'cafe', 'lounge', 'room', 'corridor', 'open', 'zen'];

export function areaKindLabel(kind: AreaKind): string {
  return t(`editor.areaKind.${kind}`);
}

export const ZONE_KINDS: readonly ZoneKind[] = ['meeting', 'lunch', 'lounge', 'quiet', 'phone', 'open'];

export function zoneKindLabel(kind: ZoneKind): string {
  return t(`editor.zoneKind.${kind}`);
}

export function dirLabel(dir: 'up' | 'down' | 'left' | 'right'): string {
  return t(`editor.dir.${dir}`);
}

const WALL_PRESET_KEYS: Readonly<Record<string, MessageKey>> = {
  office: 'editor.wallPreset.office',
  reception: 'editor.wallPreset.reception',
  meeting: 'editor.wallPreset.meeting',
  amarela: 'editor.wallPreset.amarela',
  kitchen: 'editor.wallPreset.kitchen',
  restroom: 'editor.wallPreset.restroom',
  lounge: 'editor.wallPreset.lounge',
  zen: 'editor.wallPreset.zen',
};

/** Nome de um preset de parede de `WALLS` (a chave do preset quando não há tradução). */
export function wallPresetLabel(key: string): string {
  const k = WALL_PRESET_KEYS[key];
  return k ? t(k) : key;
}

export function spotLabel(kind: 'talk' | 'stand' | 'watch'): string {
  return t(`editor.spot.${kind}`);
}
