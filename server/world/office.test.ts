import { describe, expect, it } from 'vitest';
import { assembleOffice } from '../../shared/map/assemble';
import { clone } from '../../shared/map/test-fixtures';
import { TILE, WALK_SPEED } from '../../shared/map/tile';
import { AUTO_AWAY_MS, GHOST_MS } from './office';
import { hallDoc, makeWorld, twoAreaDoc } from '../test/world-helpers';

describe('Office — movimento', () => {
  it('recusa destino dentro de móveis e o caminho contorna o bloco', async () => {
    const w = makeWorld(hallDoc());
    const a = await w.join(1);
    expect(w.office.posOf(1)).toMatchObject({ tx: 2, ty: 10 });
    w.office.teleport(1, 2, 5);
    await w.office.handle(1, { t: 'move_to', x: 7, y: 5, seq: 1 });
    expect(a.last('moved_reject')).toMatchObject({ seq: 1, reason: 'blocked' });

    await w.office.handle(1, { t: 'move_to', x: 12, y: 5, seq: 2 });
    expect(a.last('ack')).toEqual({ t: 'ack', seq: 2, x: 12, y: 5 });
    const grid = w.office.assembly.grid;
    for (let i = 0; i < 200; i++) {
      w.run(0.05);
      const p = w.office.posOf(1)!;
      expect(grid.walkable(p.tx, p.ty)).toBe(true);
      // pés nunca dentro do bloco (5..9, 3..7)
      const fx = Math.floor(p.x / TILE);
      const fy = Math.floor(p.y / TILE);
      expect(fx >= 5 && fx <= 9 && fy >= 3 && fy <= 7).toBe(false);
    }
    expect(w.office.posOf(1)).toMatchObject({ tx: 12, ty: 5 });
  });

  it('recusa longe demais e fora da grade', async () => {
    const w = makeWorld(hallDoc());
    const a = await w.join(1);
    await w.office.handle(1, { t: 'move_to', x: 500, y: 5 });
    expect(a.last('moved_reject')?.reason).toBe('invalid');
  });

  it('anda a 3,2 tiles/s (± 1 %) em 20 ticks', async () => {
    const w = makeWorld(hallDoc());
    await w.join(1);
    const x0 = w.office.posOf(1)!.x;
    await w.office.handle(1, { t: 'move_to', x: 19, y: 10 });
    w.run(1);
    const tiles = (w.office.posOf(1)!.x - x0) / TILE;
    expect(Math.abs(tiles - WALK_SPEED / TILE) / (WALK_SPEED / TILE)).toBeLessThan(0.01);
    expect(tiles).toBeGreaterThan((WALK_SPEED / TILE) * 0.99);
  });

  it('move_dir anda um tile por vez e para virado para a parede', async () => {
    const w = makeWorld(hallDoc());
    const a = await w.join(1);
    w.office.teleport(1, 2, 5);
    await w.office.handle(1, { t: 'move_dir', dir: 'right' });
    w.run(2);
    // (5,5) é móvel: para em (4,5) virado para a direita
    expect(w.office.posOf(1)).toMatchObject({ tx: 4, ty: 5, x: 4 * TILE + 8, y: 5 * TILE + 11 });
    expect(w.office.stateOf(1)).toMatchObject({ dir: 'right', moving: false, pose: 'stand' });

    // parado, encostado na parede: só vira
    w.office.teleport(1, 10, 6);
    w.run(0.1);
    await w.office.handle(1, { t: 'move_dir', dir: 'left' });
    w.run(0.5);
    expect(w.office.posOf(1)).toMatchObject({ tx: 10, ty: 6 });
    expect(w.office.stateOf(1)?.dir).toBe('left');

    // soltar a tecla termina no máximo o tile atual
    w.office.teleport(1, 0, 10);
    await w.office.handle(1, { t: 'move_dir', dir: 'right' });
    w.run(0.4);
    await w.office.handle(1, { t: 'move_dir', dir: null });
    const tx = w.office.posOf(1)!.tx;
    w.run(1);
    expect(w.office.posOf(1)!.tx).toBeLessThanOrEqual(tx + 1);
    expect(w.office.stateOf(1)?.moving).toBe(false);
    expect(a.of('moved_reject')).toHaveLength(0);
  });
});

describe('Office — zonas trancadas', () => {
  it('recusa quem não é membro (com batida implícita) e deixa o membro e o admitido passarem', async () => {
    const w = makeWorld(twoAreaDoc());
    const a = await w.join(1);
    const b = await w.join(2);
    await w.office.handle(1, { t: 'move_to', x: 5, y: 4 });
    w.run(5);
    expect(w.office.posOf(1)).toMatchObject({ tx: 5, ty: 4 });
    expect(w.office.zones.get('sala')?.members.has(1)).toBe(true);

    await w.office.handle(1, { t: 'lock', zone: 'sala', locked: true });
    w.run(0.05);
    expect(b.last('zone')?.zone).toMatchObject({ id: 'sala', locked: true, members: [1] });

    await w.office.handle(2, { t: 'move_to', x: 6, y: 4, seq: 7 });
    expect(b.last('moved_reject')).toMatchObject({ seq: 7, reason: 'locked' });
    expect(a.last('knock')).toMatchObject({ zone: 'sala', from: 2 });

    // membro anda dentro da sala trancada
    await w.office.handle(1, { t: 'move_to', x: 7, y: 5, seq: 3 });
    expect(a.last('ack')?.seq).toBe(3);

    // admitido entra
    await w.office.handle(1, { t: 'admit', zone: 'sala', user: 2, allow: true });
    expect(b.last('knock_result')).toEqual({ t: 'knock_result', zone: 'sala', allow: true });
    await w.office.handle(2, { t: 'move_to', x: 6, y: 4, seq: 8 });
    expect(b.last('ack')?.seq).toBe(8);
    w.run(5);
    expect(w.office.zones.get('sala')?.members.has(2)).toBe(true);

    // só membro tranca/destranca; sala vazia destranca sozinha
    await w.office.handle(1, { t: 'move_to', x: 10, y: 10 });
    await w.office.handle(2, { t: 'move_to', x: 11, y: 10 });
    w.run(6);
    expect(w.office.zones.get('sala')).toMatchObject({ locked: false });
  });

  it('não membro não tranca', async () => {
    const w = makeWorld(twoAreaDoc());
    const a = await w.join(1);
    await w.office.handle(1, { t: 'lock', zone: 'sala', locked: true });
    expect(a.last('error')?.code).toBe('forbidden');
  });
});

describe('Office — assentos', () => {
  it('exige adjacência, assento livre e mesa não reivindicada por outro; pose `type` em mesa', async () => {
    const w = makeWorld(twoAreaDoc());
    const a = await w.join(1);
    const b = await w.join(2);
    // longe: vira intenção — anda até o assento e senta ao chegar (nada de 'far')
    w.office.teleport(1, 6, 4);
    await w.office.handle(1, { t: 'sit', spot: 'sala#f3:desk' });
    expect(a.last('moved_reject')).toBeUndefined();
    expect(w.office.stateOf(1)?.moving).toBe(true);
    w.run(4);
    expect(w.office.stateOf(1)).toMatchObject({ seat: 'sala#f3:desk', pose: 'type' });
    await w.office.handle(1, { t: 'stand' });

    w.office.teleport(1, 2, 6);
    await w.office.handle(1, { t: 'sit', spot: 'sala#f3:desk' });
    w.run(1);
    expect(w.office.stateOf(1)).toMatchObject({ seat: 'sala#f3:desk', pose: 'type', dir: 'up' });
    expect(b.last('state')?.entities.find((e) => e.id === 1)?.seat).toBe('sala#f3:desk');

    w.office.teleport(2, 3, 6);
    await w.office.handle(2, { t: 'sit', spot: 'sala#f3:desk' });
    expect(b.last('moved_reject')?.reason).toBe('seat_taken');

    // mesa sala#f0 reivindicada por 2: 1 não senta nela
    await w.office.handle(2, { t: 'desk_claim', desk: 'sala#f0' });
    await w.office.handle(1, { t: 'stand' });
    w.run(0.5);
    expect(w.office.stateOf(1)?.seat).toBeUndefined();
    w.office.teleport(1, 1, 2);
    await w.office.handle(1, { t: 'sit', spot: 'sala#f2:desk' });
    expect(a.last('moved_reject')?.reason).toBe('desk_taken');
    // o dono senta
    w.office.teleport(2, 1, 3);
    await w.office.handle(2, { t: 'sit', spot: 'sala#f2:desk' });
    w.run(1);
    expect(w.office.stateOf(2)?.seat).toBe('sala#f2:desk');
  });
});

describe('Office — chat', () => {
  it('perto não atravessa zona privada; sala só para membros; geral para todos e gravado', async () => {
    const w = makeWorld(twoAreaDoc());
    const a = await w.join(1);
    const b = await w.join(2);
    const c = await w.join(3);
    w.office.teleport(1, 5, 6); // dentro da sala (privada)
    w.office.teleport(2, 5, 8); // corredor, a 2 tiles de 1
    w.office.teleport(3, 8, 10); // corredor, a 3 tiles de 2
    w.run(0.1);

    await w.office.handle(1, { t: 'chat', scope: 'near', text: 'oi de dentro' });
    expect(a.of('chat')).toHaveLength(1);
    expect(b.of('chat')).toHaveLength(0);
    expect(c.of('chat')).toHaveLength(0);

    await w.office.handle(2, { t: 'chat', scope: 'near', text: 'oi do corredor' });
    expect(c.last('chat')?.msg).toMatchObject({ text: 'oi do corredor', from: 2, scope: 'near' });
    expect(a.of('chat')).toHaveLength(1);

    await w.office.handle(1, { t: 'chat', scope: 'room', text: 'reunião' });
    expect(a.last('chat')?.msg).toMatchObject({ scope: 'room', zone: 'sala' });
    expect(b.of('chat').some((m) => m.msg.text === 'reunião')).toBe(false);
    await w.office.handle(2, { t: 'chat', scope: 'room', text: 'x' });
    expect(b.last('error')?.code).toBe('forbidden');

    await w.office.handle(3, { t: 'chat', scope: 'global', text: 'bom dia' });
    for (const k of [a, b, c]) expect(k.last('chat')?.msg.text).toBe('bom dia');
    const rows = await w.repos.chat.list('global', null, null, 10);
    expect(rows.map((r) => r.text)).toEqual(['bom dia']);
    expect((await w.repos.chat.list('room', 'sala', null, 10)).map((r) => r.text)).toEqual(['reunião']);
  });

  it('limita 5 mensagens em 5 s', async () => {
    const w = makeWorld(twoAreaDoc());
    const a = await w.join(1);
    for (let i = 0; i < 6; i++) await w.office.handle(1, { t: 'chat', scope: 'global', text: `m${i}` });
    expect(a.of('chat')).toHaveLength(5);
    expect(a.last('error')?.code).toBe('rate_limited');
    w.clock.t += 5_001;
    await w.office.handle(1, { t: 'chat', scope: 'global', text: 'de novo' });
    expect(a.of('chat')).toHaveLength(6);
  });
});

describe('Office — presença', () => {
  it('auto-away após 5 min sem input (não para busy) e volta com atividade', async () => {
    const w = makeWorld(twoAreaDoc());
    const a = await w.join(1);
    await w.join(2);
    await w.office.handle(2, { t: 'status', status: 'busy' });
    w.clock.t += AUTO_AWAY_MS + 1_000;
    w.office.housekeep();
    expect(a.of('status')).toContainEqual({ t: 'status', id: 1, status: 'away' });
    expect(w.office.posOf(2)?.status).toBe('busy');
    await w.office.handle(1, { t: 'activity' });
    expect(a.last('status')).toEqual({ t: 'status', id: 1, status: 'available' });
  });

  it('fantasma: reconexão em 30 s recupera a posição; depois disso some e volta ao spawn', async () => {
    const w = makeWorld(twoAreaDoc());
    const a = await w.join(1);
    const b = await w.join(2);
    w.office.teleport(1, 15, 12);
    w.office.leave(1, a);
    expect(w.office.online).toBe(1);
    w.clock.t += 10_000;
    w.office.housekeep();
    expect(b.of('leave')).toHaveLength(0);
    const a2 = await w.join(1);
    expect(w.office.posOf(1)).toMatchObject({ tx: 15, ty: 12 });
    expect(a2.last('welcome')?.entities.find((e) => e.id === 1)).toMatchObject({ x: 15.5, y: 12 + 11 / 16 });

    w.office.leave(1, a2);
    w.clock.t += GHOST_MS + 1;
    w.office.housekeep();
    expect(b.last('leave')).toEqual({ t: 'leave', id: 1 });
    expect(w.office.entities.has(1)).toBe(false);
    await w.join(1);
    expect(w.office.posOf(1)).toMatchObject({ tx: 10, ty: 10 });
  });

  it('nova conexão do mesmo usuário derruba a anterior com kick replaced', async () => {
    const w = makeWorld(twoAreaDoc());
    const c1 = await w.join(1);
    const c2 = await w.join(1);
    expect(c1.last('kick')).toEqual({ t: 'kick', reason: 'replaced' });
    expect(c1.open).toBe(false);
    expect(c2.last('welcome')?.you.id).toBe(1);
    expect(w.office.isCurrent(1, c1)).toBe(false);
    w.office.leave(1, c1); // o close atrasado do socket velho não derruba o novo
    expect(w.office.online).toBe(1);
  });

  it('revalidação derruba conta desativada', async () => {
    const w = makeWorld(twoAreaDoc(), {
      session: { userFromRequest: () => null, revalidate: (id) => (id === 2 ? { ok: false, reason: 'disabled' } : { ok: false, reason: 'auth' }) },
    });
    const a = await w.join(2);
    const b = await w.join(3);
    await w.office.revalidateAll();
    expect(a.last('kick')).toEqual({ t: 'kick', reason: 'disabled' });
    expect(b.last('kick')).toEqual({ t: 'kick', reason: 'session' });
    expect(w.office.entities.size).toBe(0);
  });

  it('spawn: primeiro tile livre', async () => {
    const w = makeWorld(twoAreaDoc());
    await w.join(1);
    await w.join(2);
    const p1 = w.office.posOf(1)!;
    const p2 = w.office.posOf(2)!;
    expect(p1).toMatchObject({ tx: 10, ty: 10 });
    expect(`${p2.tx},${p2.ty}`).not.toBe('10,10');
  });
});

describe('Office — emotes', () => {
  it('cooldown de 1,5 s e duração de 2,5 s (mão levantada 10 s)', async () => {
    const w = makeWorld(twoAreaDoc());
    await w.join(1);
    await w.office.handle(1, { t: 'emote', emote: 'cheer' });
    w.run(0.05);
    expect(w.office.stateOf(1)?.pose).toBe('cheer');
    await w.office.handle(1, { t: 'emote', emote: 'laugh' });
    w.run(0.05);
    expect(w.office.stateOf(1)?.pose).toBe('cheer');
    w.run(2.5);
    expect(w.office.stateOf(1)?.pose).toBe('stand');
    await w.office.handle(1, { t: 'emote', emote: 'raise_hand' });
    w.run(9);
    expect(w.office.stateOf(1)?.pose).toBe('raise_hand');
    w.run(1.1);
    expect(w.office.stateOf(1)?.pose).toBe('stand');
  });
});

describe('Office — av_set', () => {
  it('simétrico, só quando muda, e isolado pela zona privada', async () => {
    const w = makeWorld(twoAreaDoc());
    const a = await w.join(1);
    const b = await w.join(2);
    w.office.teleport(1, 10, 10);
    w.office.teleport(2, 12, 10);
    w.run(0.05);
    const sa = a.last('av_set')!;
    const sb = b.last('av_set')!;
    expect(sa).toMatchObject({ hear: [2], allow: [2], screenAllowed: true });
    expect(sb).toMatchObject({ hear: [1], allow: [1] });
    expect(sa.volumes['2']).toBe(sb.volumes['1']);
    expect(sa.volumes['2']).toBeGreaterThan(0.15);
    expect(sa.volumes['2']).toBeLessThan(1);

    const na = a.of('av_set').length;
    w.run(1);
    expect(a.of('av_set')).toHaveLength(na);

    // 1 entra na sala de reunião (privada): ninguém se ouve; tela liberada
    w.office.teleport(1, 5, 4);
    w.run(0.3);
    expect(a.last('av_set')).toMatchObject({ hear: [], screenAllowed: true });
    expect(b.last('av_set')).toMatchObject({ hear: [] });
  });

  it('no máximo 4 atualizações por segundo', async () => {
    const w = makeWorld(twoAreaDoc());
    const a = await w.join(1);
    await w.join(2);
    w.office.teleport(2, 12, 10);
    w.run(0.05);
    const n0 = a.of('av_set').length;
    for (let i = 0; i < 20; i++) {
      w.office.teleport(1, i % 2 ? 10 : 14, 10);
      w.run(0.05);
    }
    expect(a.of('av_set').length - n0).toBeLessThanOrEqual(4);
  });
});

describe('Office — mesas', () => {
  it('reivindicar/liberar emitem a mensagem unificada `desk`', async () => {
    const w = makeWorld(twoAreaDoc());
    const a = await w.join(1);
    const b = await w.join(2);
    await w.office.handle(1, { t: 'desk_claim', desk: 'sala#f0' });
    expect(b.last('desk')).toEqual({ t: 'desk', desk: 'sala#f0', userId: 1, decor: null });
    await w.office.handle(2, { t: 'desk_claim', desk: 'sala#f0' });
    expect(b.last('error')?.code).toBe('conflict');
    b.clear();
    await w.office.handle(1, { t: 'desk_claim', desk: 'sala#f1' });
    expect(b.of('desk')).toEqual([
      { t: 'desk', desk: 'sala#f0', userId: null, decor: null },
      { t: 'desk', desk: 'sala#f1', userId: 1, decor: null },
    ]);
    await w.office.handle(1, { t: 'desk_release' });
    expect(a.last('desk')).toEqual({ t: 'desk', desk: 'sala#f1', userId: null, decor: null });
    expect(await w.repos.desks.all()).toEqual([]);
    await w.office.handle(1, { t: 'desk_claim', desk: 'nao#existe' });
    expect(a.last('error')?.code).toBe('not_found');
  });

  it('mensagens de erro saem no idioma da conexão (pt-BR padrão do teste; en quando a conexão pede)', async () => {
    const w = makeWorld(twoAreaDoc());
    const a = await w.join(1);
    const b = await w.join(2, undefined, 'en');
    await w.office.handle(1, { t: 'desk_claim', desk: 'sala#f0' });
    await w.office.handle(2, { t: 'desk_claim', desk: 'sala#f0' });
    expect(b.last('error')).toEqual({ t: 'error', code: 'conflict', message: 'this desk already has an owner' });
    await w.office.handle(2, { t: 'desk_release' });
    expect(b.last('error')).toEqual({ t: 'error', code: 'not_found', message: 'you have no desk' });
    await w.office.handle(1, { t: 'desk_release' });
    await w.office.handle(1, { t: 'desk_release' });
    expect(a.last('error')).toEqual({ t: 'error', code: 'not_found', message: 'você não tem mesa' });
  });

  it('welcome traz as mesas carregadas do banco', async () => {
    const w = makeWorld(twoAreaDoc());
    await w.repos.desks.claim('sala#f1', 9);
    await w.office.load();
    const a = await w.join(1);
    expect(a.last('welcome')?.desks).toEqual([{ id: 'sala#f1', userId: 9, decor: null }]);
  });
});

describe('Office — swapMap', () => {
  it('teleporta quem ficou num tile bloqueado, solta assento/mesa removidos e avisa todos', async () => {
    const w = makeWorld(twoAreaDoc());
    const a = await w.join(1);
    const b = await w.join(2);
    await w.office.handle(1, { t: 'move_to', x: 5, y: 4 });
    w.run(4);
    await w.office.handle(1, { t: 'lock', zone: 'sala', locked: true });
    w.office.teleport(2, 6, 10);
    await w.office.handle(2, { t: 'desk_claim', desk: 'sala#f0' });
    w.run(0.1);

    const doc = clone(twoAreaDoc());
    const corr = doc.areas.find((x) => x.id === 'corr')!;
    corr.blocked = [{ x: 5, y: 1, w: 3, h: 3 }]; // (5..7, 9..11) absolutos
    const sala = doc.areas.find((x) => x.id === 'sala')!;
    sala.furniture = sala.furniture.filter((f) => f.id !== 'f0');
    const next = assembleOffice(doc, w.office.layoutVersion + 1);
    a.clear();
    b.clear();
    const r = w.office.swapMap(next, { id: 42 });

    expect(r).toMatchObject({ moved: 1, releasedDesks: 1 });
    const p = w.office.posOf(2)!;
    expect(next.grid.walkable(p.tx, p.ty)).toBe(true);
    expect(`${p.tx},${p.ty}`).not.toBe('6,10');
    expect(b.msgs[0]).toEqual({ t: 'notice', level: 'warn', text: 'Sua mesa foi removida do mapa.' });
    expect(a.of('map')).toEqual([{ t: 'map', id: 42, version: 2 }]);
    const st = a.last('state')!;
    expect(st.entities.find((e) => e.id === 2)).toMatchObject({ tp: 1 });
    expect(st.entities.find((e) => e.id === 1)?.tp).toBeUndefined();
    expect(st.zones.find((z) => z.id === 'sala')).toMatchObject({ locked: true, members: [1] });
    expect(st.desks).toEqual([]);
    expect(w.office.layoutVersion).toBe(2);
    expect(w.office.etag).toBe('"m42-2-1"');

    // a nova grade vale para os caminhos
    await w.office.handle(2, { t: 'move_to', x: 6, y: 10, seq: 1 });
    expect(b.last('ack')?.x === 6 && b.last('ack')?.y === 10).toBe(false);
  });
});

describe('Office — pos (cliente autoritativo)', () => {
  it('aceita posição plausível, recusa parede e salto rápido demais', async () => {
    const w = makeWorld(hallDoc());
    const a = await w.join(1);
    w.office.teleport(1, 2, 5);
    w.run(0.2);
    const p0 = w.office.posOf(1)!;
    await w.office.handle(1, { t: 'pos', x: p0.x + 8, y: p0.y, dir: 'right', moving: true });
    expect(w.office.posOf(1)).toMatchObject({ x: p0.x + 8, tx: 3 });
    expect(w.office.stateOf(1)).toMatchObject({ moving: true, pose: 'walk' });
    // (5,5) é móvel: recusa e devolve
    w.run(0.5);
    await w.office.handle(1, { t: 'pos', x: 5 * 16 + 8, y: 5 * 16 + 11, dir: 'right', moving: true });
    expect(a.last('moved_reject')).toMatchObject({ reason: 'blocked', seq: 0 });
    expect(w.office.posOf(1)).toMatchObject({ tx: 3 });
    // teletransporte disfarçado de pos: recusa por distância
    w.run(0.5);
    await w.office.handle(1, { t: 'pos', x: 40 * 16, y: 5 * 16 + 11, dir: 'right', moving: true });
    expect(a.last('moved_reject')?.reason).toMatch(/far|blocked/);
    // parou
    await w.office.handle(1, { t: 'pos', x: p0.x + 8, y: p0.y, dir: 'right', moving: false });
    w.run(0.1);
    expect(w.office.stateOf(1)).toMatchObject({ moving: false, pose: 'stand' });
  });
});
