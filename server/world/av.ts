// Conjunto audível por usuário (WP8, lado do servidor): depois de ticks em que alguém mudou de
// tile/zona, recalcula `audibleSet`/`volumeFor` e manda `av_set` só quando mudou, no máximo 4×/s
// por usuário (o excedente fica pendente e sai no primeiro tick permitido).
import { audibleSet, volumeFor, zoneAt, type Person } from '../../shared/map/zones';
import type { OfficeAssembly } from '../../shared/map/types';
import type { ServerMsg } from '../../shared/protocol';
import type { ScreenControl } from '../livekit/control';

export const AV_MIN_INTERVAL_MS = 250;
export const VOLUME_STEP = 0.05;

export interface AvPerson {
  id: number;
  tx: number;
  ty: number;
  /** Pés em px de mundo. */
  x: number;
  y: number;
}

export type AvSetMsg = Extract<ServerMsg, { t: 'av_set' }>;

export function quantizeVolume(v: number): number {
  const q = Math.round(v / VOLUME_STEP) * VOLUME_STEP;
  return Math.max(0, Math.min(1, Math.round(q * 100) / 100));
}

/** `av_set` de `self` dado o mundo (puro; usado pelo gerenciador e pelos testes). */
export function computeAvSet(assembly: OfficeAssembly, self: AvPerson, all: readonly AvPerson[]): AvSetMsg {
  const toPerson = (p: AvPerson): Person => ({ id: String(p.id), tx: p.tx, ty: p.ty, x: p.x, y: p.y });
  const me = toPerson(self);
  const people = all.map(toPerson);
  const ids = audibleSet(me, people, assembly);
  const hear = [...ids].map(Number).sort((a, b) => a - b);
  const volumes: Record<string, number> = {};
  for (const p of people) if (ids.has(p.id)) volumes[p.id] = quantizeVolume(volumeFor(me, p, assembly));
  const z = zoneAt(assembly, self.tx, self.ty);
  // A audição é simétrica: quem eu ouço é exatamente quem pode me ouvir.
  return { t: 'av_set', hear, allow: [...hear], volumes, screenAllowed: true }; // tela em qualquer lugar (quem ouve, vê)
}

interface Sent {
  key: string;
  at: number;
  screen: boolean | null;
}

export class AvManager {
  private sent = new Map<number, Sent>();
  private pending = new Set<number>();

  constructor(
    private readonly opts: {
      send: (userId: number, msg: AvSetMsg) => void;
      now: () => number;
      screen?: ScreenControl | null;
    },
  ) {}

  /**
   * Chamado a cada tick com as pessoas conectadas. `changed` = alguém mudou de tile/zona/entrou/saiu.
   * Sem mudança, só reprocessa quem ficou pendente pelo limite de taxa.
   */
  update(assembly: OfficeAssembly, people: readonly AvPerson[], changed: boolean): void {
    if (!changed && this.pending.size === 0) return;
    const now = this.opts.now();
    for (const p of people) {
      if (!changed && !this.pending.has(p.id)) continue;
      const msg = computeAvSet(assembly, p, people);
      const key = JSON.stringify([msg.hear, msg.volumes, msg.screenAllowed]);
      let s = this.sent.get(p.id);
      if (!s) this.sent.set(p.id, (s = { key: '', at: -Infinity, screen: null }));
      if (s.screen !== msg.screenAllowed) {
        // A primeira avaliação só registra (o token já nasce sem tela); depois, cada troca vai ao SFU.
        if (s.screen !== null || msg.screenAllowed) this.opts.screen?.setScreenAllowed(p.id, msg.screenAllowed);
        s.screen = msg.screenAllowed;
      }
      if (key === s.key) {
        this.pending.delete(p.id);
        continue;
      }
      if (now - s.at < AV_MIN_INTERVAL_MS) {
        this.pending.add(p.id);
        continue;
      }
      s.key = key;
      s.at = now;
      this.pending.delete(p.id);
      this.opts.send(p.id, msg);
    }
    for (const id of this.pending) if (!people.some((p) => p.id === id)) this.pending.delete(id);
  }

  /** Esquece o usuário (desconectou): a próxima conexão recebe um `av_set` novo. */
  remove(userId: number): void {
    this.sent.delete(userId);
    this.pending.delete(userId);
  }
}
