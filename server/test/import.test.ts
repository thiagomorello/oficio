import bcrypt from 'bcryptjs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateTempPassword, parseArgs, UsageError } from '../cli-args';
import { runCommand, type CliDeps } from '../cli-commands';
import { formatReport, hashPlainPasswords, isBcryptHash, mapRow, normalizeHash, runImport } from '../import/core';
import { parseImportJson } from '../import/json';
import { createFakeRepos } from './fakeDb';

const H = (c: string): string => '$2y$08$' + c.repeat(53);
const raw = (id: number, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  external_id: String(id), name: `Person ${id}`, email: `P${id}@Example.com`, password_hash: H('a'), role: 'Support', ...over,
});

describe('mapRow / hash', () => {
  it('normaliza $2y$ para $2a$ e valida bcrypt', () => {
    expect(normalizeHash(H('b'))).toBe('$2a$08$' + 'b'.repeat(53));
    expect(normalizeHash('$2b$08$x')).toBe('$2b$08$x');
    expect(isBcryptHash(normalizeHash(H('b')))).toBe(true);
    expect(isBcryptHash('senha123')).toBe(false);
  });

  it('mapeia campos em snake_case e camelCase', () => {
    const m = mapRow(raw(10, { role: 'Manager', is_admin: true }));
    expect(m).toEqual({
      ok: true,
      row: { external_id: '10', name: 'Person 10', email: 'p10@example.com', password_hash: '$2a$08$' + 'a'.repeat(53), role_name: 'Manager', is_admin: true },
    });
    const camel = mapRow({ externalId: 7, name: 'X', email: 'x@y.com', passwordHash: H('c'), roleName: 'Ops', isAdmin: 'true' });
    expect(camel.ok && camel.row).toMatchObject({ external_id: '7', role_name: 'Ops', is_admin: true });
    const byId = mapRow({ id: 'abc-1', name: 'X', email: 'x@y.com', password_hash: H('c') });
    expect(byId.ok && byId.row).toMatchObject({ external_id: 'abc-1', role_name: null, is_admin: false });
  });

  it('rejeita inválidos', () => {
    expect(mapRow(raw(1, { email: 'nao-e-email' }))).toMatchObject({ ok: false, reason: 'invalid e-mail' });
    expect(mapRow(raw(1, { password_hash: 'plain' }))).toMatchObject({ ok: false, reason: 'password_hash is not bcrypt' });
    expect(mapRow(raw(1, { name: '  ' }))).toMatchObject({ ok: false });
    expect(mapRow(raw(1, { external_id: '' }))).toMatchObject({ ok: false });
    expect(mapRow(raw(1, { external_id: 'x'.repeat(65) }))).toMatchObject({ ok: false });
  });

  it('hashPlainPasswords converte senha em texto (>= 8) e preserva hash existente', async () => {
    const rows = await hashPlainPasswords([
      { id: 1, email: 'a@b.c', name: 'A', password: 'segredo123' },
      { id: 2, email: 'b@b.c', name: 'B', password: 'curta' },
      { id: 3, email: 'c@b.c', name: 'C', password: 'ignorada!', password_hash: H('d') },
    ], 4);
    expect(rows[0]!.password).toBeUndefined();
    expect(await bcrypt.compare('segredo123', String(rows[0]!.password_hash))).toBe(true);
    expect(rows[1]!.password_hash).toBeUndefined();
    expect(rows[2]!.password_hash).toBe(H('d'));
  });
});

describe('runImport', () => {
  it('insere, atualiza e relata; dry-run não grava', async () => {
    const r = createFakeRepos();
    const dry = await runImport(r.users, [raw(1), raw(2)], { dryRun: true });
    expect(dry.counts).toMatchObject({ inserted: 2, updated: 0, skipped: 0 });
    expect((await r.users.list()).total).toBe(0);
    const real = await runImport(r.users, [raw(1), raw(2)]);
    expect(real.counts.inserted).toBe(2);
    expect((await r.users.byExternalId('1'))?.email).toBe('p1@example.com');
    const again = await runImport(r.users, [raw(1, { name: 'Renamed' }), raw(3)]);
    expect(again.counts).toMatchObject({ inserted: 1, updated: 1 });
    expect((await r.users.byExternalId('1'))?.name).toBe('Renamed');
    const text = formatReport(again);
    expect(text).toContain('inserted=1 updated=1');
    expect(text).not.toContain('$2a$');
  });

  it('colisão com conta local: pula; --adopt-local adota; dry-run não adota', async () => {
    const r = createFakeRepos();
    const local = await r.users.createLocal({ email: 'p7@example.com', name: 'Local', password_hash: 'x' });
    const skip = await runImport(r.users, [raw(7)]);
    expect(skip.items[0]).toMatchObject({ action: 'skipped' });
    expect(skip.items[0]!.reason).toMatch(/adopt-local/);
    expect((await r.users.byId(local.id))?.external_id).toBeNull();
    await runImport(r.users, [raw(7)], { adoptLocal: true, dryRun: true });
    expect((await r.users.byId(local.id))?.external_id).toBeNull();
    const ad = await runImport(r.users, [raw(7)], { adoptLocal: true });
    expect(ad.counts.adopted).toBe(1);
    expect(await r.users.byExternalId('7')).toMatchObject({ id: local.id });
  });

  it('colisão com outro external_id, duplicados e linhas inválidas são pulados', async () => {
    const r = createFakeRepos();
    await runImport(r.users, [raw(1)]);
    const rep = await runImport(r.users, [raw(2, { email: 'p1@example.com' }), raw(5), raw(5), raw(6, { password_hash: 'x' })]);
    expect(rep.counts).toMatchObject({ inserted: 1, skipped: 3 });
  });
});

describe('import-json', () => {
  it('aceita array de objetos e rejeita lixo', () => {
    expect(parseImportJson(JSON.stringify([raw(1), { external_id: '2' }]))).toHaveLength(2);
    expect(() => parseImportJson('{}')).toThrow(/array/);
    expect(() => parseImportJson('nope')).toThrow(/JSON/);
    expect(() => parseImportJson('[1]')).toThrow(/object/);
  });
});

describe('parseArgs', () => {
  it('flags, valores e posicionais', () => {
    expect(parseArgs(['import-json', 'f.json', '--dry-run', '--adopt-local'])).toMatchObject({ command: 'import-json', dryRun: true, adoptLocal: true, positional: ['f.json'] });
    expect(parseArgs(['create-admin', '--email=a@b.c', '--name', 'Ana B'])).toMatchObject({ email: 'a@b.c', name: 'Ana B' });
  });
  it('erros de uso', () => {
    expect(() => parseArgs([])).toThrow(UsageError);
    expect(() => parseArgs(['foo'])).toThrow(/unknown/);
    expect(() => parseArgs(['import-csv'])).toThrow(/unknown/);
    expect(() => parseArgs(['migrate', '--nope'])).toThrow(/option/);
    expect(() => parseArgs(['create-admin', '--email'])).toThrow(/value/);
    expect(() => parseArgs(['import-json', '--dry-run=1'])).toThrow();
    expect(() => parseArgs(['import-json', '--roles', 'a'])).toThrow(/option/);
  });
  it('senha temporária: 12 caracteres, sem ambíguos, variável', () => {
    const a = generateTempPassword();
    expect(a).toMatch(/^[A-HJ-NP-Za-km-z2-9]{12}$/);
    expect(generateTempPassword()).not.toBe(a);
  });
});

function deps(over: Partial<CliDeps> = {}): { d: CliDeps; lines: string[] } {
  const lines: string[] = [];
  return { lines, d: { repos: createFakeRepos(), out: (l) => lines.push(l), env: {}, ...over } };
}

describe('comandos', () => {
  it('import-json: dry-run, real (com senha em texto) e arquivo inválido', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oficio-'));
    const file = join(dir, 'u.json');
    await writeFile(file, JSON.stringify([raw(1), { id: 2, name: 'Plain', email: 'plain@example.com', password: 'segredo123' }]));
    const { d, lines } = deps();
    expect(await runCommand(parseArgs(['import-json', file, '--dry-run']), d)).toBe(0);
    expect((await d.repos!.users.list()).total).toBe(0);
    expect(lines.join('\n')).toContain('[dry-run]');
    expect(await runCommand(parseArgs(['import-json', file]), d)).toBe(0);
    expect((await d.repos!.users.list()).total).toBe(2);
    const plain = (await d.repos!.users.byEmail('plain@example.com'))!;
    expect(plain.external_id).toBe('2');
    expect(await bcrypt.compare('segredo123', plain.password_hash)).toBe(true);
    const bad = join(dir, 'bad.json');
    await writeFile(bad, '{"a":1}');
    await expect(runCommand(parseArgs(['import-json', bad]), d)).rejects.toThrow(/array/);
    await expect(runCommand(parseArgs(['import-json']), d)).rejects.toThrow(UsageError);
  });

  it('create-admin: senha temporária (bcrypt, troca obrigatória), senha explícita e promoção', async () => {
    const { d, lines } = deps();
    await runCommand(parseArgs(['create-admin', '--email', 'Root@X.com', '--name', 'Root']), d);
    const u = (await d.repos!.users.byEmail('root@x.com'))!;
    expect(u).toMatchObject({ is_admin: true, must_change_password: true });
    const temp = lines.find((l) => l.startsWith('temporary password'))!.split(': ').pop()!;
    expect(await bcrypt.compare(temp, u.password_hash)).toBe(true);

    await runCommand(parseArgs(['create-admin', '--email', 'b@x.com', '--name', 'B', '--password', 'segredo123']), d);
    const b = (await d.repos!.users.byEmail('b@x.com'))!;
    expect(b.must_change_password).toBe(false);
    expect(await bcrypt.compare('segredo123', b.password_hash)).toBe(true);

    const l = await d.repos!.users.createLocal({ email: 'c@x.com', name: 'C', password_hash: 'h' });
    await runCommand(parseArgs(['create-admin', '--email', 'c@x.com', '--name', 'C']), d);
    expect((await d.repos!.users.byId(l.id))?.is_admin).toBe(true);

    await expect(runCommand(parseArgs(['create-admin', '--email', 'd@x.com', '--name', 'D', '--password', 'curta']), d)).rejects.toThrow(UsageError);
    await expect(runCommand(parseArgs(['create-admin', '--email', 'x']), d)).rejects.toThrow(UsageError);
  });

  it('reset-password: gera temporária, sobe password_version, exige troca; usuário inexistente = 1', async () => {
    const { d, lines } = deps();
    const u = await d.repos!.users.createLocal({ email: 'z@x.com', name: 'Z', password_hash: 'old' });
    expect(await runCommand(parseArgs(['reset-password', '--email', 'z@x.com']), d)).toBe(0);
    const after = (await d.repos!.users.byId(u.id))!;
    expect(after).toMatchObject({ must_change_password: true, password_version: 2 });
    const temp = lines.at(-1)!.split(': ').pop()!;
    expect(await bcrypt.compare(temp, after.password_hash)).toBe(true);
    expect(await runCommand(parseArgs(['reset-password', '--email', 'nao@x.com']), d)).toBe(1);
  });
});
