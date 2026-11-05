// Dependências compartilhadas pelos painéis do shell.
import type { UserPublicSelf } from '../../../shared/model';
import type { ArtModule } from '../art/api';
import type { OfficeSocket } from '../net/socket';
import type { OfficeClientStore } from '../net/world-store';
import type { WorldApi } from '../world/api';

export interface UIDeps {
  store: OfficeClientStore;
  socket: OfficeSocket;
  world: WorldApi;
  me: UserPublicSelf;
  art: ArtModule;
  /** "Minha mesa" (WP9 liga a navegação até a mesa). Sem isto, a câmera foca o próprio avatar. */
  onMyDesk?: () => void;
}

/** Contexto interno dos painéis: deps + utilitários do shell. */
export interface PanelCtx extends UIDeps {
  /** Aviso curto (toast). */
  notify(text: string, level?: 'info' | 'success' | 'warn' | 'alert'): void;
  /** Nome da zona (do mapa atual) ou undefined. */
  zoneName(id: string): string | undefined;
}

export interface Panel {
  readonly el: HTMLElement;
  open(): void;
  close(): void;
  toggle(): void;
  readonly isOpen: boolean;
  destroy(): void;
}
