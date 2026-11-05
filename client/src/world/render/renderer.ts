// Desenho do mundo por frame: faixa externa escura -> pisos -> paredes/itens de parede (StaticScene)
// -> móveis e avatares ordenados por profundidade -> partículas -> ícones sobre as cabeças.
// O texto nítido (nomes, balões, pílulas, placas) fica em overlay.ts, em espaço de tela.
import { TILE, type ArtModule, type CharacterFrameRequest, type IconName, type ScreenMode, type Sprite } from '../../art/api';
import type { WorldAssets } from '../assets';
import type { Camera } from '../camera';
import type { Avatar } from '../replica/avatar';
import type { ReplicaEffect, WorldView } from '../replica/replica';
import { Particles } from './particles';
import { shadowSprite } from './props';
import { opaqueBounds, type FurnVis } from './scene';
import { StaticScene, type ViewRect } from './static';

/** Fundo da página e faixa escura em volta do escritório. */
export const PAGE_BG = '#121212';
export const EXTERIOR_BG = '#1a1a1e';
/** Largura da faixa externa (tiles). */
const EXTERIOR_TILES = 3;
/** Anel de quem está falando. */
export const SPEAKING_RING = '#ffd800';

const enum K {
  FurnBase,
  FurnFront,
  Avatar,
}

interface Ent {
  k: K;
  y: number;
  f: FurnVis | null;
  a: Avatar | null;
}

/** Posição da cabeça (px de mundo) de cada avatar desenhado neste frame. */
export interface HeadInfo {
  x: number;
  y: number;
  feetY: number;
  visible: boolean;
  /** Retângulo do sprite (px de mundo) para hit-test. */
  bx: number;
  by: number;
  bw: number;
  bh: number;
  depth: number;
}

export interface FrameSelection {
  user: number | null;
  hover: number | null;
}

export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  readonly scene: StaticScene;
  readonly heads = new Map<number, HeadInfo>();
  readonly particles = new Particles();
  assets: WorldAssets | null = null;
  /** Retângulo visível do último frame (px de mundo). */
  readonly viewRect: ViewRect = { x0: 0, y0: 0, x1: 0, y1: 0 };
  private ents: Ent[] = [];
  private pool: Ent[] = [];
  private icons: { x: number; y: number; name: IconName; bounce: number; alpha: number }[] = [];
  private iconCount = 0;
  private view: WorldView | null = null;
  private readonly req: CharacterFrameRequest = {
    appearance: undefined as unknown as CharacterFrameRequest['appearance'],
    dir: 'down',
    pose: 'stand',
    frame: 0,
    held: 'none',
    seated: false,
  };
  private readonly screenOf = (f: FurnVis): ScreenMode => this.deskScreen(f);
  private readonly decorOf = (id: string) => this.view?.desks.get(id)?.decor ?? null;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly art: ArtModule,
    private readonly camera: Camera,
  ) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.scene = new StaticScene(art);
  }

  setAssets(a: WorldAssets | null): void {
    this.assets = a;
    this.scene.setAssets(a);
  }

  /** Mantém os caches da cena coerentes com o mapa atual. */
  sync(view: WorldView): void {
    this.view = view;
    this.scene.sync(view.assembly.areas, view.layoutVersion);
  }

  /** Tela do monitor: `code` com alguém sentado, `standby` na mesa livre, `off` na mesa de alguém ausente. */
  deskScreen(f: FurnVis): ScreenMode {
    const view = this.view;
    const desk = view?.assembly.deskById.get(f.id);
    if (!view || !desk) return 'off';
    if (view.spots.has(desk.spotId)) return 'code';
    return view.desks.get(desk.id)?.userId ? 'off' : 'standby';
  }

  frame(view: WorldView, now: number, dt: number, sel: FrameSelection, effects?: ReplicaEffect[]): void {
    const { ctx, camera } = this;
    this.view = view;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = PAGE_BG;
    ctx.fillRect(0, 0, W, H);
    const { scale, ox, oy } = camera.transform();
    ctx.setTransform(scale, 0, 0, scale, ox, oy);
    const v = this.viewRect;
    v.x0 = -ox / scale;
    v.y0 = -oy / scale;
    v.x1 = v.x0 + W / scale;
    v.y1 = v.y0 + H / scale;
    const isVisible = (x: number, y: number, w: number, h: number) => x < v.x1 && x + w > v.x0 && y < v.y1 && y + h > v.y0;

    // ---- faixa externa e cena estática
    const a = view.assembly;
    const m = EXTERIOR_TILES * TILE;
    ctx.fillStyle = EXTERIOR_BG;
    ctx.fillRect(-m, -m, a.w * TILE + 2 * m, a.h * TILE + 2 * m);
    this.scene.drawFloors(ctx, v);
    this.scene.drawWalls(ctx, v, Date.now());

    // ---- entidades ordenadas por profundidade
    const ents = this.ents;
    ents.length = 0;
    let used = 0;
    const push = (k: K, y: number, f: FurnVis | null, av: Avatar | null) => {
      let e = this.pool[used];
      if (!e) this.pool[used] = e = { k, y, f, a: av };
      else {
        e.k = k;
        e.y = y;
        e.f = f;
        e.a = av;
      }
      used++;
      ents.push(e);
    };
    this.scene.collect((f, front, depth) => push(front ? K.FurnFront : K.FurnBase, depth, f, null), v);
    for (const av of view.avatars.values()) {
      const head = this.headOf(av.id);
      head.visible = false;
      head.x = av.x;
      head.y = av.y - 26;
      head.feetY = av.y;
      if (av.alpha <= 0.01 || !isVisible(av.x - 24, av.y - 48, 48, 56)) continue;
      push(K.Avatar, av.depth(), null, av);
    }
    ents.sort((p, q) => p.y - q.y || p.k - q.k);

    this.iconCount = 0;
    for (const e of ents) {
      if (e.k === K.Avatar) this.drawAvatar(e.a!, now, sel);
      else this.scene.drawFurniture(ctx, e.f!, e.k === K.FurnFront, now, this.screenOf, this.decorOf);
    }

    // ---- efeitos (confete de quem comemora)
    if (effects?.length) {
      for (const fx of effects) {
        const h = this.heads.get(fx.id);
        if (!h || !h.visible) continue;
        if (fx.kind === 'confetti') this.particles.confetti(h.x, h.y - 4);
        else this.particles.sparkle(h.x, h.y + 4);
      }
      effects.length = 0;
    }
    this.particles.update(dt);
    this.particles.draw(ctx, v.x0, v.y0, v.x1, v.y1, now);

    // ---- ícones sobre as cabeças
    for (let i = 0; i < this.iconCount; i++) {
      const ic = this.icons[i];
      const s = this.icon(ic.name);
      if (!s) continue;
      ctx.globalAlpha = ic.alpha;
      ctx.drawImage(s.canvas, Math.round(ic.x - s.ax), Math.round(ic.y - s.ay - ic.bounce));
    }
    ctx.globalAlpha = 1;
  }

  private headOf(id: number): HeadInfo {
    let h = this.heads.get(id);
    if (!h) this.heads.set(id, (h = { x: 0, y: 0, feetY: 0, visible: false, bx: 0, by: 0, bw: 0, bh: 0, depth: 0 }));
    return h;
  }

  /** Remove entradas de avatares que já saíram. */
  pruneHeads(view: WorldView): void {
    for (const id of this.heads.keys()) if (!view.avatars.has(id)) this.heads.delete(id);
  }

  private drawAvatar(av: Avatar, now: number, sel: FrameSelection): void {
    const { ctx } = this;
    const head = this.headOf(av.id);
    const x = Math.round(av.x + av.offX);
    const y = Math.round(av.y + av.offY);
    ctx.globalAlpha = av.alpha;
    // anéis no chão: fala (amarelo da marca), seleção, hover
    if (av.speaking) this.drawSpeakingRing(x, y, now);
    if (sel.user === av.id) this.drawRing(x, y, '#ffffff', now, true);
    else if (sel.hover === av.id) this.drawRing(x, y, '#ffffff', now, false);
    if (!av.seated) {
      const sh = shadowSprite();
      ctx.drawImage(sh.canvas, x - sh.ax, y - sh.ay);
    }
    let sprite: Sprite | null = null;
    const req = this.req;
    req.appearance = av.appearance;
    req.dir = av.dir;
    req.pose = av.pose;
    req.held = av.held;
    req.seated = av.seated;
    try {
      sprite = this.charSprite(req, av.animT);
    } catch {
      sprite = null;
    }
    if (!sprite && req.pose !== 'stand') {
      // arte sem a pose: em pé (ou sentado) parado
      req.pose = av.seated ? 'sit' : 'stand';
      req.held = 'none';
      try {
        sprite = this.charSprite(req, av.animT);
      } catch {
        sprite = null;
      }
    }
    if (sprite) {
      const sx = x - sprite.ax;
      const sy = y - sprite.ay;
      ctx.drawImage(sprite.canvas, sx, sy);
      const b = opaqueBounds(sprite.canvas);
      head.bx = sx + b.x;
      head.by = sy + b.y;
      head.bw = b.w;
      head.bh = b.h;
      head.y = sy + b.y;
    } else {
      head.bx = x - 7;
      head.by = y - 26;
      head.bw = 14;
      head.bh = 26;
      head.y = y - 26;
    }
    head.x = x;
    head.feetY = y;
    head.visible = true;
    head.depth = av.depth();
    if (av.mic === false) this.drawMicOff(x + 6, head.y + 1);
    ctx.globalAlpha = 1;
    if (av.icon) {
      const bounce = av.icon === 'zzz' ? Math.round(Math.sin(now / 500) * 1.5) : Math.round(Math.max(0, 1 - (now - av.iconAt) / 250) * 4);
      this.pushIcon(x, head.y - 2, av.icon, bounce, av.alpha);
    }
  }

  private pushIcon(x: number, y: number, name: IconName, bounce: number, alpha: number): void {
    if (this.iconCount >= 256) return;
    let ic = this.icons[this.iconCount];
    if (!ic) this.icons[this.iconCount] = ic = { x: 0, y: 0, name, bounce: 0, alpha: 1 };
    ic.x = x;
    ic.y = y;
    ic.name = name;
    ic.bounce = bounce;
    ic.alpha = alpha;
    this.iconCount++;
  }

  /** Sprite do personagem no frame da animação (tolera arte sem a pose). */
  private charSprite(req: CharacterFrameRequest, animT: number): Sprite {
    const { art } = this;
    const count = Math.max(1, art.poseFrameCount(req.pose) || 1);
    const dur = Math.max(30, art.poseFrameDuration(req.pose) || 500);
    req.frame = Math.floor(animT / dur) % count;
    return art.characterSprite(req);
  }

  private drawRing(x: number, y: number, color: string, now: number, pulse: boolean): void {
    const { ctx } = this;
    const k = pulse ? 1 + Math.sin(now / 220) * 0.08 : 1;
    ctx.save();
    ctx.globalAlpha *= pulse ? 0.95 : 0.6;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(x, y, 8 * k, 3.5 * k, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /** Anel amarelo pulsando sob os pés de quem fala. */
  private drawSpeakingRing(x: number, y: number, now: number): void {
    const { ctx } = this;
    const k = 1 + Math.sin(now / 140) * 0.06;
    ctx.save();
    ctx.strokeStyle = SPEAKING_RING;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha *= 0.95;
    ctx.beginPath();
    ctx.ellipse(x, y, 9 * k, 4 * k, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /** Microfone cortado (pixel art 5×7) ao lado da cabeça. */
  private drawMicOff(x: number, y: number): void {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(18,18,18,0.85)';
    ctx.fillRect(x - 1, y - 1, 7, 9);
    ctx.fillStyle = '#e8e6ea';
    ctx.fillRect(x + 1, y, 3, 4);
    ctx.fillRect(x, y + 3, 1, 2);
    ctx.fillRect(x + 4, y + 3, 1, 2);
    ctx.fillRect(x + 1, y + 5, 3, 1);
    ctx.fillRect(x + 2, y + 6, 1, 1);
    ctx.fillStyle = '#e30b2f';
    for (let i = 0; i < 6; i++) ctx.fillRect(x + i - 0.5, y + i + 0.5, 1, 1);
  }

  private icon(name: IconName): Sprite | null {
    try {
      const s = this.art.iconSprite(name);
      if (s && s.canvas.width > 0) return s;
    } catch {
      // arte ainda sem este ícone
    }
    return null;
  }
}
