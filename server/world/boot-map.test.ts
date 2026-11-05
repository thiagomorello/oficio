import { describe, expect, it } from 'vitest';
import { createFakeRepos } from '../test/fakeDb';
import { loadBootMap } from './boot-map';

const log = { info() {}, warn() {}, error() {} };

describe('loadBootMap', () => {
  it('primeira subida: grava o mapa padrão como versão publicada e reutiliza na segunda', async () => {
    const repos = createFakeRepos();
    const a = await loadBootMap(repos, log);
    expect(a.id).toBeGreaterThan(0);
    expect(a.doc.areas.length).toBeGreaterThan(10);
    const b = await loadBootMap(repos, log);
    expect(b.id).toBe(a.id);
    expect((await repos.maps.list()).length).toBe(1);
  });
  it('mapa publicado inválido cai para o padrão em memória', async () => {
    const repos = createFakeRepos();
    const row = await repos.maps.createVersion({ schema: 1, bogus: true }, 'quebrado', null, null, null);
    await repos.maps.setPublished(row.id);
    const r = await loadBootMap(repos, log);
    expect(r.id).toBe(0);
    expect(r.doc.areas.length).toBeGreaterThan(10);
  });
});
