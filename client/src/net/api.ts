// Cliente HTTP da API (/api/*): JSON, cookie de sessão same-origin, erros tipados.
import { t } from '../i18n';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(messageOf(body, status));
    this.name = 'ApiError';
  }
  /** Código opcional devolvido pelo servidor (ex.: 'disabled'). */
  get code(): string | undefined {
    const c = (this.body as { code?: unknown } | null)?.code;
    return typeof c === 'string' ? c : undefined;
  }
}

function messageOf(body: unknown, status: number): string {
  const e = (body as { error?: unknown } | null)?.error;
  return typeof e === 'string' && e ? e : t('common.errorStatus', { status });
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
  if (body !== undefined || method === 'POST' || method === 'PUT') {
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body ?? {});
  }
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(0, { error: t('common.offline') });
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text.slice(0, 200) };
    }
  }
  if (res.status === 401 && !location.pathname.startsWith('/login')) {
    location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

export const api = {
  get: <T = unknown>(path: string) => request<T>('GET', path),
  post: <T = unknown>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T = unknown>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T = unknown>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T = unknown>(path: string) => request<T>('DELETE', path),
};
