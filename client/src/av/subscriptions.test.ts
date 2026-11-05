import { describe, expect, it } from 'vitest';
import {
  SubscriptionReconciler, lkIdentity, userIdFromIdentity, wantsTrack,
  type AvSetMsg, type RemoteParticipantLike, type RemotePublicationLike, type RoomLike,
} from './subscriptions';

class FakePub implements RemotePublicationLike {
  calls: boolean[] = [];
  constructor(readonly trackSid: string, readonly source: string) {}
  setSubscribed(s: boolean): void {
    this.calls.push(s);
  }
}

class FakeRemote implements RemoteParticipantLike {
  trackPublications = new Map<string, FakePub>();
  volumes: number[] = [];
  constructor(readonly identity: string, sources: string[] = ['microphone', 'camera']) {
    sources.forEach((s, i) => this.trackPublications.set(`${identity}-T${i}`, new FakePub(`${identity}-T${i}`, s)));
  }
  pub(source: string): FakePub {
    return [...this.trackPublications.values()].find((p) => p.source === source)!;
  }
  setVolume(v: number): void {
    this.volumes.push(v);
  }
}

class FakeRoom implements RoomLike {
  remoteParticipants = new Map<string, FakeRemote>();
  perms: { all: boolean; list: { participantIdentity: string; allowAll: boolean }[] }[] = [];
  localParticipant = {
    setTrackSubscriptionPermissions: (all: boolean, list: { participantIdentity: string; allowAll: boolean }[] = []) => {
      this.perms.push({ all, list });
    },
  };
  add(p: FakeRemote): FakeRemote {
    this.remoteParticipants.set(p.identity, p);
    return p;
  }
}

const av = (hear: number[], volumes: Record<string, number> = {}, screenAllowed = false, allow = hear): AvSetMsg => ({
  t: 'av_set', hear, allow, volumes, screenAllowed,
});

describe('identidades', () => {
  it('u<id> <-> id', () => {
    expect(lkIdentity(12)).toBe('u12');
    expect(userIdFromIdentity('u12')).toBe(12);
    expect(userIdFromIdentity('admin')).toBeNull();
    expect(userIdFromIdentity('u12x')).toBeNull();
  });

  it('wantsTrack: tela só com screenAllowed', () => {
    expect(wantsTrack(av([2]), 2, 'microphone')).toBe(true);
    expect(wantsTrack(av([2]), 3, 'microphone')).toBe(false);
    expect(wantsTrack(av([2]), 2, 'screen_share')).toBe(false);
    expect(wantsTrack(av([2], {}, true), 2, 'screen_share')).toBe(true);
    expect(wantsTrack(av([2], {}, true), 2, 'screen_share_audio')).toBe(true);
    expect(wantsTrack(null, 2, 'camera')).toBe(false);
  });
});

describe('SubscriptionReconciler', () => {
  it('assina quem eu ouço e só chama setSubscribed nas diferenças', () => {
    const room = new FakeRoom();
    const a = room.add(new FakeRemote('u2'));
    const b = room.add(new FakeRemote('u3'));
    const r = new SubscriptionReconciler({ selfId: () => 1 });

    r.reconcile(room, av([2]));
    expect(a.pub('microphone').calls).toEqual([true]);
    expect(a.pub('camera').calls).toEqual([true]);
    expect(b.pub('microphone').calls).toEqual([false]);

    // mesmo av_set: nenhuma chamada nova
    r.reconcile(room, av([2]));
    expect(a.pub('microphone').calls).toEqual([true]);
    expect(b.pub('microphone').calls).toEqual([false]);

    // 3 entra, 2 sai
    r.reconcile(room, av([3]));
    expect(a.pub('microphone').calls).toEqual([true, false]);
    expect(b.pub('microphone').calls).toEqual([false, true]);
    expect(b.pub('camera').calls).toEqual([false, true]);
  });

  it('faixa publicada depois entra no próximo reconcile; participante novo também', () => {
    const room = new FakeRoom();
    const a = room.add(new FakeRemote('u2', ['microphone']));
    const r = new SubscriptionReconciler({ selfId: () => 1 });
    r.reconcile(room, av([2, 4]));
    a.trackPublications.set('cam', new FakePub('cam', 'camera'));
    const c = room.add(new FakeRemote('u4', ['microphone']));
    r.reconcile(room, av([2, 4]));
    expect(a.pub('microphone').calls).toEqual([true]);
    expect(a.pub('camera').calls).toEqual([true]);
    expect(c.pub('microphone').calls).toEqual([true]);
  });

  it('tela só na mesma sala de reunião', () => {
    const room = new FakeRoom();
    const a = room.add(new FakeRemote('u2', ['microphone', 'screen_share', 'screen_share_audio']));
    const r = new SubscriptionReconciler({ selfId: () => 1 });
    r.reconcile(room, av([2], {}, false));
    expect(a.pub('microphone').calls).toEqual([true]);
    expect(a.pub('screen_share').calls).toEqual([false]);
    expect(a.pub('screen_share_audio').calls).toEqual([false]);
    r.reconcile(room, av([2], {}, true));
    expect(a.pub('screen_share').calls).toEqual([false, true]);
    expect(a.pub('screen_share_audio').calls).toEqual([false, true]);
    expect(a.pub('microphone').calls).toEqual([true]);
  });

  it('aplica volumes (com o volume geral) só quando mudam', () => {
    const room = new FakeRoom();
    const a = room.add(new FakeRemote('u2'));
    const b = room.add(new FakeRemote('u3'));
    let master = 1;
    const r = new SubscriptionReconciler({ selfId: () => 1, masterVolume: () => master });
    r.reconcile(room, av([2, 3], { 2: 0.5 }));
    expect(a.volumes).toEqual([0.5]);
    expect(b.volumes).toEqual([1]); // sem volume no av_set: 1
    r.reconcile(room, av([2, 3], { 2: 0.5 }));
    expect(a.volumes).toEqual([0.5]);
    master = 0.5;
    r.reconcile(room, av([2, 3], { 2: 0.5, 3: 0.8 }));
    expect(a.volumes).toEqual([0.5, 0.25]);
    expect(b.volumes).toEqual([1, 0.4]);
  });

  it('ignora identidades estranhas e a minha própria', () => {
    const room = new FakeRoom();
    const bot = room.add(new FakeRemote('recorder'));
    const me = room.add(new FakeRemote('u1'));
    const r = new SubscriptionReconciler({ selfId: () => 1 });
    r.reconcile(room, av([1]));
    expect(bot.pub('microphone').calls).toEqual([false]);
    expect(bot.volumes).toEqual([]);
    expect(me.pub('microphone').calls).toEqual([false]);
  });

  it('permissões do publicador: exatamente `allow`, sem repetir; force reaplica', () => {
    const room = new FakeRoom();
    const r = new SubscriptionReconciler({ selfId: () => 1 });
    r.applyPermissions(room, null);
    expect(room.perms).toEqual([{ all: false, list: [] }]);
    r.applyPermissions(room, av([3, 2, 1]));
    expect(room.perms[1]).toEqual({
      all: false,
      list: [{ participantIdentity: 'u2', allowAll: true }, { participantIdentity: 'u3', allowAll: true }],
    });
    r.applyPermissions(room, av([2, 3]));
    expect(room.perms).toHaveLength(2);
    r.applyPermissions(room, av([2, 3]), true);
    expect(room.perms).toHaveLength(3);
    r.applyPermissions(room, av([]));
    expect(room.perms[3]).toEqual({ all: false, list: [] });
  });

  it('reset esquece o estado aplicado (nova sala)', () => {
    const room = new FakeRoom();
    const a = room.add(new FakeRemote('u2', ['microphone']));
    const r = new SubscriptionReconciler({ selfId: () => 1 });
    r.reconcile(room, av([2]));
    r.reset();
    r.reconcile(room, av([2]));
    expect(a.pub('microphone').calls).toEqual([true, true]);
  });
});
