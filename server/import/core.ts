// Parte pura (e testável) da importação de usuários: mapeamento de linhas, normalização de hash e upsert.
import bcrypt from 'bcryptjs';
import type { UsersRepo } from '../db/repos/users';
import type { ImportRow } from '../db/types';

/** `$2y$` (PHP) -> `$2a$` (equivalente para o bcryptjs). */
export function normalizeHash(h: string): string {
  return h.trim().replace(/^\$2y\$/, '$2a$');
}

const BCRYPT_RE = /^\$2[abxy]\$\d{2}\$[./A-Za-z0-9]{53}$/;
export function isBcryptHash(h: string): boolean {
  return BCRYPT_RE.test(h);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PLAIN_PASSWORD = 8;
export const MAX_EXTERNAL_ID = 64;

export type MapResult = { ok: true; row: ImportRow } | { ok: false; reason: string; ref: string };

function truthy(v: unknown): boolean {
  return v === true || v === 1 || v === '1' || v === 'true';
}

/**
 * Converte um objeto do arquivo de importação em `ImportRow`.
 * Campos aceitos: `external_id` (ou `externalId`/`id`), `email`, `name`, `password_hash` (bcrypt; ou
 * `passwordHash`), `role_name` (ou `role`) e `is_admin` (ou `isAdmin`). Senha em texto puro (`password`)
 * precisa ter sido convertida em hash antes (ver `hashPlainPasswords`).
 */
export function mapRow(raw: Record<string, unknown>): MapResult {
  const idv = raw.external_id ?? raw.externalId ?? raw.id;
  const ref = String(raw.email ?? idv ?? '?');
  const external_id = idv == null ? '' : String(idv).trim();
  if (!external_id || external_id.length > MAX_EXTERNAL_ID) return { ok: false, reason: 'external_id missing or too long', ref };
  const email = String(raw.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 190) return { ok: false, reason: 'invalid e-mail', ref };
  const name = String(raw.name ?? '').trim();
  if (!name) return { ok: false, reason: 'empty name', ref };
  const hash = normalizeHash(String(raw.password_hash ?? raw.passwordHash ?? ''));
  if (!isBcryptHash(hash)) return { ok: false, reason: 'password_hash is not bcrypt', ref };
  const roleRaw = raw.role_name ?? raw.roleName ?? raw.role ?? null;
  const role_name = roleRaw == null || String(roleRaw).trim() === '' ? null : String(roleRaw).trim().slice(0, 120);
  const is_admin = truthy(raw.is_admin ?? raw.isAdmin);
  return { ok: true, row: { external_id, name: name.slice(0, 190), email, password_hash: hash, role_name, is_admin } };
}

/**
 * Linhas com `password` em texto puro (e sem `password_hash`) ganham um hash bcrypt. Senhas curtas
 * ficam sem hash e serão rejeitadas pelo `mapRow`. Não altera os objetos originais.
 */
export async function hashPlainPasswords(rows: Record<string, unknown>[], rounds = 10): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (const raw of rows) {
    const plain = raw.password;
    if (typeof plain === 'string' && plain.length >= MIN_PLAIN_PASSWORD && raw.password_hash == null && raw.passwordHash == null) {
      const { password: _omit, ...rest } = raw;
      out.push({ ...rest, password_hash: await bcrypt.hash(plain, rounds) });
    } else {
      out.push(raw);
    }
  }
  return out;
}

export type ImportAction = 'inserted' | 'updated' | 'adopted' | 'skipped';

export interface ImportItem {
  ref: string;
  external_id: string | null;
  email: string;
  action: ImportAction;
  reason?: string;
}

export interface ImportReport {
  dryRun: boolean;
  items: ImportItem[];
  counts: Record<ImportAction, number>;
}

export interface ImportOptions {
  dryRun?: boolean;
  adoptLocal?: boolean;
}

/**
 * Importa linhas via `UsersRepo`. Colisão de e-mail com conta local (external_id NULL): pula,
 * a menos que `adoptLocal`. Colisão com OUTRO external_id: pula. Em dry-run nada é escrito.
 */
export async function runImport(users: UsersRepo, rawRows: Record<string, unknown>[], opts: ImportOptions = {}): Promise<ImportReport> {
  const items: ImportItem[] = [];
  const seen = new Set<string>();
  const seenEmail = new Set<string>();
  for (const raw of rawRows) {
    const m = mapRow(raw);
    if (!m.ok) {
      items.push({ ref: m.ref, external_id: null, email: String(raw.email ?? ''), action: 'skipped', reason: m.reason });
      continue;
    }
    const r = m.row;
    const base = { ref: r.email, external_id: r.external_id, email: r.email };
    if (seen.has(r.external_id) || seenEmail.has(r.email)) {
      items.push({ ...base, action: 'skipped', reason: 'duplicate in file' });
      continue;
    }
    seen.add(r.external_id);
    seenEmail.add(r.email);

    const byId = await users.byExternalId(r.external_id);
    if (byId) {
      if (!opts.dryRun) await users.upsertImported(r);
      items.push({ ...base, action: 'updated' });
      continue;
    }
    const byMail = await users.byEmail(r.email);
    if (byMail) {
      if (byMail.external_id !== null) {
        items.push({ ...base, action: 'skipped', reason: `e-mail already belongs to external_id ${byMail.external_id}` });
      } else if (opts.adoptLocal) {
        if (!opts.dryRun) await users.adoptLocal(byMail.id, r);
        items.push({ ...base, action: 'adopted', reason: 'local account linked to external_id' });
      } else {
        items.push({ ...base, action: 'skipped', reason: 'e-mail of a local account (use --adopt-local)' });
      }
      continue;
    }
    if (!opts.dryRun) await users.upsertImported(r);
    items.push({ ...base, action: 'inserted' });
  }
  const counts: Record<ImportAction, number> = { inserted: 0, updated: 0, adopted: 0, skipped: 0 };
  for (const i of items) counts[i.action]++;
  return { dryRun: !!opts.dryRun, items, counts };
}

/** Tabela de texto para o terminal. Nunca imprime hashes. */
export function formatReport(rep: ImportReport): string {
  const lines: string[] = [];
  const w = Math.max(5, ...rep.items.map((i) => i.email.length));
  lines.push(`${'action'.padEnd(10)} ${'email'.padEnd(w)} note`);
  for (const i of rep.items) lines.push(`${i.action.padEnd(10)} ${i.email.padEnd(w)} ${i.reason ?? ''}`.trimEnd());
  const c = rep.counts;
  lines.push('');
  lines.push(`${rep.dryRun ? '[dry-run] ' : ''}inserted=${c.inserted} updated=${c.updated} adopted=${c.adopted} skipped=${c.skipped} total=${rep.items.length}`);
  return lines.join('\n');
}
