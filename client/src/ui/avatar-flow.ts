// Editor de avatar: primeiro acesso (antes de conectar) e "Meu avatar" (edição). Salva em /api/me/appearance.
import type { UserPublicSelf } from '../../../shared/model';
import type { ArtModule } from '../art/api';
import { api } from '../net/api';

/**
 * Abre o editor e resolve quando ele fecha. `first` não pode ser cancelado, então só fecha depois de salvar.
 * Devolve a aparência/nome salvos (ou null se o usuário cancelou no modo 'edit').
 */
export async function runAvatarEditor(
  art: ArtModule,
  user: Pick<UserPublicSelf, 'id' | 'name' | 'appearance'>,
  mode: 'first' | 'edit',
): Promise<{ appearance: NonNullable<UserPublicSelf['appearance']>; displayName: string } | null> {
  const { openAvatarEditor } = await import('./avatar-editor/index');
  return new Promise((resolve) => {
    let saved: { appearance: NonNullable<UserPublicSelf['appearance']>; displayName: string } | null = null;
    openAvatarEditor({
      art,
      initial: user.appearance ?? art.appearanceFromSeed(user.id),
      displayName: user.name,
      mode,
      save: async (appearance, displayName) => {
        await api.put('/api/me/appearance', { appearance, displayName });
        saved = { appearance, displayName };
      },
      onClose: () => resolve(saved),
    });
  });
}
