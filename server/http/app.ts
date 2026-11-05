// Utilidades HTTP da API (/api/*): HttpError, sendJson, readJson. As rotas entram nos próximos pacotes.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { hasMessage, type Params } from '../../shared/i18n';
import type { ReqTranslator } from '../i18n';
import { isJsonContentType } from './guard';

const MAX_BODY = 256 * 1024;

/**
 * Erro HTTP com mensagem para o usuário. `message` pode ser uma chave do i18n (`server.*`), traduzida no
 * idioma da requisição por `httpErrorMessage` na hora de responder; um texto comum passa como está.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly params?: Params,
  ) {
    super(message);
  }
}

/** Texto final do erro no idioma da requisição (chave do i18n -> tradução; texto comum -> ele mesmo). */
export function httpErrorMessage(err: HttpError, tr: ReqTranslator): string {
  return hasMessage(err.message) ? tr.t(err.message, err.params) : err.message;
}

/** Traduz uma mensagem que pode ser chave do i18n (validações compartilhadas) ou texto já pronto. */
export function translateMaybe(msg: string, tr: ReqTranslator): string {
  return hasMessage(msg) ? tr.t(msg) : msg;
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    // A API só é lida pela própria página: nada de leitura "no-cors" por outras origens.
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
  res.end(data);
}

/** Lê o corpo JSON. Exige `Content-Type: application/json` (barreira contra CSRF; ver http/guard.ts). */
export function readJson(req: IncomingMessage, maxBody: number = MAX_BODY): Promise<unknown> {
  if (!isJsonContentType(req.headers['content-type'])) {
    req.resume();
    return Promise.reject(new HttpError(415, 'server.http.badJsonContentType'));
  }
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      // Grande demais: continua drenando (sem guardar) para conseguir responder 413.
      if (size > maxBody) return void fail(new HttpError(413, 'server.http.bodyTooLarge'));
      chunks.push(c);
    });
    req.on('end', () => {
      if (size > maxBody) return;
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return ok({});
      try {
        ok(JSON.parse(raw));
      } catch {
        fail(new HttpError(400, 'server.http.invalidJson'));
      }
    });
    req.on('error', fail);
  });
}
