// Implementação dos comandos da CLI. Recebe dependências por parâmetro para ser testável com os repos fake.
import bcrypt from 'bcryptjs';
import { dbConfigFromEnv, createDb, type Db } from './db/pool';
import { runMigrations } from './db/migrate';
import { createMysqlRepos, type Repos } from './db/repos/index';
import { generateTempPassword, UsageError, type CliArgs } from './cli-args';
import { formatReport, hashPlainPasswords, runImport } from './import/core';
import { readImportJson } from './import/json';
import { errMsg, log } from './log';

export interface CliDeps {
  repos?: Repos;
  /** Presente só com banco real (migrate). */
  db?: Db;
  out(line: string): void;
  env: NodeJS.ProcessEnv;
}

const MIN_PASSWORD = 8;

export async function runCommand(args: CliArgs, deps: CliDeps): Promise<number> {
  const { out } = deps;
  const repos = deps.repos as Repos;
  switch (args.command) {
    case 'migrate': {
      if (!deps.db) throw new Error('migrate requires DATABASE_URL');
      const applied = await runMigrations(deps.db, log);
      out(applied.length ? `applied: ${applied.join(', ')}` : 'nothing to apply');
      return 0;
    }

    case 'import-json': {
      const file = args.positional[0];
      if (!file) throw new UsageError('usage: import-json <file> [--dry-run] [--adopt-local]');
      const rows = await hashPlainPasswords(await readImportJson(file));
      const rep = await runImport(repos.users, rows, { dryRun: args.dryRun, adoptLocal: args.adoptLocal });
      out(formatReport(rep));
      return 0;
    }

    case 'create-admin': {
      if (!args.email || !args.name) throw new UsageError('usage: create-admin --email <e-mail> --name <name> [--password <password>]');
      const email = args.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UsageError('invalid e-mail');
      if (args.password !== undefined && args.password.length < MIN_PASSWORD) throw new UsageError(`the password must have at least ${MIN_PASSWORD} characters`);
      const existing = await repos.users.byEmail(email);
      if (existing) {
        await repos.users.update(existing.id, { is_admin: true, status: 'active' });
        out(`${email} already existed: now an admin (password unchanged)`);
        return 0;
      }
      const temp = args.password === undefined;
      const password = args.password ?? generateTempPassword();
      await repos.users.createLocal({
        email, name: args.name.trim(), password_hash: await bcrypt.hash(password, 10), is_admin: true, must_change_password: temp,
      });
      out(`admin created: ${email}`);
      if (temp) out(`temporary password (shown only once, must be changed on first login): ${password}`);
      return 0;
    }

    case 'reset-password': {
      if (!args.email) throw new UsageError('usage: reset-password --email <e-mail>');
      const u = await repos.users.byEmail(args.email);
      if (!u) {
        out(`user not found: ${args.email}`);
        return 1;
      }
      const password = generateTempPassword();
      await repos.users.setPassword(u.id, await bcrypt.hash(password, 10), { needsChange: true });
      out(`temporary password for ${u.email} (shown only once, must be changed on next login): ${password}`);
      return 0;
    }
  }
}

export const USAGE = `Usage: cli <command> [options]

  migrate                                     apply pending database migrations
  import-json <file> [--dry-run] [--adopt-local]
                                              import users from a JSON array (see docs/admin-guide.md)
  create-admin --email <e> --name <n> [--password <p>]
  reset-password --email <e>

Environment: DATABASE_URL (or MYSQL_HOST/PORT/USER/PASSWORD/DATABASE).
First import: always run with --dry-run.
`;

/** Ponto de entrada: monta o banco, executa e devolve o código de saída. */
export async function main(argv: string[], env: NodeJS.ProcessEnv, parse: (a: string[]) => CliArgs, out: (l: string) => void): Promise<number> {
  let args: CliArgs;
  try {
    args = parse(argv);
  } catch (err) {
    if (err instanceof UsageError || err instanceof Error) {
      out(`error: ${err.message}\n\n${USAGE}`);
      return 2;
    }
    throw err;
  }
  let db: Db | undefined;
  try {
    const cfg = dbConfigFromEnv(env);
    if (!cfg) {
      out('error: DATABASE_URL (or MYSQL_HOST) not set');
      return 2;
    }
    db = createDb(cfg);
    const repos = createMysqlRepos(db);
    return await runCommand(args, { repos, db, out, env });
  } catch (err) {
    if (err instanceof UsageError) {
      out(`error: ${err.message}`);
      return 2;
    }
    log.error(`failure: ${errMsg(err)}`);
    return 1;
  } finally {
    await db?.close().catch(() => undefined);
  }
}
