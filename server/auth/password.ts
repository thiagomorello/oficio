// Senhas: bcrypt (bcryptjs), senha mestra opcional (somente dev), temporárias e tokens de uso único.
import bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { ServerConfig } from '../config';
import { log } from '../log';

const BCRYPT_COST = 10;
const TEMP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** Hash que nunca confere com nada; usado para igualar o tempo de resposta quando o e-mail não existe. */
export const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', BCRYPT_COST);

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Senha mestra efetiva: só vale com `config.dev`; em produção é ignorada (com aviso no boot). */
export function effectiveMasterPassword(config: Pick<ServerConfig, 'dev' | 'loginMasterPassword'>, warn = true): string | undefined {
  if (!config.loginMasterPassword) return undefined;
  if (config.dev) return config.loginMasterPassword;
  if (warn) log.warn('LOGIN_MASTER_PASSWORD is set outside --dev mode: it will be IGNORED. Remove it from the environment.');
  return undefined;
}

/** Confere a senha com o hash bcrypt ($2y$ é tratado como $2a$). `master` só deve vir de `effectiveMasterPassword`. */
export async function verify(plain: string, hash: string, master?: string): Promise<boolean> {
  if (master !== undefined && safeEqual(plain, master)) return true;
  try {
    return await bcrypt.compare(plain, hash.replace(/^\$2y\$/, '$2a$'));
  } catch {
    return false;
  }
}

export function hash(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

/** Senha temporária de 12 caracteres (sem caracteres ambíguos). */
export function tempPassword(): string {
  let out = '';
  for (let i = 0; i < 12; i++) out += TEMP_ALPHABET[randomInt(TEMP_ALPHABET.length)];
  return out;
}

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** Token de uso único: `raw` vai para o usuário (base64url, 32 bytes); só o `hash` (sha256 hex) é gravado. */
export function tokenPair(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: sha256Hex(raw) };
}
