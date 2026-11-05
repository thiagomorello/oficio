// Validação do documento do mapa (A.3): zod → estrutural → assemble → topológico.
// Erros bloqueiam a publicação; avisos exigem confirmação de quem publica.
import { areaGeometry, assembleOffice, autoDoorFrameId, doorwayRect } from './assemble';
import { luminance, mix } from './color';
import { DEFAULT_LOCALE, tFor, type Locale, type MessageKey, type Params } from '../i18n';
import { LIMITS_PREFIX, mapDocSchema, zodIssueMessage, type MapArea, type OfficeMapDoc } from './doc';
import { FURNITURE, type FurnitureKind } from './furniture';
import { FREE } from './grid';
import { CARPET_DEFAULT, FLOOR_BASE, FLOOR_TINT_K, MIN_FLOOR_LUMINANCE } from './palette';
import { absId } from './spots';
import { TILE } from './tile';
import type { OfficeAssembly, TileRect } from './types';

export type MapErrorCode =
  | 'schema'
  | 'limits'
  | 'duplicate_id'
  | 'area_outside'
  | 'area_overlap'
  | 'furniture_outside'
  | 'furniture_overlap'
  | 'seat_on_wall'
  | 'wall_item_no_wall'
  | 'wall_item_outside'
  | 'doorway_not_on_wall'
  | 'doorway_blocked'
  | 'spawn_missing'
  | 'spawn_blocked'
  | 'spawn_unreachable'
  | 'spot_unreachable'
  | 'spot_blocked'
  | 'zone_empty'
  | 'zone_overlap'
  | 'zone_no_door'
  | 'zone_sign_invalid';

export type MapWarningCode =
  | 'floor_missing'
  | 'floor_dark'
  | 'wall_item_overlap'
  | 'wall_item_hidden'
  | 'tile_unreachable'
  | 'zone_many_doors'
  | 'zone_capacity'
  | 'desk_without_chair'
  | 'chair_without_desk'
  | 'desk_pair_mismatch';

export type MapIssueCode = MapErrorCode | MapWarningCode;

export interface MapIssue {
  code: MapIssueCode;
  severity: 'error' | 'warning';
  /** Texto no idioma pedido a `validateMap` (padrão: `en`). */
  message: string;
  /** Chave da mensagem (`map.validate.*`) e parâmetros: o editor retraduz com `t(key, params)`. */
  key: MessageKey;
  params?: Params;
  /** Onde (tiles absolutos), para o editor marcar/centralizar. */
  at?: TileRect;
  /** Id relacionado (área, móvel absoluto, zona, spot...). */
  ref?: string;
}

export interface MapValidation {
  errors: MapIssue[];
  warnings: MapIssue[];
  /** Montagem (versão 0) quando não há erros. */
  assembly: OfficeAssembly | null;
}

/** Móveis de chão altos que escondem o que está pendurado na parede logo atrás (igual a layout.test). */
const TALL_FLOOR = new Set<FurnitureKind>(['plant_tall', 'bookshelf', 'binder_shelf', 'fridge', 'vending_machine', 'arcade', 'water_cooler', 'floor_lamp', 'toilet_stall']);
const WALL_DECOR = new Set<FurnitureKind>(['painting', 'poster', 'window', 'tv', 'whiteboard', 'sign', 'clock', 'mirror', 'door_frame']);

/** Cor média estimada de um piso (regra de luminância); `tintK` = intensidade do tint, igual ao `floorChunk`. */
export function floorColor(kind: keyof typeof FLOOR_BASE | 'carpet', tint?: string, tintK: number = FLOOR_TINT_K): string {
  if (kind === 'carpet') return tint ?? CARPET_DEFAULT;
  return tint ? mix(FLOOR_BASE[kind], tint, tintK) : FLOOR_BASE[kind];
}

function intersects(a: TileRect, b: TileRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function inRect(r: TileRect, x: number, y: number): boolean {
  return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
}

/**
 * Valida um documento (qualquer JSON). `locale` é o idioma de `MapIssue.message`; cada issue também
 * carrega `key`/`params` para o editor retraduzir ao vivo.
 */
export function validateMap(raw: unknown, locale: Locale = DEFAULT_LOCALE): MapValidation {
  const errors: MapIssue[] = [];
  const warnings: MapIssue[] = [];
  const issue = (code: MapIssueCode, severity: MapIssue['severity'], key: MessageKey, params?: Params, at?: TileRect, ref?: string): MapIssue => ({
    code,
    severity,
    message: tFor(locale, key, params),
    key,
    ...(params ? { params } : {}),
    ...(at ? { at } : {}),
    ...(ref ? { ref } : {}),
  });
  const err: ErrFn = (code, key, params, at, ref) => errors.push(issue(code, 'error', key, params, at, ref));
  const warn: WarnFn = (code, key, params, at, ref) => warnings.push(issue(code, 'warning', key, params, at, ref));

  // ---------------------------------------------------------------- 1. zod
  const parsed = mapDocSchema.safeParse(raw);
  if (!parsed.success) {
    for (const i of parsed.error.issues) {
      const path = i.path.length ? i.path.join('.') : '(doc)';
      const detail = zodIssueMessage(i, locale);
      if (i.message.startsWith(LIMITS_PREFIX)) err('limits', i.message as MessageKey, (i as { params?: Params }).params);
      else err('schema', 'map.validate.schema', { path, detail });
    }
    return { errors, warnings, assembly: null };
  }
  // o zod devolve uma cópia; validamos/montamos o objeto original quando possível (memo por identidade)
  const doc = raw as OfficeMapDoc;

  // ---------------------------------------------------------------- 2. estrutural
  const seen = (key: MessageKey, params: Params, ids: Iterable<string>) => {
    const s = new Set<string>();
    for (const id of ids) {
      if (s.has(id)) err('duplicate_id', key, { ...params, id }, undefined, id);
      s.add(id);
    }
  };
  seen('map.validate.duplicateId.areas', {}, doc.areas.map((a) => a.id));
  seen('map.validate.duplicateId.zones', {}, doc.zones.map((z) => z.id));
  seen('map.validate.duplicateId.spots', {}, doc.spots.map((s) => s.id));
  for (const a of doc.areas) seen('map.validate.duplicateId.inArea', { area: a.id }, [...a.furniture.map((f) => f.id), ...a.wallItems.map((w) => w.id), ...a.rugs.map((r) => r.id)]);

  if (!doc.spawn.length) err('spawn_missing', 'map.validate.spawnMissing');

  for (const a of doc.areas) {
    const r = a.rect;
    if (r.w < 4 || r.h < 4) err('area_outside', 'map.validate.areaTooSmall', { id: a.id }, r, a.id);
    else if (r.x < 0 || r.y < 0 || r.x + r.w > doc.size.w || r.y + r.h > doc.size.h) err('area_outside', 'map.validate.areaOutside', { id: a.id, w: doc.size.w, h: doc.size.h }, r, a.id);
  }
  for (let i = 0; i < doc.areas.length; i++) {
    for (let j = i + 1; j < doc.areas.length; j++) {
      const a = doc.areas[i];
      const b = doc.areas[j];
      if (intersects(a.rect, b.rect)) err('area_overlap', 'map.validate.areaOverlap', { a: a.id, b: b.id }, a.rect, `${a.id},${b.id}`);
    }
  }
  for (const a of doc.areas) checkArea(a, err, warn);

  const wallItemIds = new Map<string, MapArea['wallItems'][number]>();
  for (const a of doc.areas) for (const w of a.wallItems) wallItemIds.set(`${a.id}/${w.id}`, w);
  for (const z of doc.zones) {
    if (z.signId === undefined) continue;
    const w = wallItemIds.get(z.signId);
    if (!w || w.kind !== 'sign') err('zone_sign_invalid', 'map.validate.zoneSignInvalid', { id: z.id, signId: z.signId }, undefined, z.id);
  }

  // ---------------------------------------------------------------- 3. assemble
  const assembly = assembleOffice(doc, 0, {
    warn: (code, key, params, ref) => warn(code, key, params, undefined, ref),
  });

  // ---------------------------------------------------------------- 4. topológico
  topology(doc, assembly, err, warn);

  return { errors, warnings, assembly: errors.length ? null : assembly };
}

type ErrFn = (code: MapErrorCode, key: MessageKey, params?: Params, at?: TileRect, ref?: string) => void;
type WarnFn = (code: MapWarningCode, key: MessageKey, params?: Params, at?: TileRect, ref?: string) => void;

function checkArea(a: MapArea, err: ErrFn, warn: WarnFn): void {
  const geo = areaGeometry(a);
  const absR = (r: TileRect): TileRect => ({ x: a.rect.x + r.x, y: a.rect.y + r.y, w: r.w, h: r.h });

  // passagens
  for (const d of a.doorways) {
    const wallOk = d.side === 'north' ? a.walls.north : a.walls.south;
    if (!wallOk || d.w < 1 || d.w > 4 || d.lx < 1 || d.lx + d.w > a.rect.w - 1) {
      err('doorway_not_on_wall', 'map.validate.doorwayNotOnWall', { id: a.id, side: d.side, lx: d.lx, w: d.w }, absR(doorwayRect(a, d)), a.id);
    }
  }

  // móveis
  const occ = new Map<number, string>();
  for (const f of a.furniture) {
    const def = FURNITURE[f.kind];
    const { w, h } = def.footprint;
    const fid = absId(a.id, f.id);
    const at = absR({ x: f.lx, y: f.ly, w, h });
    if (f.lx < 0 || f.ly < 0 || f.lx + w > a.rect.w || f.ly + h > a.rect.h) {
      err('furniture_outside', 'map.validate.furnitureOutside', { id: fid, kind: f.kind }, at, fid);
      continue;
    }
    for (let y = f.ly; y < f.ly + h; y++) {
      for (let x = f.lx; x < f.lx + w; x++) {
        const k = y * a.rect.w + x;
        const other = occ.get(k);
        if (other) err('furniture_overlap', 'map.validate.furnitureOverlap', { id: fid, kind: f.kind, other }, absR({ x, y, w: 1, h: 1 }), fid);
        else occ.set(k, fid);
        if (def.seat && (!inRect(geo.interior, x, y) || (a.blocked ?? []).some((b) => inRect(b, x, y)))) {
          err('seat_on_wall', 'map.validate.seatOnWall', { id: fid, kind: f.kind }, absR({ x, y, w: 1, h: 1 }), fid);
        }
      }
    }
  }

  // itens de parede (+ batentes automáticos das passagens norte)
  type WI = { id: string; kind: FurnitureKind; lcx: number; on: 'face' | 'south' };
  const items: WI[] = a.wallItems.map((w) => ({ id: absId(a.id, w.id), kind: w.kind, lcx: w.lcx, on: w.on }));
  a.doorways
    .filter((d) => d.side === 'north')
    .forEach((d, i) => items.push({ id: autoDoorFrameId(a.id, i), kind: 'door_frame', lcx: d.lx + d.w / 2, on: 'face' }));
  for (const w of a.wallItems) {
    const id = absId(a.id, w.id);
    const half = FURNITURE[w.kind].footprint.w / 2;
    const row = w.on === 'face' ? 0 : a.rect.h - 1;
    const at = absR({ x: Math.floor(w.lcx - half), y: row, w: Math.ceil(half * 2), h: w.on === 'face' ? 2 : 1 });
    if (w.on === 'face' ? !a.walls.north : !a.walls.south) err('wall_item_no_wall', w.on === 'face' ? 'map.validate.wallItemNoWallNorth' : 'map.validate.wallItemNoWallSouth', { id, kind: w.kind }, at, id);
    else if (w.lcx - half < geo.spanX0 || w.lcx + half > geo.spanX1) err('wall_item_outside', 'map.validate.wallItemOutside', { id, kind: w.kind }, at, id);
  }
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const p = items[i];
      const q = items[j];
      if (p.on !== q.on) continue;
      const hp = FURNITURE[p.kind].footprint.w / 2;
      const hq = FURNITURE[q.kind].footprint.w / 2;
      if (p.lcx - hp < q.lcx + hq && q.lcx - hq < p.lcx + hp) {
        warn('wall_item_overlap', 'map.validate.wallItemOverlap', { a: p.id, aKind: p.kind, b: q.id, bKind: q.kind }, absR({ x: Math.floor(Math.min(p.lcx - hp, q.lcx - hq)), y: p.on === 'face' ? 0 : a.rect.h - 1, w: 1, h: 1 }), p.id);
      }
    }
  }
  for (const w of items) {
    if (w.on !== 'face' || !WALL_DECOR.has(w.kind)) continue;
    const cx = (a.rect.x + w.lcx) * TILE;
    const half = (FURNITURE[w.kind].footprint.w * TILE) / 2 - 2;
    for (const f of a.furniture) {
      if (!TALL_FLOOR.has(f.kind) || f.ly !== 2) continue;
      const fx0 = (a.rect.x + f.lx) * TILE + (f.dx ?? 0);
      const fx1 = fx0 + FURNITURE[f.kind].footprint.w * TILE;
      if (fx0 < cx + half && fx1 > cx - half) warn('wall_item_hidden', 'map.validate.wallItemHidden', { id: w.id, kind: w.kind, other: absId(a.id, f.id), otherKind: f.kind }, absR({ x: f.lx, y: f.ly, w: 1, h: 1 }), w.id);
    }
  }

  // pisos
  const cover = new Uint8Array(a.rect.w * a.rect.h);
  for (const f of a.floors) {
    for (let y = Math.max(0, f.ly); y < Math.min(a.rect.h, f.ly + f.h); y++) for (let x = Math.max(0, f.lx); x < Math.min(a.rect.w, f.lx + f.w); x++) cover[y * a.rect.w + x] = 1;
    const c = floorColor(f.kind, f.tint, f.tintK);
    const lum = luminance(c);
    if (lum < MIN_FLOOR_LUMINANCE) warn('floor_dark', 'map.validate.floorDark', { id: a.id, kind: f.kind, color: c, lum: lum.toFixed(2), min: MIN_FLOOR_LUMINANCE }, absR({ x: f.lx, y: f.ly, w: f.w, h: f.h }), a.id);
  }
  for (const r of a.rugs) {
    const lum = luminance(r.color);
    if (lum < MIN_FLOOR_LUMINANCE) warn('floor_dark', 'map.validate.rugDark', { id: a.id, rug: r.id, color: r.color, lum: lum.toFixed(2) }, absR({ x: Math.floor(r.lx), y: Math.floor(r.ly), w: Math.ceil(r.w), h: Math.ceil(r.h) }), absId(a.id, r.id));
  }
  const need: TileRect[] = [geo.interior, ...a.doorways.map((d) => doorwayRect(a, d))];
  let missing = 0;
  let first: { x: number; y: number } | null = null;
  for (const r of need) {
    for (let y = Math.max(0, r.y); y < Math.min(a.rect.h, r.y + r.h); y++) {
      for (let x = Math.max(0, r.x); x < Math.min(a.rect.w, r.x + r.w); x++) {
        if (cover[y * a.rect.w + x]) continue;
        missing++;
        first ??= { x, y };
      }
    }
  }
  if (missing && first) warn('floor_missing', 'map.validate.floorMissing', { id: a.id, n: missing }, absR({ x: first.x, y: first.y, w: 1, h: 1 }), a.id);

  // mesas: desk e desk_back de uma ilha devem ficar alinhadas (cadeiras são checadas na topologia)
  for (const f of a.furniture) {
    if (f.kind !== 'desk' && f.kind !== 'desk_back') continue;
    const fid = absId(a.id, f.id);
    const at = absR({ x: f.lx, y: f.ly, w: 2, h: 1 });
    if (f.kind === 'desk') {
      const back = a.furniture.find((g) => g.kind === 'desk_back' && g.ly === f.ly - 1 && Math.abs(g.lx - f.lx) === 1);
      if (back && !a.furniture.some((g) => g.kind === 'desk_back' && g.ly === f.ly - 1 && g.lx === f.lx)) {
        warn('desk_pair_mismatch', 'map.validate.deskPairMisaligned', { id: fid, other: absId(a.id, back.id) }, at, fid);
      }
    }
  }
}

function topology(doc: OfficeMapDoc, as: OfficeAssembly, err: ErrFn, warn: WarnFn): void {
  const { grid, w, h, reach } = as;
  const hasSpawn = as.spawn.length > 0 && grid.walkable(as.spawn[0].x, as.spawn[0].y);

  // passagens: tiles caminháveis e com saída do outro lado
  for (const a of doc.areas) {
    for (const d of a.doorways) {
      const r = doorwayRect(a, d);
      const ax = a.rect.x + r.x;
      const ay = a.rect.y + r.y;
      let blocked = false;
      for (let y = ay; y < ay + r.h; y++) for (let x = ax; x < ax + r.w; x++) if (!grid.walkable(x, y)) blocked = true;
      const outY = d.side === 'north' ? a.rect.y - 1 : a.rect.y + a.rect.h;
      const inY = d.side === 'north' ? a.rect.y + 2 : a.rect.y + a.rect.h - 2;
      let out = false;
      let inside = false;
      for (let x = ax; x < ax + r.w; x++) {
        if (grid.walkable(x, outY)) out = true;
        if (grid.walkable(x, inY)) inside = true;
      }
      if (blocked || !out || !inside) err('doorway_blocked', blocked ? 'map.validate.doorwayBlocked' : !out ? 'map.validate.doorwayNoExit' : 'map.validate.doorwayBlockedInside', { id: a.id, side: d.side, lx: d.lx }, { x: ax, y: ay, w: r.w, h: r.h }, a.id);
    }
  }

  // mesas x cadeiras (pelos spots derivados)
  const chairs = new Map<string, number>();
  for (const s of as.spots) if (s.kind === 'desk' && s.deskId) chairs.set(s.deskId, (chairs.get(s.deskId) ?? 0) + 1);
  for (const a of doc.areas) {
    for (const f of a.furniture) {
      if (f.kind !== 'desk' && f.kind !== 'desk_back') continue;
      const fid = absId(a.id, f.id);
      const at = { x: a.rect.x + f.lx, y: a.rect.y + f.ly, w: 2, h: 1 };
      const n = chairs.get(fid) ?? 0;
      if (!n) warn('desk_without_chair', f.kind === 'desk' ? 'map.validate.deskWithoutChairBelow' : 'map.validate.deskWithoutChairAbove', { id: fid }, at, fid);
      else if (n > 1) warn('desk_pair_mismatch', 'map.validate.deskManyChairs', { id: fid, n }, at, fid);
    }
  }

  // spawn
  as.spawn.forEach((p, i) => {
    const at = { x: p.x, y: p.y, w: 1, h: 1 };
    if (grid.get(p.x, p.y) !== FREE) err('spawn_blocked', 'map.validate.spawnBlocked', { i, x: p.x, y: p.y }, at);
    else if (i > 0 && hasSpawn && !reach[p.y * w + p.x]) err('spawn_unreachable', 'map.validate.spawnUnreachable', { i, x: p.x, y: p.y }, at);
  });

  // spots
  for (const s of as.spots) {
    const at = { x: s.tx, y: s.ty, w: 1, h: 1 };
    if (!grid.walkable(s.tx, s.ty)) err('spot_blocked', 'map.validate.spotBlocked', { id: s.id, kind: s.kind }, at, s.id);
    else if (hasSpawn && !reach[s.ty * w + s.tx]) err('spot_unreachable', 'map.validate.spotUnreachable', { id: s.id, kind: s.kind }, at, s.id);
  }

  // zonas
  for (const z of as.zones) {
    let walk = 0;
    for (let i = 0; i < z.tiles.length; i++) if (z.tiles[i] && grid.cells[i] !== 0) walk++;
    const at = z.rects[0];
    if (!z.count || !walk) {
      err('zone_empty', 'map.validate.zoneEmpty', { id: z.id }, at, z.id);
      continue;
    }
    if (z.private && !z.doorTiles.length) err('zone_no_door', 'map.validate.zoneNoDoor', { id: z.id }, at, z.id);
    const groups = doorGroups(z.doorTiles);
    if (groups > 1) warn('zone_many_doors', 'map.validate.zoneManyDoors', { id: z.id, n: groups }, at, z.id);
    if (z.capacity !== undefined) {
      let seats = 0;
      for (const s of as.spots) if (s.seated && z.tiles[s.ty * w + s.tx]) seats++;
      if (seats !== z.capacity) warn('zone_capacity', 'map.validate.zoneCapacity', { id: z.id, capacity: z.capacity, seats }, at, z.id);
    }
  }
  for (let i = 0; i < as.zones.length; i++) {
    for (let j = i + 1; j < as.zones.length; j++) {
      const a = as.zones[i].tiles;
      const b = as.zones[j].tiles;
      for (let k = 0; k < a.length; k++) {
        if (a[k] && b[k]) {
          const x = k % w;
          err('zone_overlap', 'map.validate.zoneOverlap', { a: as.zones[i].id, b: as.zones[j].id }, { x, y: (k - x) / w, w: 1, h: 1 }, `${as.zones[i].id},${as.zones[j].id}`);
          break;
        }
      }
    }
  }

  // componentes inalcançáveis
  if (hasSpawn) {
    const seen = new Uint8Array(w * h);
    const queue = new Int32Array(w * h);
    for (let start = 0; start < w * h; start++) {
      if (seen[start] || reach[start] || grid.cells[start] === 0) continue;
      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      seen[start] = 1;
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      let n = 0;
      while (head < tail) {
        const i = queue[head++];
        const x = i % w;
        const y = (i - x) / w;
        n++;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
        for (const [nx, ny] of [
          [x + 1, y],
          [x - 1, y],
          [x, y + 1],
          [x, y - 1],
        ]) {
          if (!grid.walkable(nx, ny)) continue;
          const j = ny * w + nx;
          if (seen[j]) continue;
          seen[j] = 1;
          queue[tail++] = j;
        }
      }
      warn('tile_unreachable', 'map.validate.tileUnreachable', { n }, { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
    }
  }
}

/** Quantidade de grupos 4-conexos de tiles de porta. */
function doorGroups(tiles: readonly { x: number; y: number }[]): number {
  const left = new Set(tiles.map((t) => `${t.x},${t.y}`));
  let groups = 0;
  for (const t of tiles) {
    const k0 = `${t.x},${t.y}`;
    if (!left.has(k0)) continue;
    groups++;
    const stack = [t];
    left.delete(k0);
    while (stack.length) {
      const c = stack.pop()!;
      for (const [nx, ny] of [
        [c.x + 1, c.y],
        [c.x - 1, c.y],
        [c.x, c.y + 1],
        [c.x, c.y - 1],
      ]) {
        const k = `${nx},${ny}`;
        if (!left.has(k)) continue;
        left.delete(k);
        stack.push({ x: nx, y: ny });
      }
    }
  }
  return groups;
}
