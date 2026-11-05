// Renderiza o mapa padrão em ASCII (um caractere por tile) para conferência visual, sem DOM.
// Uso: npx tsx scripts/render-map.ts   (imprime e grava docs/mapa-padrao.txt)
//
// Legenda: '#' bloqueado · '.' livre · 's' assento · 'D' tile de passagem (porta) · '@' spawn ·
// letras maiúsculas = tiles livres de cada zona (ver a lista ao final).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { doorwayRect } from '../shared/map/assemble';
import { buildDefaultMap } from '../shared/map/default-map';
import { BLOCKED, SEAT } from '../shared/map/grid';
import { validateMap } from '../shared/map/validate';

const ZONE_CHARS = 'ABCEFGHIJKLMNOPQRTUVWXYZ'; // sem 'D' (porta) e 'S'

const doc = buildDefaultMap();
const v = validateMap(doc);
if (!v.assembly) {
  for (const e of v.errors) console.error(`ERRO ${e.code}: ${e.message}`);
  process.exit(1);
}
const as = v.assembly;
const { w, h, grid } = as;
const rows: string[][] = [];
for (let y = 0; y < h; y++) {
  const row: string[] = [];
  for (let x = 0; x < w; x++) {
    const c = grid.get(x, y);
    const z = as.zoneAt[y * w + x];
    row.push(c === BLOCKED ? '#' : c === SEAT ? 's' : z >= 0 ? ZONE_CHARS[z % ZONE_CHARS.length] : '.');
  }
  rows.push(row);
}
for (const a of doc.areas) {
  for (const d of a.doorways) {
    const r = doorwayRect(a, d);
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) rows[a.rect.y + y][a.rect.x + x] = 'D';
  }
}
for (const p of as.spawn) rows[p.y][p.x] = '@';

const ruler = (step: number) => {
  let s = '';
  for (let x = 0; x < w; x++) s += x % step === 0 ? String((x / step) % 10) : ' ';
  return s;
};
const out: string[] = [];
out.push(`Mapa padrão "${doc.name}" — ${w}×${h} tiles (gerado por scripts/render-map.ts)`);
out.push('');
out.push(`     ${ruler(10)}`);
out.push(`     ${Array.from({ length: w }, (_, x) => x % 10).join('')}`);
rows.forEach((r, y) => out.push(`${String(y).padStart(3)}  ${r.join('')}`));
out.push('');
out.push("Legenda: '#' bloqueado · '.' livre · 's' assento · 'D' passagem · '@' spawn · letras = zonas");
as.zones.forEach((z) => out.push(`  ${ZONE_CHARS[z.index % ZONE_CHARS.length]}  ${z.id} (${z.kind}${z.private ? ', privada' : ''}${z.lockable ? ', trancável' : ''}${z.capacity !== undefined ? `, ${z.capacity} lugares` : ''})`));
const seats = as.spots.filter((s) => s.seated).length;
out.push('');
out.push(`Áreas ${doc.areas.length} · zonas ${as.zones.length} · mesas ${as.desks.length} (${as.desks[0]?.code}…${as.desks[as.desks.length - 1]?.code}) · assentos ${seats} · spots ${as.spots.length} · spawn ${as.spawn.length}`);
out.push(`Validação: ${v.errors.length} erro(s), ${v.warnings.length} aviso(s)`);
for (const i of v.warnings) out.push(`  aviso ${i.code}: ${i.message}`);

const text = out.join('\n') + '\n';
process.stdout.write(text);
const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'mapa-padrao.txt');
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, text);
