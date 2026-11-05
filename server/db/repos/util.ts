// Conversões de linha do MySQL para os tipos de domínio.

/** mysql2 já devolve JSON parseado; strings (MariaDB/LONGTEXT) são parseadas aqui. */
export function parseJson<T>(v: unknown): T | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T;
    } catch {
      return null;
    }
  }
  if (Buffer.isBuffer(v)) return parseJson<T>(v.toString('utf8'));
  return v as T;
}

export function toJson(v: unknown): string | null {
  return v === null || v === undefined ? null : JSON.stringify(v);
}

export function bool(v: unknown): boolean {
  return v === true || v === 1 || v === '1' || v === 1n;
}

export function date(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v : new Date(String(v));
}

export function num(v: unknown): number {
  return Number(v);
}

export function numOrNull(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

/** Escapa `%`, `_` e `\` para LIKE. */
export function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}
