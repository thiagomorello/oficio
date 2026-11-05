// Migrações como módulos TS (o esbuild as empacota junto do servidor; não há .sql em runtime).
// Só acrescente ao final; nunca edite uma migração já aplicada em produção.
import { sql as s001 } from './001_init';
import { sql as s002 } from './002_maps';
import { sql as s003 } from './003_avatar';
import { sql as s004 } from './004_desk_decor';
import { sql as s005 } from './005_telemetry';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  { version: 1, name: '001_init', sql: s001 },
  { version: 2, name: '002_maps', sql: s002 },
  { version: 3, name: '003_avatar', sql: s003 },
  { version: 4, name: '004_desk_decor', sql: s004 },
  { version: 5, name: '005_telemetry', sql: s005 },
];
