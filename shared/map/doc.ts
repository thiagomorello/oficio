// Documento do mapa do escritório (`OfficeMapDoc`) — o que o editor edita, o banco guarda e
// `assembleOffice()` transforma em grade/spots/zonas/mesas. Puro, sem DOM.
//
// COORDENADAS
// - `MapArea.rect`, `MapZone.rects`, `MapSpot.tx/ty` e `spawn` são em tiles ABSOLUTOS do mundo.
// - Tudo DENTRO de uma área (`floors`, `rugs`, `furniture`, `doorways`, `wallItems.lcx`, `blocked`) é em
//   tiles LOCAIS à área: (0, 0) = canto superior esquerdo de `area.rect`, exatamente como no
//   `AreaBuilder` (`px(lx) = (rect.x + lx) * TILE`). Assim mover uma área move tudo junto.
// - `MapFurniture.lx/ly` = canto superior esquerdo do footprint (tiles inteiros). `dx/dy` só deslocam
//   o desenho (px), nunca o footprint (ex.: cadeira centrada numa mesa de 2 tiles: `dx: 8`).
// - `MapRug` aceita frações de 0,25 tile; `MapWallItem.lcx` (centro do item) também.
//
// PAREDES (iguais às salas do Habblaud, `layout/room.ts`)
// - norte: face de 2 linhas (ly 0–1, não caminháveis); sul: 1 linha (ly h-1); oeste/leste: "tampa" de
//   0,5 tile que torna a coluna 0 / w-1 não caminhável.
// - `doorways` abrem passagem (1..4 tiles) numa parede norte ou sul; porta norte ganha `door_frame`.
// - Itens de parede `on:'face'` ficam na face norte (rodapé em ly 2); `on:'south'` na mureta sul.
//
// IDS
// - `MapFurniture.id`/`MapWallItem.id`/`MapRug.id` são locais à área ("f17"; nunca renumerados). O id
//   absoluto é `${area.id}#${id}` — base dos ids de spots e mesas, que sobrevivem a republicações.
import { z } from 'zod';
import { DEFAULT_LOCALE, hasMessage, tFor, type Locale, type MessageKey, type Params } from '../i18n';
import { FURNITURE, type Dir, type FloorKind, type FurnitureKind, type WallStyle } from './furniture';
import type { AreaKind, TileRect, ZoneKind } from './types';

export type { AreaKind, TileRect, ZoneKind };

export const MAP_SCHEMA = 1 as const;

export interface MapWalls {
  style: WallStyle;
  north: boolean;
  south: boolean;
  west: boolean;
  east: boolean;
}

/** Passagem numa parede: `lx` = primeira coluna local, `w` = 1..4 tiles. */
export interface MapDoorway {
  side: 'north' | 'south';
  lx: number;
  w: number;
}

export interface MapFloor {
  kind: FloorKind;
  lx: number;
  ly: number;
  w: number;
  h: number;
  tint?: string;
  tint2?: string;
  /** Intensidade do tint nos pisos não-carpete (0..1; padrão `FLOOR_TINT_K` = 0,45). Carpet ignora. */
  tintK?: number;
  seed?: number;
}

/** Tapete (frações de 0,25 tile). */
export interface MapRug {
  id: string;
  lx: number;
  ly: number;
  w: number;
  h: number;
  color: string;
  seed?: number;
}

export interface MapFurniture {
  /** "f17" — local à área, nunca renumerado. */
  id: string;
  kind: FurnitureKind;
  variant?: string;
  lx: number;
  ly: number;
  /** Direção de quem usa (stool/bench/beanbag); cafe_chair/armchair/sofa usam a `variant`. */
  dir?: Dir;
  dx?: number;
  dy?: number;
  seat?: string;
}

export interface MapWallItem {
  id: string;
  kind: FurnitureKind;
  variant?: string;
  /** Centro do item em tiles locais (frações de 0,25). */
  lcx: number;
  on: 'face' | 'south';
  /** Texto da placa (`sign`). */
  label?: string;
}

export interface MapArea {
  id: string;
  name: string;
  /** Prefixo dos códigos de mesa ("A1" -> "A1-03"). Sem ele, as iniciais do nome. */
  code?: string;
  kind: AreaKind;
  /** Absoluto. */
  rect: TileRect;
  walls: MapWalls;
  doorways: MapDoorway[];
  floors: MapFloor[];
  rugs: MapRug[];
  furniture: MapFurniture[];
  wallItems: MapWallItem[];
  /** Tiles bloqueados extras, em coordenadas LOCAIS. */
  blocked?: TileRect[];
  /** Tom leve sobre o piso (identidade da sala). */
  floorTint?: string;
  /** Id (local) do `sign` com o nome da área. */
  signId?: string;
}

export interface MapZone {
  id: string;
  name: string;
  kind: ZoneKind;
  /** Absolutos. */
  rects: TileRect[];
  private: boolean;
  lockable: boolean;
  capacity?: number;
  /** "areaId/wallItemId" do `sign` sobre a porta. */
  signId?: string;
  color?: string;
}

/** Ponto de interesse avulso (absoluto). */
export interface MapSpot {
  id: string;
  kind: 'talk' | 'stand' | 'watch';
  tx: number;
  ty: number;
  dir: Dir;
  dx?: number;
  dy?: number;
  group?: string;
}

export interface OfficeMapDoc {
  schema: typeof MAP_SCHEMA;
  name: string;
  /** Tiles; cada lado ≤ 200. */
  size: { w: number; h: number };
  /** Próximo número livre para ids gerados pelo editor ("f<seq>"). */
  seq: number;
  areas: MapArea[];
  zones: MapZone[];
  spawn: { x: number; y: number }[];
  spots: MapSpot[];
  /** deskId -> rótulo exibido na placa. */
  deskLabels?: Record<string, string>;
}

// ------------------------------------------------------------------ zod

export const MAP_LIMITS = {
  size: 200,
  areas: 64,
  furniture: 4000,
  wallItems: 600,
  zones: 128,
  spots: 1000,
  spawn: 64,
  perArea: 400,
} as const;

/**
 * Prefixo das chaves de mensagem de limite (o validador as classifica como `limits`). As mensagens
 * deste schema são CHAVES de `shared/i18n` (`map.doc.*`, com `params` nos issues custom);
 * `formatZodIssues` traduz no idioma pedido.
 */
export const LIMITS_PREFIX = 'map.doc.limit.';

export const ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
export const COLOR_RE = /^#[0-9a-f]{6}$/;

const key = (k: MessageKey): string => k;

const id = z.string().regex(ID_RE, key('map.doc.invalidId'));
const color = z.string().regex(COLOR_RE, key('map.doc.invalidColor'));
const int = z.number().int();
const quarter = z.number().finite().refine((v) => Number.isInteger(v * 4), key('map.doc.quarterStep'));
const dirSchema = z.enum(['down', 'up', 'left', 'right']);
const kinds = Object.keys(FURNITURE) as [FurnitureKind, ...FurnitureKind[]];
const furnitureKind = z.enum(kinds);
const floorKind = z.enum(['carpet', 'wood', 'tile_check', 'tile_white', 'concrete', 'marble', 'grass', 'sidewalk', 'street']);
const pxOffset = int.min(-32).max(32);
const tileRect = z.object({ x: int, y: int, w: int.min(0).max(MAP_LIMITS.size), h: int.min(0).max(MAP_LIMITS.size) });
const label = z.string().min(1).max(48);

const wallStyle = z.object({
  base: color,
  trim: color.optional(),
  pattern: z.enum(['plain', 'stripes', 'tiles', 'wood_panel', 'brick', 'glass', 'marble']).optional(),
  exterior: z.boolean().optional(),
});

function checkVariant(kind: FurnitureKind, variant: string | undefined, ctx: z.RefinementCtx): void {
  if (variant === undefined) return;
  const list = FURNITURE[kind].variants;
  if (!list) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['variant'], message: key('map.doc.noVariants'), params: { kind } });
  else if (!list.includes(variant)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['variant'], message: key('map.doc.invalidVariant'), params: { variant, kind, list: list.join(', ') } });
}

const mapFurniture = z
  .object({
    id,
    kind: furnitureKind,
    variant: z.string().max(32).optional(),
    lx: int,
    ly: int,
    dir: dirSchema.optional(),
    dx: pxOffset.optional(),
    dy: pxOffset.optional(),
    seat: z.string().max(32).optional(),
  })
  .superRefine((f, ctx) => {
    if (FURNITURE[f.kind].mount !== 'floor') ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['kind'], message: key('map.doc.wallItemAsFurniture'), params: { kind: f.kind } });
    checkVariant(f.kind, f.variant, ctx);
  });

const mapWallItem = z
  .object({
    id,
    kind: furnitureKind,
    variant: z.string().max(32).optional(),
    lcx: quarter,
    on: z.enum(['face', 'south']),
    label: label.optional(),
  })
  .superRefine((w, ctx) => {
    if (FURNITURE[w.kind].mount !== 'wall') ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['kind'], message: key('map.doc.furnitureAsWallItem'), params: { kind: w.kind } });
    checkVariant(w.kind, w.variant, ctx);
  });

const mapArea = z.object({
  id,
  name: z.string().min(1).max(64),
  code: z.string().regex(/^[A-Za-z0-9]{1,6}$/, key('map.doc.codeFormat')).optional(),
  kind: z.enum(['reception', 'restroom', 'cafe', 'lounge', 'room', 'corridor', 'open', 'zen']),
  rect: tileRect,
  walls: z.object({ style: wallStyle, north: z.boolean(), south: z.boolean(), west: z.boolean(), east: z.boolean() }),
  doorways: z.array(z.object({ side: z.enum(['north', 'south']), lx: int, w: int })).max(16),
  floors: z.array(z.object({ kind: floorKind, lx: int, ly: int, w: int.min(1), h: int.min(1), tint: color.optional(), tint2: color.optional(), tintK: z.number().min(0).max(1).optional(), seed: int.optional() })).max(MAP_LIMITS.perArea),
  rugs: z.array(z.object({ id, lx: quarter, ly: quarter, w: quarter.refine((v) => v > 0, 'largura > 0'), h: quarter.refine((v) => v > 0, 'altura > 0'), color, seed: int.optional() })).max(64),
  furniture: z.array(mapFurniture),
  wallItems: z.array(mapWallItem),
  blocked: z.array(tileRect).max(64).optional(),
  floorTint: color.optional(),
  signId: id.optional(),
});

const mapZone = z.object({
  id,
  name: z.string().min(1).max(64),
  kind: z.enum(['meeting', 'lunch', 'lounge', 'quiet', 'phone', 'open']),
  rects: z.array(tileRect).max(32),
  private: z.boolean(),
  lockable: z.boolean(),
  capacity: int.min(1).max(500).optional(),
  signId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}\/[a-z0-9][a-z0-9_-]{0,31}$/, 'signId: "areaId/wallItemId"').optional(),
  color: color.optional(),
});

const mapSpot = z.object({
  id,
  kind: z.enum(['talk', 'stand', 'watch']),
  tx: int,
  ty: int,
  dir: dirSchema,
  dx: pxOffset.optional(),
  dy: pxOffset.optional(),
  group: z.string().max(48).optional(),
});

export const mapDocSchema = z
  .object({
    schema: z.literal(MAP_SCHEMA),
    name: z.string().min(1).max(64),
    size: z.object({ w: int.min(1), h: int.min(1) }),
    seq: int.min(0),
    areas: z.array(mapArea),
    zones: z.array(mapZone),
    spawn: z.array(z.object({ x: int, y: int })),
    spots: z.array(mapSpot),
    deskLabels: z.record(z.string().max(80), label).optional(),
  })
  .superRefine((d, ctx) => {
    // as chaves de limite começam com LIMITS_PREFIX ('map.doc.limit.')
    const lim = (path: (string | number)[], message: MessageKey, params: Params) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message, params: { ...params } });
    if (d.size.w > MAP_LIMITS.size || d.size.h > MAP_LIMITS.size) lim(['size'], 'map.doc.limit.size', { n: MAP_LIMITS.size });
    if (d.areas.length > MAP_LIMITS.areas) lim(['areas'], 'map.doc.limit.areas', { n: MAP_LIMITS.areas });
    if (d.zones.length > MAP_LIMITS.zones) lim(['zones'], 'map.doc.limit.zones', { n: MAP_LIMITS.zones });
    if (d.spots.length > MAP_LIMITS.spots) lim(['spots'], 'map.doc.limit.spots', { n: MAP_LIMITS.spots });
    if (d.spawn.length > MAP_LIMITS.spawn) lim(['spawn'], 'map.doc.limit.spawn', { n: MAP_LIMITS.spawn });
    let furn = 0;
    let wall = 0;
    for (const a of d.areas) {
      furn += a.furniture.length;
      wall += a.wallItems.length;
    }
    if (furn > MAP_LIMITS.furniture) lim(['areas'], 'map.doc.limit.furniture', { n: MAP_LIMITS.furniture, count: furn });
    if (wall > MAP_LIMITS.wallItems) lim(['areas'], 'map.doc.limit.wallItems', { n: MAP_LIMITS.wallItems, count: wall });
  });

/** Garantia em tempo de compilação: o que o zod aceita é um `OfficeMapDoc`. */
type Assert<T extends true> = T;
export type _MapDocSchemaMatches = Assert<z.infer<typeof mapDocSchema> extends OfficeMapDoc ? true : false>;

/** Mensagem de um issue do zod no idioma pedido (as nossas são chaves `map.doc.*`; as do zod ficam como vêm). */
export function zodIssueMessage(issue: z.ZodIssue, locale: Locale = DEFAULT_LOCALE): string {
  const params = (issue as { params?: Params }).params;
  return hasMessage(issue.message) ? tFor(locale, issue.message, params) : issue.message;
}

/** Formata os problemas do zod em linhas legíveis ("areas.0.furniture.3.variant: ..."). */
export function formatZodIssues(err: z.ZodError, locale: Locale = DEFAULT_LOCALE): string[] {
  return err.issues.map((i) => `${i.path.length ? i.path.join('.') : '(doc)'}: ${zodIssueMessage(i, locale)}`);
}

export class MapDocError extends Error {
  constructor(
    message: string,
    readonly issues: string[],
  ) {
    super(message);
    this.name = 'MapDocError';
  }
}

/**
 * Valida (e, no futuro, migra) um documento vindo do banco/HTTP. Lança `MapDocError` com uma
 * mensagem legível se o formato for inválido. Não faz validação topológica (ver `validateMap`).
 */
export function migrateDoc(raw: unknown, locale: Locale = DEFAULT_LOCALE): OfficeMapDoc {
  if (!raw || typeof raw !== 'object') throw new MapDocError(tFor(locale, 'map.doc.notAnObject'), []);
  const schema = (raw as { schema?: unknown }).schema;
  if (schema !== MAP_SCHEMA) throw new MapDocError(tFor(locale, 'map.doc.unknownSchema', { schema: JSON.stringify(schema), expected: MAP_SCHEMA }), []);
  const r = mapDocSchema.safeParse(raw);
  if (!r.success) {
    const issues = formatZodIssues(r.error, locale);
    const head = issues.slice(0, 5).join('; ');
    throw new MapDocError(tFor(locale, 'map.doc.invalid', { issues: `${head}${issues.length > 5 ? ` (+${issues.length - 5})` : ''}` }), issues);
  }
  return r.data as OfficeMapDoc;
}
