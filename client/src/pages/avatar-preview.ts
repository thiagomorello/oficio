// Página de desenvolvimento do montador de avatar: abre o editor com uma aparência aleatória e mostra/loga o JSON salvo.
// `?mode=first` abre como primeiro acesso; `?fail=1` faz o salvar falhar (testa o toast de erro).
import '@fontsource/pixelify-sans/400.css';
import * as artNs from '../art/index';
import type { Appearance, ArtModule } from '../art/api';
import { openAvatarEditor } from '../ui/avatar-editor';
import { randomAll } from '../ui/avatar-editor/random';
import { h } from '../ui/dom';

const art: ArtModule = artNs;
const params = new URLSearchParams(location.search);
const mode = params.get('mode') === 'first' ? 'first' : 'edit';

const app = document.getElementById('app') as HTMLElement;
const out = h('pre', { text: '(nada salvo ainda)' });
const open = (): void => {
  const initial: Appearance = randomAll(Math.random() < 0.5 ? 'f' : 'm');
  openAvatarEditor({
    art,
    initial,
    displayName: 'Maria S.',
    mode,
    save: async (a, displayName) => {
      await new Promise((r) => setTimeout(r, 300));
      if (params.get('fail')) throw new Error('Falha simulada ao salvar.');
      const json = JSON.stringify({ displayName, appearance: a }, null, 2);
      console.log('avatar salvo', json);
      out.textContent = json;
    },
    onClose: () => console.log('editor fechado'),
  });
};
app.append(h('p', { text: `Modo: ${mode}` }), h('button', { type: 'button', text: 'Abrir montador', on: { click: open } }), out);
open();
