// Contexto compartilhado entre view, ferramentas, painéis e atalhos.
import type { ArtModule } from '../art/api';
import type { OfficeMapDoc, TileRect } from '../../../shared/map/doc';
import type { Camera } from '../world/camera';
import type { DocStore } from './doc-store';
import type { EditOp } from './ops';
import type { EditorScene } from './scene';
import type { EditorState, Mode } from './state';
import type { Ref } from './types';

/** Ponteiro em coordenadas de tela (CSS px), de mundo (px) e de tile. */
export interface PointerInfo {
  sx: number;
  sy: number;
  wx: number;
  wy: number;
  tx: number;
  ty: number;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  button: number;
}

export type ToastKind = 'info' | 'success' | 'error' | 'warning';

export interface EditorCtx {
  readonly store: DocStore;
  readonly state: EditorState;
  readonly scene: EditorScene;
  readonly art: ArtModule;
  readonly camera: Camera;
  /** Documento desenhado: o rascunho, ou a versão em visualização. */
  doc(): OfficeMapDoc;
  /** Visualizando uma versão (nada é editável). */
  readOnly(): boolean;
  /** Aplica e empilha (com aviso em caso de erro). */
  exec(op: EditOp): boolean;
  select(refs: Ref[]): void;
  setMode(m: Mode): void;
  /** O que está sob o ponto (px de mundo). */
  hit(wx: number, wy: number): Ref | null;
  /** Ponteiro sobre o canvas (null fora dele). */
  hover: PointerInfo | null;
  toast(text: string, kind?: ToastKind): void;
  redraw(): void;
  /** Centraliza a câmera num retângulo de tiles. */
  centerOn(r: TileRect): void;
  /** Foca um campo do painel de propriedades (ex.: 'label' da placa recém-colocada). */
  focusProp(name: string): void;
}

export interface Tool {
  cursor?: string;
  down?(p: PointerInfo): void;
  /** Arrastando (passou do limiar) a partir de `start`. */
  drag?(p: PointerInfo, start: PointerInfo): void;
  /** Soltou; `dragged` = houve arrasto. */
  up?(p: PointerInfo, start: PointerInfo, dragged: boolean): void;
  hover?(p: PointerInfo | null): void;
  /** Tecla específica da ferramenta (R/C no ghost...). true = consumiu. */
  key?(e: KeyboardEvent): boolean;
  cancel?(): void;
  /** Desenho em coordenadas de mundo (ghost, retângulo de arrasto). */
  draw?(g: CanvasRenderingContext2D, scale: number): void;
}
