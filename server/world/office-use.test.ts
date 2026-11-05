import { describe, expect, it } from 'vitest';
import { createDocBuilder } from '../../shared/map/doc-builder';
import { USE_PREP_MS } from './office';
import { makeWorld } from '../test/world-helpers';

/** Salão 20×12 com café, bebedouro e arcade; spawn em (2,10). */
function useDoc() {
  const b = createDocBuilder({ w: 20, h: 12 });
  const a = b.area('hall', { x: 0, y: 0, w: 20, h: 12 }, { name: 'Salão', kind: 'open', walls: false });
  a.furn('coffee_machine', 10, 3);
  a.furn('water_cooler', 14, 3);
  a.furn('arcade', 17, 3);
  b.spawn(2, 10);
  return b.build();
}

async function setup() {
  const w = makeWorld(useDoc());
  const a = await w.join(1);
  const b = await w.join(2);
  const spots = w.office.assembly.spots;
  const coffee = spots.find((s) => s.kind === 'coffee')!;
  const water = spots.find((s) => s.kind === 'water')!;
  const arcade = spots.find((s) => s.kind === 'arcade')!;
  return { w, a, b, coffee, water, arcade };
}

describe('Office — usar (use)', () => {
  it('longe: anda até o spot e usa ao chegar (café: use -> drink com held coffee)', async () => {
    const { w, coffee } = await setup();
    w.office.teleport(1, 2, 10);
    await w.office.handle(1, { t: 'use', spot: coffee.id });
    expect(w.office.stateOf(1)?.using).toBeUndefined();
    w.run(0.2);
    expect(w.office.stateOf(1)).toMatchObject({ pose: 'walk', moving: true });
    for (let i = 0; i < 400 && !w.office.stateOf(1)?.using; i++) w.run(0.05);
    const st = w.office.stateOf(1)!;
    expect(st).toMatchObject({ using: coffee.id, dir: coffee.dir, moving: false, pose: 'use', held: 'none' });
    expect(w.office.posOf(1)).toMatchObject({ x: coffee.x, y: coffee.y });
    w.run(USE_PREP_MS / 1000 + 0.2);
    expect(w.office.stateOf(1)).toMatchObject({ pose: 'drink', held: 'coffee' });
    // 6 s no total: solta
    w.run(4);
    expect(w.office.stateOf(1)).toMatchObject({ pose: 'stand', held: 'none' });
    expect(w.office.stateOf(1)?.using).toBeUndefined();
    expect(w.office.useOwners.size).toBe(0);
  });

  it('perto: usa direto; arcade = game com controller até apertar de novo', async () => {
    const { w, arcade } = await setup();
    w.office.teleport(1, arcade.tx, arcade.ty);
    await w.office.handle(1, { t: 'use', spot: arcade.id });
    w.run(1);
    expect(w.office.stateOf(1)).toMatchObject({ using: arcade.id, pose: 'game', held: 'controller' });
    w.run(30);
    expect(w.office.stateOf(1)?.pose).toBe('game');
    await w.office.handle(1, { t: 'use', spot: arcade.id });
    w.run(1);
    expect(w.office.stateOf(1)).toMatchObject({ pose: 'stand', held: 'none' });
  });

  it('arcade termina sozinho em 120 s', async () => {
    const { w, arcade } = await setup();
    w.office.teleport(1, arcade.tx, arcade.ty);
    await w.office.handle(1, { t: 'use', spot: arcade.id });
    w.run(119);
    expect(w.office.stateOf(1)?.using).toBe(arcade.id);
    w.run(3);
    expect(w.office.stateOf(1)?.using).toBeUndefined();
  });

  it('exclusividade: o segundo é recusado enquanto o primeiro usa ou vai usar', async () => {
    const { w, b, coffee } = await setup();
    w.office.teleport(1, coffee.tx, coffee.ty);
    await w.office.handle(1, { t: 'use', spot: coffee.id });
    w.office.teleport(2, coffee.tx + 1, coffee.ty);
    b.clear();
    await w.office.handle(2, { t: 'use', spot: coffee.id });
    expect(b.last('moved_reject')?.reason).toBe('seat_taken');
    w.run(1);
    expect(w.office.stateOf(2)?.using).toBeUndefined();
    // depois que o primeiro solta, o segundo consegue
    w.run(7);
    await w.office.handle(2, { t: 'use', spot: coffee.id });
    w.run(1);
    expect(w.office.stateOf(2)?.using).toBe(coffee.id);
  });

  it('mover, levantar ou andar por tecla libera o spot e a mão', async () => {
    const { w, coffee, water } = await setup();
    w.office.teleport(1, coffee.tx, coffee.ty);
    await w.office.handle(1, { t: 'use', spot: coffee.id });
    w.run(3.5);
    expect(w.office.stateOf(1)).toMatchObject({ pose: 'drink', held: 'coffee' });
    await w.office.handle(1, { t: 'move_to', x: 5, y: 8 });
    expect(w.office.useOwners.size).toBe(0);
    w.run(0.3);
    expect(w.office.stateOf(1)).toMatchObject({ held: 'none' });
    expect(w.office.stateOf(1)?.using).toBeUndefined();

    w.office.teleport(1, water.tx, water.ty);
    await w.office.handle(1, { t: 'use', spot: water.id });
    w.run(1);
    expect(w.office.stateOf(1)?.using).toBe(water.id);
    await w.office.handle(1, { t: 'stand' });
    w.run(0.5);
    expect(w.office.stateOf(1)?.using).toBeUndefined();
    expect(w.office.useOwners.size).toBe(0);

    await w.office.handle(1, { t: 'use', spot: water.id });
    w.run(1);
    await w.office.handle(1, { t: 'move_dir', dir: 'down' });
    w.run(0.1);
    expect(w.office.useOwners.size).toBe(0);
  });

  it('spot inexistente é recusado', async () => {
    const { w, a } = await setup();
    await w.office.handle(1, { t: 'use', spot: 'nada#x:coffee' });
    expect(a.last('moved_reject')?.reason).toBe('invalid');
  });
});
