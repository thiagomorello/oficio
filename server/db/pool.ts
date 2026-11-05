// MySQL pool (mysql2/promise) behind a small interface so tests can swap in fakes.
import { readFileSync } from 'node:fs';
import mysql from 'mysql2/promise';
import type { Pool, PoolConnection, PoolOptions } from 'mysql2/promise';

export interface ExecResult {
  affectedRows: number;
  insertId: number;
}

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string, params?: unknown[]): Promise<ExecResult>;
  /** Roda `fn` numa transação (commit/rollback automáticos). Dentro de `fn`, `tx` aninhado reaproveita a mesma. */
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface DbConfig {
  /** mysql://user:pass@host:3306/db */
  url?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  connectionLimit?: number;
  /** TLS: `required` validates the server certificate; `skip-verify` encrypts without validating (test setups). */
  ssl?: SslMode;
  /** Path to a PEM bundle with the CA(s) that signed the server certificate (private or corporate CA). Implies `required`. */
  sslCa?: string;
}

export type SslMode = 'required' | 'skip-verify';

/** `?ssl=true|1|required|skip-verify` in the URL or MYSQL_SSL with the same values (`false`/`0`/empty = no TLS). */
export function parseSslMode(v: string | null | undefined): SslMode | undefined {
  const t = (v ?? '').trim().toLowerCase();
  if (!t || t === 'false' || t === '0' || t === 'off' || t === 'disabled' || t === 'no') return undefined;
  if (t === 'skip-verify' || t === 'no-verify' || t === 'insecure') return 'skip-verify';
  return 'required';
}

/** Reads the CA bundle once; a missing or empty file is a configuration error worth failing loudly at boot. */
export function readCaBundle(path: string): string {
  let pem: string;
  try {
    pem = readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(`MYSQL_SSL_CA: cannot read ${path}: ${(err as Error).message}`);
  }
  if (!/-----BEGIN CERTIFICATE-----/.test(pem)) throw new Error(`MYSQL_SSL_CA: ${path} does not contain a PEM certificate`);
  return pem;
}

function sslOptions(mode: SslMode | undefined, caPath?: string): Pick<PoolOptions, 'ssl'> {
  if (caPath) return { ssl: { ca: readCaBundle(caPath), rejectUnauthorized: mode !== 'skip-verify' } };
  if (!mode) return {};
  return { ssl: mode === 'required' ? { rejectUnauthorized: true } : { rejectUnauthorized: false } };
}

/** Monta a config a partir de DATABASE_URL ou das variáveis MYSQL_*. */
export function dbConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DbConfig | null {
  const url = env.DATABASE_URL?.trim();
  const sslCa = env.MYSQL_SSL_CA?.trim() || undefined;
  if (url) return { url, ssl: parseSslMode(env.MYSQL_SSL), sslCa };
  const host = env.MYSQL_HOST?.trim();
  if (!host) return null;
  return {
    host,
    port: Number.parseInt(env.MYSQL_PORT ?? '', 10) || 3306,
    user: env.MYSQL_USER?.trim() || 'root',
    password: env.MYSQL_PASSWORD ?? '',
    database: env.MYSQL_DATABASE?.trim() || 'oficio',
    ssl: parseSslMode(env.MYSQL_SSL),
    sslCa,
  };
}

export function poolOptions(cfg: DbConfig): PoolOptions {
  const common: PoolOptions = {
    timezone: 'Z',
    supportBigNumbers: true,
    decimalNumbers: true,
    charset: 'utf8mb4',
    connectionLimit: cfg.connectionLimit ?? 5,
    waitForConnections: true,
    queueLimit: 0,
    dateStrings: false,
  };
  if (cfg.url) {
    const u = new URL(cfg.url);
    if (u.protocol !== 'mysql:') throw new Error(`DATABASE_URL must start with mysql:// (got ${u.protocol}//)`);
    const sslParam = u.searchParams.get('ssl') ?? u.searchParams.get('sslmode') ?? u.searchParams.get('ssl-mode');
    const caParam = u.searchParams.get('sslca') ?? u.searchParams.get('ssl-ca') ?? undefined;
    return {
      ...common,
      host: u.hostname,
      port: u.port ? Number.parseInt(u.port, 10) : 3306,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: decodeURIComponent(u.pathname.replace(/^\//, '')) || 'oficio',
      ...sslOptions(cfg.ssl ?? parseSslMode(sslParam), cfg.sslCa ?? caParam),
    };
  }
  return { ...common, host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.database, ...sslOptions(cfg.ssl, cfg.sslCa) };
}

type Queryable = Pick<Pool | PoolConnection, 'query'>;

function wrap(q: Queryable, pool: Pool | null, conn: PoolConnection | null): Db {
  const self: Db = {
    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const [rows] = await q.query(sql, params);
      return rows as T[];
    },
    async exec(sql: string, params: unknown[] = []): Promise<ExecResult> {
      const [res] = await q.query(sql, params);
      const r = res as { affectedRows?: number; insertId?: number };
      return { affectedRows: r.affectedRows ?? 0, insertId: Number(r.insertId ?? 0) };
    },
    async tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
      if (conn || !pool) return fn(self); // já dentro de uma transação
      const c = await pool.getConnection();
      const inner = wrap(c, null, c);
      try {
        await c.beginTransaction();
        const out = await fn(inner);
        await c.commit();
        return out;
      } catch (err) {
        try {
          await c.rollback();
        } catch {
          // conexão já caiu
        }
        throw err;
      } finally {
        c.release();
      }
    },
    async close(): Promise<void> {
      if (pool) await pool.end();
    },
  };
  return self;
}

export function createDb(cfg: DbConfig): Db {
  const pool = mysql.createPool(poolOptions(cfg));
  return wrap(pool, pool, null);
}
