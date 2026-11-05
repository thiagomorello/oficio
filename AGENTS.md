# Instructions for AI coding agents

This file is for coding agents such as Claude Code, Codex, Cursor, Copilot Workspace and similar tools that are asked
to **deploy Oficio to production** or to **change its code**. Humans are welcome to read it too; nothing here is
secret. Claude Code also reads it through [CLAUDE.md](CLAUDE.md).

Oficio is a self-hosted virtual office: one Node 22 app (HTTP + WebSocket), MySQL 8, a LiveKit server for
audio/video and a reverse proxy with TLS. The full documentation lives in [docs/](docs/) (English) and
[docs/pt-BR/](docs/pt-BR/) (Portuguese). When this file and a document in `docs/` disagree, `docs/` wins; open an
issue about the disagreement.

## Repository map

| Path | What it is |
|---|---|
| `server/` | Node/TypeScript backend: HTTP routes, WebSocket hub, 20 Hz world simulation, MySQL repositories, CLI (`dist/server/cli.js`) |
| `client/` | Browser app: Vite multi-page build, plain DOM + canvas, no UI framework |
| `shared/` | Code used by both sides: map model, validation (zod), i18n messages, branding |
| `docker-compose.yml` | Production stack for a VPS: `app` + `mysql` + `livekit` + `caddy` (automatic HTTPS). Reads `.env` |
| `deploy/` | Portainer stacks, Caddy/nginx/Traefik configs, LiveKit template, Kubernetes manifests |
| `scripts/` | `gen-secrets.sh`/`.ps1`, `first-admin.sh`, `backup.sh`, `restore.sh` |
| `docs/deploy/` | One guide per platform (VPS, Hostinger, DigitalOcean, Portainer, Coolify, Dokploy, Railway, Render, Fly.io, Kubernetes, LiveKit Cloud, Vercel) |
| `.env.example` | Every environment variable with comments; `docs/configuration.md` is the reference |

## Commands

```sh
npm ci                      # install (Node 22)
npm run dev                 # http://127.0.0.1:4747 with in-memory data, user dev@oficio.local / dev12345
npm run typecheck           # tsc for client+shared and for server
npm test                    # vitest (includes the i18n parity test)
npm run build               # client (Vite) + server (esbuild) into dist/
docker build -t oficio:local .
docker compose -f docker-compose.dev.yml up -d   # MySQL + LiveKit for local development (see CONTRIBUTING.md)
```

Run `npm run typecheck && npm test` before proposing any code change. CI runs the same plus a Docker build,
a smoke test of the image and `docker compose config` on every compose file.

## Deploying to production: runbook

### Step 0. Collect the inputs from the human. Do not invent any of them.

1. **Where it will run.** A Linux VPS with Docker (the default and best-supported path), a Portainer host, a
   PaaS (Railway, Render, Fly.io, DigitalOcean App Platform, Coolify, Dokploy) or Kubernetes. Vercel cannot run
   Oficio: see [docs/deploy/vercel.md](docs/deploy/vercel.md).
2. **Two host names** already pointing (A/AAAA records) to the server, for example `office.example.com` and
   `livekit.example.com`. If they use Cloudflare, the LiveKit record must be *DNS only* (grey cloud).
3. **An e-mail address** for Let's Encrypt notices (`ACME_EMAIL`).
4. **The server's public IP** (`LIVEKIT_NODE_IP`). `curl -4 ifconfig.me` on the server gives it.
5. **Branding**: app name, optional logo URL, accent color, default language (`en` or `pt-BR`).
6. **The first administrator**: e-mail and display name.
7. **LiveKit**: self-hosted in the stack (default on a VPS) or [LiveKit Cloud](docs/deploy/livekit-cloud.md)
   (required on PaaS without UDP). For Cloud you need its `wss://` URL, API key and API secret from the human.
8. **Optional**: SendGrid API key and sender address for invite/reset e-mails; S3-compatible bucket for backups.

Check the requirements with the human before touching the server: [docs/requirements.md](docs/requirements.md)
(2 vCPU / 4 GB for a small team, ports 80, 443/tcp, 7881/tcp and 7882/udp open, Docker 24+ with Compose v2.23+).

### Step 1. Choose the guide

| Target | Follow |
|---|---|
| Any Linux VPS with Docker (default) | the commands below, details in [docs/deploy/docker-compose-vps.md](docs/deploy/docker-compose-vps.md) |
| Hostinger VPS / DigitalOcean Droplet | [hostinger.md](docs/deploy/hostinger.md) / [digitalocean.md](docs/deploy/digitalocean.md) (same stack, provider specifics) |
| Portainer | [portainer.md](docs/deploy/portainer.md) with `deploy/portainer/stack.yml` or `stack-swarm.yml` |
| Coolify / Dokploy | [coolify.md](docs/deploy/coolify.md) / [dokploy.md](docs/deploy/dokploy.md) |
| Railway / Render / DO App Platform | [railway.md](docs/deploy/railway.md) / [render.md](docs/deploy/render.md) / [digitalocean.md](docs/deploy/digitalocean.md), always with LiveKit Cloud |
| Fly.io | [fly.md](docs/deploy/fly.md) (LiveKit can be self-hosted there, UDP is available) |
| Kubernetes | [kubernetes.md](docs/deploy/kubernetes.md) |

### Step 2. VPS with Docker Compose (the default path)

Run on the server as a user that can use Docker. Stop and report to the human if any check fails.

```sh
# 1. Code and secrets
git clone https://github.com/thiagomorello/oficio.git && cd oficio
git checkout v0.1.0                      # pin a release tag; never deploy an untested main
cp .env.example .env
./scripts/gen-secrets.sh                 # fills OFFICE_JWT_SECRET, MYSQL_*, LIVEKIT_API_KEY/SECRET, METRICS_TOKEN

# 2. Edit .env (sed or an editor). Set at least:
#    OFFICE_DOMAIN, LIVEKIT_DOMAIN, ACME_EMAIL, LIVEKIT_NODE_IP
#    OFFICE_PUBLIC_URL=https://<OFFICE_DOMAIN>, OFFICE_ALLOWED_HOSTS=<OFFICE_DOMAIN>, LIVEKIT_URL=wss://<LIVEKIT_DOMAIN>
#    (or delete those three lines so docker-compose.yml derives them from the domains)
#    OFFICE_APP_NAME, OFFICE_ACCENT_COLOR, OFFICE_DEFAULT_LOCALE, TZ
#    OFICIO_VERSION=0.1.0  (pins the image tag used by docker-compose.yml)
grep -E "^(OFFICE_DOMAIN|LIVEKIT_DOMAIN|ACME_EMAIL|LIVEKIT_NODE_IP|OFFICE_JWT_SECRET|LIVEKIT_API_SECRET)=" .env | sed "s/=.*/=<set>/"

# 3. Validate and start
docker compose config -q                 # must print nothing
docker compose up -d
docker compose ps                        # after ~60 s: app, livekit, mysql "(healthy)", caddy "Up"
docker compose logs --tail=50 caddy app  # Caddy: "certificate obtained successfully" x2; app: "listening on"

# 4. Verify from outside (replace the domains)
curl -fsS https://office.example.com/api/health   # {"ok":true,"db":"ok",...,"livekit":true}
curl -fsS https://office.example.com/api/config   # the branding you set, no secrets
curl -fsS https://livekit.example.com/            # OK

# 5. First administrator (prints a temporary password ONCE)
./scripts/first-admin.sh admin@example.com "Admin Name"
```

Give the temporary password to the human through the channel they are talking to you in, once, and do not write it
anywhere else (no file, no commit, no log, no ticket). The account must change it at first login.

Then confirm in a browser (or ask the human to): open the office URL, sign in, build an avatar, walk into the
office, and run the LiveKit connection test described in [docs/livekit.md](docs/livekit.md). Audio/video working
between two browsers is the real end-to-end check; `livekit: true` in `/api/health` only means the app can reach
the LiveKit API.

### Step 3. Finish properly

- Set up backups: `scripts/backup.sh` in cron, see [docs/backup-restore.md](docs/backup-restore.md). Test one
  restore into a scratch database before calling it done.
- Firewall: only 22, 80, 443/tcp (+443/udp), 7881/tcp, 7882/udp from the internet. MySQL (3306) and the LiveKit
  API (7880) must stay on the internal Docker network. `docker-compose.yml` already does not publish them.
- TURN (only if the human asks for it, for people on networks that block UDP and non-standard ports): add the
  `docker-compose.turn.yml` overlay and open 5349/tcp + 3478/udp; it reuses Caddy's certificate. Pick a renewal
  method with the human (host cron script or the `turn-reloader` profile, which needs the Docker socket). See
  [docs/livekit.md](docs/livekit.md#turn-when-and-how).
- Tell the human: the two URLs, the admin e-mail, where `.env` lives (and that it holds the secrets), how to
  upgrade ([docs/upgrading.md](docs/upgrading.md)) and how to roll back.

### Guardrails (apply to every platform)

- **Never commit `.env`** or paste secret values into chat, logs, issues or commit messages. `.gitignore` already
  excludes `.env`; keep it that way.
- **Never in production**: `OFFICE_IN_MEMORY=1`, `OFFICE_DEV=1`, `OFFICE_COOKIE_SECURE=0`,
  `LOGIN_MASTER_PASSWORD`, `MYSQL_SSL=skip-verify` (acceptable only as a documented temporary measure).
- **HTTPS is mandatory**: browsers refuse microphone/camera access over plain HTTP, and the session cookie is
  `Secure`. Do not "fix" a login problem by turning `OFFICE_COOKIE_SECURE` off; fix the proxy or `TRUST_PROXY`.
- **Exactly one app replica.** The office state is in process memory ([why](docs/architecture.md#why-exactly-one-replica)).
  Do not scale `app` horizontally; scale LiveKit or the VPS instead.
- **LiveKit keys must match on both sides.** In the compose stack `LIVEKIT_KEYS` for the server is built from
  `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`; if you change one, restart both `app` and `livekit`.
- **Pin versions.** Use `OFICIO_VERSION=X.Y.Z` (or `image: ...:X.Y.Z`), never `latest`, in anything the human will
  keep running. Upgrades: back up, bump the tag, `docker compose pull && docker compose up -d`, check `/api/health`.
  Migrations are additive and run automatically at boot; rolling back the image is safe, see
  [docs/upgrading.md](docs/upgrading.md#rolling-back).
- **Destructive commands need explicit human approval**: `docker compose down -v`, deleting volumes, dropping or
  restoring over the database, changing DNS, replacing the TLS setup. State what will be lost before asking.
- **Do not touch other services on the host** (other containers, firewall rules you did not create, system
  packages) unless the human asked for exactly that.
- When something fails, read [docs/troubleshooting.md](docs/troubleshooting.md) first ("First three things to
  check"), then collect the information listed in its last section before asking the human.

## Working on the code

- TypeScript strict, ESM. The client is plain DOM built with `h()` from `client/src/ui/dom.ts` plus canvas; do not
  introduce a UI framework. CSS classes use the `of-` prefix and colors come from the `--accent*` variables.
- Every user-facing string goes through `t()` from `shared/i18n` with both `en` and `pt-BR` messages in
  `shared/i18n/messages/*.ts`; `npm test` fails if a key is missing in one language. See [docs/i18n.md](docs/i18n.md).
- Server-side texts (HTTP errors, e-mails, default map) are translated with the request translator (`tr`) and the
  user's locale; do not hardcode English or Portuguese in `server/`.
- Database changes are additive migrations in `server/db/migrations/` (new file, never edit a shipped one).
- Branding is configuration (`OFFICE_APP_NAME`, `OFFICE_LOGO_URL`, `OFFICE_ACCENT_COLOR`, `OFFICE_SIGN_TEXT`);
  do not hardcode a company name, logo or color anywhere.
- Documentation changes go to both `docs/` and `docs/pt-BR/` (same file name, same structure) and to both READMEs
  when the README is involved.
- Conventional commits (`feat:`, `fix:`, `docs:`, `ci:`...). Keep `CHANGELOG.md` updated under *Unreleased*.
- Do not add comparisons with other products to the README, docs or code comments; describe Oficio on its own terms.
