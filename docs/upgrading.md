# Upgrading

Upgrading Oficio means pulling a newer image and recreating the `app` container; database migrations run automatically and are additive, so a rollback is just the older tag. This page covers version tags, the compose procedure, reading the changelog, what migrations do during an upgrade, how to roll back, keeping LiveKit and the other images current, and upgrading a source install.

## Versioning and image tags

Oficio follows [Semantic Versioning](https://semver.org/); every release has notes in [CHANGELOG.md](../CHANGELOG.md) and a GitHub release. Images are published to `ghcr.io/thiagomorello/oficio` for `linux/amd64` and `linux/arm64`:

| Tag | Meaning | Use it for |
|---|---|---|
| `0.1.0` | exact release | production: predictable, you choose when to move |
| `0.1` | latest patch of a minor | production if you want bug fixes automatically on `pull` |
| `latest` | latest **release** | the default in `docker-compose.yml`; fine for small teams, but it can jump a minor version on `pull` |
| `edge` | every push to `main` | testing unreleased changes; never production |
| `sha-<commit>` | a specific build | reproducing a bug report |

The compose file reads the tag from `OFICIO_VERSION` in `.env` (`image: ghcr.io/thiagomorello/oficio:${OFICIO_VERSION:-latest}`). Pin it:

```ini
OFICIO_VERSION=0.1.0
```

The running version is visible in `GET /api/health` (`"version"`), and in the app logs at boot.

## Before you upgrade

1. **Read the changelog** for every version between yours and the target: [CHANGELOG.md](../CHANGELOG.md) → the matching GitHub release. Look for headings **Changed**, **Removed** and any note about environment variables, ports or the compose file. Only minor and major versions may require action; patches never do.
2. **Diff the compose file** if you track the repository: `git fetch && git diff HEAD..origin/main -- docker-compose.yml .env.example`. New variables appear in `.env.example` with a default; copy the ones you want into `.env`.
3. **Back up**: `./scripts/backup.sh` ([Backup and restore](backup-restore.md)). Migrations are additive and safe, but a backup makes rollback a non-event.
4. Pick a quiet moment: the upgrade restarts the app, which disconnects everyone for a few seconds (they reconnect automatically and stay signed in).

## Upgrading the compose stack

```sh
cd /opt/oficio
git pull                                  # if you keep the repository checkout (optional)
sed -i 's/^OFICIO_VERSION=.*/OFICIO_VERSION=0.2.0/' .env   # or edit .env by hand
docker compose pull app
docker compose up -d
docker compose logs -f app
```

What you should see in the logs:

- configuration warnings, if any (new variables you may want to set);
- one `migration 00N_…` line per pending migration, or `database is already up to date` when there is nothing to apply;
- `Published map #N loaded.` and the final `Oficio <version> (docker) listening on http://0.0.0.0:4747`.

Then:

```sh
curl -s https://office.example.com/api/health
```

The `version` field shows the new release and `ok` is `true`. Open the office in a browser; the client reloads its assets automatically because the bundle file names are content-hashed.

`docker compose up -d` recreates only the containers whose image or configuration changed, so MySQL, LiveKit and Caddy keep running unless you also changed their lines.

### Portainer and other platforms

- **Portainer stack:** change `OFICIO_VERSION` in the stack's environment variables (or the image tag in the editor) and click **Update the stack** with *Re-pull image* enabled. In Swarm the service updates `stop-first` (one replica) and rolls back automatically if the health check fails for 30 s (`failure_action: rollback`).
- **Railway / Render / Fly / DigitalOcean App Platform / Coolify / Dokploy:** change the image tag (or redeploy from the new commit) in the platform's UI; the app migrates at boot in the same way. See the guides under `deploy/`.
- **Kubernetes:** update the image tag in the Deployment; keep `replicas: 1` and `strategy: Recreate` so two app pods never run at once.

## Migrations during an upgrade

- The new app version applies pending migrations **at boot**, under a MySQL named lock, before it starts serving. If a migration fails, the process exits with the SQL error in the logs and the container restarts; fix the cause (usually privileges on a managed database) and restart. The old version can be started again in the meantime (see rollback).
- Migrations are **additive**: they create tables and add columns, never drop or rename them. Data written by the new version lands in new columns that the old version simply ignores.
- You can run them ahead of time to shorten the restart window: `docker compose run --rm app node dist/server/cli.js migrate` with the new image, while the old app is still serving. The named lock prevents a race with the app's own migration run.

## Rolling back

Because the schema only grows, going back is a tag change:

```sh
sed -i 's/^OFICIO_VERSION=.*/OFICIO_VERSION=0.1.0/' .env
docker compose pull app
docker compose up -d app
```

The older version starts against the newer schema without complaint. Two caveats:

- Features introduced by the newer version are not available, and data they stored is invisible until you upgrade again (it is not lost).
- If a release note explicitly says a migration is **not backward compatible** (rare; it would be a major version), restore the backup you took instead: `./scripts/restore.sh backups/<file>` with the old version running.

## Keeping the other images current

| Service | Image in compose | How to upgrade |
|---|---|---|
| LiveKit | `livekit/livekit-server:v1.13.11` (pinned) | Edit the tag in `docker-compose.yml`, read LiveKit's release notes, `docker compose pull livekit && docker compose up -d livekit`. Ongoing calls drop and reconnect within seconds. Stay on the 1.x line; the bundled `livekit-client` SDK is compatible with 1.x servers. The project bumps this tag in its own releases; pulling the repository gives you the tested combination. |
| MySQL | `mysql:8.0` (floating patch) | `docker compose pull mysql && docker compose up -d mysql` picks up 8.0.x patches; MySQL upgrades its data directory automatically within the 8.0 line. Take a backup first. Moving to 8.4 is supported by MySQL (in-place from 8.0) but test it on a copy first. |
| Caddy | `caddy:2-alpine` (floating) | `docker compose pull caddy && docker compose up -d caddy`. Certificates persist in the volume. |

A full refresh of everything: `docker compose pull && docker compose up -d`, after a backup.

## Upgrading a source install

```sh
cd /opt/oficio
git fetch --tags
git checkout v0.2.0
npm ci
npm run build
npm run cli -- migrate            # optional: the server also migrates at start
sudo systemctl restart oficio     # or however you run `node dist/server/index.js`
```

Node.js must stay at 22 or newer. Check `package.json` `engines` after a major release.

## Checklist

- [ ] Changelog read for every version in between
- [ ] `.env.example` diffed, new variables set
- [ ] `./scripts/backup.sh` ran and printed `[backup] OK`
- [ ] `OFICIO_VERSION` bumped, `docker compose pull app && docker compose up -d`
- [ ] Logs show migrations applied and the new version banner
- [ ] `/api/health` → `ok: true`, correct `version`
- [ ] Sign in, walk around, test audio with a colleague
- [ ] If something is wrong: previous tag, `docker compose up -d app`, open an issue with `docker compose logs --tail=200 app`
