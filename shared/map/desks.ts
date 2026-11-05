// Mesas de trabalho reivindicáveis derivadas do mapa: cada `desk`/`desk_back` com uma cadeira de
// escritório encaixada (spot `desk` com `deskId`). Ids estáveis "<areaId>#<furnitureId>".
import type { OfficeMapDoc } from './doc';
import { FURNITURE } from './furniture';
import { absId } from './spots';
import { TILE } from './tile';
import type { DeskDef, OfficeAssembly, SpotDef } from './types';

/** Iniciais do nome da área ("Sala Amarela" -> "SA"); sem letras, o começo do id. */
export function areaInitials(name: string, id: string): string {
  const words = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const s = words
    .slice(0, 3)
    .map((w) => w[0].toUpperCase())
    .join('');
  return s || id.slice(0, 2).toUpperCase();
}

/**
 * Deriva as mesas. `spots` são os spots já derivados (ver `deriveSpots`); a primeira cadeira que
 * aponta para uma mesa é a dela. Código = `${area.code ?? iniciais}-NN`, NN por (ly, lx) na área.
 */
export function deriveDesks(input: { doc: OfficeMapDoc; spots: readonly SpotDef[] }): DeskDef[] {
  const chairOf = new Map<string, SpotDef>();
  for (const s of input.spots) if (s.kind === 'desk' && s.deskId && !chairOf.has(s.deskId)) chairOf.set(s.deskId, s);
  const out: DeskDef[] = [];
  for (const area of input.doc.areas) {
    const prefix = area.code ?? areaInitials(area.name, area.id);
    const list = area.furniture
      .filter((f) => (f.kind === 'desk' || f.kind === 'desk_back') && chairOf.has(absId(area.id, f.id)))
      .sort((a, b) => a.ly - b.ly || a.lx - b.lx);
    list.forEach((f, i) => {
      const id = absId(area.id, f.id);
      const chair = chairOf.get(id)!;
      const kind = f.kind as 'desk' | 'desk_back';
      const tx = area.rect.x + f.lx;
      const ty = area.rect.y + f.ly;
      const dx = f.dx ?? 0;
      const code = `${prefix}-${String(i + 1).padStart(2, '0')}`;
      const w = FURNITURE[kind].footprint.w;
      out.push({
        id,
        code,
        label: input.doc.deskLabels?.[id] ?? code,
        areaId: area.id,
        furnitureId: id,
        chairId: chair.furnitureId ?? '',
        spotId: chair.id,
        side: kind === 'desk' ? 'S' : 'N',
        kind,
        tx,
        ty,
        dx,
        // desk (S): borda frontal (sul) do tampo, sobre quem senta de costas; desk_back (N): borda norte.
        plate: { x: tx * TILE + (w * TILE) / 2 + dx, y: kind === 'desk' ? (ty + 1) * TILE - 2 : ty * TILE + 3 },
      });
    });
  }
  return out;
}

/** "x,y" -> deskId para os tiles da mesa e da cadeira. */
export function deskTileIndex(desks: readonly DeskDef[], spotById: ReadonlyMap<string, SpotDef>): Map<string, string> {
  const m = new Map<string, string>();
  for (const d of desks) {
    const w = FURNITURE[d.kind].footprint.w;
    for (let i = 0; i < w; i++) m.set(`${d.tx + i},${d.ty}`, d.id);
    const s = spotById.get(d.spotId);
    if (s) m.set(`${s.tx},${s.ty}`, d.id);
  }
  return m;
}

/** Mesa no tile (mesa ou cadeira), ou null. */
export function deskAtTile(assembly: Pick<OfficeAssembly, 'deskAtTile' | 'deskById'>, tx: number, ty: number): DeskDef | null {
  const id = assembly.deskAtTile.get(`${tx},${ty}`);
  return id ? (assembly.deskById.get(id) ?? null) : null;
}
