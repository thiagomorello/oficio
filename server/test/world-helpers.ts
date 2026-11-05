// Utilitários dos testes do mundo: conexões falsas, relógio manual, usuários e mapas pequenos.
import { assembleOffice } from '../../shared/map/assemble';
import { createDocBuilder } from '../../shared/map/doc-builder';
import type { OfficeMapDoc } from '../../shared/map/doc';
import { twoAreaDoc } from '../../shared/map/test-fixtures';
import type { Locale } from '../../shared/branding';
import type { ServerMsg } from '../../shared/protocol';
import type { SessionLike, SessionUser } from '../auth/session-types';
import { Office, type OfficeOptions } from '../world/office';
import type { Conn } from '../ws/outbox';
import { createFakeRepos } from './fakeDb';

export class FakeConn implements Conn {
  msgs: ServerMsg[] = [];
  open = true;
  closedWith: { code?: number; reason?: string } | null = null;
  readonly ip = '127.0.0.1';
  sendRaw(data: string): void {
    if (this.open) this.msgs.push(JSON.parse(data) as ServerMsg);
  }
  close(code?: number, reason?: string): void {
    this.open = false;
    this.closedWith = { code, reason };
  }
  isOpen(): boolean {
    return this.open;
  }
  of<K extends ServerMsg['t']>(t: K): Extract<ServerMsg, { t: K }>[] {
    return this.msgs.filter((m): m is Extract<ServerMsg, { t: K }> => m.t === t);
  }
  last<K extends ServerMsg['t']>(t: K): Extract<ServerMsg, { t: K }> | undefined {
    const l = this.of(t);
    return l[l.length - 1];
  }
  clear(): void {
    this.msgs = [];
  }
}

export function sessionUser(id: number, over: Partial<SessionUser> = {}): SessionUser {
  return {
    id,
    name: `Pessoa ${id}`,
    email: `p${id}@example.com`,
    displayName: null,
    isAdmin: false,
    needsPasswordChange: false,
    appearance: null,
    settings: null,
    roleName: 'Suporte',
    ...over,
  };
}

/**
 * Salão aberto 20×12 sem paredes, com um bloco de móveis/divisória em (5..9, 3..7) e spawn em (2,10).
 */
export function hallDoc(): OfficeMapDoc {
  const b = createDocBuilder({ w: 20, h: 12 });
  b.area('hall', { x: 0, y: 0, w: 20, h: 12 }, { name: 'Salão', kind: 'open', walls: false }).block(5, 3, 5, 5);
  b.spawn(2, 10);
  return b.build();
}

export { twoAreaDoc };

export interface World {
  office: Office;
  repos: ReturnType<typeof createFakeRepos>;
  clock: { t: number };
  /** Avança o relógio e o tick em passos de 50 ms. */
  run(seconds: number): void;
  /** `locale`: idioma da conexão (padrão: o do mundo, pt-BR nos testes). */
  join(id: number, over?: Partial<SessionUser>, locale?: Locale): Promise<FakeConn>;
}

export function makeWorld(doc: OfficeMapDoc = twoAreaDoc(), extra: Partial<OfficeOptions> = {}): World {
  const clock = { t: 1_700_000_000_000 };
  const repos = createFakeRepos({ now: () => new Date(clock.t) });
  // Os testes comparam textos em pt-BR (idioma original do projeto); `extra.defaultLocale` pode sobrescrever.
  const office = new Office({ repos, assembly: assembleOffice(doc, 1), now: () => clock.t, defaultLocale: 'pt-BR', ...extra });
  return {
    office,
    repos,
    clock,
    run(seconds) {
      const n = Math.round(seconds / 0.05);
      for (let i = 0; i < n; i++) {
        clock.t += 50;
        office.step(0.05);
      }
    },
    async join(id, over, locale) {
      const c = new FakeConn();
      await office.join(sessionUser(id, over), c, locale);
      return c;
    },
  };
}

/** Sessão falsa: cookie `office_session=test` -> usuário 1 (ou `office_session=u<N>` -> N). */
export function fakeSession(revalidate: SessionLike['revalidate'] = (id) => ({ ok: true, user: sessionUser(id) })): SessionLike {
  return {
    userFromRequest(req) {
      const cookie = req.headers.cookie ?? '';
      const m = /(?:^|;\s*)office_session=([^;]+)/.exec(cookie);
      if (!m) return null;
      if (m[1] === 'test') return sessionUser(1);
      const n = /^u(\d+)$/.exec(m[1]);
      return n ? sessionUser(Number(n[1])) : null;
    },
    revalidate,
  };
}
