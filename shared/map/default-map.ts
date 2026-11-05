// Mapa padrão do escritório (A.4): 80×58 tiles, montado só com o doc-builder e os stamps
// (os mesmos do editor). Puro e determinístico: duas chamadas produzem o mesmo JSON.
//
//   y 0–11   recepção · Sala Rosa · Sala Azul · Sala Amarela · Hub        (salas com porta sul em lx 7)
//   y 12–16  corredor norte (passadeira amarela, nichos com bancos e plantas)
//   y 17–40  open plan (x 0–53): parede norte com janelas/quadros e 3 portas, 12 ilhas A1..B6,
//            divisórias de vidro para o corredor sul e para a praça · praça (x 54–79)
//   y 41–45  corredor sul
//   y 46–57  banheiros · copa · lounge · sala zen                        (portas na face norte)
//
// Ids das mesas: as reivindicações gravam `ilha-xx#f<seq>`, então as 12 ilhas sempre consomem a
// MESMA faixa de `seq` (ISLAND_SEQ), na mesma ordem (tapete + stampIsland). Todo o resto usa ids
// a partir do fim dessa faixa e pode crescer/mudar à vontade sem mexer nas mesas.
import { BRAND_SIGN_LABEL } from '../branding';
import { DEFAULT_LOCALE, tFor, type Locale, type MessageKey, type Params } from '../i18n';
import type { OfficeMapDoc, TileRect } from './doc';
import { createDocBuilder, type AreaHandle, type DocBuilder } from './doc-builder';
import type { FurnitureKind } from './furniture';
import { FLOORS, FURNITURE_VARIANTS, ROOM_TINTS, RUGS, SIGNS, WALLS } from './palette';
import { stampIsland, stampLunchTable, stampMeetingRoom, stampPhoneBooth } from './stamps';

export const DEFAULT_MAP_SIZE = { w: 80, h: 58 } as const;

/** Colunas (x absoluto) das ilhas e linhas (y absoluto) das fileiras A e B. */
export const ISLAND_XS = [0, 9, 18, 27, 36, 45] as const;
export const ISLAND_YS = { A: 21, B: 28 } as const;

/** Faixa de `seq` das ilhas (tapete + 12 móveis por ilha): NÃO mudar (ids gravados no banco). */
export const ISLAND_SEQ = { start: 63, end: 219 } as const;

/** Portas da parede norte do open plan e vãos da divisória sul (x absoluto, 2 tiles). */
const OPEN_DOORS = [9, 27, 45] as const;

const plants = FURNITURE_VARIANTS.plantsTall;
const smallPlants = ['fern', 'succulent', 'flower'] as const;

/**
 * Texto de uma placa de `SIGNS` no idioma pedido: `{brand}` fica literal (o render desenha a marca);
 * as demais são chaves `map.default.*`.
 */
export function signText(sign: (typeof SIGNS)[keyof typeof SIGNS], locale: Locale = DEFAULT_LOCALE): string {
  return sign === BRAND_SIGN_LABEL ? sign : tFor(locale, sign);
}

/** Rótulos do mapa padrão no idioma da instância (gravados como dados quando o mapa é publicado). */
interface Labels {
  t(key: MessageKey, params?: Params): string;
  sign(sign: (typeof SIGNS)[keyof typeof SIGNS]): string;
}

function labelsFor(locale: Locale): Labels {
  return { t: (key, params) => tFor(locale, key, params), sign: (s) => signText(s, locale) };
}

/** Spot `talk` em par (dois tiles vizinhos, um virado para o outro). */
function talkPair(b: DocBuilder, id: string, x: number, y: number): void {
  b.spot({ id: `${id}-0`, kind: 'talk', tx: x, ty: y, dir: 'right', group: id });
  b.spot({ id: `${id}-1`, kind: 'talk', tx: x + 1, ty: y, dir: 'left', group: id });
}

function rect(x: number, y: number, w: number, h: number): TileRect {
  return { x, y, w, h };
}

/** Linha de divisória de vidro 'h' de lx0 a lx1 (inclusive); `ends` vira 'end' nas pontas. */
function glassRunH(a: AreaHandle, lx0: number, lx1: number, ly: number, ends: { left?: boolean; right?: boolean } = {}): void {
  for (let x = lx0; x <= lx1; x++) a.furn('glass_partition', x, ly, { variant: (x === lx0 && ends.left) || (x === lx1 && ends.right) ? 'end' : 'h' });
}

/** Coluna de divisória de vidro 'v' de ly0 a ly1 (inclusive); `ends` vira 'end' nas pontas. */
function glassRunV(a: AreaHandle, lx: number, ly0: number, ly1: number, ends: { top?: boolean; bottom?: boolean } = {}): void {
  for (let y = ly0; y <= ly1; y++) a.furn('glass_partition', lx, y, { variant: (y === ly0 && ends.top) || (y === ly1 && ends.bottom) ? 'end' : 'v' });
}

/** Canto de impressão: impressora, arquivo e estante de pastas lado a lado. */
function printCorner(a: AreaHandle, lx: number, ly: number, mirror = false): void {
  const kinds: FurnitureKind[] = ['printer', 'filing_cabinet', 'binder_shelf'];
  (mirror ? [...kinds].reverse() : kinds).forEach((k, i) => a.furn(k, lx + i, ly));
}

type Placement = [kind: FurnitureKind, lx: number, ly: number, variant?: string];
type WallPlacement = [kind: FurnitureKind, lcx: number, variant?: string];

function place(a: AreaHandle, list: readonly Placement[]): void {
  for (const [k, lx, ly, variant] of list) a.furn(k, lx, ly, variant ? { variant } : {});
}

function hang(a: AreaHandle, list: readonly WallPlacement[]): void {
  for (const [k, lcx, variant] of list) a.wall(k, lcx, variant ? { variant } : {});
}

// ------------------------------------------------------------------ linha norte

function recepcao(b: DocBuilder, L: Labels): void {
  const a = b.area('recepcao', rect(0, 0, 16, 12), {
    name: L.t('map.default.recepcao'),
    kind: 'reception',
    walls: { north: true, south: false, west: true, east: true, style: WALLS.reception },
    floor: FLOORS.reception,
  });
  a.area.signId = a.wall('sign', 8, { label: L.sign(SIGNS.recepcao) });
  hang(a, [
    ['window', 2.5],
    ['clock', 4.5],
    ['light_switch', 5.75, 'on'],
    ['painting', 11],
    ['poster', 13, 'ship_it'],
    ['poster', 14.5, 'rocket'],
  ]);
  // balcão com a banqueta atrás, tapete amarelo de boas-vindas
  a.rug(4.5, 3.5, 7, 4, RUGS.reception);
  a.furn('reception_desk', 6, 5);
  a.furn('stool', 7, 4);
  place(a, [
    ['plant_small', 5, 5, 'flower'],
    ['trash_bin', 9, 5],
    // espera: dois bancos com mesinha de centro, luminárias e plantas
    ['bench', 2, 8],
    ['coffee_table', 2, 9],
    ['bench', 12, 8],
    ['coffee_table', 12, 9],
    ['floor_lamp', 1, 7],
    ['floor_lamp', 14, 7],
    ['plant_tall', 1, 3, plants[0]],
    ['water_cooler', 14, 4],
    ['plant_tall', 14, 6, plants[2]],
    ['plant_small', 1, 10, 'flower'],
    ['plant_small', 14, 10, 'flower'],
    ['plant_small', 4, 8, 'fern'],
    ['plant_small', 11, 8, 'fern'],
  ]);
  for (let x = 3; x <= 6; x++) b.spawn(x, 3);
  talkPair(b, 'talk-recepcao', 6, 9);
}

/** Decoração extra de uma sala de reunião (coordenadas locais; interior lx 1–14, ly 2–10). */
function decorate(a: AreaHandle, tint: string, rug: [number, number, number, number], wall: readonly WallPlacement[], floor: readonly Placement[]): void {
  hang(a, wall);
  a.rug(...rug, tint);
  place(a, floor);
}

function salasNorte(b: DocBuilder, L: Labels): void {
  // Sala Rosa (4): TV, duas janelas, arquivos, plantas nos cantos
  const drop = stampMeetingRoom(b, 'sala-rosa', L.sign(SIGNS['sala-rosa']), undefined, rect(16, 0, 16, 12), { seats: 4, wall: WALLS.meeting, tint: ROOM_TINTS['sala-rosa'], tv: true });
  decorate(
    drop,
    ROOM_TINTS['sala-rosa'],
    [4.5, 3.5, 7, 5],
    [
      ['window', 2],
      ['clock', 4],
      ['light_switch', 5.75, 'on'],
      ['poster', 10.25, 'ship_it'],
      ['window', 14.25],
    ],
    [
      ['plant_small', 1, 2, 'fern'],
      ['filing_cabinet', 13, 2],
      ['filing_cabinet', 14, 2],
      ['plant_tall', 1, 10, plants[0]],
      ['plant_tall', 14, 10, plants[1]],
      ['floor_lamp', 1, 5],
      ['trash_bin', 14, 5],
    ],
  );
  // Sala Azul (4): quadro branco, duas janelas, estante
  const we = stampMeetingRoom(b, 'sala-azul', L.sign(SIGNS['sala-azul']), undefined, rect(32, 0, 16, 12), { seats: 4, wall: WALLS.meeting, tint: ROOM_TINTS['sala-azul'], whiteboard: true });
  decorate(
    we,
    ROOM_TINTS['sala-azul'],
    [4.5, 3.5, 7, 5],
    [
      ['light_switch', 1, 'on'],
      ['poster', 5.75, 'code'],
      ['clock', 10.25],
      ['window', 12],
      ['window', 14.25],
    ],
    [
      ['plant_small', 1, 2, 'succulent'],
      ['filing_cabinet', 14, 2],
      ['bookshelf', 12, 9],
      ['plant_tall', 1, 10, plants[2]],
      ['plant_tall', 14, 10, plants[3]],
      ['floor_lamp', 14, 5],
    ],
  );
  // Sala Amarela (8): quadro branco, duas janelas, estante e arquivo
  const amarela = stampMeetingRoom(b, 'sala-amarela', L.sign(SIGNS['sala-amarela']), undefined, rect(48, 0, 16, 12), { seats: 8, wall: WALLS.amarela, tint: ROOM_TINTS['sala-amarela'], whiteboard: true });
  decorate(
    amarela,
    ROOM_TINTS['sala-amarela'],
    [3.5, 3.5, 9, 5],
    [
      ['light_switch', 1, 'on'],
      ['clock', 5.75],
      ['poster', 10.25, 'rocket'],
      ['window', 12],
      ['window', 14.25],
    ],
    [
      ['plant_small', 1, 2, 'flower'],
      ['filing_cabinet', 14, 2],
      ['bookshelf', 12, 9],
      ['plant_tall', 1, 10, plants[1]],
      ['plant_tall', 14, 10, plants[0]],
      ['floor_lamp', 1, 5],
    ],
  );
  // Hub (12): duas TVs, duas janelas
  const hub = stampMeetingRoom(b, 'hub', L.sign(SIGNS.hub), undefined, rect(64, 0, 16, 12), { seats: 12, wall: WALLS.meeting, tint: ROOM_TINTS.hub, tv: true });
  decorate(
    hub,
    ROOM_TINTS.hub,
    [1.5, 3.5, 13, 5],
    [
      ['window', 1.75],
      ['tv', 4],
      ['light_switch', 5.75, 'on'],
      ['clock', 10.25],
      ['window', 14.25],
    ],
    [
      ['plant_small', 1, 2, 'fern'],
      ['filing_cabinet', 13, 2],
      ['filing_cabinet', 14, 2],
      ['bookshelf', 12, 9],
      ['plant_tall', 1, 10, plants[3]],
      ['plant_tall', 14, 10, plants[2]],
    ],
  );
}

function corredorNorte(b: DocBuilder, L: Labels): void {
  const a = b.area('corredor-norte', rect(0, 12, 80, 5), { name: L.t('map.default.corredorNorte'), kind: 'corridor', walls: false, floor: FLOORS.corridor });
  a.rug(0, 1.75, 80, 1.5, RUGS.open);
  // nichos junto às paredes sul das salas (x 16r … 16r+15; portas em 16r+7..8)
  [16, 32, 48, 64].forEach((x, i) => {
    a.furn('plant_tall', x, 0, { variant: plants[i % plants.length] });
    a.furn('bench', x + 2, 0);
    a.furn('plant_small', x + 4, 0, { variant: smallPlants[i % 3] });
    a.furn('trash_bin', x + 10, 0);
    if (i % 2 === 0) a.furn('water_cooler', x + 12, 0);
    else a.furn('bench', x + 11, 0);
    a.furn('plant_tall', x + 14, 0, { variant: plants[(i + 1) % plants.length] });
  });
  // lado sul (costas da parede do open plan), longe das portas em x 9, 27, 45
  [2, 20, 38].forEach((x, i) => {
    a.furn('plant_tall', x, 4, { variant: plants[(i + 2) % plants.length] });
    a.furn('trash_bin', x + 4, 4);
  });
}

// ------------------------------------------------------------------ open plan + praça

function openPlan(b: DocBuilder, L: Labels): void {
  const norte = b.area('open-vao-norte', rect(0, 17, 54, 4), {
    name: L.t('map.default.openPlan'),
    kind: 'open',
    walls: { north: true, south: false, west: false, east: false, style: WALLS.office },
    floor: FLOORS.openCarpet,
    doorways: OPEN_DOORS.map((x) => ({ side: 'north' as const, lx: x, w: 2 })),
  });
  const sul = b.area('open-vao-sul', rect(0, 35, 54, 6), { name: L.t('map.default.openPlan'), kind: 'open', walls: false, floor: FLOORS.openCarpet });

  // ilhas: faixa fixa de seq (ids das mesas gravados no banco)
  const rest = b.doc.seq;
  b.doc.seq = ISLAND_SEQ.start;
  const islands: { a: AreaHandle; i: number; row: 'A' | 'B' }[] = [];
  ISLAND_XS.forEach((x, i) => {
    for (const row of ['A', 'B'] as const) {
      const code = `${row}${i + 1}`;
      const a = b.area(`ilha-${code.toLowerCase()}`, rect(x, ISLAND_YS[row], 9, 7), { name: L.t('map.default.ilha', { code }), code, kind: 'open', walls: false, floor: FLOORS.openCarpet });
      a.rug(1.5, 1.5, 7, 5, RUGS.open);
      stampIsland(a, 2, 2, { pairs: 3 });
      islands.push({ a, i, row });
    }
  });
  if (b.doc.seq !== ISLAND_SEQ.end) throw new Error(`default-map: ilhas consumiram seq ${ISLAND_SEQ.start}..${b.doc.seq}, esperado ..${ISLAND_SEQ.end}`);
  b.doc.seq = rest;

  for (const { a, i, row } of islands) {
    // ponta leste (lx 8): planta, painel de vidro colado às mesas (plantas altas junto à praça), lixeira
    a.furn('plant_small', 8, 2, { variant: smallPlants[(i + (row === 'B' ? 1 : 0)) % 3] });
    if (i === ISLAND_XS.length - 1) {
      a.furn('plant_tall', 8, 3, { variant: plants[row === 'A' ? 0 : 2] });
      a.furn('plant_tall', 8, 4, { variant: plants[row === 'A' ? 1 : 3] });
    } else glassRunV(a, 8, 3, 4);
    a.furn('trash_bin', 8, 5);
    // ponta oeste da fileira (A1/B1): ilha do café
    if (i === 0) {
      place(a, [
        ['plant_small', 0, 2, 'flower'],
        ['water_cooler', 0, 3],
        ['coffee_machine', 1, 3],
        ['cafe_table', 0, 5],
      ]);
    }
  }

  // parede norte: por coluna de ilhas, janela + quadro branco (pares, com canto de impressão) ou
  // pôster + janela + relógio + quadro (ímpares, com a porta)
  ISLAND_XS.forEach((x, i) => {
    if (i % 2 === 0) {
      place(norte, [
        ['binder_shelf', x, 2],
        ['filing_cabinet', x + 1, 2],
        ['printer', x + 2, 2],
      ]);
      hang(norte, [
        ['poster', x + 2.5, FURNITURE_VARIANTS.posters[(i / 2) % 3]],
        ['window', x + 4],
        ['whiteboard', x + 7],
      ]);
    } else {
      hang(norte, [
        ['poster', x + 2.5, i === 3 ? 'coffee' : 'cat'],
        ['window', x + 4.5],
        ['clock', x + 6.5],
        ['painting', x + 8],
      ]);
      place(norte, [
        ['plant_small', x + 3, 2, smallPlants[i % 3]],
        ['trash_bin', x + 7, 2],
      ]);
    }
  });

  // divisória de vidro para o corredor sul (vãos de 2 tiles alinhados às portas norte)
  glassRunH(sul, 0, 8, 5, { right: true });
  glassRunH(sul, 11, 26, 5, { left: true, right: true });
  glassRunH(sul, 29, 44, 5, { left: true, right: true });
  glassRunH(sul, 47, 53, 5, { left: true });
  // vão sul: cantos de impressão encostados na divisória, luminárias, plantas e lixeiras
  printCorner(sul, 3, 4);
  printCorner(sul, 21, 4, true);
  printCorner(sul, 39, 4);
  [1, 17, 35, 51].forEach((x, k) => sul.furn('plant_tall', x, 4, { variant: plants[k % plants.length] }));
  [13, 31, 49].forEach((x) => sul.furn('floor_lamp', x, 4));
  [7, 25, 43].forEach((x) => sul.furn('trash_bin', x, 4));
}

function praca(b: DocBuilder, L: Labels): void {
  // parede norte contínua com a do open plan, duas entradas largas do corredor
  const a = b.area('praca', rect(54, 17, 26, 24), {
    name: L.t('map.default.praca'),
    kind: 'open',
    walls: { north: true, south: false, west: false, east: false, style: WALLS.office },
    floor: FLOORS.praca,
    doorways: [
      { side: 'north', lx: 1, w: 3 },
      { side: 'north', lx: 12, w: 4 },
    ],
  });
  hang(a, [
    ['poster', 4.5, 'coffee'],
    ['clock', 5.5],
    ['painting', 10],
    ['poster', 16.5, 'rocket'],
    ['poster', 17.5, 'ship_it'],
    ['window', 19],
    ['window', 21.5],
    ['poster', 23.5, 'cat'],
    ['painting', 25],
  ]);
  // divisória de vidro com o open plan (x 54), vãos em y 19–20, 27–28 e 35–36
  glassRunV(a, 0, 4, 9, { top: true, bottom: true });
  glassRunV(a, 0, 12, 17, { top: true, bottom: true });
  glassRunV(a, 0, 20, 23, { top: true });
  // canteiro central com bancos em volta e luminárias
  a.rug(3.5, 5.5, 13, 7, RUGS.open);
  place(a, [
    ['plant_tall', 8, 8, plants[2]],
    ['plant_tall', 11, 8, plants[0]],
    ['plant_small', 9, 8, 'flower'],
    ['plant_small', 10, 8, 'flower'],
    ['bench', 9, 6],
    ['bench', 9, 10],
    ['bench', 5, 8],
    ['bench', 13, 8],
    ['floor_lamp', 8, 6],
    ['floor_lamp', 11, 10],
    ['plant_small', 11, 6, 'fern'],
    ['plant_small', 8, 10, 'fern'],
  ]);
  talkPair(b, 'talk-praca', 54 + 9, 17 + 14);
  // café: bebedouro e snacks encostados na parede (trecho sem quadros), mesinhas com cadeiras
  place(a, [
    ['water_cooler', 6, 2],
    ['vending_machine', 7, 2],
    ['vending_machine', 8, 2],
    ['trash_bin', 9, 2],
    ['plant_small', 10, 2, 'flower'],
    ['plant_small', 24, 2, 'fern'],
  ]);
  for (const [x, y] of [
    [4, 14],
    [4, 17],
    [15, 14],
    [15, 17],
  ] as const) {
    a.furn('cafe_table', x, y);
    a.furn('cafe_chair', x - 1, y, { variant: 'right' });
    a.furn('cafe_chair', x + 1, y, { variant: 'left' });
  }
  a.furn('plant_tall', 1, 22, { variant: plants[1] });
  a.furn('trash_bin', 8, 17);
  // cantinho de leitura (sudeste): estantes, poltronas e mesinha sobre tapete
  a.rug(18.5, 18.5, 7, 5, RUGS.zen);
  place(a, [
    ['bookshelf', 19, 19],
    ['bookshelf', 21, 19],
    ['floor_lamp', 23, 19],
    ['armchair', 19, 21, 'right'],
    ['coffee_table', 20, 21],
    ['armchair', 22, 21, 'left'],
    ['plant_small', 24, 21, 'succulent'],
  ]);
  // cabines telefônicas
  stampPhoneBooth(b, a, 20, 2, { zone: { id: 'cabine-1', name: L.t('map.default.cabine', { n: 1 }) } });
  stampPhoneBooth(b, a, 20, 8, { zone: { id: 'cabine-2', name: L.t('map.default.cabine', { n: 2 }) }, plant: 'succulent' });
  place(a, [
    ['plant_tall', 25, 5, plants[3]],
    ['plant_tall', 25, 23, plants[1]],
    ['plant_tall', 24, 12, plants[0]],
    ['floor_lamp', 25, 12],
  ]);
}

// ------------------------------------------------------------------ linha sul

function corredorSul(b: DocBuilder, L: Labels): void {
  const a = b.area('corredor-sul', rect(0, 41, 80, 5), { name: L.t('map.default.corredorSul'), kind: 'corridor', walls: false, floor: FLOORS.corridor });
  a.rug(0, 1.75, 80, 1.5, RUGS.open);
  // nichos junto às paredes norte das salas de baixo (portas em x 7–8, 31–32, 55–56, 71–72)
  place(a, [
    ['plant_tall', 1, 4, plants[0]],
    ['bench', 3, 4],
    ['trash_bin', 12, 4],
    ['plant_tall', 14, 4, plants[1]],
    ['plant_tall', 18, 4, plants[2]],
    ['bench', 21, 4],
    ['plant_small', 23, 4, 'fern'],
    ['trash_bin', 28, 4],
    ['water_cooler', 36, 0],
    ['bench', 39, 4],
    ['plant_tall', 42, 4, plants[3]],
    ['trash_bin', 51, 4],
    ['plant_tall', 62, 4, plants[1]],
    ['bench', 65, 4],
    ['trash_bin', 76, 4],
    ['plant_tall', 78, 4, plants[2]],
  ]);
}

function banheiros(b: DocBuilder, L: Labels): void {
  const a = b.area('banheiros', rect(0, 46, 16, 12), {
    name: L.t('map.default.banheiros'),
    kind: 'restroom',
    walls: { north: true, south: true, west: true, east: true, style: WALLS.restroom },
    floor: FLOORS.restroom,
    doorways: [{ side: 'north', lx: 7, w: 2 }],
  });
  hang(a, [
    ['painting', 3],
    ['light_switch', 6, 'on'],
    ['clock', 14],
  ]);
  // 4 cabines ao sul (porta para cima; spot na linha 10) com painel de vidro no fim
  for (let i = 0; i < 4; i++) a.furn('toilet_stall', 1 + 2 * i, 8);
  glassRunV(a, 9, 8, 9, { top: true });
  // 3 pias com espelho na parede norte, tapetinho na frente
  for (let i = 0; i < 3; i++) {
    a.furn('sink', 10 + i, 2);
    a.wall('mirror', 10.5 + i);
  }
  a.rug(9.75, 3.25, 3.5, 0.75, ROOM_TINTS['sala-azul']);
  place(a, [
    ['trash_bin', 13, 2],
    ['plant_small', 14, 2, 'succulent'],
    ['plant_tall', 1, 2, plants[1]],
    ['plant_small', 2, 2, 'fern'],
    ['trash_bin', 14, 6],
    ['plant_tall', 14, 10, plants[3]],
  ]);
}

function copa(b: DocBuilder, L: Labels): void {
  const a = b.area('copa', rect(16, 46, 32, 12), {
    name: L.sign(SIGNS.copa),
    kind: 'cafe',
    walls: { north: true, south: true, west: true, east: true, style: WALLS.kitchen },
    floor: FLOORS.kitchen,
    doorways: [{ side: 'north', lx: 15, w: 2 }],
  });
  a.area.signId = a.wall('sign', 24, { label: L.sign(SIGNS.copa) });
  hang(a, [
    ['shelf_wall', 3],
    ['shelf_wall', 7],
    ['poster', 9.5, 'coffee'],
    ['clock', 18],
    ['window', 20.5],
    ['window', 28],
    ['poster', 30.25, 'cat'],
  ]);
  // bancada contínua na parede norte; geladeiras e snacks no trecho sem nada pendurado
  place(a, [
    ['counter', 1, 2, 'drawers'],
    ['coffee_machine', 2, 2],
    ['coffee_machine', 3, 2],
    ['counter', 4, 2, 'plain'],
    ['counter_sink', 5, 2],
    ['counter', 6, 2, 'drawers'],
    ['microwave', 7, 2],
    ['microwave', 8, 2],
    ['counter', 9, 2, 'plain'],
    ['counter', 10, 2, 'drawers'],
    ['fridge', 11, 2],
    ['fridge', 12, 2],
    ['vending_machine', 13, 2],
    ['trash_bin', 14, 2],
  ]);
  // mesa de almoço (12 lugares) sobre o tapete
  a.rug(8.5, 4.5, 13, 5, RUGS.copa);
  stampLunchTable(b, a, 10, 5, { zone: { id: 'mesa-copa', name: L.t('map.default.mesaCopa') } });
  // bistrô: duas mesinhas com cadeiras
  a.rug(22.5, 5.5, 5, 5, RUGS.lounge);
  for (const y of [6, 9]) {
    a.furn('cafe_table', 25, y);
    a.furn('cafe_chair', 24, y, { variant: 'right' });
    a.furn('cafe_chair', 26, y, { variant: 'left' });
  }
  place(a, [
    ['plant_small', 23, 2, 'flower'],
    ['trash_bin', 24, 2],
    ['water_cooler', 26, 2],
    ['counter', 29, 6, 'drawers'],
    ['coffee_machine', 30, 6],
    ['trash_bin', 30, 8],
    ['plant_tall', 30, 10, plants[0]],
    ['plant_tall', 1, 10, plants[2]],
    ['plant_small', 2, 10, 'succulent'],
    ['trash_bin', 1, 5],
  ]);
  talkPair(b, 'talk-copa', 16 + 3, 46 + 4);
}

function lounge(b: DocBuilder, L: Labels): void {
  const a = b.area('lounge', rect(48, 46, 16, 12), {
    name: L.sign(SIGNS.lounge),
    kind: 'lounge',
    walls: { north: true, south: true, west: true, east: true, style: WALLS.lounge },
    floor: FLOORS.lounge,
    doorways: [{ side: 'north', lx: 7, w: 2 }],
  });
  a.area.signId = a.wall('sign', 11, { label: L.sign(SIGNS.lounge) });
  hang(a, [
    ['tv', 4],
    ['clock', 13],
    ['poster', 14, 'ship_it'],
    ['poster', 15, 'bug'],
  ]);
  // canto da TV: sofá + 2 poltronas + mesinha sobre o tapete grande; estante e fliperamas na parede
  a.rug(1.5, 3.5, 6, 6, RUGS.lounge);
  place(a, [
    ['bookshelf', 1, 2],
    ['arcade', 5, 2],
    ['arcade', 6, 2],
    ['armchair', 2, 5, 'right'],
    ['coffee_table', 3, 5],
    ['armchair', 5, 5, 'left'],
    ['sofa', 3, 6, 'up'],
    ['floor_lamp', 6, 6],
  ]);
  a.furn('plant_small', 1, 8, { variant: 'fern' });
  // puffs da torcida, ao sul da mesa de ping-pong e virados para ela
  const puffs: [number, number][] = [
    [8, 9],
    [9, 9],
    [11, 9],
    [12, 9],
  ];
  FURNITURE_VARIANTS.beanbags.forEach((v, i) => a.furn('beanbag', puffs[i][0], puffs[i][1], { variant: v, dir: 'up' }));
  // ping-pong (spots pingpong em lx 8/12 ly 7, watch em lx 9/11 ly 5)
  place(a, [
    ['pingpong_table', 9, 6],
    ['vending_machine', 14, 8],
    ['trash_bin', 14, 6],
    ['plant_tall', 1, 10, plants[1]],
    ['plant_tall', 14, 10, plants[2]],
    ['plant_small', 13, 2, 'flower'],
  ]);
  talkPair(b, 'talk-lounge', 48 + 10, 46 + 3);
  b.zone({ id: 'lounge', name: L.sign(SIGNS.lounge), kind: 'lounge', rects: [rect(49, 48, 14, 9)], private: true, lockable: false, signId: `lounge/${a.area.signId}` });
}

function salaZen(b: DocBuilder, L: Labels): void {
  const a = b.area('sala-zen', rect(64, 46, 16, 12), {
    name: L.sign(SIGNS['sala-zen']),
    kind: 'zen',
    walls: { north: true, south: true, west: true, east: true, style: WALLS.zen },
    floor: FLOORS.zenCarpet,
    doorways: [{ side: 'north', lx: 7, w: 2 }],
  });
  a.area.signId = a.wall('sign', 12, { label: L.sign(SIGNS['sala-zen']) });
  hang(a, [
    ['painting', 2],
    ['window', 4.5],
    ['light_switch', 6.25, 'off'],
    ['painting', 14.5],
  ]);
  // dois recantos: poltronas frente a frente com mesinha, cada um no seu tapete
  a.rug(1.5, 4.5, 6, 4, RUGS.zen);
  a.rug(8.5, 6.5, 6, 3, RUGS.zen);
  place(a, [
    ['armchair', 2, 6, 'right'],
    ['coffee_table', 3, 6],
    ['armchair', 5, 6, 'left'],
    ['armchair', 9, 7, 'right'],
    ['coffee_table', 10, 7],
    ['armchair', 12, 7, 'left'],
    ['bookshelf', 2, 9],
    ['bookshelf', 11, 4],
    ['floor_lamp', 1, 5],
    ['floor_lamp', 13, 7],
    // muitas plantas
    ['plant_tall', 9, 2, plants[3]],
    ['plant_small', 1, 2, 'fern'],
    ['plant_small', 13, 2, 'succulent'],
    ['plant_small', 14, 2, 'flower'],
    ['plant_tall', 1, 10, plants[0]],
    ['plant_tall', 14, 10, plants[2]],
    ['plant_tall', 14, 4, plants[1]],
    ['plant_small', 6, 9, 'fern'],
    ['plant_small', 9, 10, 'succulent'],
  ]);
  b.zone({ id: 'zen', name: L.sign(SIGNS['sala-zen']), kind: 'quiet', rects: [rect(65, 48, 14, 9)], private: true, lockable: false, signId: `sala-zen/${a.area.signId}` });
}

/**
 * Constrói o mapa padrão (novo objeto a cada chamada). `locale` = idioma dos nomes e placas: eles são
 * DADOS (ficam gravados no banco quando o mapa é publicado), então nascem num idioma concreto — o
 * padrão da instância. Os ids (sala-rosa, hub, copa...) não dependem do idioma.
 */
export function buildDefaultMap(locale: Locale = DEFAULT_LOCALE): OfficeMapDoc {
  const L = labelsFor(locale);
  const b = createDocBuilder(DEFAULT_MAP_SIZE, L.t('map.default.name'));
  // tudo que não é ilha usa ids depois da faixa reservada às ilhas
  b.doc.seq = ISLAND_SEQ.end;
  recepcao(b, L);
  salasNorte(b, L);
  corredorNorte(b, L);
  openPlan(b, L);
  praca(b, L);
  corredorSul(b, L);
  banheiros(b, L);
  copa(b, L);
  lounge(b, L);
  salaZen(b, L);
  return b.build();
}
