import { describe, expect, it } from 'vitest';
import { hostAllowed, hostnameOf, isLoopbackHost, originAllowed, parseAllowedHosts, wsOriginAllowed } from './guard';

describe('guarda de Host/Origin', () => {
  const allowed = parseAllowedHosts(' Meu-Mac.local:4747 , escritorio.lan ');

  it('hostnameOf e OFFICE_ALLOWED_HOSTS', () => {
    expect([...allowed]).toEqual(['meu-mac.local', 'escritorio.lan']);
    expect(hostnameOf('LocalHost:4747')).toBe('localhost');
    expect(hostnameOf('[::1]:4747')).toBe('::1');
    expect(hostnameOf('a b')).toBeUndefined();
    expect(hostnameOf('[::1]lixo')).toBeUndefined();
  });

  it('Host: IPs, localhost e liberados sim; domínios de fora não', () => {
    expect(hostAllowed(undefined, allowed)).toBe(true);
    for (const h of ['localhost:4747', 'app.localhost', '127.0.0.1:4747', '[::1]:1', '10.0.0.5:4747', 'meu-mac.local:4747']) expect(hostAllowed(h, allowed)).toBe(true);
    for (const h of ['attacker.example:4747', 'localhost.attacker.example', '127.0.0.1.nip.io', '', 'x y']) expect(hostAllowed(h, allowed)).toBe(false);
  });

  it('isLoopbackHost: só localhost, *.localhost, 127.x e ::1 (terminal somente leitura)', () => {
    for (const h of ['localhost:4747', 'LOCALHOST', 'app.localhost:1', '127.0.0.1:4747', '127.8.9.10', '[::1]:4747']) expect(isLoopbackHost(h)).toBe(true);
    for (const h of [undefined, '', '10.0.0.5:4747', '192.168.0.10', '0.0.0.0:4747', 'escritorio.lan', 'meu-mac.local:4747', '[::]:4747', 'localhost.attacker.example', '127.0.0.1.nip.io', 'x y']) {
      expect(isLoopbackHost(h)).toBe(false);
    }
  });

  it('Origin: ausente, mesma origem ou local', () => {
    expect(originAllowed(undefined, 'localhost:4747', allowed)).toBe(true);
    expect(originAllowed('http://localhost:4747', 'localhost:4747', allowed)).toBe(true);
    expect(originAllowed('http://localhost:5173', '127.0.0.1:4747', allowed)).toBe(true); // Vite dev com proxy
    expect(originAllowed('http://192.168.0.10:4747', '192.168.0.10:4747', allowed)).toBe(true);
    expect(originAllowed('http://attacker.example', 'localhost:4747', allowed)).toBe(false);
    expect(originAllowed('http://1.2.3.4', 'localhost:4747', allowed)).toBe(false);
    expect(originAllowed('null', 'localhost:4747', allowed)).toBe(false);
    expect(originAllowed('file://', 'localhost:4747', allowed)).toBe(false);
  });
});

describe('wsOriginAllowed', () => {
  const cfg = { allowedHosts: new Set(['office.example.com']) };
  const req = (origin: string | undefined, host = 'office.example.com') => ({ headers: { origin, host } }) as never;
  it('exige Origin e aceita a mesma origem ou host liberado', () => {
    expect(wsOriginAllowed(req(undefined), cfg)).toBe(false);
    expect(wsOriginAllowed(req('https://office.example.com'), cfg)).toBe(true);
    expect(wsOriginAllowed(req('https://x.example'), cfg)).toBe(false);
    expect(wsOriginAllowed(req('null'), cfg)).toBe(false);
  });
});
