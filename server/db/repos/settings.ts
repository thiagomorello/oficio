import type { Db } from '../pool';

/** Chaves conhecidas de office_settings. */
export const SETTING_PUBLISHED_MAP_ID = 'published_map_id';

export interface SettingsRepo {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export function createMysqlSettingsRepo(db: Db): SettingsRepo {
  return {
    async get(key) {
      const rows = await db.query<{ v: string }>('SELECT v FROM office_settings WHERE k = ? LIMIT 1', [key]);
      return rows[0] ? String(rows[0].v) : null;
    },
    async set(key, value) {
      await db.exec('INSERT INTO office_settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)', [key, value]);
    },
  };
}
