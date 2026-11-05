# Deploy on Coolify

Coolify is a self-hosted platform that deploys applications on your own servers from a web UI, with its own Traefik (or Caddy) proxy handling domains and HTTPS. Oficio runs on Coolify as a **Docker Compose** resource with three services: `app`, `mysql` and `livekit`. Coolify's proxy replaces the `caddy` service of the standard stack.

| | |
|---|---|
| **What you get** | Oficio, MySQL and a self-hosted LiveKit on a server you already manage with Coolify; domains, TLS, logs, restarts and redeploys from Coolify's UI. |
| **Monthly cost** | Only your server (Coolify itself is free and open source). For Oficio alone, 2 GB RAM is enough for ~15 people; Coolify adds ~1 GB of its own. |
| **Time needed** | 20–30 minutes. |
| **Audio/video** | Self-hosted LiveKit in the same compose (ports 7881/7882 published on the host). [LiveKit Cloud](livekit-cloud.md) optional. |
| **Database** | MySQL 8 container in the same compose, data in a Docker volume managed by Coolify. |

Coolify's UI changes often; labels below are from Coolify v4 (late 2026). Where a label differs, look for the equivalent.

## Why not the repository's `docker-compose.yml` as-is

Three reasons, all about the Caddy service:

1. Coolify's proxy already listens on ports 80 and 443 of the server. The stack's `caddy` would fail to bind them.
2. Coolify assigns domains per service and generates the proxy configuration itself; Caddy is redundant.
3. Coolify rewrites the compose file it deploys (adds its network, labels and volumes) and does not reliably preserve Compose's inline `configs: content:` blocks. The trimmed compose below configures LiveKit through the `LIVEKIT_CONFIG` environment variable instead, exactly like the Portainer stack does.

So instead of pointing Coolify at the repository, you paste a compose file of your own. It is short.

## Prerequisites

- A server with Coolify installed and its proxy running (Coolify dashboard reachable).
- DNS: `office.example.com` and `livekit.example.com` as A records to the server's public IP (`203.0.113.10`). Cloudflare: **DNS only**.
- Firewall (host and provider): 80/tcp, 443/tcp (the proxy), 7881/tcp and 7882/udp (LiveKit media), 22/tcp (SSH), and Coolify's own port 8000/tcp restricted to your IP.
- Secrets, generated on your computer:

  ```sh
  echo "OFFICE_JWT_SECRET=$(openssl rand -hex 32)"
  echo "MYSQL_ROOT_PASSWORD=$(openssl rand -hex 24)"
  echo "MYSQL_PASSWORD=$(openssl rand -hex 24)"
  echo "LIVEKIT_API_KEY=API$(openssl rand -hex 6)"
  echo "LIVEKIT_API_SECRET=$(openssl rand -hex 24)"
  ```

## 1. Create the resource

1. In Coolify open your **Project** (or create one: **Projects > + Add**), then the environment (`production`).
2. **+ New Resource**. Under **Docker Based**, choose **Docker Compose Empty** (a compose you paste yourself).
3. Select the **Server** and **Destination** (the default Docker network is fine).

## 2. Paste the compose

In the **Docker Compose** editor paste the following and click **Save**:

```yaml
services:
  app:
    image: ghcr.io/thiagomorello/oficio:${OFICIO_VERSION:-latest}
    restart: unless-stopped
    depends_on:
      mysql:
        condition: service_healthy
    environment:
      - SERVICE_FQDN_APP_4747
      - NODE_ENV=production
      - TZ=${TZ:-UTC}
      - OFFICE_IN_DOCKER=1
      - OFFICE_HOST=0.0.0.0
      - OFFICE_PORT=4747
      - OFFICE_PUBLIC_URL=https://${OFFICE_DOMAIN}
      - OFFICE_ALLOWED_HOSTS=${OFFICE_DOMAIN}
      - OFFICE_COOKIE_SECURE=1
      - TRUST_PROXY=1
      - OFFICE_JWT_SECRET=${OFFICE_JWT_SECRET}
      - OFFICE_APP_NAME=${OFFICE_APP_NAME:-Oficio}
      - OFFICE_LOGO_URL=${OFFICE_LOGO_URL:-}
      - OFFICE_ACCENT_COLOR=${OFFICE_ACCENT_COLOR:-}
      - OFFICE_SIGN_TEXT=${OFFICE_SIGN_TEXT:-}
      - OFFICE_DEFAULT_LOCALE=${OFFICE_DEFAULT_LOCALE:-en}
      - DATABASE_URL=mysql://oficio:${MYSQL_PASSWORD}@mysql:3306/oficio
      - LIVEKIT_URL=wss://${LIVEKIT_DOMAIN}
      - LIVEKIT_INTERNAL_URL=http://livekit:7880
      - LIVEKIT_API_KEY=${LIVEKIT_API_KEY}
      - LIVEKIT_API_SECRET=${LIVEKIT_API_SECRET}
      - LIVEKIT_ROOM=oficio
      - SENDGRID_API_KEY=${SENDGRID_API_KEY:-}
      - MAIL_FROM=${MAIL_FROM:-}
      - METRICS_TOKEN=${METRICS_TOKEN:-}
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://127.0.0.1:4747/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s

  livekit:
    image: livekit/livekit-server:v1.13.11
    restart: unless-stopped
    environment:
      - SERVICE_FQDN_LIVEKIT_7880
      - LIVEKIT_KEYS=${LIVEKIT_API_KEY}: ${LIVEKIT_API_SECRET}
      - |
        LIVEKIT_CONFIG=
        port: 7880
        rtc:
          tcp_port: 7881
          udp_port: 7882
          use_external_ip: true
          node_ip: ${LIVEKIT_NODE_IP:-}
        turn:
          enabled: false
        room:
          auto_create: true
          empty_timeout: 300
          departure_timeout: 20
        logging:
          level: info
          pion_level: error
    ports:
      - "7881:7881/tcp"
      - "7882:7882/udp"
    healthcheck:
      test: ["CMD-SHELL", "wget -q -O /dev/null http://127.0.0.1:7880/ || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 3

  mysql:
    image: mysql:8.0
    restart: unless-stopped
    command:
      - "--character-set-server=utf8mb4"
      - "--collation-server=utf8mb4_unicode_ci"
      - "--innodb-buffer-pool-size=256M"
      - "--max-connections=100"
    environment:
      - MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD}
      - MYSQL_DATABASE=oficio
      - MYSQL_USER=oficio
      - MYSQL_PASSWORD=${MYSQL_PASSWORD}
      - TZ=${TZ:-UTC}
    volumes:
      - mysql-data:/var/lib/mysql
    healthcheck:
      test: ["CMD-SHELL", "mysqladmin ping -h 127.0.0.1 -u root -p$$MYSQL_ROOT_PASSWORD --silent"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 30s

volumes:
  mysql-data:
```

About the two `SERVICE_FQDN_*` lines: they are Coolify's "magic" variables. `SERVICE_FQDN_APP_4747` tells Coolify that the `app` service wants a domain routed to container port 4747, and `SERVICE_FQDN_LIVEKIT_7880` the same for `livekit` on port 7880. After you save, Coolify shows a **Domains** field for each of these two services. (The YAML is derived from [`deploy/portainer/stack.yml`](../../deploy/portainer/stack.yml) minus Caddy; the security hardening options `read_only`, `cap_drop` and `tmpfs` were left out because Coolify's compose rewriting does not always preserve them. Add them back if your Coolify version keeps them.)

## 3. Domains

On the resource page, Coolify lists the services. For each one:

- **app** > **Domains**: `https://office.example.com`
- **livekit** > **Domains**: `https://livekit.example.com`

Use `https://`: that is how Coolify knows to request a Let's Encrypt certificate through its proxy. Leave the generated `sslip.io` suggestions out; Oficio must be reached by the same host name you put in `OFFICE_DOMAIN`.

## 4. Environment variables

Open the **Environment Variables** tab. Coolify has pre-filled the `${...}` names it found in the compose; fill the values (or use **Developer view** to paste `KEY=value` lines):

| Variable | Value |
|---|---|
| `OFFICE_DOMAIN` | `office.example.com` |
| `LIVEKIT_DOMAIN` | `livekit.example.com` |
| `LIVEKIT_NODE_IP` | `203.0.113.10` (public IP of the server; recommended) |
| `OFFICE_JWT_SECRET` | 64 hex chars |
| `MYSQL_ROOT_PASSWORD` | 48 hex chars |
| `MYSQL_PASSWORD` | 48 hex chars, hex only |
| `LIVEKIT_API_KEY` | `API` + 12 hex |
| `LIVEKIT_API_SECRET` | 48 hex chars |

Optional: `OFICIO_VERSION` (image tag, default `latest`), `OFFICE_APP_NAME`, `OFFICE_LOGO_URL`, `OFFICE_ACCENT_COLOR`, `OFFICE_SIGN_TEXT`, `OFFICE_DEFAULT_LOCALE` (`en`/`pt-BR`/`es`), `SENDGRID_API_KEY` + `MAIL_FROM`, `METRICS_TOKEN`, `TZ`. Leave unknown ones empty rather than deleting them.

Mark the secrets as such if your Coolify version offers the toggle (hides them in the UI).

## 5. Deploy

Click **Deploy** (top right). The **Deployments** tab shows the log: image pulls, then container starts. Wait until the three containers are **Running**; `app` becomes **Healthy** about 30 s after `mysql` does.

**Logs** tab per service: `app` should show migrations and the listening message; `livekit` should show `starting LiveKit server` with your `nodeIP`. Coolify's proxy obtains the certificates in the background (first visit may take a minute).

Check from your computer:

```sh
curl -s https://office.example.com/api/health      # {"ok":true,"db":"ok",...,"livekit":true}
curl -s https://livekit.example.com/                # OK
```

## 6. First admin

In the resource, open the **app** service's **Terminal** (Coolify offers a terminal per container; alternatively `ssh` to the server and `docker exec -it <app-container> sh`, find the name with `docker ps`). Run:

```sh
node dist/server/cli.js create-admin --email you@example.com --name "Your Name"
```

Copy the temporary password (shown once), open `https://office.example.com`, sign in, set your password. Invite people in **Admin > Users**.

## 7. Persistent data

The `mysql-data` volume holds everything. Coolify names it with the resource's identifier; find it in the **Storages** tab (or `docker volume ls` on the server). **Do not** click "Delete" on the resource unless you mean to lose the database; use **Stop** instead.

Backups: Coolify's built-in scheduled database backups apply to databases created as Coolify "Database" resources, not to a MySQL inside a compose. Schedule a dump on the server with cron:

```sh
docker exec -e MYSQL_PWD='<MYSQL_ROOT_PASSWORD>' <mysql-container> \
  mysqldump -u root --single-transaction --quick --routines --triggers --hex-blob oficio \
  | gzip -9 > /var/backups/oficio-$(date +%F).sql.gz
```

Alternative: create MySQL as a separate Coolify **Database** resource (which gets Coolify's backup scheduler and S3 upload), remove the `mysql` service from the compose, and point `DATABASE_URL` at it (internal host name shown by Coolify). See [../database.md](../database.md).

## 8. Updates

With `OFICIO_VERSION` unset (`latest`), click **Redeploy** on the resource: Coolify pulls the newer image and recreates the containers. To pin releases, set `OFICIO_VERSION=1.2.3` and change it when you want to upgrade. Release tags and notes: GitHub Releases of the repository. Migrations run automatically on start.

## 9. LiveKit Cloud instead of the bundled LiveKit

Delete the `livekit:` service from the compose, set `LIVEKIT_URL` and `LIVEKIT_INTERNAL_URL` in the `app` service to `wss://<project>.livekit.cloud` (replace the two lines that reference `LIVEKIT_DOMAIN` / `http://livekit:7880`), and fill `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` with the Cloud project's key. Ports 7881/7882 can be closed. [livekit-cloud.md](livekit-cloud.md).

## Troubleshooting

- **Domain shows Coolify's "no resource" page or a certificate error**: the domain was not saved on the right service, or DNS points elsewhere. Check **Domains** on `app` and `livekit`, and `nslookup`.
- **Login page says the service is unavailable (503)**: `OFFICE_JWT_SECRET` empty. Fill it and redeploy.
- **"Origin not allowed" / requests rejected**: `OFFICE_DOMAIN` differs from the domain you entered in Coolify. They must match exactly.
- **Audio does not connect**: 7882/udp not open in the provider firewall, or `LIVEKIT_NODE_IP` wrong. `curl https://livekit.example.com/` must print `OK`.
- **LiveKit logs "could not parse config"**: the indentation of the `LIVEKIT_CONFIG` block was altered when pasting. Compare with the YAML above.
- Coolify's documentation on Docker Compose resources and `SERVICE_*` variables covers the platform side; [../troubleshooting.md](../troubleshooting.md) covers Oficio.
