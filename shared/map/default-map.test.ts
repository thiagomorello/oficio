// A.8: o mapa padrão é determinístico, passa no validateMap sem erros nem avisos e tem exatamente o
// que o plano promete (72 mesas, 12 lugares na mesa da copa, 4 reuniões com uma única porta...).
import { describe, expect, it } from 'vitest';
import { tFor } from '../i18n';
import { buildDefaultMap, signText } from './default-map';
import { FREE } from './grid';
import { ROOM_TINTS, SIGNS } from './palette';
import type { OfficeAssembly } from './types';
import { validateMap } from './validate';

/** Código=id de cada mesa, na ordem da montagem (capturado antes do redesenho de 15/10/2026). */
// prettier-ignore
const DESK_IDS = [
  "A1-01=ilha-a1#f65", "A1-02=ilha-a1#f69", "A1-03=ilha-a1#f73", "A1-04=ilha-a1#f66", "A1-05=ilha-a1#f70", "A1-06=ilha-a1#f74",
  "B1-01=ilha-b1#f78", "B1-02=ilha-b1#f82", "B1-03=ilha-b1#f86", "B1-04=ilha-b1#f79", "B1-05=ilha-b1#f83", "B1-06=ilha-b1#f87",
  "A2-01=ilha-a2#f91", "A2-02=ilha-a2#f95", "A2-03=ilha-a2#f99", "A2-04=ilha-a2#f92", "A2-05=ilha-a2#f96", "A2-06=ilha-a2#f100",
  "B2-01=ilha-b2#f104", "B2-02=ilha-b2#f108", "B2-03=ilha-b2#f112", "B2-04=ilha-b2#f105", "B2-05=ilha-b2#f109", "B2-06=ilha-b2#f113",
  "A3-01=ilha-a3#f117", "A3-02=ilha-a3#f121", "A3-03=ilha-a3#f125", "A3-04=ilha-a3#f118", "A3-05=ilha-a3#f122", "A3-06=ilha-a3#f126",
  "B3-01=ilha-b3#f130", "B3-02=ilha-b3#f134", "B3-03=ilha-b3#f138", "B3-04=ilha-b3#f131", "B3-05=ilha-b3#f135", "B3-06=ilha-b3#f139",
  "A4-01=ilha-a4#f143", "A4-02=ilha-a4#f147", "A4-03=ilha-a4#f151", "A4-04=ilha-a4#f144", "A4-05=ilha-a4#f148", "A4-06=ilha-a4#f152",
  "B4-01=ilha-b4#f156", "B4-02=ilha-b4#f160", "B4-03=ilha-b4#f164", "B4-04=ilha-b4#f157", "B4-05=ilha-b4#f161", "B4-06=ilha-b4#f165",
  "A5-01=ilha-a5#f169", "A5-02=ilha-a5#f173", "A5-03=ilha-a5#f177", "A5-04=ilha-a5#f170", "A5-05=ilha-a5#f174", "A5-06=ilha-a5#f178",
  "B5-01=ilha-b5#f182", "B5-02=ilha-b5#f186", "B5-03=ilha-b5#f190", "B5-04=ilha-b5#f183", "B5-05=ilha-b5#f187", "B5-06=ilha-b5#f191",
  "A6-01=ilha-a6#f195", "A6-02=ilha-a6#f199", "A6-03=ilha-a6#f203", "A6-04=ilha-a6#f196", "A6-05=ilha-a6#f200", "A6-06=ilha-a6#f204",
  "B6-01=ilha-b6#f208", "B6-02=ilha-b6#f212", "B6-03=ilha-b6#f216", "B6-04=ilha-b6#f209", "B6-05=ilha-b6#f213", "B6-06=ilha-b6#f217",
];

function assembly(): OfficeAssembly {
  const v = validateMap(buildDefaultMap());
  if (!v.assembly) throw new Error(v.errors.map((e) => `${e.code}: ${e.message}`).join('\n'));
  return v.assembly;
}

/** Grupos 4-conexos de tiles. */
function groups(tiles: readonly { x: number; y: number }[]): { x: number; y: number }[][] {
  const left = new Map(tiles.map((t) => [`${t.x},${t.y}`, t]));
  const out: { x: number; y: number }[][] = [];
  for (const t of tiles) {
    if (!left.delete(`${t.x},${t.y}`)) continue;
    const g = [t];
    for (let i = 0; i < g.length; i++) {
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const k = `${g[i].x + dx},${g[i].y + dy}`;
        const n = left.get(k);
        if (n && left.delete(k)) g.push(n);
      }
    }
    out.push(g);
  }
  return out;
}

describe('mapa padrão', () => {
  it('é determinístico (duas chamadas → mesmo JSON); o idioma só muda nomes e rótulos', () => {
    expect(JSON.stringify(buildDefaultMap())).toBe(JSON.stringify(buildDefaultMap()));
    const strip = (d: ReturnType<typeof buildDefaultMap>) => JSON.stringify(d, (k, v) => (k === 'name' || k === 'label' ? undefined : v));
    expect(strip(buildDefaultMap('en'))).toBe(strip(buildDefaultMap('pt-BR')));
  });

  it('80×58, validateMap sem erros nem avisos', () => {
    const doc = buildDefaultMap();
    expect(doc.size).toEqual({ w: 80, h: 58 });
    const v = validateMap(doc);
    expect(v.errors).toEqual([]);
    expect(v.warnings).toEqual([]);
    expect(v.assembly).not.toBeNull();
  });

  it('tem as áreas da tabela A.4 (ids fixos; placas da paleta no idioma pedido)', () => {
    const doc = buildDefaultMap('pt-BR');
    expect(doc.name).toBe('Escritório padrão');
    expect(doc.areas.find((a) => a.id === 'recepcao')?.name).toBe('Recepção');
    expect(buildDefaultMap('en').areas.find((a) => a.id === 'recepcao')?.name).toBe('Reception');
    expect(buildDefaultMap().name).toBe(tFor('en', 'map.default.name'));
    const ids = doc.areas.map((a) => a.id);
    for (const id of ['recepcao', 'sala-rosa', 'sala-azul', 'sala-amarela', 'hub', 'corredor-norte', 'praca', 'corredor-sul', 'banheiros', 'copa', 'lounge', 'sala-zen']) expect(ids).toContain(id);
    for (const r of ['a', 'b']) for (let i = 1; i <= 6; i++) expect(ids).toContain(`ilha-${r}${i}`);
    expect(ids.filter((id) => id.startsWith('open-vao-')).length).toBeGreaterThan(0);
    for (const [id, label] of Object.entries(SIGNS)) {
      const a = doc.areas.find((x) => x.id === id)!;
      const sign = a.wallItems.find((w) => w.id === a.signId);
      expect(sign?.kind, id).toBe('sign');
      expect(sign?.label, id).toBe(signText(label, 'pt-BR'));
    }
    expect(signText(SIGNS.recepcao)).toBe('{brand}');
    expect(signText(SIGNS['sala-rosa'], 'pt-BR')).toBe('Sala Rosa');
    expect(signText(SIGNS['sala-rosa'], 'en')).toBe('Pink Room');
    for (const [id, tint] of Object.entries(ROOM_TINTS)) expect(doc.areas.find((a) => a.id === id)?.floorTint).toBe(tint);
  });

  it('72 mesas com códigos únicos A1-01…B6-06', () => {
    const as = assembly();
    expect(as.desks).toHaveLength(72);
    const want: string[] = [];
    for (const r of ['A', 'B']) for (let i = 1; i <= 6; i++) for (let n = 1; n <= 6; n++) want.push(`${r}${i}-0${n}`);
    expect(as.desks.map((d) => d.code).sort()).toEqual(want.sort());
    expect(new Set(as.desks.map((d) => d.id)).size).toBe(72);
  });

  it('ids das mesas e cadeiras estáveis (gravados no banco nas reivindicações)', () => {
    const as = assembly();
    expect(as.desks.map((d) => `${d.code}=${d.id}`)).toEqual(DESK_IDS);
    // a cadeira de cada mesa é o móvel criado logo antes dela no stampIsland (N: f-1; S: f+1)
    for (const d of as.desks) {
      const n = Number(d.id.split('#f')[1]);
      expect(d.chairId, d.code).toBe(`${d.areaId}#f${d.side === 'N' ? n - 1 : n + 1}`);
    }
  });

  it('ambientes mobiliados: banheiro, lounge, zen, reuniões e open plan com parede/divisórias', () => {
    const doc = buildDefaultMap();
    const as = assembly();
    const area = (id: string) => doc.areas.find((a) => a.id === id)!;
    const count = (id: string, kind: string) => area(id).furniture.filter((f) => f.kind === kind).length + area(id).wallItems.filter((w) => w.kind === kind).length;
    const spots = (areaId: string, kind: string) => as.spots.filter((s) => s.areaId === areaId && s.kind === kind).length;
    expect(count('banheiros', 'toilet_stall')).toBe(4);
    expect(spots('banheiros', 'stall')).toBe(4);
    expect(count('banheiros', 'sink')).toBe(3);
    expect(count('banheiros', 'mirror')).toBe(3);
    expect(spots('lounge', 'pingpong')).toBe(2);
    expect(spots('lounge', 'watch')).toBe(2);
    expect(count('lounge', 'beanbag')).toBe(4);
    expect(count('lounge', 'arcade')).toBe(2);
    expect(count('sala-zen', 'armchair')).toBe(4);
    expect(count('sala-zen', 'bookshelf')).toBe(2);
    expect(count('hub', 'tv')).toBe(2);
    for (const id of ['sala-rosa', 'sala-azul', 'sala-amarela', 'hub']) {
      expect(count(id, 'window'), id).toBeGreaterThanOrEqual(2);
      expect(area(id).rugs.length, id).toBeGreaterThan(0);
    }
    const norte = area('open-vao-norte');
    expect(norte.walls.north).toBe(true);
    expect(norte.doorways.map((d) => d.w)).toEqual([2, 2, 2]);
    expect(as.spots.filter((s) => s.areaId === 'open-vao-norte' && s.kind === 'whiteboard').length).toBe(3);
    const glass = doc.areas.reduce((n, a) => n + a.furniture.filter((f) => f.kind === 'glass_partition').length, 0);
    expect(glass).toBeGreaterThan(50);
  });

  it('12 cafe_seat dentro da zona mesa-copa (lunch, privada, não trancável, 12 lugares)', () => {
    const as = assembly();
    const z = as.zoneById.get('mesa-copa')!;
    expect(z).toMatchObject({ kind: 'lunch', private: true, lockable: false, capacity: 12 });
    const seats = as.spots.filter((s) => s.kind === 'cafe_seat' && z.tiles[s.ty * as.w + s.tx]);
    expect(seats).toHaveLength(12);
    expect(seats.every((s) => s.areaId === 'copa')).toBe(true);
  });

  it('4 zonas de reunião privadas e trancáveis, cada uma com uma única porta de 2 tiles', () => {
    const as = assembly();
    const meetings = as.zones.filter((z) => z.kind === 'meeting');
    expect(meetings.map((z) => z.id).sort()).toEqual(['hub', 'sala-amarela', 'sala-azul', 'sala-rosa']);
    const seats: Record<string, number> = { 'sala-rosa': 4, 'sala-azul': 4, 'sala-amarela': 8, hub: 12 };
    for (const z of meetings) {
      expect(z.private && z.lockable, z.id).toBe(true);
      expect(z.capacity, z.id).toBe(seats[z.id]);
      expect(z.signId, z.id).toBe(`${z.id}/${as.doc.areas.find((a) => a.id === z.id)!.signId}`);
      const g = groups(z.doorTiles);
      expect(g, z.id).toHaveLength(1);
      expect(g[0], z.id).toHaveLength(2);
    }
  });

  it('todo spot e todo tile caminhável são alcançáveis a partir do spawn', () => {
    const as = assembly();
    for (const s of as.spots) expect(as.reach[s.ty * as.w + s.tx], s.id).toBe(1);
    for (let i = 0; i < as.w * as.h; i++) if (as.grid.cells[i] !== 0) expect(as.reach[i]).toBe(1);
  });

  it('pelo menos 4 tiles de spawn livres e distintos', () => {
    const as = assembly();
    const free = new Set(as.spawn.filter((p) => as.grid.get(p.x, p.y) === FREE).map((p) => `${p.x},${p.y}`));
    expect(free.size).toBeGreaterThanOrEqual(4);
  });

  it('spots talk em pares: 2 na recepção, praça, copa e lounge', () => {
    const as = assembly();
    const talk = as.spots.filter((s) => s.kind === 'talk');
    for (const area of ['recepcao', 'praca', 'copa', 'lounge']) expect(talk.filter((s) => s.areaId === area), area).toHaveLength(2);
  });
});
