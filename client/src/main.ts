import './ui/brand.css';
// Ponto de entrada do escritório: sessão (GET /api/me) -> (primeiro acesso: editor de avatar) -> mapa -> store/socket -> mundo -> UI.
// Sem servidor (ou sem WebSocket) a página carrega com o mapa em cache/de exemplo e tenta reconectar.
import type { UserPublicSelf } from '../../shared/model';
import { loadMap } from './net/map-client';
import { OfficeSocket } from './net/socket';
import { OfficeClientStore } from './net/world-store';
import * as art from './art/index';
import { runAvatarEditor } from './ui/avatar-flow';
import { mountUI } from './ui';
import { startMedia } from './av';
import { mountSounds } from './ui/sounds';
import { migrateLegacyKeys, safeLocalStorage } from './ui/prefs';
import { createWorld } from './world';
import { startTelemetry, type EarlyEvent } from './telemetry';
import { errorData } from './telemetry/core';
import { loadBranding, pageTitle } from './net/branding';

declare global {
  interface Window {
    escritorio?: unknown;
  }
}

interface MeResult {
  user: UserPublicSelf | null;
  needsAvatar: boolean;
  /** false = servidor fora do ar/sem a rota (segue em modo offline). */
  online: boolean;
}

/** GET /api/me. 401 -> /login. Aceita `{user, needsAvatar}` ou o usuário direto. */
async function fetchMe(): Promise<MeResult | null> {
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin', headers: { accept: 'application/json' } });
    if (res.status === 401) {
      location.assign('/login');
      return null;
    }
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return { user: null, needsAvatar: false, online: false };
    const body = (await res.json()) as { user?: UserPublicSelf; needsAvatar?: boolean } & Partial<UserPublicSelf>;
    const user = (body.user ?? (typeof body.id === 'number' ? (body as UserPublicSelf) : null)) as UserPublicSelf | null;
    const needsAvatar = body.needsAvatar ?? (user ? !user.appearance : false);
    return { user, needsAvatar: !!needsAvatar, online: true };
  } catch (err) {
    console.warn('[escritório] /api/me indisponível', err);
    return { user: null, needsAvatar: false, online: false };
  }
}

async function boot(): Promise<void> {
  migrateLegacyKeys(safeLocalStorage());
  await loadBranding();
  document.title = pageTitle();
  /** Eventos de telemetria antes do coletor subir (editor de avatar, mapa). */
  const early: EarlyEvent[] = [];
  const me = await fetchMe();
  if (!me) return; // redirecionando para o login
  // Primeiro acesso: monta o avatar ANTES de conectar (o servidor só aceita quem já tem aparência).
  if (me.user && me.online && me.needsAvatar) {
    const saved = await runAvatarEditor(art, me.user, 'first').catch((err) => {
      console.error('[escritório] editor de avatar', err);
      early.push({ kind: 'avatar_editor_error', data: errorData(err), at: Date.now() });
      return null;
    });
    if (saved) {
      me.user.appearance = saved.appearance;
      me.user.name = saved.displayName;
    }
  }
  const map = await loadMap();
  // Servidor no ar mas o mapa veio do exemplo/cache: GET /api/map falhou.
  if (me.online && map.source !== 'server') early.push({ kind: 'map_fallback', data: { source: map.source, id: map.id, version: map.version }, at: Date.now() });
  const socket = new OfficeSocket();
  const store = new OfficeClientStore({ serverNow: () => socket.serverNow() });
  socket.on('message', (m) => store.apply(m));
  socket.on('state', (s) => store.setConnection(s));
  if (me.user) store.self = me.user;
  // sons de notificação (chat, bater na porta, alguém por perto); respeita a preferência `sounds`
  mountSounds({ store, settings: () => store.self?.settings });

  const canvas = document.getElementById('world') as HTMLCanvasElement;
  const world = createWorld(canvas, store, socket, map);
  const root = document.getElementById('ui') as HTMLElement;
  let media: ReturnType<typeof startMedia> | null = null;
  if (me.user) {
    const ui = mountUI(root, { store, socket, world, me: me.user, art });
    // Áudio/vídeo por proximidade (LiveKit). Antes do connect: o `welcome` traz as credenciais.
    media = startMedia({
      store,
      socket,
      me: me.user,
      settings: () => store.self?.settings,
      art,
      slots: ui.slots,
      notify: (level, text) => ui.notify(text, level),
    });
  }
  // Telemetria (desligável com localStorage['oficio:telemetry'] = 'off'); só com sessão de verdade.
  const telemetry = me.user && me.online ? startTelemetry({ store, socket, world, media, early }) : null;
  socket.connect();

  // depuração pelo console do navegador
  window.escritorio = { store, socket, world, map, media, telemetry };
}

boot().catch((err) => console.error('[escritório] falha ao iniciar', err));
