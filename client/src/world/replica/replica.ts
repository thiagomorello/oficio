// Réplica do mundo no cliente: transforma o estado do store (entidades + amostras) em avatares
// prontos para o desenho. Remotos: interpolados em `serverNow - atraso adaptativo` (interpolation.targetDelay). Próprio avatar:
// predição local + reconciliação. Também expõe as ações do usuário (andar, sentar, emotes, chat).
import type { Appearance, IconName } from '../../art/api';
import type { ClientMsg, ChatScope } from '../../../../shared/protocol';
import { FLAG_MOVING, FLAG_SEATED, FLAG_TP, type DeskState, type Dir, type Emote, type EntityState, type Pose, type ZoneState } from '../../../../shared/model';
import { PathFinder } from '../../../../shared/map/astar';
import { zoneAt } from '../../../../shared/map/zones';
import { TILE } from '../../../../shared/map/tile';
import type { OfficeAssembly, SpotDef } from '../../../../shared/map/types';
import type { OfficeClientStore, Sample } from '../../net/world-store';
import { USE_SPOT_KINDS } from '../../../../shared/map/spots';
import { Avatar } from './avatar';
import { nearestUseSpot } from './spots-near';
import { INTERP_DELAY_MS, renderTime, sampleAt, stepDelay, targetDelay } from './interpolation';
import { BROADCAST_MS } from '../../net/world-store';
import { Predictor } from './prediction';

/** O que o renderer e o overlay leem (somente leitura). */
export interface WorldView {
  readonly avatars: ReadonlyMap<number, Avatar>;
  readonly assembly: OfficeAssembly;
  /** Incrementa a cada troca de mapa. */
  readonly layoutVersion: number;
  /** Ocupação dos spots: spotId -> id do usuário. */
  readonly spots: ReadonlyMap<string, number>;
  /** Relógio local do frame (ms epoch). */
  readonly now: number;
  readonly self: Avatar | null;
  readonly desks: ReadonlyMap<string, DeskState>;
  readonly zones: ReadonlyMap<string, ZoneState>;
  nameOf(id: number): string;
}

export interface ReplicaDeps {
  send(msg: ClientMsg): void;
  /** Relógio do servidor estimado (ms epoch). */
  serverNow(): number;
  /** Offset servidor - cliente e RTT (ms), para comparar amostras com a predição. */
  clock(): { offset: number; rtt: number };
  appearanceFor(id: number): Appearance;
  /** Relógio local (ms); padrão Date.now. */
  now?(): number;
}

export type ReplicaEffect = { kind: 'confetti' | 'sparkle'; id: number };

/** Emotes: ícone sobre a cabeça. */
export const EMOTE_ICON: Readonly<Record<Emote, IconName>> = {
  raise_hand: 'wave',
  cheer: 'star',
  laugh: 'heart',
  stretch: 'coffee',
  sulk: 'storm',
  talk: 'chat',
};
const EMOTE_POSES = new Set<Pose>(Object.keys(EMOTE_ICON) as Pose[]);
export const CHAT_BUBBLE_MS = 6000;
const EMOTE_ICON_MS = 2200;
/** Quanto tempo o assento largado é ignorado se o servidor não confirmar a saída. */
const LEAVE_GRACE_MS = 3000;

/** Converte x/y de `ack`/`moved_reject` para px: inteiros = tile (pés no ponto padrão); frações = unidades de entidade. */
export function protocolPointToPx(x: number, y: number): { x: number; y: number } {
  if (Number.isInteger(x) && Number.isInteger(y)) return { x: x * TILE + TILE / 2, y: y * TILE + 11 };
  return { x: x * TILE, y: y * TILE };
}

/** Índice dos assentos por posição (px) — os deltas não trazem o id do assento. */
class SeatIndex {
  private readonly buckets = new Map<string, SpotDef[]>();
  constructor(spots: readonly SpotDef[]) {
    for (const s of spots) {
      if (!s.seated) continue;
      const k = `${Math.floor(s.x / 8)},${Math.floor(s.y / 8)}`;
      let b = this.buckets.get(k);
      if (!b) this.buckets.set(k, (b = []));
      b.push(s);
    }
  }

  near(x: number, y: number, max = 3): SpotDef | null {
    const bx = Math.floor(x / 8);
    const by = Math.floor(y / 8);
    let best: SpotDef | null = null;
    let bd = max * max + 0.001;
    for (let j = by - 1; j <= by + 1; j++) {
      for (let i = bx - 1; i <= bx + 1; i++) {
        for (const s of this.buckets.get(`${i},${j}`) ?? []) {
          const d = (s.x - x) ** 2 + (s.y - y) ** 2;
          if (d < bd) {
            bd = d;
            best = s;
          }
        }
      }
    }
    return best;
  }
}

export class Replica implements WorldView {
  readonly avatars = new Map<number, Avatar>();
  readonly spots = new Map<string, number>();
  assembly: OfficeAssembly;
  layoutVersion = 0;
  now = 0;
  self: Avatar | null = null;
  readonly predictor: Predictor;
  /** Efeitos pedidos ao renderer (consumidos por ele a cada frame). */
  readonly effects: ReplicaEffect[] = [];
  /** Assento pedido por clique longe: senta ao chegar. */
  pendingSit: string | null = null;
  private finder: PathFinder;
  private seats: SeatIndex;
  private readonly lastPose = new Map<number, Pose>();
  private readonly offs: (() => void)[] = [];
  private readonly localNow: () => number;

  constructor(
    private readonly store: OfficeClientStore,
    assembly: OfficeAssembly,
    private readonly deps: ReplicaDeps,
  ) {
    this.assembly = assembly;
    this.finder = new PathFinder(assembly.grid);
    this.seats = new SeatIndex(assembly.spots);
    this.localNow = deps.now ?? (() => Date.now());
    this.predictor = new Predictor({
      grid: () => this.assembly.grid,
      finder: () => this.finder,
      send: (m) => this.deps.send(m),
      now: this.localNow,
    });
    this.offs.push(
      store.on('reset', (ev) => this.rebuild(ev.reason)),
      store.on('entity', (e) => {
        if (e.id === store.selfId) this.onSelfSample(e.tp);
      }),
      store.on('leave', (id) => this.removeAvatar(id)),
      store.on('ack', (m) => {
        if (m.seq !== this.predictor.moveToSeq || m.seq !== this.predictor.seq || !this.predictor.path) return;
        const goal = protocolPointToPx(m.x, m.y);
        const path = this.predictor.path.path;
        const end = { x: path[path.length - 2] * TILE + TILE / 2, y: path[path.length - 1] * TILE + 11 };
        if (Math.abs(end.x - goal.x) > 1 || Math.abs(end.y - goal.y) > 1) this.predictor.replan(Math.floor(goal.x / TILE), Math.floor(goal.y / TILE));
      }),
      store.on('reject', (m) => {
        this.pendingSit = null;
        if (m.seq === undefined) return; // recusa de sentar/trancar: não é movimento, não puxa o avatar
        const p = protocolPointToPx(m.x, m.y);
        this.predictor.reject(p.x, p.y);
      }),
      store.on('chat', (m) => {
        const a = this.avatars.get(m.from);
        if (a) a.say(m.text, CHAT_BUBBLE_MS, this.localNow());
      }),
      store.on('appearance', (id) => {
        const a = this.avatars.get(id);
        if (!a) return;
        // o cache de sprites é por conteúdo da aparência: trocar o objeto basta
        a.appearance = this.deps.appearanceFor(id);
        a.user = store.nameOf(id);
      }),
      store.on('user', (id) => {
        const a = this.avatars.get(id);
        if (a) a.user = store.nameOf(id);
      }),
    );
    this.rebuild();
  }

  get desks(): ReadonlyMap<string, DeskState> {
    return this.store.desks;
  }

  get zones(): ReadonlyMap<string, ZoneState> {
    return this.store.zones;
  }

  nameOf(id: number): string {
    return this.store.nameOf(id);
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
  }

  /** Troca de mapa (`{t:'map'}` + GET /api/map). */
  setAssembly(a: OfficeAssembly): void {
    this.assembly = a;
    this.finder = new PathFinder(a.grid);
    this.seats = new SeatIndex(a.spots);
    this.layoutVersion++;
    this.pendingSit = null;
    this.predictor.stop();
    for (const av of this.avatars.values()) av.spot = null;
  }

  // ------------------------------------------------------------------ ações do usuário

  moveTo(tx: number, ty: number, run = false): boolean {
    this.pendingSit = null;
    return this.predictor.moveTo(tx, ty, run);
  }

  setDir(dir: Dir | null, run = false): void {
    if (dir) this.pendingSit = null;
    this.predictor.setDir(dir, run);
  }

  /** Senta no spot (perto: na hora; longe: anda até ele e senta ao chegar). */
  sit(spotId: string, run = false): boolean {
    const spot = this.assembly.spotById.get(spotId);
    const me = this.self;
    if (!spot || !spot.seated || !me) return false;
    const occupant = this.spots.get(spotId);
    if (occupant !== undefined && occupant !== me.id) return false;
    if (Math.max(Math.abs(spot.tx - this.predictor.m.tx), Math.abs(spot.ty - this.predictor.m.ty)) <= 1) {
      this.pendingSit = null;
      this.predictor.stop();
      this.deps.send({ t: 'sit', spot: spotId });
      this.backTo(spotId);
      return true;
    }
    if (!this.predictor.moveTo(spot.tx, spot.ty, run)) return false;
    this.pendingSit = spotId;
    return true;
  }

  /**
   * Usa um spot (café, bebedouro, pia, banheiro, arcade, pingue-pongue, estante, quadro).
   * Perto: manda `use` na hora; longe: planeja o caminho local e manda `use` já (o servidor anda
   * e usa ao chegar). Devolve false se o spot não é de uso, está ocupado por outro ou sem caminho.
   */
  use(spotId: string, run = false): boolean {
    const spot = this.assembly.spotById.get(spotId);
    const me = this.self;
    if (!spot || !USE_SPOT_KINDS.has(spot.kind) || !me) return false;
    const occupant = this.spots.get(spotId);
    if (occupant !== undefined && occupant !== me.id) return false;
    this.pendingSit = null;
    if (Math.max(Math.abs(spot.tx - this.predictor.m.tx), Math.abs(spot.ty - this.predictor.m.ty)) <= 1) {
      this.predictor.stop();
      this.deps.send({ t: 'use', spot: spotId });
      this.backTo(spotId);
      return true;
    }
    if (!this.predictor.moveTo(spot.tx, spot.ty, run)) return false;
    this.pendingSit = 'use:' + spotId;
    return true;
  }

  /** Spot de uso livre (ou meu) mais próximo do próprio avatar (Chebyshev ≤ `max`), ou null. */
  nearestUse(max = 1): SpotDef | null {
    const me = this.self;
    if (!me) return null;
    const p = this.predictor.m;
    const s = nearestUseSpot(this.assembly, p.tx, p.ty, max);
    if (!s) return null;
    const occ = this.spots.get(s.id);
    return occ !== undefined && occ !== me.id ? null : s;
  }

  stand(): void {
    this.pendingSit = null;
    this.deps.send({ t: 'stand' });
  }

  emote(e: Emote): void {
    this.deps.send({ t: 'emote', emote: e });
  }

  chat(text: string, scope: ChatScope = 'near'): boolean {
    const t = text.trim();
    if (!t) return false;
    this.deps.send({ t: 'chat', scope, text: t.slice(0, 1000) });
    return true;
  }

  /** Assento livre mais próximo do próprio avatar (Chebyshev ≤ `max` tiles), ou null. */
  nearestSeat(max = 1): SpotDef | null {
    const me = this.self;
    if (!me) return null;
    const tx = this.predictor.m.tx;
    const ty = this.predictor.m.ty;
    let best: SpotDef | null = null;
    let bd = Infinity;
    for (const s of this.assembly.spots) {
      if (!s.seated) continue;
      const cheb = Math.max(Math.abs(s.tx - tx), Math.abs(s.ty - ty));
      if (cheb > max) continue;
      const occ = this.spots.get(s.id);
      if (occ !== undefined && occ !== me.id) continue;
      const d = (s.x - me.x) ** 2 + (s.y - me.y) ** 2;
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ frame

  /** Atraso de desenho dos remotos (ms), adaptado à latência medida. */
  interpDelay = INTERP_DELAY_MS;

  update(dt: number, now: number): void {
    this.now = now;
    const store = this.store;
    this.interpDelay = stepDelay(this.interpDelay, targetDelay(store.arrivalLags, BROADCAST_MS), dt * 1000);
    const rt = renderTime(this.deps.serverNow(), this.interpDelay);
    const selfId = store.selfId;
    for (const id of this.avatars.keys()) if (!store.entities.has(id)) this.removeAvatar(id);
    this.spots.clear();
    for (const [id, ent] of store.entities) {
      let a = this.avatars.get(id);
      if (!a) a = this.addAvatar(id, id === selfId);
      const buf = store.samples.get(id) ?? [];
      const last = buf[buf.length - 1];
      if (a.self) this.updateSelf(a, dt, last);
      else {
        const s = sampleAt(buf, rt);
        if (s) {
          a.x = s.x;
          a.y = s.y;
          a.dir = s.dir;
          a.setPose(s.pose, ent.held);
          a.moving = s.moving;
          a.run = s.run;
          a.seated = s.seated;
        }
      }
      a.syncTile();
      if (a.self) {
        const own = this.selfSpots(ent, this.localNow());
        this.resolveSeat(a, own.seat, own.using);
      } else this.resolveSeat(a, ent.seat, ent.using);
      if (a.spot) this.spots.set(a.spot, id);
      a.zone = zoneAt(this.assembly, a.tx, a.ty)?.id ?? null;
      a.speaking = store.speaking.has(id);
      const media = store.media.get(id);
      a.mic = media ? media.mic : null;
      a.status = store.users.get(id)?.status ?? 'available';
      a.ghost = store.ghosts.has(id);
      a.alpha = a.ghost ? 0.45 : 1;
      this.detectEmote(a, now);
      a.tick(dt, now);
    }
  }

  private lastPosSent = 0;
  private wasMoving = false;
  /**
   * Assento/spot de uso que o próprio avatar largou andando. Até o servidor confirmar (estado sem
   * esse spot), o `seat`/`using` antigo e a flag de sentado das amostras são ignorados: senão cada
   * parada antes da confirmação puxava o avatar de volta para o assento (loop "não consigo sair").
   */
  private leaving: { seat: string | null; using: string | null; until: number } | null = null;

  /** Pediu de novo o spot que estava largando: volta a valer o estado do servidor. */
  private backTo(spotId: string): void {
    if (this.leaving && (this.leaving.seat === spotId || this.leaving.using === spotId)) this.leaving = null;
  }

  /** `seat`/`using` do próprio avatar, sem o spot que ele acabou de largar. */
  private selfSpots(ent: EntityState | undefined, now: number): { seat?: string; using?: string } {
    const lv = this.leaving;
    if (lv) {
      const still = (lv.seat !== null && ent?.seat === lv.seat) || (lv.using !== null && ent?.using === lv.using);
      if (!still || now > lv.until) this.leaving = null;
    }
    const cur = this.leaving;
    return {
      seat: cur && ent?.seat === cur.seat ? undefined : ent?.seat,
      using: cur && ent?.using === cur.using ? undefined : ent?.using,
    };
  }

  private updateSelf(a: Avatar, dt: number, last: Sample | undefined): void {
    const p = this.predictor;
    p.update(dt);
    // Posição ditada pelo cliente: 20×/s andando e uma vez ao parar (o servidor só valida).
    const now = this.localNow();
    const ent = this.store.entities.get(a.id);
    if (p.active && !this.leaving && (ent?.seat || ent?.using)) this.leaving = { seat: ent.seat ?? null, using: ent.using ?? null, until: now + LEAVE_GRACE_MS };
    const own = this.selfSpots(ent, now);
    const stopped = this.wasMoving && !p.active;
    if ((p.active && now - this.lastPosSent >= 50) || stopped) {
      this.lastPosSent = now;
      this.deps.send({ t: 'pos', x: Math.round(p.m.x * 100) / 100, y: Math.round(p.m.y * 100) / 100, dir: p.m.dir, moving: p.active, run: p.active && p.run ? true : undefined });
    }
    this.wasMoving = p.active;
    if (stopped) {
      if (this.pendingSit) {
        const pend = this.pendingSit;
        this.pendingSit = null;
        const isUse = pend.startsWith('use:');
        const spot = this.assembly.spotById.get(isUse ? pend.slice(4) : pend);
        if (spot && Math.max(Math.abs(spot.tx - p.m.tx), Math.abs(spot.ty - p.m.ty)) <= 1) {
          this.deps.send(isUse ? { t: 'use', spot: spot.id } : { t: 'sit', spot: spot.id });
          this.backTo(spot.id);
        }
      } else {
        // parou em cima de uma cadeira livre: senta
        const seat = this.assembly.spots.find((s) => s.seated && s.tx === p.m.tx && s.ty === p.m.ty);
        const occ = seat ? this.spots.get(seat.id) : undefined;
        if (seat && (occ === undefined || occ === a.id)) {
          this.deps.send({ t: 'sit', spot: seat.id });
          this.backTo(seat.id);
        }
      }
    }
    a.x = p.m.x;
    a.y = p.m.y;
    a.dir = p.m.dir;
    if (p.moving) {
      a.setPose(p.run ? 'run' : 'walk', ent?.held ?? 'none');
      a.moving = true;
      a.run = p.run;
      a.seated = false;
    } else {
      a.moving = false;
      a.run = false;
      // Sentado/pose: o `state` do servidor (entities) é a fonte; os deltas só trazem posição.
      const seatedSrv = !!own.seat;
      const usingSpot = own.using ? this.assembly.spotById.get(own.using) : undefined;
      // Largando o assento: pose/flag das amostras ainda são as de sentado.
      const lastPose = this.leaving ? undefined : last?.pose;
      const pose = (seatedSrv || usingSpot ? ent?.pose : undefined) ?? lastPose ?? (this.leaving ? 'stand' : ent?.pose) ?? 'stand';
      a.setPose(pose === 'walk' || pose === 'run' ? 'stand' : pose, this.leaving && !usingSpot ? 'none' : (ent?.held ?? 'none'));
      a.seated = seatedSrv || (!this.leaving && !!last && (last.flags & FLAG_SEATED) !== 0);
      if (a.seated && ent) {
        const spot = own.seat ? this.assembly.spotById.get(own.seat) : undefined;
        if (spot) {
          a.x = spot.x;
          a.y = spot.y;
          a.dir = spot.dir;
          if (!p.correcting) p.follow(spot.x, spot.y);
        }
      } else if (usingSpot) {
        a.x = usingSpot.x;
        a.y = usingSpot.y;
        a.dir = usingSpot.dir;
        if (!p.correcting) p.follow(usingSpot.x, usingSpot.y);
      } else if (last && !p.correcting && a.pose !== 'stand') a.dir = last.dir;
    }
  }

  /** Amostra nova do próprio avatar: reconcilia a predição. */
  private onSelfSample(tp: boolean): void {
    const id = this.store.selfId;
    if (id === null) return;
    const buf = this.store.samples.get(id);
    const last = buf?.[buf.length - 1];
    if (!last) return;
    const p = this.predictor;
    if (tp || last.flags & FLAG_TP) {
      p.stop();
      this.pendingSit = null;
      p.reset(last.x, last.y, last.dir);
      return;
    }
    if (last.flags & FLAG_SEATED && !p.active && !this.leaving) {
      p.follow(last.x, last.y);
      return;
    }
    // Cliente autoritativo: a posição local manda; o servidor só corrige por teleporte (recusa).
  }

  private resolveSeat(a: Avatar, seatId: string | undefined, usingId?: string): void {
    const useSpot = !a.seated && usingId && !a.moving ? this.assembly.spotById.get(usingId) : undefined;
    a.using = useSpot?.id ?? null;
    if (useSpot) {
      // Em uso: encaixa no spot (remotos também), olhando para `dir`, e ordena pela base do spot.
      a.x = useSpot.x;
      a.y = useSpot.y;
      a.dir = useSpot.dir;
      a.spot = useSpot.id;
      a.sortY = useSpot.sortY ?? null;
      return;
    }
    if (!a.seated) {
      a.spot = null;
      a.sortY = null;
      return;
    }
    let spot = seatId ? this.assembly.spotById.get(seatId) : undefined;
    if (!spot && a.spot) {
      const cur = this.assembly.spotById.get(a.spot);
      if (cur && Math.abs(cur.x - a.x) <= 3 && Math.abs(cur.y - a.y) <= 3) spot = cur;
    }
    spot ??= this.seats.near(a.x, a.y) ?? undefined;
    a.spot = spot?.id ?? null;
    a.sortY = spot?.sortY ?? null;
  }

  private detectEmote(a: Avatar, now: number): void {
    const prev = this.lastPose.get(a.id);
    if (prev === a.pose) return;
    this.lastPose.set(a.id, a.pose);
    if (prev === undefined || !EMOTE_POSES.has(a.pose)) return;
    a.setIcon(EMOTE_ICON[a.pose as Emote], EMOTE_ICON_MS, now);
    if (a.pose === 'cheer') this.effects.push({ kind: 'confetti', id: a.id });
  }

  /** `keepPrediction`: próprio avatar recriado num `state` — nasce onde a predição está, sem resetá-la. */
  private addAvatar(id: number, self: boolean, keepPrediction = false): Avatar {
    const a = new Avatar(id, this.store.nameOf(id), this.deps.appearanceFor(id), self);
    const buf = this.store.samples.get(id);
    const last = buf?.[buf.length - 1];
    if (self && keepPrediction) {
      const p = this.predictor.m;
      a.x = p.x;
      a.y = p.y;
      a.dir = p.dir;
      if (last) a.pose = last.pose;
    } else if (last) {
      a.x = last.x;
      a.y = last.y;
      a.dir = last.dir;
      a.pose = last.pose;
    }
    a.syncTile();
    this.avatars.set(id, a);
    if (self) {
      this.self = a;
      if (!keepPrediction) this.predictor.reset(a.x, a.y, a.dir);
    }
    return a;
  }

  private removeAvatar(id: number): void {
    this.avatars.delete(id);
    this.lastPose.delete(id);
    if (this.self?.id === id) this.self = null;
  }

  /**
   * Recomeça a partir do estado do store (welcome/state). O `state` chega para todos sempre que alguém
   * senta/levanta ou muda zona/mesa: nele o próprio avatar mantém a predição (posição local manda),
   * senão cada `state` parava a tecla segurada e puxava o avatar para a posição atrasada do servidor.
   * Só welcome, troca de usuário ou teleporte do servidor (FLAG_TP) reposicionam.
   */
  private rebuild(reason?: string): void {
    const selfId = this.store.selfId;
    const buf = selfId === null ? undefined : this.store.samples.get(selfId);
    const tp = !!buf?.length && (buf[buf.length - 1].flags & FLAG_TP) !== 0;
    const keepSelf = reason === 'state' && !tp && this.self !== null && this.self.id === selfId && this.store.entities.has(selfId);
    this.avatars.clear();
    this.lastPose.clear();
    this.self = null;
    if (!keepSelf) {
      this.pendingSit = null;
      this.leaving = null;
      this.predictor.stop();
    }
    for (const id of this.store.entities.keys()) this.addAvatar(id, id === selfId, keepSelf);
  }
}
