# Deploy on Dokploy

Dokploy is a self-hosted deployment platform (a web UI over Docker and Docker Swarm) with a built-in Traefik proxy that owns ports 80/443 and issues Let's Encrypt certificates. Oficio runs on Dokploy as a **Compose** service with `app`, `mysql` and `livekit`; Dokploy's Traefik replaces the `caddy` service of the standard stack.

| | |
|---|---|
| **What you get** | Oficio, MySQL and a self-hosted LiveKit on a server you manage with Dokploy; domains, TLS, logs, terminal and redeploys from the UI. |
| **Monthly cost** | Only the server (Dokploy is free and open source). 2 GB RAM for ~15 people plus Dokploy's own footprint; 4 GB is comfortable. |
| **Time needed** | 20–30 minutes. |
| **Audio/video** | Self-hosted LiveKit in the compose (7881/tcp + 7882/udp published on the host). [LiveKit Cloud](livekit-cloud.md) optional. |
| **Database** | MySQL 8 container in the compose, data in a Docker volume. |

Labels are from Dokploy as of late 2026; check Dokploy's docs if a menu has moved.

## Why a pasted compose instead of the repository file

The repository's `docker-compose.yml` includes Caddy on 80/443, which collides with Dokploy's Traefik, and uses Compose inline `configs: content:` blocks that platform rewriting may not preserve. Dokploy can deploy a compose from a Git repository, but the `.env` handling for Git-based compose services has had rough edges (variables not loaded from subdirectories), so the dependable path is **Raw** mode: paste a trimmed compose and put the variables in Dokploy's **Environment** tab.

## Prerequisites

- Dokploy installed on a server, dashboard reachable (port 3000 by default; restrict it to your IP).
- DNS A records `office.example.com` and `livekit.example.com` to the server IP (`203.0.113.10`). Cloudflare: **DNS only**.
- Firewall (host and provider): 80/tcp, 443/tcp, 7881/tcp, 7882/udp, 22/tcp. MySQL stays internal.
- Secrets generated locally:

  ```sh
  echo "OFFICE_JWT_SECRET=$(openssl rand -hex 32)"
  echo "MYSQL_ROOT_PASSWORD=$(openssl rand -hex 24)"
  echo "MYSQL_PASSWORD=$(openssl rand -hex 24)"
  echo "LIVEKIT_API_KEY=API$(openssl rand -hex 6)"
  echo "LIVEKIT_API_SECRET=$(openssl rand -hex 24)"
  ```

## 1. Create the Compose service

1. **Projects > Create Project** (name `oficio`), open it.
2. **Create Service > Compose**. Name: `oficio`. Compose type: **Docker Compose** (not Stack, unless you run Dokploy in Swarm mode on purpose). **Create**.
3. In the service, **General** tab, **Provider**: choose **Raw**.

## 2. Paste the compose

Paste into the **Compose file** editor and **Save**:

```yaml
services:
  app:
    image: ghcr.io/thiagomorello/oficio:${OFICIO_VERSION:-latest}
    restart: unless-stopped
    depends_on:
      mysql:
        condition: service_healthy
    environment:
      NODE_ENV: production
      TZ: ${TZ:-UTC}
      OFFICE_IN_DOCKER: "1"
      OFFICE_HOST: 0.0.0.0
      OFFICE_PORT: "4747"
      OFFICE_PUBLIC_URL: https://${OFFICE_DOMAIN}
      OFFICE_ALLOWED_HOSTS: ${OFFICE_DOMAIN}
      OFFICE_COOKIE_SECURE: "1"
      TRUST_PROXY: "1"
      OFFICE_JWT_SECRET: ${OFFICE_JWT_SECRET}
      OFFICE_APP_NAME: ${OFFICE_APP_NAME:-Oficio}
      OFFICE_LOGO_URL: ${OFFICE_LOGO_URL:-}
      OFFICE_ACCENT_COLOR: ${OFFICE_ACCENT_COLOR:-}
      OFFICE_SIGN_TEXT: ${OFFICE_SIGN_TEXT:-}
      OFFICE_DEFAULT_LOCALE: ${OFFICE_DEFAULT_LOCALE:-en}
      DATABASE_URL: mysql://oficio:${MYSQL_PASSWORD}@mysql:3306/oficio
      LIVEKIT_URL: wss://${LIVEKIT_DOMAIN}
      LIVEKIT_INTERNAL_URL: http://livekit:7880
      LIVEKIT_API_KEY: ${LIVEKIT_API_KEY}
      LIVEKIT_API_SECRET: ${LIVEKIT_API_SECRET}
      LIVEKIT_ROOM: oficio
      SENDGRID_API_KEY: ${SENDGRID_API_KEY:-}
      MAIL_FROM: ${MAIL_FROM:-}
      METRICS_TOKEN: ${METRICS_TOKEN:-}
    read_only: true
    tmpfs:
      - /tmp:size=64m
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://127.0.0.1:4747/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
    networks: [default, dokploy-network]

  livekit:
    image: livekit/livekit-server:v1.13.11
    restart: unless-stopped
    environment:
      LIVEKIT_KEYS: "${LIVEKIT_API_KEY}: ${LIVEKIT_API_SECRET}"
      LIVEKIT_CONFIG: |
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
    read_only: true
    healthcheck:
      test: ["CMD-SHELL", "wget -q -O /dev/null http://127.0.0.1:7880/ || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 3
    networks: [default, dokploy-network]

  mysql:
    image: mysql:8.0
    restart: unless-stopped
    command:
      - "--character-set-server=utf8mb4"
      - "--collation-server=utf8mb4_unicode_ci"
      - "--innodb-buffer-pool-size=256M"
      - "--max-connections=100"
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}
      MYSQL_DATABASE: oficio
      MYSQL_USER: oficio
      MYSQL_PASSWORD: ${MYSQL_PASSWORD}
      TZ: ${TZ:-UTC}
    volumes:
      - mysql-data:/var/lib/mysql
    healthcheck:
      test: ["CMD-SHELL", "mysqladmin ping -h 127.0.0.1 -u root -p$$MYSQL_ROOT_PASSWORD --silent"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 30s
    networks: [default]

volumes:
  mysql-data:

networks:
  dokploy-network:
    external: true
```

Notes: `dokploy-network` is the external network Dokploy's Traefik uses to reach containers; `app` and `livekit` join it so the domains can be routed, `mysql` does not. This is [`deploy/portainer/stack.yml`](../../deploy/portainer/stack.yml) without Caddy. Dokploy may add its own labels when deploying; that is expected.

## 3. Environment variables

**Environment** tab. Paste one `KEY=value` per line:

```
OFFICE_DOMAIN=office.example.com
LIVEKIT_DOMAIN=livekit.example.com
LIVEKIT_NODE_IP=203.0.113.10
OFFICE_JWT_SECRET=<64 hex>
MYSQL_ROOT_PASSWORD=<48 hex>
MYSQL_PASSWORD=<48 hex, hex only>
LIVEKIT_API_KEY=API<12 hex>
LIVEKIT_API_SECRET=<48 hex>
```

Optional: `OFICIO_VERSION`, `OFFICE_APP_NAME`, `OFFICE_LOGO_URL`, `OFFICE_ACCENT_COLOR`, `OFFICE_SIGN_TEXT`, `OFFICE_DEFAULT_LOCALE`, `SENDGRID_API_KEY`, `MAIL_FROM`, `METRICS_TOKEN`, `TZ`. **Save**.

## 4. Domains

**Domains** tab, **Add Domain**, twice:

| Host | Service name | Container port | HTTPS | Certificate |
|---|---|---|---|---|
| `office.example.com` | `app` | `4747` | on | Let's Encrypt |
| `livekit.example.com` | `livekit` | `7880` | on | Let's Encrypt |

Path `/` for both. Dokploy writes the Traefik routers; WebSocket upgrades pass through Traefik without extra configuration.

## 5. Deploy

Click **Deploy**. The **Deployments** tab streams the log (image pulls, container creation). Then in **Logs**, pick each service: `mysql` reaches `ready for connections`, `app` runs migrations and listens on 4747, `livekit` prints `starting LiveKit server`. Certificates appear on the first HTTPS request (give Traefik up to a minute).

Check:

```sh
curl -s https://office.example.com/api/health      # {"ok":true,"db":"ok",...,"livekit":true}
curl -s https://livekit.example.com/                # OK
```

## 6. First admin

**Advanced** (or **Terminal**) tab: pick the `app` container and open a shell, or `ssh` to the server and `docker exec -it $(docker ps -qf name=oficio.*app) sh`. Run:

```sh
node dist/server/cli.js create-admin --email you@example.com --name "Your Name"
```

Sign in at `https://office.example.com` with the temporary password (shown once), set a new one, build your avatar. Invite colleagues in **Admin > Users**.

## 7. Persistent volumes and backups

`mysql-data` is a named Docker volume (`docker volume ls` on the server shows it prefixed with the compose project name). **Stop** keeps it; deleting the service in Dokploy may remove it, so export a dump first.

Backups: Dokploy's scheduled backups apply to its own database services, not to a MySQL inside a compose. Two options:

- Cron on the server:

  ```sh
  docker exec -e MYSQL_PWD='<MYSQL_ROOT_PASSWORD>' $(docker ps -qf name=oficio.*mysql) \
    mysqldump -u root --single-transaction --quick --routines --triggers --hex-blob oficio \
    | gzip -9 > /var/backups/oficio-$(date +%F).sql.gz
  ```

- Create MySQL as a Dokploy **Database** service (which has scheduled backups to S3), remove `mysql` from the compose, set `DATABASE_URL` to the internal host Dokploy shows. See [../database.md](../database.md).

Also keep a copy of the environment variables.

## 8. Updates

**Redeploy** pulls `latest` (or the pinned `OFICIO_VERSION`) and recreates the containers; migrations run on start. Everyone is disconnected for a few seconds. To pin releases, set `OFICIO_VERSION=1.2.3` in **Environment** and bump it on purpose. Dokploy's **Auto Deploy**/webhooks apply to Git-based services; with Raw mode you redeploy by hand.

## 9. LiveKit Cloud instead of the bundled LiveKit

Remove the `livekit` service and the `livekit.example.com` domain, replace `LIVEKIT_URL: wss://${LIVEKIT_DOMAIN}` and `LIVEKIT_INTERNAL_URL: http://livekit:7880` in `app` with your `wss://<project>.livekit.cloud` URL, and use the Cloud project's API key/secret. [livekit-cloud.md](livekit-cloud.md).

## Troubleshooting

- **404 from Traefik on the domain**: the domain was attached to the wrong service or port; check **Domains** (`app`/4747, `livekit`/7880) and that both services list `dokploy-network`.
- **`network dokploy-network declared as external, but could not be found`**: your Dokploy uses another network name; run `docker network ls` on the server and adjust the compose.
- **Login returns 503**: `OFFICE_JWT_SECRET` is empty in **Environment**.
- **Requests rejected because of the host name**: `OFFICE_DOMAIN` must equal the host you added in **Domains**.
- **No audio**: 7882/udp closed at the provider firewall, or `LIVEKIT_NODE_IP` not the public IP.
- [../troubleshooting.md](../troubleshooting.md) for the rest.
