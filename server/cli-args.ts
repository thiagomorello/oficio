// Parser mínimo de argumentos da CLI (sem dependências).
import { randomBytes } from 'node:crypto';

export const COMMANDS = ['migrate', 'import-json', 'create-admin', 'reset-password'] as const;
export type Command = (typeof COMMANDS)[number];

export interface CliArgs {
  command: Command;
  positional: string[];
  dryRun: boolean;
  adoptLocal: boolean;
  email?: string;
  name?: string;
  password?: string;
}

const BOOL_FLAGS = new Set(['dry-run', 'adopt-local']);
const VALUE_FLAGS = new Set(['email', 'name', 'password']);

export class UsageError extends Error {}

export function parseArgs(argv: string[]): CliArgs {
  const [cmd, ...rest] = argv;
  if (!cmd || !(COMMANDS as readonly string[]).includes(cmd)) {
    throw new UsageError(cmd ? `unknown command: ${cmd}` : 'specify a command');
  }
  const out: CliArgs = { command: cmd as Command, positional: [], dryRun: false, adoptLocal: false };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (!a.startsWith('--')) {
      out.positional.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    const key = a.slice(2, eq < 0 ? undefined : eq);
    if (BOOL_FLAGS.has(key)) {
      if (eq >= 0) throw new UsageError(`--${key} does not take a value`);
      if (key === 'dry-run') out.dryRun = true;
      else out.adoptLocal = true;
    } else if (VALUE_FLAGS.has(key)) {
      const value = eq >= 0 ? a.slice(eq + 1) : rest[++i];
      if (value === undefined || (eq < 0 && value.startsWith('--'))) throw new UsageError(`--${key} requires a value`);
      (out as unknown as Record<string, unknown>)[key] = value;
    } else {
      throw new UsageError(`unknown option: --${key}`);
    }
  }
  return out;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/** Senha temporária de 12 caracteres (sem ambíguos), sem viés de módulo. */
export function generateTempPassword(len = 12): string {
  let out = '';
  const limit = 256 - (256 % ALPHABET.length);
  while (out.length < len) {
    for (const b of randomBytes(len * 2)) {
      if (b >= limit) continue;
      out += ALPHABET[b % ALPHABET.length];
      if (out.length === len) break;
    }
  }
  return out;
}
