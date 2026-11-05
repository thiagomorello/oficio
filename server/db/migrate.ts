// Aplica as migrações pendentes. Um lock nomeado do MySQL evita corrida entre réplicas/CLI.
// DDL no MySQL faz commit implícito, então não há transação por migração: as instruções rodam em
// sequência e a versão só é gravada no fim (uma migração interrompida é reaplicada do início).
import type { Db } from './pool';
import { MIGRATIONS, type Migration } from './migrations/index';

export interface MigrateLog {
  info(msg: string): void;
  warn(msg: string): void;
}

/** Divide em instruções: `;` no fim da linha; ignora linhas de comentário `--`. */
export function splitStatements(sql: string): string[] {
  const clean = sql
    .split('\n')
    .filter((l) => !/^\s*--/.test(l))
    .join('\n');
  return clean
    .split(/;[ \t]*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const LOCK = 'office_migrate';

export async function runMigrations(db: Db, log: MigrateLog, migrations: Migration[] = MIGRATIONS): Promise<number[]> {
  // GET_LOCK vale por conexão: tudo roda dentro de uma única conexão (tx) para segurar o lock.
  return db.tx(async (c) => {
    const got = await c.query<{ got: number | null }>('SELECT GET_LOCK(?, 30) AS got', [LOCK]);
    if (Number(got[0]?.got) !== 1) throw new Error('could not acquire the migration lock (is another instance migrating?)');
    try {
      await c.exec(
        `CREATE TABLE IF NOT EXISTS office_migrations (
           version INT UNSIGNED NOT NULL PRIMARY KEY,
           name VARCHAR(120) NOT NULL,
           applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      );
      const done = new Set((await c.query<{ version: number }>('SELECT version FROM office_migrations')).map((r) => Number(r.version)));
      const applied: number[] = [];
      for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
        if (done.has(m.version)) continue;
        log.info(`migration ${m.name}...`);
        for (const stmt of splitStatements(m.sql)) await c.exec(stmt);
        await c.exec('INSERT INTO office_migrations (version, name) VALUES (?, ?)', [m.version, m.name]);
        applied.push(m.version);
      }
      if (applied.length === 0) log.info('database is already up to date');
      return applied;
    } finally {
      try {
        await c.query('SELECT RELEASE_LOCK(?)', [LOCK]);
      } catch (err) {
        log.warn(`failed to release the migration lock: ${String(err).slice(0, 120)}`);
      }
    }
  });
}
