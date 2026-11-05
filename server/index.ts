// Servidor do Oficio.
//   npm run dev    -> tsx server/index.ts --dev (Vite em middleware mode, HMR no mesmo servidor)
//   npm start      -> node dist/server/index.js (serve dist/client)
import { createApp } from './app-factory';
import { loadConfig } from './config';
import { runMigrations } from './db/migrate';
import { createDb, type Db } from './db/pool';
import { createMysqlRepos, type Repos } from './db/repos/index';
import { errMsg, log } from './log';
import { loadBootMap } from './world/boot-map';

const config = loadConfig(process.argv, process.env);
for (const w of config.warnings) log.warn(w);

let db: Db | undefined;
let repos: Repos;
if (config.databaseUrl) {
  db = createDb({ url: config.databaseUrl });
  try {
    await runMigrations(db, log);
  } catch (err) {
    log.error(`Database migration failed: ${errMsg(err)}`);
    process.exit(1);
  }
  repos = createMysqlRepos(db);
} else if (config.dev || config.inMemory) {
  log.warn('DATABASE_URL not set: using in-memory repositories (data is lost on restart).');
  const { createFakeRepos } = await import('./test/fakeDb');
  repos = createFakeRepos();
  // Conta de desenvolvimento para entrar sem banco: dev@oficio.local / dev12345 (admin).
  const { hash } = await import('./auth/password');
  await repos.users.createLocal({ name: 'Dev', email: 'dev@oficio.local', password_hash: await hash('dev12345'), role_name: 'SuperAdmin', is_admin: true, must_change_password: false });
  log.warn('Development user created: dev@oficio.local / dev12345');
} else {
  log.error('DATABASE_URL not set (required unless OFFICE_DEV=1 or OFFICE_IN_MEMORY=1).');
  process.exit(1);
}

const { doc: mapDoc, id: mapId } = await loadBootMap(repos, log, config.defaultLocale);
const app = await createApp({ config, repos, db, mapDoc, mapId });

app.server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') log.error(`Port ${config.port} is already in use (set OFFICE_PORT to use another one).`);
  else log.error(`HTTP server error: ${errMsg(err)}`);
  process.exit(1);
});

app.server.listen(config.port, config.host, () => {
  log.info(`${config.branding.appName} ${config.version}${config.dev ? ' (dev)' : ''}${config.inDocker ? ' (docker)' : ''} listening on http://${config.host}:${config.port}`);
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`Shutting down (${signal})...`);
  setTimeout(() => process.exit(0), 3_000).unref();
  void app.close().then(() => db?.close()).catch(() => undefined).then(() => process.exit(0));
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
