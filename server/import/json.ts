// Importação de usuários a partir de um arquivo JSON (array de objetos; ver docs/admin-guide.md).
import { readFile } from 'node:fs/promises';

export function parseImportJson(text: string): Record<string, unknown>[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('file is not valid JSON');
  }
  if (!Array.isArray(data)) throw new Error('the JSON must be an array of users');
  return data.map((x, i) => {
    if (!x || typeof x !== 'object' || Array.isArray(x)) throw new Error(`item ${i} is not an object`);
    return x as Record<string, unknown>;
  });
}

export async function readImportJson(path: string): Promise<Record<string, unknown>[]> {
  return parseImportJson(await readFile(path, 'utf8'));
}
