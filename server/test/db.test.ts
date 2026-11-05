// Camada MySQL sem servidor: migrações, pool config, health e SQL das repos contra um Db roteirizado.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDbHealth } from '../db/health';
import { runMigrations, splitStatements } from '../db/migrate';
import { MIGRATIONS } from '../db/migrations/index';
import { dbConfigFromEnv, poolOptions, readCaBundle, type Db, type ExecResult } from '../db/pool';
import { createMysqlRepos } from '../db/repos/index';

interface Call { sql: string; params: unknown[] }

/** Db que grava as chamadas e responde por regex. */
function scripted(rules: [RegExp, unknown[] | ExecResult][] = []): Db & { calls: Call[]; txCount: number } {
  const calls: Call[] = [];
  const find = (sql: string): unknown => rules.find(([re]) => re.test(sql))?.[1];
  const db = {
    calls,
    txCount: 0,
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      const r = find(sql);
      return Array.isArray(r) ? r : [];
    },
    async exec(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      const r = find(sql);
      return r && !Array.isArray(r) ? (r as ExecResult) : { affectedRows: 1, insertId: 1 };
    },
    async tx<T>(fn: (d: Db) => Promise<T>): Promise<T> {
      db.txCount++;
      return fn(db as unknown as Db);
    },
    async close() {},
  };
  return db as unknown as Db & { calls: Call[]; txCount: number };
}

describe('migrações', () => {
  it('versões sequenciais e todas geram instruções válidas (exceto a comment-only)', () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual([1, 2, 3, 4, 5]);
    expect(splitStatements(MIGRATIONS[4]!.sql)).toHaveLength(1);
    expect(MIGRATIONS[4]!.sql).toMatch(/KEY ix_tel_user_at \(user_id, at\)/);
    expect(splitStatements(MIGRATIONS[0]!.sql).length).toBe(5);
    expect(splitStatements(MIGRATIONS[1]!.sql).length).toBe(3);
    expect(splitStatements(MIGRATIONS[2]!.sql)).toEqual([]);
    expect(splitStatements(MIGRATIONS[3]!.sql)).toEqual(['ALTER TABLE desks ADD COLUMN decor JSON NULL']);
    for (const m of MIGRATIONS) for (const s of splitStatements(m.sql)) expect(s).toMatch(/^(CREATE TABLE|ALTER TABLE) /);
  });

  it('001 traz as colunas de perfil; 002 alarga desk_id', () => {
    expect(MIGRATIONS[0]!.sql).toMatch(/display_name VARCHAR\(24\)/);
    expect(MIGRATIONS[0]!.sql).toMatch(/appearance JSON NULL/);
    expect(MIGRATIONS[0]!.sql).toMatch(/settings JSON NULL/);
    expect(MIGRATIONS[1]!.sql).toMatch(/MODIFY desk_id VARCHAR\(64\) NOT NULL/);
  });

  it('runMigrations: lock, aplica pendentes em ordem, registra e solta o lock', async () => {
    const db = scripted([[/GET_LOCK/, [{ got: 1 }]], [/FROM office_migrations/, [{ version: 1 }]]]);
    const logs: string[] = [];
    const applied = await runMigrations(db, { info: (m) => logs.push(m), warn: (m) => logs.push(m) });
    expect(applied).toEqual([2, 3, 4, 5]);
    expect(db.txCount).toBe(1);
    const sqls = db.calls.map((c) => c.sql);
    expect(sqls[0]).toMatch(/GET_LOCK/);
    expect(sqls.at(-1)).toMatch(/RELEASE_LOCK/);
    const inserts = db.calls.filter((c) => /INSERT INTO office_migrations/.test(c.sql)).map((c) => c.params[0]);
    expect(inserts).toEqual([2, 3, 4, 5]);
    expect(sqls.some((s) => /CREATE TABLE office_maps/.test(s))).toBe(true);
    expect(sqls.some((s) => /CREATE TABLE users/.test(s))).toBe(false);
  });

  it('runMigrations: sem lock falha e não aplica nada; tudo aplicado = no-op', async () => {
    await expect(runMigrations(scripted([[/GET_LOCK/, [{ got: 0 }]]]), { info() {}, warn() {} })).rejects.toThrow(/lock/);
    const db = scripted([[/GET_LOCK/, [{ got: 1 }]], [/FROM office_migrations/, MIGRATIONS.map((m) => ({ version: m.version }))]]);
    expect(await runMigrations(db, { info() {}, warn() {} })).toEqual([]);
    expect(db.calls.some((c) => /INSERT INTO office_migrations/.test(c.sql))).toBe(false);
  });
});

describe('pool config', () => {
  it('poolOptions a partir da URL (credenciais com escape) e opções fixas', () => {
    const o = poolOptions({ url: 'mysql://us%40er:p%3Aw@mysql:3307/escritorio' });
    expect(o).toMatchObject({ host: 'mysql', port: 3307, user: 'us@er', password: 'p:w', database: 'escritorio', timezone: 'Z', supportBigNumbers: true, decimalNumbers: true, connectionLimit: 5 });
    expect(() => poolOptions({ url: 'postgres://x/y' })).toThrow(/mysql/);
    expect(poolOptions({ url: 'mysql://u:p@h/db' }).ssl).toBeUndefined();
    expect(poolOptions({ url: 'mysql://u:p@h/db?ssl=true' }).ssl).toEqual({ rejectUnauthorized: true });
    expect(poolOptions({ url: 'mysql://u:p@h/db?sslmode=skip-verify' }).ssl).toEqual({ rejectUnauthorized: false });
    expect(poolOptions({ url: 'mysql://u:p@h/db?ssl=false' }).ssl).toBeUndefined();
    expect(poolOptions({ url: 'mysql://u:p@h/db', ssl: 'required' }).ssl).toEqual({ rejectUnauthorized: true });
    expect(poolOptions({ host: 'h', ssl: 'skip-verify' }).ssl).toEqual({ rejectUnauthorized: false });
  });

  it('CA bundle: MYSQL_SSL_CA / ?sslca= implica TLS validado; arquivo ausente ou não-PEM falha no boot', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oficio-ca-'));
    const ca = join(dir, 'ca.pem');
    const pem = '-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----\n';
    writeFileSync(ca, pem);
    expect(readCaBundle(ca)).toBe(pem);
    expect(poolOptions({ host: 'h', sslCa: ca }).ssl).toEqual({ ca: pem, rejectUnauthorized: true });
    expect(poolOptions({ url: 'mysql://u:p@h/db', sslCa: ca }).ssl).toEqual({ ca: pem, rejectUnauthorized: true });
    expect(poolOptions({ url: `mysql://u:p@h/db?sslca=${encodeURIComponent(ca)}` }).ssl).toEqual({ ca: pem, rejectUnauthorized: true });
    expect(poolOptions({ host: 'h', ssl: 'skip-verify', sslCa: ca }).ssl).toEqual({ ca: pem, rejectUnauthorized: false });
    expect(dbConfigFromEnv({ DATABASE_URL: 'mysql://a@h/d', MYSQL_SSL_CA: ` ${ca} ` })).toMatchObject({ sslCa: ca });
    expect(dbConfigFromEnv({ MYSQL_HOST: 'h', MYSQL_SSL_CA: ca })).toMatchObject({ host: 'h', sslCa: ca });
    expect(dbConfigFromEnv({ MYSQL_HOST: 'h' })).toMatchObject({ sslCa: undefined });
    expect(() => poolOptions({ host: 'h', sslCa: join(dir, 'missing.pem') })).toThrow(/MYSQL_SSL_CA: cannot read/);
    const notPem = join(dir, 'x.txt');
    writeFileSync(notPem, 'hello');
    expect(() => readCaBundle(notPem)).toThrow(/does not contain a PEM certificate/);
  });

  it('dbConfigFromEnv: DATABASE_URL, MYSQL_* ou null', () => {
    expect(dbConfigFromEnv({ DATABASE_URL: 'mysql://a@h/d' })).toMatchObject({ url: 'mysql://a@h/d' });
    expect(dbConfigFromEnv({ DATABASE_URL: 'mysql://a@h/d', MYSQL_SSL: 'required' })).toMatchObject({ url: 'mysql://a@h/d', ssl: 'required' });
    expect(dbConfigFromEnv({ MYSQL_HOST: 'h', MYSQL_USER: 'u', MYSQL_PASSWORD: 'p' })).toMatchObject({ host: 'h', user: 'u', password: 'p', port: 3306, database: 'oficio' });
    expect(dbConfigFromEnv({})).toBeNull();
  });
});

describe('health', () => {
  it('fake / ok / error e cache de 10 s', async () => {
    expect(await createDbHealth(undefined)()).toBe('fake');
    let t = 0;
    const db = scripted();
    const h = createDbHealth(db, { now: () => t });
    expect(await h()).toBe('ok');
    t = 5000;
    await h();
    expect(db.calls.length).toBe(1);
    t = 11_000;
    await h();
    expect(db.calls.length).toBe(2);
    const bad = { ...db, query: async () => { throw new Error('down'); } } as unknown as Db;
    expect(await createDbHealth(bad)()).toBe('error');
  });

  it('timeout de 2 s vira error', async () => {
    const slow = { query: () => new Promise(() => {}) } as unknown as Db;
    expect(await createDbHealth(slow, { timeoutMs: 20 })()).toBe('error');
  });
});

describe('SQL das repos MySQL', () => {
  it('upsertImported usa ON DUPLICATE KEY, GREATEST em is_admin e não toca em status', async () => {
    const db = scripted([[/INSERT INTO users/, { affectedRows: 1, insertId: 9 }]]);
    const r = createMysqlRepos(db);
    const row = { external_id: '3', name: 'A', email: 'A@x.com', password_hash: 'h', role_name: null, is_admin: true };
    expect(await r.users.upsertImported(row)).toBe('inserted');
    const sql = db.calls[0]!.sql;
    expect(sql).toMatch(/ON DUPLICATE KEY UPDATE/);
    expect(sql).toMatch(/GREATEST\(is_admin/);
    expect(sql).not.toMatch(/status/);
    expect(db.calls[0]!.params).toEqual(['3', 'a@x.com', 'A', 'h', null, 1]);
    const db2 = scripted([[/INSERT INTO users/, { affectedRows: 2, insertId: 9 }]]);
    expect(await createMysqlRepos(db2).users.upsertImported(row)).toBe('updated');
  });

  it('setPassword incrementa password_version; update só usa colunas conhecidas', async () => {
    const db = scripted();
    const r = createMysqlRepos(db);
    await r.users.setPassword(5, 'hash', { needsChange: true });
    expect(db.calls[0]!.sql).toMatch(/password_version = password_version \+ 1/);
    expect(db.calls[0]!.params).toEqual(['hash', 1, 5]);
    await r.users.update(5, { is_admin: false, appearance: null, ...({ 'evil; DROP': 1 } as object) });
    const upd = db.calls.find((c) => /^UPDATE users SET is_admin/.test(c.sql))!;
    expect(upd.sql).toBe('UPDATE users SET is_admin = ?, appearance = ? WHERE id = ?');
    expect(upd.params).toEqual([0, null, 5]);
  });

  it('desks.claim roda em transação e respeita ocupada', async () => {
    const db = scripted([[/SELECT user_id FROM desks WHERE desk_id/, [{ user_id: 2 }]]]);
    const r = createMysqlRepos(db);
    expect(await r.desks.claim('D1', 1)).toEqual({ ok: false, reason: 'taken' });
    expect(db.txCount).toBe(1);
    expect(db.calls.some((c) => /INSERT INTO desks/.test(c.sql))).toBe(false);
  });

  it('desks.pruneNotIn com lista vazia apaga tudo', async () => {
    const db = scripted([[/SELECT user_id FROM desks/, [{ user_id: 1 }, { user_id: 2 }]]]);
    expect(await createMysqlRepos(db).desks.pruneNotIn([])).toEqual([1, 2]);
    expect(db.calls.some((c) => c.sql === 'DELETE FROM desks')).toBe(true);
  });

  it('JSON do banco chega como objeto ou string', async () => {
    const base = { id: 1, external_id: null, email: 'a@b.c', name: 'A', display_name: null, password_hash: 'h', password_version: 1, must_change_password: 0, role_name: null, is_admin: 1, status: 'active', last_seen_at: null, created_at: new Date(), updated_at: new Date() };
    const db = scripted([[/SELECT \* FROM users/, [{ ...base, appearance: '{"look":"f"}', settings: { sounds: false } }]]]);
    const u = await createMysqlRepos(db).users.byId(1);
    expect(u).toMatchObject({ is_admin: true, must_change_password: false, appearance: { look: 'f' }, settings: { sounds: false } });
  });
});

describe('SQL da telemetria (MySQL)', () => {
  it('insertMany em um INSERT; vazio não toca no banco', async () => {
    const db = scripted();
    const r = createMysqlRepos(db);
    expect(await r.telemetry.insertMany([])).toBe(0);
    expect(db.calls).toHaveLength(0);
    const at = new Date(1000);
    await r.telemetry.insertMany([
      { user_id: 1, session_id: 's'.repeat(50), kind: 'sample', at, data: { rtt: 5 } },
      { user_id: null, session_id: 'server', kind: 'ws_drop', at, data: null },
    ]);
    expect(db.calls[0]!.sql).toMatch(/INSERT INTO telemetry_events \(user_id, session_id, kind, at, data\) VALUES \(\?, \?, \?, \?, \?\), \(\?, \?, \?, \?, \?\)/);
    expect(db.calls[0]!.params).toEqual([1, 's'.repeat(40), 'sample', at, '{"rtt":5}', null, 'server', 'ws_drop', at, null]);
  });

  it('summary junta contagens, p95 e último A/V; query filtra e limita', async () => {
    const db = scripted([
      [/ROW_NUMBER\(\) OVER/, [{ user_id: 1, rtt_p95: 190 }]],
      [/JSON_UNQUOTE/, [{ user_id: 1, last_av: 'connected' }]],
      [/GROUP BY user_id/, [{ user_id: 1, last_seen: new Date(5000), sessions: 2, samples: 20, rtt_avg: 105, fps_avg: 45, rejects: 1, jumps: 2, disconnects: 1, errors: 0 }]],
      [/FROM telemetry_events WHERE at >= \?/, [{ id: 9, user_id: 1, session_id: 'abc', kind: 'js_error', at: new Date(1), data: '{"message":"x"}' }]],
    ]);
    const r = createMysqlRepos(db);
    expect(await r.telemetry.summary(new Date(0))).toEqual([
      { user_id: 1, last_seen: new Date(5000), sessions: 2, samples: 20, rtt_avg: 105, rtt_p95: 190, fps_avg: 45, rejects: 1, jumps: 2, disconnects: 1, errors: 0, last_av: 'connected' },
    ]);
    const rows = await r.telemetry.query({ userId: 1, kind: 'js_error', since: new Date(0), limit: 99999 });
    expect(rows).toEqual([{ id: 9, user_id: 1, session_id: 'abc', kind: 'js_error', at: new Date(1), data: { message: 'x' } }]);
    const q = db.calls.at(-1)!;
    expect(q.sql).toMatch(/user_id = \? AND kind = \?/);
    expect(q.params.at(-1)).toBe(1000);
  });
});
