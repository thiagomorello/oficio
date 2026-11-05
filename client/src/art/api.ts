// CONTRATO do módulo de arte (pixel art procedural).
//
// - Implementação: client/src/art/index.ts (+ arquivos internos de art/).
// - Consumidores: client/src/world/** (render do escritório) e client/src/ui/** (avatares).
// - Regra: mudanças aqui devem ser ADITIVAS. Não renomeie/remova tipos, kinds ou funções.
//
// Convenções gerais
// - Mundo em "pixels de mundo"; 1 tile = TILE px. Tudo é pixel art em 1x, ampliado pela câmera
//   com imageSmoothingEnabled = false.
// - Perspectiva: top-down 3/4, como em tilesets de escritório moderno em pixel art. Ver DIREÇÃO DE ARTE abaixo. Vemos o topo e a FRENTE (face sul)
//   dos objetos. Paredes norte mostram a face (2 tiles de altura); paredes laterais e sul aparecem
//   só como "tampa" fina para não esconder o interior das salas.
// - Luz vem de cima/esquerda: topos mais claros, faces frontais mais escuras, sombra suave embaixo.
// - Sprites são HTMLCanvasElement em cache (gere uma vez, reutilize sempre).

// DIREÇÃO DE ARTE (pixel art top-down 3/4 de escritório moderno, claro e detalhado)
// - Escritório claro e limpo: porcelanato claro com rejunte sutil, madeira quente no lounge, paredes claras,
//   divisórias de vidro azulado, estantes com pastas coloridas, plantas em vasos, quadros, placa com o nome.
// - Ilhas de mesas com 1–2 monitores de tela azulada brilhante, teclado, mouse, caneca, papéis; cadeiras grafite.
// - Copa com bancada clara e frontão de mármore, pia inox, cafeteira, geladeira; bebedouro com galão azul.
// - Lounge com sofá azul/cinza-azulado e almofadas laranja, tapete, mesa de centro, bonsai, impressora grande.
// - Paleta clara (neutros frios + madeira quente + acentos saturados nos objetos); contorno 1px cinza-azulado
//   escuro (não preto); 3–4 tons por material; brilhos especulares; sombras de contato; muitos detalhes pequenos.


export * from '../../../shared/map/furniture';
import type { DeskItemKind } from '../../../shared/desk-decor';
import type {
  Appearance,
  Dir,
  Doorway,
  FloorKind,
  FurnitureKind,
  HeldItem,
  IconName,
  Pose,
  Rect,
  RoomTheme,
  ScreenMode,
  SpriteRectName,
  WallStyle,
} from '../../../shared/map/furniture';

export interface Sprite {
  canvas: HTMLCanvasElement;
  /** Ponto de ancoragem dentro do sprite (px). Ver convenções em FurnitureDef / characterSprite. */
  ax: number;
  ay: number;
  rects?: Partial<Record<SpriteRectName, Rect>>;
}

/** `front` é desenhado POR CIMA de quem está sentado/dentro (ex.: encosto da cadeira, porta da cabine). */
export interface FurnitureSprites {
  base: Sprite;
  front?: Sprite;
}

export interface CharacterFrameRequest {
  appearance: Appearance;
  dir: Dir;
  pose: Pose;
  frame: number;
  held?: HeldItem;
  /** Para poses que podem ser em pé ou sentado (raise_hand, read, talk). */
  seated?: boolean;
}

/** Assinatura que art/index.ts deve exportar (o mundo e a UI dependem disto). */
export interface ArtModule {
  appearanceFromSeed(seed: number, opts?: { look?: 'f' | 'm'; sub?: boolean }): Appearance;
  /** Ancoragem: (ax, ay) = centro dos pés (ponto no chão). Personagem ocupa ~14–18px de largura e ~24–28px de altura. */
  characterSprite(req: CharacterFrameRequest): Sprite;
  poseFrameCount(pose: Pose): number;
  /** Duração de cada frame da pose em ms. */
  poseFrameDuration(pose: Pose): number;
  /**
   * `opts.seed` (opcional, aditivo) varia os detalhes de itens repetidos (objetos sobre a mesa, livros da
   * estante, pastas...). Sem seed, usa a variação 0. Sprites continuam em cache por (kind, variant, state, seed % N).
   */
  furnitureSprites(kind: FurnitureKind, variant?: string, state?: number, opts?: { seed?: number; clean?: boolean }): FurnitureSprites;
  /**
   * (Aditivo, Adendo D) Item de decoração de mesa, âncora inferior esquerda (ax=0, ay=h-1), tamanho em
   * DESK_ITEMS[kind].size. `opts.clean` em furnitureSprites desenha a mesa com geometria fixa e sem itens soltos.
   */
  deskItemSprite?(kind: DeskItemKind, variant: string): Sprite;
  /** Desenha uma área de piso (px de mundo, múltiplos de TILE). `seed` varia detalhes por tile. */
  drawFloor(ctx: CanvasRenderingContext2D, kind: FloorKind, x: number, y: number, w: number, h: number, opts: { seed: number; tint?: string; tint2?: string; tintK?: number }): void;
  /** Tapete decorativo sobre o piso. */
  drawRug(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, seed: number): void;
  /** Face de parede norte: altura 2*TILE a partir de y, com "tampa" escura no topo e rodapé na base. */
  drawWallFace(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, style: WallStyle, opts?: { doorways?: Doorway[] }): void;
  /** Tampa de parede (laterais e trechos sem face), retângulo arbitrário. */
  drawWallTop(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, style: WallStyle): void;
  /** Parede sul: 1 tile de altura (tampa + mureta curta), com passagens opcionais. */
  drawSouthWall(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, style: WallStyle, opts?: { doorways?: Doorway[] }): void;
  /** Conteúdo animado de tela (monitor/TV). `r` em px de mundo. `t` em ms. */
  drawScreen(ctx: CanvasRenderingContext2D, r: Rect, mode: ScreenMode, t: number, seed: number): void;
  /** Post-its do quadro kanban (colunas: a fazer / fazendo / feito). */
  drawBoard(ctx: CanvasRenderingContext2D, r: Rect, items: readonly { status: 'pending' | 'in_progress' | 'completed' }[], t: number): void;
  /** Céu + horizonte visto pela janela conforme a hora local (0–24, fracionária). */
  drawWindowView(ctx: CanvasRenderingContext2D, r: Rect, hour: number, t: number, seed: number): void;
  drawClock(ctx: CanvasRenderingContext2D, r: Rect, date: Date): void;
  roomTheme(seed: number): RoomTheme;
  iconSprite(name: IconName): Sprite;
  /**
   * (Opcional, aditivo) Lance do futebol de drawScreen('show') com seed % 3 === 0, no instante `t`:
   * a partir de `progress >= goalAt` a tela pisca "GOL" (bola no gol da direita se `right`). O mundo
   * usa para a torcida comemorar junto com a TV.
   */
  footballLance?(t: number, seed: number): { lance: number; progress: number; right: boolean; period: number; goalAt: number };
  /** Avatar (cabeça + ombros) ampliado para a UI. */
  avatarCanvas(seed: number, opts?: { look?: 'f' | 'm'; sub?: boolean; scale?: number }): HTMLCanvasElement;
}
