// Avatar de um usuário no mundo replicado: o que o renderer e o overlay leem a cada frame.
// Versão enxuta do `Character` da sim antiga (sem comportamento/IA): posição, pose, animação,
// faixa lateral, ícone, balões e marcadores de presença/A/V.
import type { Appearance, Dir, HeldItem, IconName, Pose } from '../../art/api';
import type { UserStatus } from '../../../../shared/model';
import { FOOT_DX, FOOT_DY, TILE } from '../../../../shared/map/tile';

export class Avatar {
  /** Id do usuário. */
  readonly id: number;
  /** Nome exibido. */
  user: string;
  appearance: Appearance;

  // posição (px de mundo; pés) e tile lógico
  x = 0;
  y = 0;
  tx = 0;
  ty = 0;
  dir: Dir = 'down';
  pose: Pose = 'stand';
  held: HeldItem = 'none';
  /** Andando/correndo segundo o servidor (ou a predição, no próprio avatar). */
  moving = false;
  run = false;
  seated = false;
  /** Profundidade forçada (assentos). null = usa y. */
  sortY: number | null = null;
  alpha = 1;
  /** Tempo (ms) na pose atual (frame da animação). */
  animT = 0;
  /** Faixa lateral (px) ao andar: dois avatares no mesmo caminho não se sobrepõem. */
  readonly lane: number;
  offX = 0;
  offY = 0;

  // marcadores
  icon: IconName | null = null;
  iconUntil = 0;
  iconAt = 0;
  bubbleText: string | null = null;
  bubbleIcon = '';
  bubbleAt = 0;
  bubbleUntil = 0;
  /** Fala curta (chat) sobre a cabeça. */
  sayText = '';
  sayAt = 0;
  sayUntil = 0;

  // presença e A/V
  speaking = false;
  /** Microfone ligado (null = desconhecido: não desenha o ícone de mudo). */
  mic: boolean | null = null;
  status: UserStatus = 'available';
  /** Conexão caiu; a entidade continua no mundo por um tempo. */
  ghost = false;
  /** Zona em que está (id) ou null. */
  zone: string | null = null;
  /** Spot onde está sentado/encaixado (id) ou null. */
  spot: string | null = null;
  /** Spot de uso (café, pia, arcade...) em que está, ou null. */
  using: string | null = null;
  /** O próprio usuário. */
  readonly self: boolean;

  constructor(id: number, user: string, appearance: Appearance, self = false) {
    this.id = id;
    this.user = user;
    this.appearance = appearance;
    this.self = self;
    // faixa determinística por id (−3..3 px)
    const h = Math.imul(id ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
    this.lane = Math.round(((h % 1000) / 1000) * 7 - 3.5);
  }

  /** Aproxima o deslocamento visual da faixa (andando) ou do centro (parado). */
  updateLane(dt: number): void {
    const walking = this.pose === 'walk' || this.pose === 'run';
    const horiz = this.dir === 'left' || this.dir === 'right';
    const tx = walking && !horiz && !this.self ? this.lane : 0;
    const ty = walking && horiz && !this.self ? this.lane * 0.6 : 0;
    const k = Math.min(1, dt * 5);
    this.offX += (tx - this.offX) * k;
    this.offY += (ty - this.offY) * k;
    if (Math.abs(this.offX) < 0.05) this.offX = 0;
    if (Math.abs(this.offY) < 0.05) this.offY = 0;
  }

  /** Coloca os pés no ponto padrão de um tile. */
  placeAtTile(tx: number, ty: number): void {
    this.tx = tx;
    this.ty = ty;
    this.x = tx * TILE + FOOT_DX;
    this.y = ty * TILE + FOOT_DY;
  }

  /** Atualiza o tile lógico a partir da posição dos pés. */
  syncTile(): void {
    this.tx = Math.round((this.x - FOOT_DX) / TILE);
    this.ty = Math.round((this.y - FOOT_DY) / TILE);
  }

  setPose(pose: Pose, held: HeldItem = this.held): void {
    if (this.pose !== pose) {
      this.pose = pose;
      this.animT = 0;
    }
    this.held = held;
  }

  setIcon(icon: IconName | null, ms: number, now: number): void {
    this.icon = icon;
    this.iconAt = now;
    this.iconUntil = icon ? now + ms : 0;
  }

  showBubble(icon: string, text: string, ms: number, now: number): void {
    this.bubbleIcon = icon;
    this.bubbleText = text;
    this.bubbleAt = now;
    this.bubbleUntil = now + ms;
  }

  say(text: string, ms: number, now: number): void {
    this.sayText = text;
    this.sayAt = now;
    this.sayUntil = now + ms;
  }

  /** Expira ícone e balões vencidos. */
  tick(dt: number, now: number): void {
    this.animT += dt * 1000;
    if (this.icon && now >= this.iconUntil) this.icon = null;
    if (this.bubbleText && now >= this.bubbleUntil) this.bubbleText = null;
    if (this.sayText && now >= this.sayUntil) this.sayText = '';
    this.updateLane(dt);
  }

  depth(): number {
    return this.sortY ?? this.y;
  }
}
