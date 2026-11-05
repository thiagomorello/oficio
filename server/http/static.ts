// Arquivos do cliente compilado (dist/client) no modo produção, com fallback de SPA.
//
// Cache:
// - /bundle/* são os arquivos gerados pelo Vite com hash no nome (build.assetsDir = 'bundle'):
//   nunca mudam de conteúdo, então podem ficar em cache por 1 ano (immutable);
// - todo o resto (as páginas html e client/public: /assets/art, manifest.json...) tem nome
//   fixo e pode mudar a cada build: `no-cache` + ETag/Last-Modified, e o navegador revalida (304).
import { createReadStream, statSync, type Stats } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { DEFAULT_LOCALE, type Locale } from '../../shared/branding';
import { localeFromRequest, tFor } from '../i18n';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
};

/** Pasta dos arquivos com hash do Vite (igual a `build.assetsDir` em vite.config.ts). */
/** Páginas do cliente (3 entradas Vite); qualquer outra rota cai no index.html (SPA). */
export const ROUTES: Record<string, string> = {
  '/': 'index.html',
  '/login': 'login.html',
  '/admin': 'admin.html',
  '/admin/*': 'admin.html',
};

export function resolveRoute(pathname: string): string {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (ROUTES[p]) return ROUTES[p];
  for (const [k, v] of Object.entries(ROUTES)) if (k.endsWith('/*') && p.startsWith(k.slice(0, -1))) return v;
  return 'index.html';
}

export const HASHED_DIR = '/bundle/';
export const IMMUTABLE = 'public, max-age=31536000, immutable';
export const REVALIDATE = 'no-cache';

function fileStat(p: string): Stats | undefined {
  try {
    const st = statSync(p);
    return st.isFile() ? st : undefined;
  } catch {
    return undefined;
  }
}

/** ETag fraco a partir do tamanho e da data de modificação (barato e estável entre reinícios). */
export function etagOf(st: Pick<Stats, 'size' | 'mtimeMs'>): string {
  return `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
}

/** A cópia do navegador ainda vale? (If-None-Match tem prioridade sobre If-Modified-Since.) */
export function isNotModified(req: IncomingMessage, etag: string, mtimeMs: number): boolean {
  const inm = req.headers['if-none-match'];
  if (typeof inm === 'string' && inm.trim()) {
    const strip = (t: string) => t.trim().replace(/^W\//, '');
    const want = strip(etag);
    return inm.split(',').some((t) => t.trim() === '*' || strip(t) === want);
  }
  const ims = req.headers['if-modified-since'];
  if (typeof ims === 'string' && ims.trim()) {
    const since = Date.parse(ims);
    // Last-Modified tem resolução de segundos.
    return Number.isFinite(since) && Math.floor(mtimeMs / 1000) * 1000 <= since;
  }
  return false;
}

/** `defaultLocale`: idioma das respostas de erro em texto quando a requisição não diz o seu. */
export function createStaticHandler(distDir: string, defaultLocale: Locale = DEFAULT_LOCALE): (req: IncomingMessage, res: ServerResponse, pathname: string) => void {
  const root = resolve(distDir);
  const index = join(root, 'index.html');
  const pageOf = (pathname: string) => join(root, resolveRoute(pathname));

  const send = (req: IncomingMessage, res: ServerResponse, file: string, st: Stats, cache: string) => {
    const etag = etagOf(st);
    const headers: Record<string, string | number> = {
      'Cache-Control': cache,
      ETag: etag,
      'Last-Modified': new Date(st.mtimeMs).toUTCString(),
      'X-Content-Type-Options': 'nosniff',
      // A página não deve ser embutida em sites de terceiros (clickjacking nas configurações).
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
    };
    if (isNotModified(req, etag, st.mtimeMs)) {
      res.writeHead(304, headers);
      return void res.end();
    }
    res.writeHead(200, {
      ...headers,
      'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': st.size,
    });
    if (req.method === 'HEAD') return void res.end();
    createReadStream(file)
      .on('error', () => res.destroy())
      .pipe(res);
  };

  return (req, res, pathname) => {
    const locale = localeFromRequest(req, defaultLocale);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
      return void res.end(tFor(locale, 'server.static.methodNotAllowed'));
    }
    const indexStat = fileStat(index);
    if (!indexStat) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      return void res.end(tFor(locale, 'server.static.notBuilt'));
    }
    let rel: string;
    try {
      rel = decodeURIComponent(pathname);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      return void res.end(tFor(locale, 'server.static.invalidPath'));
    }
    const file = resolve(root, `.${rel}`);
    const inside = file === root || file.startsWith(root + sep);
    const st = inside && file !== root ? fileStat(file) : undefined;
    if (st) return send(req, res, file, st, rel.startsWith(HASHED_DIR) ? IMMUTABLE : REVALIDATE);
    if (rel.startsWith('/assets/') || rel.startsWith(HASHED_DIR)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      return void res.end(tFor(locale, 'server.static.notFound'));
    }
    // Páginas conhecidas (/login, /admin...) e SPA: o resto cai no index.html.
    const page = pageOf(rel);
    send(req, res, page, fileStat(page) ?? indexStat, REVALIDATE);
  };
}
