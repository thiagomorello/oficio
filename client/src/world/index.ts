// Mundo do escritório: liga a réplica (replica/), o desenho (render/), a câmera e a entrada, e
// implementa o contrato WorldApi consumido pela UI.
import { predictorStats } from './replica/prediction';
import { t } from '../i18n';
import * as artModule from '../art';
import { TILE, type ArtModule } from '../art/api';
import type { OfficeSocket } from '../net/socket';
import type { OfficeClientStore } from '../net/world-store';
import { loadMap, sampleMap, type LoadedMap } from '../net/map-client';
import type { OfficeAssembly } from '../../../shared/map/types';
import { DEFAULT_WORLD_OPTIONS, type MinimapSource, type Selection, type WorldApi, type WorldEvent, type WorldOptions } from './api';
import { loadWorldAssets } from './assets';
import { Camera, overviewFrame } from './camera';
import { attachInput, classifyClick, seatNearPoint } from './input';
import { nearestUseSpot } from './replica/spots-near';
import { Replica } from './replica/replica';
import { Overlay } from './render/overlay';
import { Renderer } from './render/renderer';

export * from './api';

const art: ArtModule = artModule;

/** Intervalo mínimo entre avisos de atividade (auto-away do servidor). */
const ACTIVITY_EVERY_MS = 20_000;
/** Zoom inicial ao seguir o próprio avatar. */
const FOLLOW_ZOOM = 3;

export function createWorld(canvas: HTMLCanvasElement, store: OfficeClientStore, socket: OfficeSocket, initial?: LoadedMap | OfficeAssembly): WorldApi {
  let options: WorldOptions = { ...DEFAULT_WORLD_OPTIONS };
  const camera = new Camera();
  const first: OfficeAssembly = !initial ? sampleMap().assembly : 'assembly' in initial ? initial.assembly : initial;
  let mapKey = initial && 'assembly' in initial ? `${initial.id}:${initial.version}` : '';
  const replica = new Replica(store, first, {
    send: (m) => void socket.send(m),
    serverNow: () => socket.serverNow(),
    clock: () => ({ offset: socket.offset, rtt: socket.rtt }),
    appearanceFor: (id) => store.users.get(id)?.appearance ?? art.appearanceFromSeed(id * 2654435761),
  });
  const renderer = new Renderer(canvas, art, camera);
  const overlay = new Overlay(renderer.ctx, renderer, camera);
  const selectCbs = new Set<(s: Selection) => void>();
  const hoverCbs = new Set<(id: number | null) => void>();
  const eventCbs = new Set<(e: WorldEvent) => void>();
  let selection: Selection = null;
  let hover: number | null = null;
  let mouse: { x: number; y: number } | null = null;
  let raf = 0;
  let lastTs = 0;
  let framed = false;
  let overviewed = false;
  let lastActivity = 0;
  let destroyed = false;
  const abort = new AbortController();
  const SELF = 'self';

  const emit = (e: WorldEvent) => {
    for (const cb of [...eventCbs]) {
      try {
        cb(e);
      } catch (err) {
        console.error('[mundo] erro num ouvinte', err);
      }
    }
  };

  const activity = () => {
    const now = Date.now();
    if (now - lastActivity < ACTIVITY_EVERY_MS) return;
    lastActivity = now;
    socket.send({ t: 'activity' });
  };

  // ------------------------------------------------------------------ tamanho/limites

  const officeRect = () => ({ x: 0, y: 0, w: replica.assembly.w * TILE, h: replica.assembly.h * TILE });

  const updateBounds = () => {
    const b = officeRect();
    camera.bounds = { x: b.x - 3 * TILE, y: b.y - 3 * TILE, w: b.w + 6 * TILE, h: b.h + 6 * TILE };
    const fit = camera.fitZoom(b, 16);
    camera.minZoom = Math.min(1, Math.max(0.25, fit));
    camera.clamp();
  };

  const resize = () => {
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    const pw = Math.floor(w * dpr);
    const ph = Math.floor(h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    camera.setView(w, h, dpr);
    updateBounds();
  };

  const overview = (animate = true) => {
    camera.follow = null;
    const f = overviewFrame(officeRect(), camera.viewW, camera.viewH, camera.insets);
    const fit = Math.max(camera.minZoom, f.zoom);
    const snapped = camera.snapZoom(fit, 'down');
    const z = Math.min(snapped >= fit * 0.82 ? snapped : fit, 4);
    const c = camera.centerFor(f.cx, f.cy, z);
    if (animate) camera.animateTo(c.x, c.y - f.dy / z, z, Date.now(), 420);
    else {
      camera.stop();
      camera.x = c.x;
      camera.y = c.y - f.dy / z;
      camera.zoom = z;
      camera.clamp();
    }
  };

  // ------------------------------------------------------------------ seleção e foco

  const userOf = (sel: Selection): number | null => (sel?.type === 'agent' ? Number(sel.id) : null);

  const setSelection = (sel: Selection, focus = false) => {
    const same = sel === selection || (!!sel && !!selection && sel.type === selection.type && sel.id === selection.id);
    selection = sel;
    if (focus && sel) {
      if (sel.type === 'agent') focusUser(Number(sel.id), { follow: options.followSelected });
      else focusRoom(sel.id);
    }
    if (!same) for (const cb of [...selectCbs]) cb(selection);
  };

  const followSelf = () => {
    const me = replica.self;
    if (!me) return;
    camera.follow = SELF;
    if (camera.zoom < 2) {
      const z = camera.snapZoom(FOLLOW_ZOOM);
      const c = camera.centerFor(me.x, me.y - 12, z);
      camera.animateTo(c.x, c.y, z, Date.now(), 420);
    }
  };

  const focusUser = (id: number, opts: { follow?: boolean } = {}) => {
    const av = replica.avatars.get(id);
    if (!av) return;
    const zoom = Math.max(camera.zoom, camera.snapZoom(3));
    const c = camera.centerFor(av.x, av.y - 12, zoom);
    camera.animateTo(c.x, c.y, zoom, Date.now(), 420);
    camera.follow = opts.follow ? (av.self ? SELF : String(id)) : null;
  };

  const focusRoom = (zoneId: string) => {
    const z = replica.assembly.zoneById.get(zoneId);
    const r = z?.rects[0];
    if (!z || !r) return;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const q of z.rects) {
      x0 = Math.min(x0, q.x);
      y0 = Math.min(y0, q.y);
      x1 = Math.max(x1, q.x + q.w);
      y1 = Math.max(y1, q.y + q.h);
    }
    camera.follow = null;
    const rect = { x: x0 * TILE, y: y0 * TILE - 2 * TILE, w: (x1 - x0) * TILE, h: (y1 - y0 + 2) * TILE };
    const fit = camera.fitZoom(rect, 40);
    const zoom = Math.min(4, Math.max(camera.minZoom, camera.snapZoom(fit, 'down')));
    const c = camera.centerFor(rect.x + rect.w / 2, rect.y + rect.h / 2, zoom);
    camera.animateTo(c.x, c.y, zoom, Date.now(), 420);
  };

  const zoomStep = (steps: number, sx = camera.viewW / 2, sy = camera.viewH / 2) => {
    camera.zoomAt(camera.stepZoom(steps), sx, sy, Date.now(), true);
  };

  // ------------------------------------------------------------------ hit-test

  const pick = (sx: number, sy: number): number | null => {
    const w = camera.screenToWorld(sx, sy);
    let best: number | null = null;
    let bestDepth = -Infinity;
    const slack = Math.max(1, 3 / camera.zoom);
    for (const [id, h] of renderer.heads) {
      if (!h.visible) continue;
      if (w.x < h.bx - slack || w.x > h.bx + h.bw + slack || w.y < h.by - slack || w.y > h.by + h.bh + slack) continue;
      if (h.depth > bestDepth) {
        bestDepth = h.depth;
        best = id;
      }
    }
    return best;
  };

  const tileFromScreen = (sx: number, sy: number): { tx: number; ty: number } | null => {
    const w = camera.screenToWorld(sx, sy);
    const tx = Math.floor(w.x / TILE);
    const ty = Math.floor(w.y / TILE);
    if (tx < 0 || ty < 0 || tx >= replica.assembly.w || ty >= replica.assembly.h) return null;
    return { tx, ty };
  };

  const setHover = (id: number | null) => {
    if (id === hover) return;
    hover = id;
    canvas.style.cursor = id !== null ? 'pointer' : 'default';
    for (const cb of [...hoverCbs]) cb(id);
  };

  const detachInput = attachInput(canvas, camera, {
    pick,
    click: (sx, sy, hit, e) => {
      activity();
      const tile = tileFromScreen(sx, sy);
      if (hit === null && !tile) return;
      const wp = camera.screenToWorld(sx, sy);
      const action = classifyClick(replica.assembly, tile?.tx ?? -1, tile?.ty ?? -1, hit, wp);
      switch (action.kind) {
        case 'select':
          setSelection({ type: 'agent', id: String(action.id) });
          emit({ type: 'select', user: action.id, x: sx, y: sy });
          return;
        case 'sit':
          setSelection(null);
          if (!replica.sit(action.spot, e.shiftKey)) {
            // assento ocupado (ou sem caminho): a mesa ainda abre o menu
            const desk = tile ? replica.assembly.deskAtTile.get(`${tile.tx},${tile.ty}`) : undefined;
            if (desk) emit({ type: 'desk', desk, x: sx, y: sy });
            else emit({ type: 'hint', text: t('shell.hint.seatTaken') });
            return;
          }
          if (camera.follow !== SELF) followSelf();
          return;
        case 'desk':
          emit({ type: 'desk', desk: action.desk, x: sx, y: sy });
          return;
        case 'move':
          // Andar é pelo teclado ou pelo menu do botão direito ("Vir até aqui"); o clique só deseleciona.
          setSelection(null);
          void e;
      }
    },
    rightClick: (sx, sy, hit) => {
      activity();
      const t = tileFromScreen(sx, sy);
      if (!t) return;
      const wp = camera.screenToWorld(sx, sy);
      const seat = hit === null ? seatNearPoint(replica.assembly, t.tx, t.ty, wp) : null;
      const desk = replica.assembly.deskAtTile.get(`${t.tx},${t.ty}`) ?? null;
      const useSpot = hit === null && !seat ? nearestUseSpot(replica.assembly, t.tx, t.ty, 1) : null;
      emit({ type: 'menu', x: sx, y: sy, tx: t.tx, ty: t.ty, walkable: replica.assembly.grid.walkable(t.tx, t.ty), user: hit, seat, desk, use: useSpot ? { id: useSpot.id, kind: useSpot.kind } : null });
    },
    doubleClick: (_sx, _sy, hit) => {
      if (hit !== null) {
        setSelection({ type: 'agent', id: String(hit) });
        focusUser(hit, { follow: true });
      }
    },
    hover: (sx, sy, inside) => {
      mouse = inside ? { x: sx, y: sy } : null;
      if (!inside) setHover(null);
    },
    interact: () => {
      camera.follow = null;
      camera.stop();
    },
    zoomStep,
    dir: (dir, run) => {
      activity();
      replica.setDir(dir, run);
      if (dir && camera.follow !== SELF) followSelf();
    },
    key: (a) => {
      activity();
      switch (a.kind) {
        case 'sit':
        case 'enter': {
          const me = replica.self;
          const seat = me && !me.seated ? replica.nearestSeat(1) : null;
          const spot = !seat && a.kind === 'sit' && me && !me.seated ? replica.nearestUse(1) : null;
          if (seat) replica.sit(seat.id);
          else if (spot) replica.use(spot.id);
          else if (a.kind === 'enter') emit({ type: 'chat' });
          else emit({ type: 'hint', text: me?.seated ? t('shell.hint.alreadySeated') : t('shell.hint.noSeatNear') });
          return;
        }
        case 'stand':
          replica.stand();
          return;
        case 'emote':
          replica.emote(a.emote);
          return;
        case 'minimap':
          emit({ type: 'minimap' });
          return;
        case 'help':
          emit({ type: 'help' });
          return;
        case 'overview':
          overview(true);
          return;
        case 'follow':
          followSelf();
          return;
      }
    },
  });

  // ------------------------------------------------------------------ mapa

  const applyMap = (m: LoadedMap) => {
    const key = `${m.id}:${m.version}`;
    if (key === mapKey) return;
    mapKey = key;
    replica.setAssembly(m.assembly);
    updateBounds();
  };

  const ensureMap = () => {
    const want = store.map;
    if (!want || `${want.id}:${want.version}` === mapKey) return;
    void loadMap(want).then((m) => {
      if (!destroyed) applyMap(m);
    });
  };
  const offs = [store.on('map', ensureMap), store.on('reset', ensureMap)];

  void loadWorldAssets(abort.signal).then((a) => {
    if (a && !destroyed) renderer.setAssets(a);
  });
  const onFonts = () => overlay.resetCaches();
  document.fonts?.addEventListener?.('loadingdone', onFonts);

  // ------------------------------------------------------------------ laço

  const loop = (ts: number) => {
    raf = requestAnimationFrame(loop);
    const now = Date.now();
    const dt = lastTs ? Math.min(0.1, Math.max(0, (ts - lastTs) / 1000)) : 1 / 60;
    lastTs = ts;
    try {
      const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
      if (canvas.clientWidth !== camera.viewW || canvas.clientHeight !== camera.viewH || dpr !== camera.dpr) resize();
      replica.update(dt, now);
      renderer.sync(replica);
      if (!framed) {
        // primeiro quadro com o próprio avatar: segue ele; antes disso, a visão geral
        if (replica.self) {
          framed = true;
          camera.follow = SELF;
          const z = camera.snapZoom(FOLLOW_ZOOM);
          const c = camera.centerFor(replica.self.x, replica.self.y - 12, z);
          camera.stop();
          camera.zoom = z;
          camera.x = c.x;
          camera.y = c.y;
          camera.clamp();
        } else if (!overviewed) {
          overviewed = true;
          overview(false);
        }
      }
      const target = camera.follow === SELF ? replica.self : camera.follow ? replica.avatars.get(Number(camera.follow)) : null;
      if (camera.follow && !target) camera.follow = null;
      camera.update(now, target ? camera.centerFor(target.x, target.y - 12, camera.zoom) : null, dt);
      const sel = { user: userOf(selection), hover };
      renderer.frame(replica, now, dt, sel, replica.effects);
      overlay.draw(replica, now, { showNames: options.showNames }, sel);
      renderer.pruneHeads(replica);
      if (mouse) setHover(pick(mouse.x, mouse.y));
      if (selection?.type === 'agent' && !replica.avatars.has(Number(selection.id))) setSelection(null);
    } catch (err) {
      console.error('[mundo] erro no frame', err);
    }
  };

  const onVisibility = () => {
    if (!document.hidden) lastTs = 0;
  };

  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', onVisibility);
  resize();
  raf = requestAnimationFrame(loop);

  const minimap: MinimapSource = {
    get assembly() {
      return replica.assembly;
    },
    get layoutVersion() {
      return replica.layoutVersion;
    },
    get selfId() {
      return store.selfId;
    },
    *avatars() {
      for (const a of replica.avatars.values()) yield { id: a.id, x: a.x, y: a.y, self: a.self, status: a.status, zone: a.zone };
    },
    view: () => ({ ...renderer.viewRect }),
    centerOn: (x, y) => {
      camera.follow = null;
      camera.animateTo(x, y, camera.zoom, Date.now(), 300);
    },
  };

  return {
    select: (sel, opts) => setSelection(sel, !!opts?.focus),
    getSelection: () => selection,
    onSelect: (cb) => {
      selectCbs.add(cb);
      return () => void selectCbs.delete(cb);
    },
    onHover: (cb) => {
      hoverCbs.add(cb);
      return () => void hoverCbs.delete(cb);
    },
    on: (cb) => {
      eventCbs.add(cb);
      return () => void eventCbs.delete(cb);
    },
    focusUser,
    focusAgent: (id, opts) => focusUser(Number(id), opts),
    focusRoom,
    follow: followSelf,
    overview: () => overview(true),
    zoomBy: (factor) => {
      if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return;
      const target = camera.snapZoom(camera.zoom * factor, factor > 1 ? 'up' : 'down');
      if (Math.abs(target - camera.zoom) < 1e-3) zoomStep(factor > 1 ? 1 : -1);
      else camera.zoomAt(target, camera.viewW / 2, camera.viewH / 2, Date.now(), true);
    },
    getOptions: () => ({ ...options }),
    setOptions: (o) => {
      options = { ...options, ...o };
    },
    setViewInsets: (ins) => {
      const v = (n: number | undefined, cur: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, n) : cur);
      const cur = camera.insets;
      camera.insets = { top: v(ins.top, cur.top), right: v(ins.right, cur.right), bottom: v(ins.bottom, cur.bottom), left: v(ins.left, cur.left) };
      updateBounds();
    },
    screenPositionOf: (id) => {
      const h = renderer.heads.get(Number(id));
      if (!h || !h.visible) return null;
      const p = camera.worldToScreen(h.x, h.y - 2);
      if (p.x < 0 || p.y < 0 || p.x > camera.viewW || p.y > camera.viewH) return null;
      return p;
    },
    tileFromScreen,
    minimapSource: () => minimap,
    sitAt: (spotId, run) => replica.sit(spotId, run),
    useAt: (spotId) => {
      const ok = replica.use(spotId);
      if (ok && camera.follow !== SELF) followSelf();
      return ok;
    },
    moveTo: (tx, ty, run) => {
      const ok = replica.moveTo(tx, ty, run);
      if (ok && camera.follow !== SELF) followSelf();
      return ok;
    },
    __replica: replica,
    __predictorStats: () => ({ ...predictorStats }),
    destroy: () => {
      destroyed = true;
      cancelAnimationFrame(raf);
      abort.abort();
      for (const off of offs) off();
      replica.destroy();
      detachInput();
      document.fonts?.removeEventListener?.('loadingdone', onFonts);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      selectCbs.clear();
      hoverCbs.clear();
      eventCbs.clear();
    },
  };
}
