import { describe, expect, it } from 'vitest';
import { SoundScheduler, DEFAULT_SOUND_SETTINGS } from '../audio/scheduler';
import { cueFor, flashTitle, newlyHeard } from './sound-cues';

const on = { selfId: 1, enabled: true };

describe('cueFor', () => {
  it('chat: tom diferente para Perto e Sala; nunca para mim', () => {
    expect(cueFor({ t: 'chat', scope: 'near', from: 2 }, on)).toBe('pop');
    expect(cueFor({ t: 'chat', scope: 'room', from: 2 }, on)).toBe('note');
    expect(cueFor({ t: 'chat', scope: 'global', from: 2 }, on)).toBe('note');
    expect(cueFor({ t: 'chat', scope: 'near', from: 1 }, on)).toBeNull();
  });
  it('batida, resposta, entrada e queda', () => {
    expect(cueFor({ t: 'knock' }, on)).toBe('chime');
    expect(cueFor({ t: 'knock_result', allow: true }, on)).toBe('note');
    expect(cueFor({ t: 'knock_result', allow: false }, on)).toBe('low');
    expect(cueFor({ t: 'near_join' }, on)).toBe('pop');
    expect(cueFor({ t: 'kick' }, on)).toBe('low');
    expect(cueFor({ t: 'disconnect' }, on)).toBe('low');
  });
  it('respeita a preferência sounds', () => {
    const off = { selfId: 1, enabled: false };
    expect(cueFor({ t: 'knock' }, off)).toBeNull();
    expect(cueFor({ t: 'chat', scope: 'near', from: 2 }, off)).toBeNull();
    expect(cueFor({ t: 'kick' }, off)).toBeNull();
  });
});

describe('newlyHeard', () => {
  it('primeiro conjunto não toca; depois só os novos (sem eu)', () => {
    expect(newlyHeard(null, [2, 3], 1)).toEqual([]);
    expect(newlyHeard([2], [1, 2, 3], 1)).toEqual([3]);
    expect(newlyHeard([2, 3], [2], 1)).toEqual([]);
  });
});

describe('flashTitle', () => {
  it('prefixa a contagem de não lidas', () => {
    expect(flashTitle('Escritório', 0)).toBe('Escritório');
    expect(flashTitle('Escritório', 1)).toBe('(1) nova mensagem · Escritório');
    expect(flashTitle('Escritório', 3)).toBe('(3) novas mensagens · Escritório');
  });
});

describe('novos sons no agendador', () => {
  it('note/low tocam com a aba oculta; pop não', () => {
    const s = new SoundScheduler();
    s.configure(true, DEFAULT_SOUND_SETTINGS);
    expect(s.decide('note', 0, { hidden: true })).not.toBeNull();
    expect(s.decide('low', 5_000, { hidden: true })).not.toBeNull();
    expect(s.decide('pop', 10_000, { hidden: true })).toBeNull();
  });
});
