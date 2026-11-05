# Backup and restore

Everything worth keeping in an Oficio instance is in MySQL; the app container itself is stateless and LiveKit keeps nothing. `scripts/backup.sh` produces a compressed logical dump of the bundled database, optionally copies it to S3-compatible storage, and `scripts/restore.sh` loads a dump back. This page explains what the dump contains, how to schedule it, how to restore, and which Docker volumes you should also protect.

## What is in a dump

The dump covers the whole `oficio` database:

| Table | Content |
|---|---|
| `users` | accounts, password hashes, roles, admin flags, avatars (`appearance`), settings |
| `password_tokens` | pending invite/reset tokens (short-lived; harmless to lose) |
| `desks` | who owns which desk and its decoration |
| `chat_messages` | the full chat history |
| `sessions_log` | login history |
| `office_maps` | map drafts and every published version |
| `office_settings` | instance settings such as the published map id |
| `telemetry_events` | 14 days of diagnostics (bulk of the size; harmless to lose) |
| `office_migrations` | which schema migrations were applied |

Not in the dump, by design: `.env` (your secrets — back it up separately and securely), the Caddy certificates (re-issuable; see [Volumes](#volumes)), LiveKit state (none), and anything about who is online.

Password hashes are bcrypt, but the dump still contains e-mails, names and chat; treat backup files as confidential.

## `scripts/backup.sh`

```sh
./scripts/backup.sh [dir] [keep]
```

Run it from the directory that holds `docker-compose.yml` and `.env` (it reads `MYSQL_ROOT_PASSWORD` from `.env` and runs `mysqldump` inside the `mysql` container). Defaults: `dir=./backups`, `keep=14`.

What it does:

1. `mysqldump -u root --single-transaction --quick --routines --triggers --events --hex-blob --default-character-set=utf8mb4 oficio`, piped through `gzip -9` into `backups/oficio-<YYYY-MM-DDTHH-MM-SS>.sql.gz.partial`. `--single-transaction` means the app keeps running and the dump is consistent; no downtime.
2. Sanity checks: the file must be larger than 1 KiB and end with `Dump completed`; otherwise it is deleted and the script exits 1 with `[backup] FAILED`.
3. Renames `.partial` to the final name and prints `[backup] OK backups/oficio-….sql.gz (N bytes)`.
4. Retention: deletes the oldest files beyond `keep`.
5. If `S3_BUCKET` is set, uploads the file with `aws s3 cp` to `s3://$S3_BUCKET/oficio/`.

The MySQL password is passed through the `MYSQL_PWD` environment variable inside the container, so it never shows up in `ps`.

### Scheduling with cron

```sh
crontab -e
```

```cron
# Daily at 03:00, keep 14 local copies, log to backups/backup.log
0 3 * * * cd /opt/oficio && ./scripts/backup.sh >> backups/backup.log 2>&1
```

Make sure the cron user can run `docker compose` (member of the `docker` group) and that `/opt/oficio` is where your `.env` lives. Check `backups/backup.log` after the first night; a healthy log is one `[backup] OK` line per day.

### Off-site copy to S3-compatible storage

Any S3-compatible bucket works: AWS S3, Backblaze B2, Cloudflare R2, MinIO, DigitalOcean Spaces, Hetzner Object Storage, Wasabi. Install the AWS CLI on the host and provide credentials to the script:

```cron
0 3 * * * cd /opt/oficio && S3_BUCKET=my-backups S3_ENDPOINT=https://s3.us-west-002.backblazeb2.com AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… AWS_DEFAULT_REGION=us-west-002 ./scripts/backup.sh >> backups/backup.log 2>&1
```

Rather than putting secrets in the crontab, put them in a root-only file and source it:

```cron
0 3 * * * cd /opt/oficio && . /root/oficio-backup.env && ./scripts/backup.sh >> backups/backup.log 2>&1
```

- `S3_BUCKET` enables the upload; `S3_ENDPOINT` is only needed for non-AWS providers.
- Objects are written to `s3://<bucket>/oficio/oficio-<timestamp>.sql.gz`. Set a lifecycle rule on the bucket to expire old objects (for example 90 days); the script only prunes local files.
- Enable bucket versioning or object lock if you want protection against a compromised host deleting backups.

### Taking a manual backup before a change

```sh
./scripts/backup.sh backups 30
ls -lh backups | tail -3
```

Do this before every [upgrade](upgrading.md) and before publishing a large map change.

## Restore

```sh
./scripts/restore.sh backups/oficio-2026-01-15T03-00-00.sql.gz
```

What it does:

1. Prints a warning and waits **5 seconds** (Ctrl+C to abort): the database `oficio` will be **replaced** by the dump.
2. `docker compose stop app` — everyone online is disconnected; the login page keeps answering `502` from Caddy until the app is back.
3. Streams the decompressed dump into `mysql -u root oficio` inside the `mysql` container. (It strips the first line when it is MariaDB's `enable the sandbox mode` directive, which MySQL 8 does not understand, so dumps taken with recent `mariadb-dump` also load.)
4. `docker compose start app`. The app re-runs migrations (no-op if the dump is current), loads the published map and starts.

Afterwards: sessions stay valid because they are signed with `OFFICE_JWT_SECRET`, not stored in the database; users whose password differs in the dump must sign in again (their `password_version` no longer matches). Desk claims, chat history and maps are whatever the dump contained.

A restore takes seconds for a typical office. For a large `telemetry_events` table it can take a minute; that table is diagnostics only.

### Restoring to a new server (disaster recovery / migration)

1. Provision the new host, install Docker, clone the repository, copy your **`.env`** from the backup location (same `OFFICE_JWT_SECRET`, same MySQL passwords; the database user in the dump must match `MYSQL_USER`/`MYSQL_PASSWORD`).
2. Point DNS at the new host (lower the TTL a day before if you can).
3. `docker compose up -d mysql` and wait until it is healthy (`docker compose ps`), then `docker compose up -d` so Caddy gets fresh certificates.
4. Copy the dump over and run `./scripts/restore.sh <file>`.
5. Verify: `curl https://office.example.com/api/health` → `"db":"ok"`, sign in, check users and the published map in `/admin`.

If you also kept the `oficio_caddy-data` volume, restore it before step 3 to reuse the existing certificates.

### Restoring a dump from a managed database

The scripts assume the compose stack. With a managed MySQL, use the provider's snapshots, or `mysqldump`/`mysql` against its host with the same flags as the script; the dump format is identical.

## Volumes

| Volume (`docker volume ls`) | Contains | Back up? |
|---|---|---|
| `oficio_mysql-data` | the MySQL data directory | **Logical dumps (`backup.sh`) are the supported way.** Copying the raw directory while MySQL runs produces a corrupt copy; if you snapshot it (e.g. a VPS disk snapshot), stop MySQL first or accept crash-recovery on restore. |
| `oficio_caddy-data` | TLS certificates, ACME account | Optional but useful: avoids re-issuing certificates after a rebuild (Let's Encrypt limits issuance to a handful per week per domain). `docker run --rm -v oficio_caddy-data:/data -v "$PWD":/out alpine tar czf /out/caddy-data.tgz -C /data .` |
| `oficio_caddy-config` | Caddy's autosaved config | No; regenerated from the Caddyfile. |

The volume prefix `oficio_` comes from `name: oficio` in the compose file; Portainer stacks use the stack name instead.

Keep `.env` with your backups (encrypted). Without `OFFICE_JWT_SECRET` every user is signed out after a restore; without the MySQL passwords the dump is useless with a fresh container; without `LIVEKIT_API_SECRET` your LiveKit config must be regenerated too.

## Testing restores

A backup you have never restored is a hope, not a backup. Once a quarter:

```sh
# on a scratch machine or a temporary compose project
git clone https://github.com/thiagomorello/oficio.git /tmp/oficio-restore-test && cd /tmp/oficio-restore-test
cp /path/to/your/.env .env           # or a copy with changed domains
docker compose -p oficio-test up -d mysql
# wait for healthy, then load the dump with the same command restore.sh uses
gzip -dc /path/to/oficio-2026-01-15T03-00-00.sql.gz | docker compose -p oficio-test exec -T \
  -e MYSQL_PWD="$(grep -E '^MYSQL_ROOT_PASSWORD=' .env | cut -d= -f2-)" mysql mysql -u root oficio
docker compose -p oficio-test exec -T -e MYSQL_PWD="$(grep -E '^MYSQL_ROOT_PASSWORD=' .env | cut -d= -f2-)" mysql \
  mysql -u root oficio -e 'SELECT COUNT(*) AS users FROM users; SELECT id,name,published_at FROM office_maps WHERE kind="version";'
docker compose -p oficio-test down -v
```

Seeing your user count and map versions is proof enough.
