import { describe, expect, it } from 'vitest';
import { decodeClient } from '../../shared/protocol';
import { makeWorld } from '../test/world-helpers';
import { AUTO_AWAY_MS, MEDIA_SPEAKING_MS } from './office';

describe('Office — estado de A/V (media)', () => {
  it('valida a mensagem do cliente', () => {
    expect(decodeClient(JSON.stringify({ t: 'media', mic: true, cam: false, screen: false }))).toEqual({ t: 'media', mic: true, cam: false, screen: false });
    expect(decodeClient(JSON.stringify({ t: 'media', mic: true, cam: false, screen: false, speaking: true }))?.t).toBe('media');
    expect(decodeClient(JSON.stringify({ t: 'media', mic: 1, cam: false, screen: false }))).toBeNull();
    expect(decodeClient(JSON.stringify({ t: 'media', mic: true, cam: false }))).toBeNull();
    expect(decodeClient(JSON.stringify({ t: 'media', mic: true, cam: false, screen: false, extra: 1 }))).toBeNull();
  });

  it('difunde mudanças para todos e só quando muda', async () => {
    const w = makeWorld();
    const a = await w.join(1);
    const b = await w.join(2);
    a.clear();
    b.clear();
    await w.office.handle(1, { t: 'media', mic: true, cam: false, screen: false });
    expect(b.of('media')).toEqual([{ t: 'media', id: 1, mic: true, cam: false, screen: false, speaking: false }]);
    expect(a.of('media')).toHaveLength(1);
    await w.office.handle(1, { t: 'media', mic: true, cam: false, screen: false });
    expect(b.of('media')).toHaveLength(1);
    await w.office.handle(1, { t: 'media', mic: true, cam: true, screen: false });
    expect(b.last('media')).toMatchObject({ id: 1, cam: true });
    expect(b.of('media')).toHaveLength(2);
  });

  it('welcome e join carregam o estado de A/V', async () => {
    const w = makeWorld();
    await w.join(1);
    await w.office.handle(1, { t: 'media', mic: true, cam: true, screen: false });
    const b = await w.join(2);
    const welcome = b.last('welcome')!;
    expect(welcome.users.find((u) => u.id === 1)?.media).toEqual({ mic: true, cam: true, screen: false, speaking: false });
    expect(welcome.users.find((u) => u.id === 2)?.media).toBeUndefined();
  });

  it('fala: limitada a 1 a cada 300 ms, o último valor vence', async () => {
    const w = makeWorld();
    await w.join(1);
    const b = await w.join(2);
    await w.office.handle(1, { t: 'media', mic: true, cam: false, screen: false });
    b.clear();
    await w.office.handle(1, { t: 'media', mic: true, cam: false, screen: false, speaking: true });
    // a ligação do mic foi agora: a fala espera a janela
    expect(b.of('media')).toHaveLength(0);
    await w.office.handle(1, { t: 'media', mic: true, cam: false, screen: false, speaking: false });
    await w.office.handle(1, { t: 'media', mic: true, cam: false, screen: false, speaking: true });
    w.run(MEDIA_SPEAKING_MS / 1000 + 0.05);
    expect(b.of('media')).toEqual([{ t: 'media', id: 1, mic: true, cam: false, screen: false, speaking: true }]);

    // voltou ao valor já difundido dentro da janela: nada sai
    await w.office.handle(1, { t: 'media', mic: true, cam: false, screen: false, speaking: false });
    await w.office.handle(1, { t: 'media', mic: true, cam: false, screen: false, speaking: true });
    w.run(1);
    expect(b.of('media')).toHaveLength(1);

    // sem `speaking`, mantém o anterior; mic desligado zera a fala e sai na hora
    await w.office.handle(1, { t: 'media', mic: false, cam: false, screen: false });
    expect(b.last('media')).toMatchObject({ mic: false, speaking: false });
    expect(b.of('media')).toHaveLength(2);
  });

  it('tela só vale em sala de reunião e desliga ao sair dela', async () => {
    const w = makeWorld();
    await w.join(1);
    const b = await w.join(2);
    await w.office.handle(1, { t: 'media', mic: true, cam: false, screen: true });
    expect(w.office.mediaOf(1)?.screen).toBe(false);

    w.office.teleport(1, 6, 4);
    await w.office.handle(1, { t: 'media', mic: true, cam: false, screen: true });
    expect(w.office.mediaOf(1)?.screen).toBe(true);
    expect(b.last('media')).toMatchObject({ id: 1, screen: true });

    w.office.teleport(1, 10, 10);
    expect(w.office.mediaOf(1)?.screen).toBe(false);
    expect(b.last('media')).toMatchObject({ id: 1, screen: false, mic: true });
  });

  it('desconectar zera o A/V para os outros', async () => {
    const w = makeWorld();
    const a = await w.join(1);
    const b = await w.join(2);
    await w.office.handle(1, { t: 'media', mic: true, cam: true, screen: false, speaking: true });
    b.clear();
    w.office.leave(1, a);
    expect(b.of('media')).toEqual([{ t: 'media', id: 1, mic: false, cam: false, screen: false, speaking: false }]);
    expect(w.office.mediaOf(1)).toBeNull();
    // reconexão dentro da carência: sem `media` até o cliente mandar de novo
    const c = await w.join(3);
    expect(c.last('welcome')!.users.find((u) => u.id === 1)?.media).toBeUndefined();
  });

  it('não conta como atividade (auto-away continua valendo)', async () => {
    const w = makeWorld();
    await w.join(1);
    w.run(AUTO_AWAY_MS / 1000 - 1);
    await w.office.handle(1, { t: 'media', mic: true, cam: false, screen: false, speaking: true });
    w.run(2);
    expect(w.office.posOf(1)!.status).toBe('away');
  });
});
