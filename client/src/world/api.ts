// CONTRATO do mundo (canvas do escritório) consumido pela UI (client/src/ui/**).
// Implementação: client/src/world/index.ts -> createWorld().
// Regra: mudanças aqui devem ser ADITIVAS.
import type { OfficeAssembly } from '../../../shared/map/types';
import type { UserStatus } from '../../../shared/model';

/**
 * Seleção: `agent` = um usuário (id numérico em string, mantido por compatibilidade com a UI);
 * `room` = uma zona do mapa (id da zona).
 */
export type Selection = { type: 'agent'; id: string } | { type: 'room'; id: string } | null;

export interface WorldOptions {
  /** Mostrar etiquetas com os nomes dos personagens. */
  showNames: boolean;
  /** (Legado, sem efeito no escritório multiplayer) */
  bubbles: 'all' | 'important' | 'none';
  /** (Legado, sem efeito) */
  liveliness: 'calm' | 'normal' | 'lively';
  /** Câmera acompanha o usuário selecionado. */
  followSelected: boolean;
  /** (Legado, sem efeito: janelas com hora fixa) */
  dayNight: boolean;
  daylight?: DaylightMode;
}

/** (Legado) Ciclo dia/noite. */
export type DaylightMode = 'auto' | 'day' | 'night';

/** Sons do ambiente (legado; usado pelo agendador de áudio da UI). */
export type SoundCueKind = 'keys' | 'elevator' | 'pingpong' | 'table' | 'arcade';

/** Margens da viewport cobertas pela UI (px CSS). */
export interface ViewInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Eventos do mundo para a UI (atalhos de teclado e cliques que abrem painéis). */
export type WorldEvent =
  /** `Enter` sem assento por perto: focar o campo do chat. */
  | { type: 'chat' }
  /** `M`: mostrar/esconder o minimapa. */
  | { type: 'minimap' }
  /** `?`: ajuda. */
  | { type: 'help' }
  /** Clique numa mesa (tampo ou cadeira de outra pessoa): menu da mesa na posição (px CSS). */
  | { type: 'desk'; desk: string; x: number; y: number }
  /** Botão direito (ou toque longo) num ponto: menu contextual do tile (px CSS + tile + o que há nele). */
  | { type: 'menu'; x: number; y: number; tx: number; ty: number; walkable: boolean; user: number | null; seat: string | null; desk: string | null; use: { id: string; kind: string } | null }
  /** Clique num avatar (também vem por `onSelect`). */
  | { type: 'select'; user: number; x: number; y: number }
  /** Dica curta para a UI mostrar (ex.: "nenhum assento livre por perto"). */
  | { type: 'hint'; text: string };

/** Dados para o minimapa (WP7): leia a cada frame do minimapa; nada é copiado. */
export interface MinimapSource {
  assembly: OfficeAssembly;
  /** Incrementa quando o mapa muda (refazer o fundo do minimapa). */
  layoutVersion: number;
  selfId: number | null;
  /** Avatares (px de mundo, pés). */
  avatars(): Iterable<{ id: number; x: number; y: number; self: boolean; status: UserStatus; zone: string | null }>;
  /** Retângulo visível na tela (px de mundo). */
  view(): { x0: number; y0: number; x1: number; y1: number };
  /** Centraliza a câmera num ponto do mundo (px). */
  centerOn(x: number, y: number): void;
}

export interface WorldApi {
  /** Seleciona (ou limpa) um usuário/zona. `focus` move a câmera até ele. */
  select(sel: Selection, opts?: { focus?: boolean }): void;
  getSelection(): Selection;
  onSelect(cb: (sel: Selection) => void): () => void;
  /** Usuário sob o cursor (para tooltips). */
  onHover(cb: (userId: number | null) => void): () => void;
  /** Eventos de teclado/clique para a UI (chat, minimapa, ajuda, mesa...). */
  on(cb: (e: WorldEvent) => void): () => void;
  focusUser(id: number, opts?: { follow?: boolean }): void;
  /** Igual a `focusUser` com o id em string (compatibilidade). */
  focusAgent(id: string, opts?: { follow?: boolean }): void;
  /** Enquadra uma zona. */
  focusRoom(zoneId: string): void;
  /** Volta a seguir o próprio avatar. */
  follow(): void;
  /** Enquadra o escritório inteiro. */
  overview(): void;
  zoomBy(factor: number): void;
  getOptions(): WorldOptions;
  setOptions(o: Partial<WorldOptions>): void;
  /** Posição na tela (CSS px) logo acima da cabeça do usuário, ou null se não visível. */
  screenPositionOf(id: string | number): { x: number; y: number } | null;
  setViewInsets?(insets: Partial<ViewInsets>): void;
  /** Tile sob um ponto da tela (CSS px), ou null fora do mapa. */
  tileFromScreen(sx: number, sy: number): { tx: number; ty: number } | null;
  minimapSource(): MinimapSource;
  /** Anda até o assento `spotId` e senta ao chegar (false se não existe/ocupado). */
  sitAt(spotId: string, run?: boolean): boolean;
  /** Anda até o tile (menu "Vir até aqui"). */
  moveTo(tx: number, ty: number, run?: boolean): boolean;
  /** Anda até o ponto de uso (café, pia...) e usa. */
  useAt(spotId: string): boolean;
  /** Depuração (QA): réplica e contadores do preditor. */
  __replica: unknown;
  __predictorStats(): { snaps: number; nudges: number; samples: number };
  destroy(): void;
}

export const DEFAULT_WORLD_OPTIONS: WorldOptions = {
  showNames: true,
  bubbles: 'important',
  liveliness: 'normal',
  followSelected: false,
  dayNight: true,
};
