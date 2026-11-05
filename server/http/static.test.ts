import { describe, expect, it } from 'vitest';
import { resolveRoute } from './static';

describe('rotas estáticas', () => {
  it('mapeia páginas e cai no index.html', () => {
    expect(resolveRoute('/')).toBe('index.html');
    expect(resolveRoute('/login')).toBe('login.html');
    expect(resolveRoute('/admin')).toBe('admin.html');
    expect(resolveRoute('/admin/mapa')).toBe('admin.html');
    expect(resolveRoute('/qualquer')).toBe('index.html');
  });
});
