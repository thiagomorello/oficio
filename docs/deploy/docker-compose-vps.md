# Deploy on a VPS with Docker Compose

This is the reference installation of Oficio. Every other guide in this folder either follows these steps on a specific provider or explains what changes when a platform cannot run one of the pieces.

| | |
|---|---|
| **What you get** | The full stack on one server: the Oficio app, MySQL 8, a self-hosted LiveKit server for audio/video, and Caddy with automatic HTTPS certificates. |
| **Monthly cost** | Roughly US$ 5–25 for the server, depending on the provider and team size (prices change; see [sizing](#1-choose-a-server-size)). Nothing else to pay. |
| **Time needed** | 30–45 minutes the first time, most of it waiting for DNS and certificates. |
| **Audio/video** | Self-hosted LiveKit in the same `docker compose` stack (or [LiveKit Cloud](livekit-cloud.md) if you prefer). |
| **Database** | MySQL 8 container in the same stack, with a Docker volume and a backup script. |

You need: a VPS with a public IPv4 address, a domain name you control, and a terminal with SSH (Windows PowerShell, macOS Terminal, or Linux).

## How the pieces fit

```
browser ──HTTPS/WSS──> Caddy (80/443) ──> app:4747        (pages, API, WebSocket /ws)
                                     └──> livekit:7880    (LiveKit signaling, wss://livekit.example.com)
browser ──WebRTC media──────────────────> livekit 7881/tcp + 7882/udp  (published directly on the host)
app ──> mysql:3306 (internal network only)
```

Two host names point to the same server: `office.example.com` (the app) and `livekit.example.com` (audio/video signaling). Browsers refuse to open the microphone and camera on plain `http://`, so HTTPS is not optional; Caddy obtains the certificates from Let's Encrypt for you.

The app keeps the live office state (who is where, who is talking) in memory, so it always runs as **one** container. Do not scale it to two replicas.

## 1. Choose a server size

| Team size (people online at once) | Server | Notes |
|---|---|---|
| up to ~15 | 1 vCPU, 2 GB RAM | Everything on one box, including LiveKit. |
| up to ~50 | 2 vCPU, 4 GB RAM | Still one box. |
| up to ~150 | 4 vCPU, 8 GB RAM | Consider moving LiveKit to its own server or to [LiveKit Cloud](livekit-cloud.md). |

20 GB of disk is plenty: the images take about 1.5 GB and the database grows slowly (chat history and telemetry). Pick a region close to most of your team: audio latency follows the server.

Ubuntu 22.04 LTS or 24.04 LTS, x86_64 or ARM64 (the image is multi-arch), with a public IPv4 address.

## 2. Create the server and connect

Create the VPS in your provider's panel with Ubuntu 24.04 and, if offered, your SSH public key. Note the public IP (we use `203.0.113.10` in the examples).

```sh
ssh root@203.0.113.10
```

Expected: a shell prompt such as `root@vps:~#`. If you were given a root password instead of a key, type it now.

### Create a non-root user (recommended)

```sh
adduser deploy                 # choose a password; the other questions can stay empty
usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy   # copies your SSH key, if you used one
```

From now on connect as `deploy`:

```sh
ssh deploy@203.0.113.10
```

Update the system once:

```sh
sudo apt update && sudo apt upgrade -y
```

## 3. Install Docker

Use Docker's official convenience script (it sets up the apt repository and installs Docker Engine with the Compose plugin):

```sh
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker                  # or log out and back in
```

Check the versions. Oficio needs Docker Engine 24 or newer and Compose **v2.23 or newer** (the stack uses inline `configs`, which older Compose releases do not understand):

```sh
docker --version
docker compose version
```

Expected: something like `Docker version 27.x` and `Docker Compose version v2.3x`. If `docker compose` (with a space) is not found, you have the old `docker-compose` v1: install the plugin with `sudo apt install docker-compose-plugin`. If you prefer the manual apt-repository method, follow the "Install using the apt repository" section of Docker's documentation; the result is the same.

## 4. Point DNS at the server

In your DNS provider (registrar, Cloudflare, Route 53...), create two **A records** pointing at the server's IPv4:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `office` | `203.0.113.10` | 300 |
| A | `livekit` | `203.0.113.10` | 300 |

Notes:

- With **Cloudflare**, set both records to **DNS only** (grey cloud). Cloudflare's proxy (orange cloud) does not carry the WebRTC traffic LiveKit needs and interferes with the WebSocket on the LiveKit host.
- Both records must resolve before you start the stack, otherwise Let's Encrypt cannot issue certificates. Check from your computer:

```sh
nslookup office.example.com
nslookup livekit.example.com
```

Expected: both answer `203.0.113.10`. New records usually propagate in a few minutes.

## 5. Firewall

Open only what the stack needs:

| Port | Protocol | Purpose |
|---|---|---|
| 22 | TCP | SSH (your access) |
| 80 | TCP | HTTP: Let's Encrypt validation and redirect to HTTPS |
| 443 | TCP | HTTPS and WebSockets (app and LiveKit signaling) |
| 7881 | TCP | LiveKit media over TCP (fallback when UDP is blocked on the user's network) |
| 7882 | UDP | LiveKit media over UDP (the normal path) |
| 5349 | TCP | optional: TURN over TLS, only with the `docker-compose.turn.yml` overlay ([LiveKit → TURN](../livekit.md#turn-when-and-how)) |
| 3478 | UDP | optional: TURN over UDP, only with the overlay |

MySQL (3306) is never published; it is only reachable from the app container on an internal Docker network. Optionally also open 443/udp for HTTP/3; it is not required.

With `ufw` on the server:

```sh
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 7881/tcp
sudo ufw allow 7882/udp
sudo ufw enable
sudo ufw status
```

If you enable TURN later (`docker-compose.turn.yml`), add `sudo ufw allow 5349/tcp` and `sudo ufw allow 3478/udp`.

**Important:** Docker publishes container ports by writing its own iptables rules, which bypass `ufw`. In practice `ufw` does not protect ports published by containers; it protects the host's own services (SSH). So also configure the firewall your **provider** offers in its control panel (Hetzner "Firewalls", DigitalOcean "Cloud Firewalls", Hostinger "Firewall", AWS security groups...) with the same five rules. The provider firewall sits in front of the server and is not affected by Docker.

## 6. Get Oficio

```sh
sudo mkdir -p /opt/oficio && sudo chown $USER:$USER /opt/oficio
git clone https://github.com/thiagomorello/oficio.git /opt/oficio
cd /opt/oficio
```

You only need the repository for `docker-compose.yml`, `.env.example` and the scripts; the application itself is pulled as a prebuilt image from `ghcr.io/thiagomorello/oficio`.

## 7. Create `.env` and generate the secrets

```sh
./scripts/gen-secrets.sh
```

Expected output:

```
created .env from .env.example
set OFFICE_JWT_SECRET
set MYSQL_ROOT_PASSWORD
set MYSQL_PASSWORD
set LIVEKIT_API_KEY
set LIVEKIT_API_SECRET
set METRICS_TOKEN

Done. Now edit .env and set: OFFICE_DOMAIN, LIVEKIT_DOMAIN, ACME_EMAIL, ...
```

The script copies `.env.example` to `.env`, fills every secret with random hex values (`openssl rand`), rewrites `DATABASE_URL` so it matches the generated MySQL password, and sets `.env` to mode 600. It is safe to re-run: existing values are kept.

Without the script (for example on a machine without `openssl`), generate values yourself: `openssl rand -hex 32` for `OFFICE_JWT_SECRET`, `openssl rand -hex 24` for the MySQL passwords and `LIVEKIT_API_SECRET`, and `API$(openssl rand -hex 6)` for `LIVEKIT_API_KEY`. Keep `MYSQL_PASSWORD` to hex characters: it is embedded in `DATABASE_URL`, where symbols would have to be URL-encoded.

## 8. Edit `.env`

```sh
nano .env
```

Set these four lines (everything else can stay as generated):

| Variable | Set to | Why |
|---|---|---|
| `OFFICE_DOMAIN` | `office.example.com` | Host name of the app. Caddy requests a certificate for it; `OFFICE_PUBLIC_URL` (links in e-mails) and `OFFICE_ALLOWED_HOSTS` (Host/Origin check) default to it in `docker-compose.yml`. |
| `LIVEKIT_DOMAIN` | `livekit.example.com` | Host name for LiveKit signaling. `LIVEKIT_URL` defaults to `wss://` + this value. |
| `ACME_EMAIL` | `you@example.com` | Let's Encrypt sends certificate expiry notices there. |
| `LIVEKIT_NODE_IP` | `203.0.113.10` | Public IPv4 that LiveKit announces to browsers for media. Optional (LiveKit can discover it through STUN) but recommended: it avoids a wrong guess on hosts with several interfaces. |

The example file also contains `OFFICE_PUBLIC_URL=https://office.example.com`, `OFFICE_ALLOWED_HOSTS=office.example.com` and `LIVEKIT_URL=wss://livekit.example.com`. Either update them to your real domains or delete the three lines so the compose defaults (derived from `OFFICE_DOMAIN` / `LIVEKIT_DOMAIN`) apply. Leaving the example values would make the app reject requests for your real host name.

Optional branding, also in `.env`: `OFFICE_APP_NAME`, `OFFICE_LOGO_URL`, `OFFICE_ACCENT_COLOR` (`#rrggbb`), `OFFICE_SIGN_TEXT` (the sign in the lobby, max 14 characters), `OFFICE_DEFAULT_LOCALE` (`en`, `pt-BR` or `es`). E-mail for invites and password resets: `SENDGRID_API_KEY` and `MAIL_FROM`; without them the admin panel shows temporary passwords on screen instead. Full reference: [../configuration.md](../configuration.md).

Save with `Ctrl+O`, `Enter`, then `Ctrl+X`.

## 9. Start the stack

```sh
docker compose up -d
```

Expected: Docker pulls four images and prints `Started` for `oficio-mysql-1`, `oficio-livekit-1`, `oficio-caddy-1` and `oficio-app-1`. The app waits for MySQL to pass its health check (up to about 30 seconds) before it starts.

Watch the logs:

```sh
docker compose logs -f
```

What to look for:

- `mysql`: `ready for connections` (the first boot initialises the data directory, which takes ~20 s).
- `app`: migrations being applied, then a line saying it is listening on port 4747. Warnings about missing configuration are printed at boot: with a complete `.env` there should be none.
- `caddy`: `certificate obtained successfully` for both host names. If you see `challenge failed`, DNS is not pointing at this server yet or port 80 is closed; fix it and Caddy retries on its own.
- `livekit`: `starting LiveKit server` with `nodeIP` equal to your public IP.

Press `Ctrl+C` to stop following the logs (the containers keep running). `docker compose ps` shows all four with status `running` and `(healthy)`.

## 10. Check that it works

```sh
curl -s https://office.example.com/api/health
```

Expected: `{"ok":true,"db":"ok","version":"0.1.0","uptime":42,"online":0,"livekit":true}` (version and uptime vary). `db` must be `ok` and `livekit` must be `true`.

```sh
curl -s https://livekit.example.com/
```

Expected: `OK`. That is LiveKit's signaling endpoint behind Caddy.

`https://office.example.com/api/config` returns the public branding (name, colors) as JSON; it is a quick way to confirm your `OFFICE_APP_NAME` took effect.

## 11. Create the first administrator

```sh
./scripts/first-admin.sh you@example.com "Your Name"
```

Expected:

```
admin created: you@example.com
temporary password (shown only once, must be changed on first login): Xk7...
```

The temporary password is printed **once**. The script runs `node dist/server/cli.js create-admin --email ... --name ...` inside the `app` container; you can pass a third argument to choose the password yourself (minimum 8 characters). Running it again for an existing e-mail promotes that account to admin without changing its password.

## 12. Sign in and invite your team

1. Open `https://office.example.com`. You see the login page with your name and logo.
2. Sign in with the e-mail and the temporary password. You are asked to set a new password.
3. Build your avatar and walk into the office.
4. Open the **Admin** panel (link in the top bar for administrators) and go to **Users**. Create a user with e-mail and name: if `SENDGRID_API_KEY` is set, the person receives an invite e-mail; otherwise the temporary password is shown to you to pass along.

Test audio with a colleague: walk next to each other and allow the microphone when the browser asks. If you hear nothing, see [../livekit.md](../livekit.md) and [../troubleshooting.md](../troubleshooting.md); the usual culprits are 7882/udp closed in the provider firewall or Cloudflare proxying `livekit.example.com`.

## 13. Backups

`scripts/backup.sh` dumps the database with `mysqldump` through the compose stack to `./backups/oficio-<timestamp>.sql.gz` and keeps the last 14 files. Run it once by hand:

```sh
cd /opt/oficio && ./scripts/backup.sh
ls -lh backups/
```

Then schedule it every night at 03:00:

```sh
crontab -e
```

Add the line:

```
0 3 * * * cd /opt/oficio && ./scripts/backup.sh >> backups/backup.log 2>&1
```

Set `S3_BUCKET` (and AWS credentials, or `S3_ENDPOINT` for S3-compatible storage) in the environment to also upload each dump off-site with the AWS CLI. Restore with `./scripts/restore.sh backups/<file>.sql.gz` (it stops the app while importing). Copy your `.env` somewhere safe too: without `OFFICE_JWT_SECRET` and the MySQL password a dump is hard to use. Details: [../backup-restore.md](../backup-restore.md).

## 14. Updates

The stack follows the `latest` image tag. To upgrade:

```sh
cd /opt/oficio
git pull                         # picks up compose/script changes, if any
docker compose pull
docker compose up -d
```

Database migrations run automatically when the new app container starts. To pin a release instead of `latest`, add `OFICIO_VERSION=1.2.3` to `.env` (tags published on GitHub Releases: `X.Y.Z`, `X.Y`, `latest`; `edge` is the untested `main` branch). See [../upgrading.md](../upgrading.md).

## 15. Uninstall

```sh
cd /opt/oficio
docker compose down            # stops and removes the containers, keeps the data
docker compose down -v         # also deletes the MySQL data and the certificates (irreversible)
cd / && sudo rm -rf /opt/oficio
```

---

## Variations

### Build the image from source instead of pulling it

Useful when you changed the code or need an architecture the published image does not cover. `docker-compose.build.yml` overrides the `app` service to build from the checkout:

```sh
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

The build needs ~2 GB of RAM and a few minutes. Repeat the same command after each `git pull` to rebuild.

### Running on ARM

The published image is multi-arch (`linux/amd64` and `linux/arm64`), as are the MySQL, LiveKit and Caddy images. The steps above work unchanged on Ampere/Graviton VPSes and on a Raspberry Pi 4/5 with a 64-bit OS. 32-bit ARM is not supported.

### Using an existing reverse proxy (nginx, Traefik, Nginx Proxy Manager, another Caddy)

If ports 80/443 on the host are already taken, remove the `caddy` service from the stack and route the two host names yourself:

1. Create `docker-compose.override.yml` next to `docker-compose.yml`:

   ```yaml
   services:
     caddy:
       deploy:
         replicas: 0
     app:
       ports: ["127.0.0.1:4747:4747"]
     livekit:
       ports:
         - "127.0.0.1:7880:7880"
         - "${LIVEKIT_TCP_PORT:-7881}:7881/tcp"
         - "${LIVEKIT_UDP_PORT:-7882}:7882/udp"
   ```

   Keep `OFFICE_DOMAIN` and `LIVEKIT_DOMAIN` in `.env` (the `caddy` definition still references them even with zero replicas).
2. In your proxy, forward `https://office.example.com` to `127.0.0.1:4747` and `https://livekit.example.com` to `127.0.0.1:7880`, with WebSocket upgrade enabled and long read timeouts. Ready-made configurations: [`deploy/caddy/Caddyfile`](../../deploy/caddy/Caddyfile) and [`deploy/nginx/oficio.conf`](../../deploy/nginx/oficio.conf). Set `TRUST_PROXY=1` (already the default in the compose file). Full guide: [../reverse-proxy.md](../reverse-proxy.md).

### Using LiveKit Cloud instead of the bundled LiveKit

Skip the `livekit` service, the `livekit.example.com` record and ports 7881/7882 entirely:

1. Create a project at LiveKit Cloud and copy its WebSocket URL and an API key/secret ([livekit-cloud.md](livekit-cloud.md)).
2. In `.env`: `LIVEKIT_URL=wss://<project>.livekit.cloud`, `LIVEKIT_INTERNAL_URL=wss://<project>.livekit.cloud`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` from the project.
3. Disable the local service with an override file:

   ```yaml
   services:
     livekit:
       deploy:
         replicas: 0
   ```

   `LIVEKIT_DOMAIN` must still be set to something (Caddy references it); point it at an unused name or keep the record, it is harmless.
4. `docker compose up -d`.

### Pinning the version, time zone, MySQL memory

In `.env`: `OFICIO_VERSION=1.2.3` (image tag), `TZ=America/Sao_Paulo` (container clocks and MySQL), `MYSQL_BUFFER_POOL=512M` (InnoDB buffer, default 256M; raise it on servers with 8 GB or more).

## Next steps

- [Hostinger](hostinger.md), [DigitalOcean](digitalocean.md): the same steps with the provider's panel described.
- [Portainer](portainer.md), [Coolify](coolify.md), [Dokploy](dokploy.md): run this stack from a web UI.
- [../admin-guide.md](../admin-guide.md): users, map editor, telemetry, CLI.
- [../troubleshooting.md](../troubleshooting.md): certificates, audio, WebSocket, database.
