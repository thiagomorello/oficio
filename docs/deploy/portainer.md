# Deploy on Portainer

Portainer is a web UI for Docker. Oficio ships two stack files for it: [`deploy/portainer/stack.yml`](../../deploy/portainer/stack.yml) for a **standalone** Docker host (includes Caddy for HTTPS) and [`deploy/portainer/stack-swarm.yml`](../../deploy/portainer/stack-swarm.yml) for **Docker Swarm** with an existing Traefik. Both are self-contained: no files from the repository are mounted, every setting is a stack environment variable.

| | |
|---|---|
| **What you get** | The full stack (app, MySQL, self-hosted LiveKit, and Caddy or your Traefik) managed from Portainer's UI: logs, console, restart, redeploy. |
| **Monthly cost** | Only the server Portainer runs on (see the [VPS guide](docker-compose-vps.md#1-choose-a-server-size) for sizing). Portainer Community Edition is free. |
| **Time needed** | 20–30 minutes. |
| **Audio/video** | Self-hosted LiveKit in the stack; [LiveKit Cloud](livekit-cloud.md) optional. |
| **Database** | MySQL 8 container in the stack, data in a Docker volume. |

UI labels are from Portainer CE 2.2x (late 2026); older or Business editions may differ slightly.

## Prerequisites

- A Linux host with Docker and Portainer installed (Portainer's own quick start: a `portainer/portainer-ce` container on port 9443). Docker Engine 24+ with Compose v2.23+ for the standalone stack (it uses inline `configs`).
- Two DNS A records to the host: `office.example.com` and `livekit.example.com` (Cloudflare: **DNS only**).
- Firewall (host and provider): 80/tcp, 443/tcp, 7881/tcp, 7882/udp, plus 22/tcp for SSH and 9443/tcp for Portainer (restrict that one to your IP if you can). MySQL is never published.
- Secrets generated on your computer (any terminal with `openssl`, including Git Bash on Windows):

  ```sh
  echo "OFFICE_JWT_SECRET=$(openssl rand -hex 32)"
  echo "MYSQL_ROOT_PASSWORD=$(openssl rand -hex 24)"
  echo "MYSQL_PASSWORD=$(openssl rand -hex 24)"
  echo "LIVEKIT_API_KEY=API$(openssl rand -hex 6)"
  echo "LIVEKIT_API_SECRET=$(openssl rand -hex 24)"
  echo "METRICS_TOKEN=$(openssl rand -hex 24)"
  ```

  Keep `MYSQL_PASSWORD` hex-only: it is embedded in a URL.

---

## Part 1: Standalone Docker host (`stack.yml`)

### 1. Add the stack

Log in to Portainer, pick your environment (usually `local`), then **Stacks > + Add stack**.

**Name**: `oficio`.

**Build method**, pick one:

**Repository** (Portainer pulls the file from GitHub and can keep it updated):

| Field | Value |
|---|---|
| Repository URL | `https://github.com/thiagomorello/oficio` |
| Repository reference | `refs/heads/main` (or a release tag, e.g. `refs/tags/v1.0.0`) |
| Compose path | `deploy/portainer/stack.yml` |
| Authentication | off (public repository) |

**Web editor** (you own the YAML): open [`deploy/portainer/stack.yml`](../../deploy/portainer/stack.yml) on GitHub, click **Raw**, copy everything and paste it into the editor. Use this if you want to edit the stack (for example to remove `caddy`).

### 2. Environment variables

Scroll to **Environment variables**. Click **+ Add an environment variable** for each row, or **Advanced mode** and paste `KEY=value` lines (one per line; this is also where **Load variables from .env file** lives if you prepared one).

Required:

| Variable | Value |
|---|---|
| `OFFICE_DOMAIN` | `office.example.com` |
| `LIVEKIT_DOMAIN` | `livekit.example.com` |
| `ACME_EMAIL` | `you@example.com` (Let's Encrypt notices) |
| `OFFICE_JWT_SECRET` | 64 hex chars (`openssl rand -hex 32`) |
| `MYSQL_ROOT_PASSWORD` | 48 hex chars |
| `MYSQL_PASSWORD` | 48 hex chars (hex only) |
| `LIVEKIT_API_KEY` | `API` + 12 hex chars |
| `LIVEKIT_API_SECRET` | 48 hex chars |

Recommended:

| Variable | Value |
|---|---|
| `LIVEKIT_NODE_IP` | public IPv4 of the host (`203.0.113.10`); LiveKit announces it to browsers. Without it LiveKit discovers the IP through STUN, which works on most single-NIC hosts. |

Optional:

| Variable | Default | Purpose |
|---|---|---|
| `OFICIO_VERSION` | `latest` | image tag: `1.2.3`, `1.2`, `latest`, `edge` |
| `OFFICE_APP_NAME` | `Oficio` | name in titles and e-mails |
| `OFFICE_LOGO_URL` | built-in logo | absolute URL of your logo |
| `OFFICE_ACCENT_COLOR` | `#7c9cff` | `#rrggbb` |
| `OFFICE_SIGN_TEXT` | app name | lobby sign, max 14 chars |
| `OFFICE_DEFAULT_LOCALE` | `en` | `en`, `pt-BR` or `es` |
| `SENDGRID_API_KEY`, `MAIL_FROM` | empty | invite / reset e-mails |
| `METRICS_TOKEN` | empty (public aggregate metrics) | protects `/metrics` |
| `TZ` | `UTC` | container time zone |
| `LIVEKIT_TCP_PORT`, `LIVEKIT_UDP_PORT` | `7881`, `7882` | host ports for media |

The stack derives the rest itself: `OFFICE_PUBLIC_URL=https://$OFFICE_DOMAIN`, `OFFICE_ALLOWED_HOSTS=$OFFICE_DOMAIN`, `LIVEKIT_URL=wss://$LIVEKIT_DOMAIN`, `DATABASE_URL=mysql://oficio:$MYSQL_PASSWORD@mysql:3306/oficio`.

### 3. Deploy

Click **Deploy the stack**. Portainer pulls four images and starts the containers; in **Stacks > oficio** you should see `app`, `livekit`, `mysql`, `caddy` with status **running** (and **healthy** after ~30 s for `app`, `livekit`, `mysql`).

Check the logs: click a container, then **Logs**. In `caddy`, wait for `certificate obtained successfully` for both domains; in `app`, migrations followed by the listening message. If Caddy logs `challenge failed`, DNS does not point at this host yet or port 80 is closed.

From any computer:

```sh
curl -s https://office.example.com/api/health      # {"ok":true,"db":"ok",...,"livekit":true}
curl -s https://livekit.example.com/                # OK
```

### 4. Create the first admin from the console

1. **Containers**, click the `oficio-app-1` container (the name may carry the stack prefix).
2. Click **Console** (the `>_` icon), command `/bin/sh`, user `node`, **Connect**.
3. Run:

   ```sh
   node dist/server/cli.js create-admin --email you@example.com --name "Your Name"
   ```

   Expected: `admin created: you@example.com` and a temporary password, shown once. Add `--password 'YourOwnPassword'` (8+ chars) to choose it yourself.
4. Open `https://office.example.com`, sign in, set a new password, build the avatar.

Invite the team in **Admin > Users**. Without `SENDGRID_API_KEY`, the temporary passwords are shown to you on screen.

### 5. Updating

**Repository method**: open the stack, and in **Stack details** click **Pull and redeploy**. Portainer re-reads the stack file from GitHub, pulls newer images (tick **Re-pull image** if offered) and recreates changed containers. Under **GitOps updates** you can also turn on **Automatic updates** with **Polling** (Portainer checks the repository at an interval and redeploys when the file changed; Community Edition supports polling, while webhook triggers have been a Business Edition feature; check Portainer's current docs). Note that polling redeploys only when the stack *file* changes, not when a new `latest` image is published; set `OFICIO_VERSION` to a specific tag and bump it, or use **Pull and redeploy** by hand.

**Web editor method**: open the stack, **Editor** tab, change `OFICIO_VERSION` in the variables (or nothing at all), tick **Re-pull image and redeploy**, and click **Update the stack**.

Migrations run on the app's first start after an update. Everyone is disconnected for a few seconds and reconnects.

### 6. Backups

`scripts/backup.sh` assumes a `docker compose` checkout and `.env`, so from Portainer use `mysqldump` directly on the host (cron on the Docker host):

```sh
docker exec -e MYSQL_PWD='<MYSQL_ROOT_PASSWORD>' oficio-mysql-1 \
  mysqldump -u root --single-transaction --quick --routines --triggers --hex-blob oficio \
  | gzip -9 > /var/backups/oficio-$(date +%F).sql.gz
```

(Adjust the container name from **Containers**.) Also back up the values of your stack environment variables: without `OFFICE_JWT_SECRET` and `MYSQL_PASSWORD` a dump is hard to reuse. More: [../backup-restore.md](../backup-restore.md).

### 7. Existing reverse proxy on the same host (Nginx Proxy Manager, Traefik, Caddy)

If something already listens on 80/443, Caddy from the stack will fail to start. Use the **Web editor** method and:

1. Delete the whole `caddy:` service block and the `caddy-data`/`caddy-config` volumes, plus the `caddyfile` entry under `configs:`.
2. Make `app` and `livekit` reachable by your proxy: either attach your proxy's network to them (add it under `networks:` of both services and declare it as `external: true`) or publish them locally: `app` with `ports: ["127.0.0.1:4747:4747"]`, `livekit` with an extra `"127.0.0.1:7880:7880"`.
3. In your proxy, route `office.example.com` to `app:4747` (or `127.0.0.1:4747`) and `livekit.example.com` to `livekit:7880`, with WebSocket support enabled (Nginx Proxy Manager: toggle **Websockets Support** on the proxy host). Keep `ACME_EMAIL` out; the proxy handles certificates. Examples: [../reverse-proxy.md](../reverse-proxy.md).

The media ports 7881/tcp and 7882/udp must still be published on the host by the `livekit` service; they are not proxied.

---

## Part 2: Docker Swarm with Traefik (`stack-swarm.yml`)

This stack assumes the common Portainer + Traefik setup on Swarm: an external overlay network where Traefik listens, an HTTPS entrypoint and a Let's Encrypt certificate resolver. It has no Caddy; Traefik terminates TLS for both host names.

### What is different on Swarm

- `app` runs with `replicas: 1` and `update_config.order: stop-first` (the office state lives in memory).
- LiveKit's media ports use `mode: host` (published on the node that runs the task, outside the routing mesh, as WebRTC requires). **`LIVEKIT_NODE_IP` is mandatory**: STUN discovery is unreliable through overlay networks, so the stack pins `use_external_ip: false` and announces that IP.
- Pin `livekit` and `mysql` to a node: uncomment the `placement.constraints: ["node.hostname == my-node"]` lines and put the node's hostname (`docker node ls`). LiveKit must stay where its ports are open, and MySQL where its local volume lives.
- `docker stack deploy` does not support inline `configs: content:`, so LiveKit is configured through the `LIVEKIT_CONFIG` environment variable. It also answers UDP only through `172.18.0.0/16` (the default `docker_gwbridge` range); change `ips.includes` if your gwbridge uses another range (`docker network inspect docker_gwbridge`).

### Steps

1. **Stacks > + Add stack**, name `oficio`, build method **Repository** with compose path `deploy/portainer/stack-swarm.yml` (or paste it in the **Web editor**).
2. Environment variables, required: `OFFICE_DOMAIN`, `LIVEKIT_DOMAIN`, `LIVEKIT_NODE_IP`, `OFFICE_JWT_SECRET`, `MYSQL_ROOT_PASSWORD`, `MYSQL_PASSWORD` (hex), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`. Traefik integration, change only if yours differ: `TRAEFIK_NETWORK` (default `traefik_public`), `TRAEFIK_ENTRYPOINT` (`websecure`), `TRAEFIK_CERTRESOLVER` (`letsencryptresolver`). Optional branding variables as in Part 1.
3. Open 7881/tcp and 7882/udp on the node that runs LiveKit (host firewall and provider firewall). 80/443 are Traefik's and should already be open.
4. **Deploy the stack**. In **Services** you should see `oficio_app`, `oficio_livekit`, `oficio_mysql` each at `1/1`.
5. Check: `curl https://office.example.com/api/health` and `curl https://livekit.example.com/` (`OK`). Traefik's dashboard, if you have one, shows the two routers `oficio` and `oficio-livekit`.
6. Console into the app task: **Services > oficio_app**, click the running task, **Console**, `/bin/sh`, and run `node dist/server/cli.js create-admin --email you@example.com --name "Your Name"`.

Updating: **Pull and redeploy** (Repository) or **Update the stack** (editor). Swarm stops the old app task first, then starts the new one.

Backups: `docker exec` into the `oficio_mysql` task's container on its node with the `mysqldump` command from Part 1.

---

## LiveKit Cloud instead of the bundled LiveKit

Remove the `livekit:` service from either stack (Web editor), and set `LIVEKIT_URL` and `LIVEKIT_INTERNAL_URL` both to your `wss://<project>.livekit.cloud` URL and `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` to the project's key. Since the stacks hard-code `LIVEKIT_URL: wss://${LIVEKIT_DOMAIN}` and `LIVEKIT_INTERNAL_URL: http://livekit:7880` in the `app` environment, change those two lines to `${LIVEKIT_URL}` and `${LIVEKIT_INTERNAL_URL}` so your variables are used. Ports 7881/7882 can then be closed. See [livekit-cloud.md](livekit-cloud.md).

## Troubleshooting

- **Stack fails with "additional properties 'content' not allowed"**: the Docker host's Compose is older than v2.23. Update Docker on the host (`apt install docker-compose-plugin`) or use the Swarm file, which does not use inline configs.
- **`caddy` restarts in a loop, "address already in use"**: ports 80/443 are taken by another proxy. See Part 1, section 7.
- **People hear nothing**: 7882/udp closed in the provider firewall, or (Swarm) `LIVEKIT_NODE_IP` wrong / LiveKit scheduled on a node where the ports are not open.
- **Login returns 503**: `OFFICE_JWT_SECRET` empty. Check the stack's environment variables and redeploy.
- More in [../troubleshooting.md](../troubleshooting.md).
