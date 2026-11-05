// Gravação automática do rascunho: 5 s depois da última alteração, `PUT /api/admin/maps/draft
// {doc, baseUpdatedAt}`. 409 = alguém gravou antes (banner: recarregar ou sobrescrever). Avisa ao sair
// da página com alterações não gravadas.
import type { OfficeMapDoc } from '../../../shared/map/doc';
import { t } from '../i18n';
import type { DocStore } from './doc-store';
import type { EditorState } from './state';

export const AUTOSAVE_MS = 5000;

/** Linha de mapa devolvida pelas rotas do admin. */
export interface MapRowDto {
  id: number;
  kind: 'draft' | 'version';
  name: string;
  doc: OfficeMapDoc;
  updated_at: string;
  created_at?: string;
  published_at?: string | null;
  by?: number | null;
}

export interface Conflict {
  updatedAt: string | null;
  by: number | string | null;
}

export interface SaveApi {
  put<T>(path: string, body: unknown): Promise<T>;
}

export interface AutosaveHooks {
  conflict(c: Conflict): void;
  error(message: string): void;
  saved?(row: MapRowDto): void;
}

type HttpErr = { status?: number; body?: unknown; message?: string };

export class Autosave {
  /** `updated_at` do rascunho que este editor viu por último. */
  base: string | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inflight: Promise<boolean> | null = null;
  private conflictInfo: Conflict | null = null;
  private readonly onUnload = (e: BeforeUnloadEvent) => {
    if (this.store.dirty || this.inflight) {
      e.preventDefault();
      e.returnValue = '';
    }
  };

  constructor(
    private readonly api: SaveApi,
    private readonly store: DocStore,
    private readonly state: EditorState,
    private readonly hooks: AutosaveHooks,
    private readonly delay = AUTOSAVE_MS,
  ) {
    if (typeof window !== 'undefined') window.addEventListener('beforeunload', this.onUnload);
  }

  dispose(): void {
    clearTimeout(this.timer);
    if (typeof window !== 'undefined') window.removeEventListener('beforeunload', this.onUnload);
  }

  get conflict(): Conflict | null {
    return this.conflictInfo;
  }

  /** Rascunho (re)carregado do servidor. */
  loaded(row: Pick<MapRowDto, 'updated_at'>): void {
    clearTimeout(this.timer);
    this.base = row.updated_at ?? null;
    this.conflictInfo = null;
  }

  /** Houve alteração local: agenda a gravação. */
  schedule(): void {
    clearTimeout(this.timer);
    if (this.conflictInfo) return;
    this.timer = setTimeout(() => void this.flush(), this.delay);
  }

  /** Grava agora se houver alteração. true = o servidor tem o conteúdo atual. */
  async flush(): Promise<boolean> {
    clearTimeout(this.timer);
    if (this.inflight) await this.inflight;
    if (this.conflictInfo) return false;
    if (!this.store.dirty) return true;
    this.inflight = this.save();
    try {
      return await this.inflight;
    } finally {
      this.inflight = null;
    }
  }

  /** Sobrescreve a versão do servidor que causou o conflito. */
  async overwrite(): Promise<boolean> {
    const c = this.conflictInfo;
    if (!c) return this.flush();
    this.base = c.updatedAt;
    this.conflictInfo = null;
    this.state.doc = this.store.dirty ? 'dirty' : 'clean';
    this.state.changed();
    return this.flush();
  }

  private async save(): Promise<boolean> {
    const rev = this.store.rev;
    const doc = this.store.doc;
    this.state.docEvent('save');
    try {
      const row = await this.api.put<MapRowDto>('/api/admin/maps/draft', { doc, baseUpdatedAt: this.base });
      this.base = row.updated_at ?? this.base;
      this.store.markSaved(rev);
      this.state.docEvent(this.store.dirty ? 'saved-dirty' : 'saved');
      this.hooks.saved?.(row);
      if (this.store.dirty) this.schedule();
      return !this.store.dirty;
    } catch (e) {
      const err = e as HttpErr;
      if (err.status === 409) {
        const b = (err.body ?? {}) as { updated_at?: string; by?: number | string | null };
        this.conflictInfo = { updatedAt: b.updated_at ?? null, by: b.by ?? null };
        this.state.docEvent('conflict');
        this.hooks.conflict(this.conflictInfo);
        return false;
      }
      this.state.docEvent('error');
      const issues = (err.body as { issues?: string[] } | undefined)?.issues;
      this.hooks.error(t('editor.autosave.error', { error: err.message ?? t('editor.error.unknown'), issues: issues?.length ? ` (${issues.slice(0, 3).join('; ')})` : '' }));
      return false;
    }
  }
}
