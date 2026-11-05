// Lógica pura da lista de participantes: linhas, ordenação e busca.
import type { UserPublic, UserStatus, ZoneState } from '../../../shared/model';
import { getLocale, t, type MessageKey } from '../i18n';

export interface ParticipantRow {
  id: number;
  name: string;
  role: string | null;
  status: UserStatus;
  zoneId: string | null;
  self: boolean;
  /** Conexão caiu, mas a entidade ainda está no mundo. */
  ghost: boolean;
  mic: boolean;
  cam: boolean;
}

const STATUS_ORDER: Record<UserStatus, number> = { available: 0, busy: 1, dnd: 2, away: 3 };

const STATUS_KEY: Record<UserStatus, MessageKey> = { available: 'shell.status.available', busy: 'shell.status.busy', away: 'shell.status.away', dnd: 'shell.status.dnd' };

/** Rótulo do status, no idioma atual. */
export function statusLabel(s: UserStatus): string {
  return t(STATUS_KEY[s]);
}

/** Tira acentos e caixa para comparar buscas. */
export function foldText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export interface RowSources {
  users: ReadonlyMap<number, UserPublic>;
  /** Quem está no mundo (online). */
  online: Iterable<number>;
  zones: Iterable<ZoneState>;
  ghosts: ReadonlySet<number>;
  media: ReadonlyMap<number, { mic: boolean; cam: boolean }>;
  selfId: number | null;
}

/** Linhas dos usuários online (entidades presentes). */
export function buildRows(src: RowSources): ParticipantRow[] {
  const zoneOf = new Map<number, string>();
  for (const z of src.zones) for (const m of z.members) zoneOf.set(m, z.id);
  const rows: ParticipantRow[] = [];
  for (const id of src.online) {
    const u = src.users.get(id);
    if (!u) continue;
    const media = src.media.get(id);
    rows.push({
      id,
      name: u.name,
      role: u.role,
      status: u.status,
      zoneId: zoneOf.get(id) ?? null,
      self: id === src.selfId,
      ghost: src.ghosts.has(id),
      mic: media?.mic ?? false,
      cam: media?.cam ?? false,
    });
  }
  return rows;
}

/** Você primeiro, depois por disponibilidade e nome. */
export function sortRows(rows: readonly ParticipantRow[]): ParticipantRow[] {
  return [...rows].sort((a, b) => {
    if (a.self !== b.self) return a.self ? -1 : 1;
    if (a.ghost !== b.ghost) return a.ghost ? 1 : -1;
    const s = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    return s || a.name.localeCompare(b.name, getLocale(), { sensitivity: 'base' });
  });
}

/** Filtra por nome, cargo ou nome da sala. */
export function filterRows(rows: readonly ParticipantRow[], query: string, zoneName: (id: string) => string | undefined): ParticipantRow[] {
  const q = foldText(query);
  if (!q) return [...rows];
  return rows.filter((r) => foldText(`${r.name} ${r.role ?? ''} ${r.zoneId ? (zoneName(r.zoneId) ?? '') : ''}`).includes(q));
}
