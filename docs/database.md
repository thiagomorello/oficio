# Database

Oficio stores users, desks, chat history, maps, settings and telemetry in **MySQL 8**. You can run the `mysql:8.0` container bundled in `docker-compose.yml` or point the app at a managed MySQL service. This page covers both options, the `DATABASE_URL` format and its alternative `MYSQL_*` form, the current state of TLS support, how migrations work, how to size the database, and where the backup procedure lives.

## Bundled MySQL (default)

`docker-compose.yml` starts `mysql:8.0` with:

- `utf8mb4` / `utf8mb4_unicode_ci` as server defaults (tables declare their own `utf8mb4` collation anyway);
- `innodb-buffer-pool-size` from `MYSQL_BUFFER_POOL` (default `256M`) and `max-connections=100`;
- a named volume `mysql-data` mounted at `/var/lib/mysql` (visible as `oficio_mysql-data` in `docker volume ls`);
- a health check (`mysqladmin ping`) that the `app` service waits for (`condition: service_healthy`); the first boot takes about 30 seconds while MySQL initialises;
- the `internal` network only: the port is **not** published on the host.

On first start the official image creates the database `MYSQL_DATABASE` (default `oficio`) and the user `MYSQL_USER` / `MYSQL_PASSWORD`, and sets `MYSQL_ROOT_PASSWORD`. These three values are read **only on the first boot**; changing them later in `.env` does not change the database. To rotate the app password afterwards, run `ALTER USER 'oficio'@'%' IDENTIFIED BY '<new>'` inside MySQL and update `.env`.

To open a MySQL shell:

```sh
docker compose exec -e MYSQL_PWD="$(grep -E '^MYSQL_ROOT_PASSWORD=' .env | cut -d= -f2-)" mysql mysql -u root oficio
```

The bundled option is right for almost every single-host deployment: it is one container, backed up by `scripts/backup.sh`, and its only consumer is the app sitting on the same internal network.

## Managed MySQL

Any MySQL 8-compatible service works as long as the app can reach it over TCP: DigitalOcean Managed MySQL, Aiven for MySQL, PlanetScale or TiDB Cloud (MySQL-compatible), Railway's MySQL plugin, Hostinger's managed databases, Amazon RDS/Aurora MySQL, Google Cloud SQL for MySQL, Azure Database for MySQL. The platform guides under `deploy/` use a managed database wherever the platform has no persistent volumes.

Steps:

1. Create a MySQL **8.x** instance and a database named `oficio` (any name works; it just has to be in the URL) with `utf8mb4` as default character set.
2. Create a user with full rights on that database (`CREATE`, `ALTER`, `INDEX`, `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `REFERENCES`). Migrations create tables and foreign keys at boot, so a read-only or DML-only user is not enough.
3. Allow the app host's IP in the service's firewall / trusted sources. Prefer the provider's **private network** address when the app runs in the same region.
4. Set `DATABASE_URL` and remove the `mysql` service and the `depends_on` block from your compose file.
5. Start the app and check `GET /api/health` reports `"db": "ok"`.

Read the [TLS](#tls) section before choosing a provider: many managed services **require** encrypted connections by default.

## `DATABASE_URL` format

```
mysql://USER:PASSWORD@HOST:PORT/DATABASE
```

- The scheme must be exactly `mysql://` (not `mysql2://`, not `mariadb://`).
- `PORT` defaults to `3306` when omitted.
- `USER` and `PASSWORD` are **URL-decoded**: percent-encode anything that is not a plain letter, digit or `-._~`. Common cases: `@` → `%40`, `#` → `%23`, `:` → `%3A`, `/` → `%2F`, `?` → `%3F`, `%` → `%25`, space → `%20`. `scripts/gen-secrets.sh` generates hex passwords precisely so this never bites.
- `DATABASE` is the path after the slash. Always include it.
- **Query parameters are ignored.** The server parses the URL into host, port, user, password and database (see `server/db/pool.ts`); anything after `?` has no effect.

Examples:

```ini
# bundled container (what docker-compose.yml assembles)
DATABASE_URL=mysql://oficio:4f1e…@mysql:3306/oficio

# managed service over a private network
DATABASE_URL=mysql://oficio:p%40ss%23word@10.0.0.12:3306/oficio

# managed service with a non-standard port
DATABASE_URL=mysql://doadmin:AVNS_xxxxxxxx@db-mysql-nyc3-12345-do-user-1-0.b.db.ondigitalocean.com:25060/oficio
```

The hostnames above are placeholders; use the ones your provider shows.

### The `MYSQL_*` alternative

When `DATABASE_URL` is empty, the server builds the URL from the parts:

```ini
MYSQL_HOST=10.0.0.12
MYSQL_PORT=3306          # default 3306
MYSQL_USER=oficio        # default root
MYSQL_PASSWORD=p@ss#word # no encoding needed here
MYSQL_DATABASE=oficio    # default oficio
```

`MYSQL_USER` and `MYSQL_PASSWORD` are URL-encoded for you, so this form is handy when the password has special characters. `DATABASE_URL`, when present, always wins. The CLI (`node dist/server/cli.js …`) uses the same two forms.

## TLS

By default the app opens plain connections, which is fine for the bundled container (traffic never leaves the Docker network of one host). Managed services usually **require** TLS; turn it on in either of two ways:

- append `?ssl=true` to `DATABASE_URL`: `mysql://user:pass@host:3306/oficio?ssl=true` (`sslmode=required` is accepted too), or
- set `MYSQL_SSL=required` (works with both `DATABASE_URL` and the `MYSQL_*` form).

With `required` the server certificate is validated against the system CA bundle of the container, which covers every major provider (DigitalOcean, Aiven, PlanetScale/TiDB, Railway's public proxy). For a private CA or a test setup you can use `?ssl=skip-verify` / `MYSQL_SSL=skip-verify`: the connection is encrypted but the certificate is not checked. `ssl=false`, `0` or an empty value disables TLS. Custom CA files are not supported yet ([roadmap](roadmap.md)).

## Migrations

Schema changes ship as **additive, numbered migrations** in `server/db/migrations/` (`001_init`, `002_maps`, `003_avatar`, `004_desk_decor`, `005_telemetry`, …), bundled into the server build.

- They run **automatically at boot** (`server/index.ts`) and on demand with `node dist/server/cli.js migrate` (`npm run cli -- migrate` from source).
- Applied versions are recorded in `office_migrations`. A MySQL named lock (`GET_LOCK('office_migrate', 30)`) prevents two processes (for example the app and the CLI) from migrating at the same time.
- Each migration runs its statements in order and records the version at the end; DDL commits implicitly in MySQL, so an interrupted migration is simply re-run from the start next time. Migrations are written so that is safe.
- Migrations are never edited after release and never remove columns, which is why **downgrading the app does not require a schema rollback**: an older version ignores columns it does not know. See [Upgrading](upgrading.md).

If the app fails to migrate it logs the error and exits; `docker compose logs app` shows the statement that failed. The usual causes are insufficient privileges (missing `CREATE`/`ALTER`/`REFERENCES`) or a database created with a non-`utf8mb4` default by a managed service.

## Sizing

The database is small. Rough per-item sizes:

| Data | Size | Notes |
|---|---|---|
| user | ~2 KB | includes appearance and settings JSON |
| chat message | ~0.3 KB | capped at 1000 characters of text; history grows forever |
| map version | 50–500 KB | one JSON document per published version |
| telemetry event | ~0.3–1 KB | purged after 14 days; a busy user produces a few hundred per day |

A 50-person team produces well under 1 GB per year including telemetry churn. Defaults are enough: `256M` buffer pool, 5 pooled connections from the app (`connectionLimit` in `server/db/pool.ts`), `max-connections=100`. Raise `MYSQL_BUFFER_POOL` to `512M`–`1G` on an 8 GB host for faster chat history and telemetry queries. The connection pool size is not configurable from the environment; one app replica never needs more than a handful.

Disk growth to watch: `chat_messages` (there is no automatic pruning; delete old rows manually if you must) and the MySQL binary logs if you enabled them yourself (the bundled image runs with defaults).

## Backups

`scripts/backup.sh` dumps the bundled database with `mysqldump --single-transaction` into `backups/oficio-<timestamp>.sql.gz`, keeps the last 14 files, and optionally uploads to S3-compatible storage. `scripts/restore.sh` stops the app, loads a dump and starts it again. Managed services have their own snapshot features; still keep a logical dump you control. Full procedure: [Backup and restore](backup-restore.md).

## Related

- [Configuration → MySQL database](configuration.md#mysql-database)
- [Troubleshooting → `/api/health` shows `db: error`](troubleshooting.md#apihealth-shows-db-error)
