# Deploy on DigitalOcean

Two ways to run Oficio on DigitalOcean:

- **Path A: a Droplet** (virtual server) with Docker. The whole stack, including self-hosted LiveKit, runs on one machine. Recommended.
- **Path B: App Platform** (managed containers) with a Managed MySQL database and LiveKit Cloud. No server to maintain, but no UDP, so audio/video must go through LiveKit Cloud.

| | Path A: Droplet | Path B: App Platform |
|---|---|---|
| **What you get** | Full stack on one server, as in the [VPS guide](docker-compose-vps.md) | App container managed by DigitalOcean, database managed by DigitalOcean, media by LiveKit Cloud |
| **Monthly cost** | ~US$ 12–48 for the Droplet (2–8 GB); optional Managed MySQL from ~US$ 15 | ~US$ 10+ for the service (basic-xs), ~US$ 15+ for Managed MySQL (a `production: false` dev database is cheaper), plus LiveKit Cloud usage above its free tier. Prices change. |
| **Time needed** | ~40 minutes | ~30 minutes |
| **Audio/video** | Self-hosted LiveKit on the Droplet | LiveKit Cloud (required) |
| **Database** | MySQL container (default) or Managed MySQL | Managed MySQL component created by the app spec |

Menu names are as of late 2026 in the DigitalOcean control panel (cloud.digitalocean.com).

---

## Path A: Droplet

### A1. Create the Droplet

1. In the control panel click **Create > Droplets**.
2. **Region**: closest to your team. **Datacenter**: any.
3. **Choose an image**: open the **Marketplace** tab and search for **Docker**; pick **Docker on Ubuntu** (Docker Engine and Compose pre-installed on Ubuntu LTS). Plain **Ubuntu 24.04 (LTS) x64** also works; you then install Docker as in the VPS guide.
4. **Size**: Basic, Regular or Premium CPU:

   | Team | Droplet |
   |---|---|
   | up to ~15 | 1 vCPU / 2 GB |
   | up to ~50 | 2 vCPU / 4 GB |
   | up to ~150 | 4 vCPU / 8 GB |

5. **Authentication**: SSH key (recommended) or password.
6. Optional: tick **Enable backups** (weekly Droplet snapshots, extra 20%).
7. **Hostname**: `oficio`. Click **Create Droplet**. Copy the public IPv4 (`203.0.113.10` below).

### A2. Cloud Firewall

Docker publishes ports around `ufw`, so use DigitalOcean's network firewall, which is enforced outside the server.

1. **Networking** (left menu) **> Firewalls > Create Firewall**.
2. Name: `oficio`.
3. **Inbound Rules**: the panel pre-fills SSH. Add the others with **New rule**:

   | Type | Protocol | Port range | Sources |
   |---|---|---|---|
   | SSH | TCP | 22 | All IPv4, All IPv6 (or only your IP) |
   | HTTP | TCP | 80 | All IPv4, All IPv6 |
   | HTTPS | TCP | 443 | All IPv4, All IPv6 |
   | Custom | TCP | 7881 | All IPv4, All IPv6 |
   | Custom | UDP | 7882 | All IPv4, All IPv6 |

4. **Outbound Rules**: leave the defaults (all traffic allowed).
5. **Apply to Droplets**: type the Droplet name and select it. **Create Firewall**.

The Docker Marketplace image also enables `ufw` on the server with a small set of ports; after connecting, run `sudo ufw status` and add the same rules (`sudo ufw allow 80/tcp` ... `sudo ufw allow 7882/udp`) so the two firewalls agree, or `sudo ufw disable` and rely on the Cloud Firewall alone. DigitalOcean's own troubleshooting docs recommend keeping them consistent.

### A3. DNS

If the domain's nameservers are at DigitalOcean: **Networking > Domains**, open the domain, and under **Create new record** add two **A** records (`office` and `livekit`, both to `203.0.113.10`, TTL 300). Otherwise add the same records at your registrar; with Cloudflare set them to **DNS only** (grey cloud).

### A4. Install Oficio

Follow the [VPS reference guide](docker-compose-vps.md) from step 2. With the Marketplace image Docker is already present (skip step 3). Summary:

```sh
ssh root@203.0.113.10
adduser deploy && usermod -aG sudo,docker deploy && su - deploy
sudo mkdir -p /opt/oficio && sudo chown $USER:$USER /opt/oficio
git clone https://github.com/thiagomorello/oficio.git /opt/oficio && cd /opt/oficio
./scripts/gen-secrets.sh
nano .env            # OFFICE_DOMAIN, LIVEKIT_DOMAIN, ACME_EMAIL, LIVEKIT_NODE_IP=203.0.113.10
docker compose up -d && docker compose logs -f
curl -s https://office.example.com/api/health
./scripts/first-admin.sh you@example.com "Your Name"
```

### A5. Optional: Managed MySQL instead of the container

Useful if you want DigitalOcean to handle backups, failover and upgrades of the database.

1. **Create > Databases**: engine **MySQL 8**, same region as the Droplet, smallest plan to start. Create.
2. In the cluster's **Overview**, under **Connection details**, choose **Connection string** and **Public network** or **VPC network** (VPC is preferable if the Droplet is in the same region). The string looks like `mysql://doadmin:<password>@<host>:25060/defaultdb?ssl-mode=REQUIRED`.
3. **Users & Databases** tab: create a database `oficio` (and, if you like, a user `oficio`).
4. **Settings > Trusted sources**: click **Edit**, add your Droplet (by name) and **Save**. Nothing else can reach the database.
5. In `/opt/oficio/.env` set `DATABASE_URL=mysql://oficio:<password>@<host>:25060/oficio?ssl=true` (Managed MySQL requires TLS; see [../database.md](../database.md) for the exact TLS parameters the app accepts) and disable the bundled MySQL with `docker-compose.override.yml`:

   ```yaml
   services:
     mysql:
       deploy:
         replicas: 0
     app:
       depends_on: !reset []
   ```

6. `docker compose up -d`. The app creates its tables on first start. Backups are then in **Databases > your cluster > Backups**.

### A6. Backups, updates, uninstall

As in the VPS guide: `scripts/backup.sh` + cron for the database, `docker compose pull && docker compose up -d` to update. Droplet **Snapshots** (Droplet page > **Snapshots > Take snapshot**) are a whole-disk safety net; power off the Droplet first for a consistent copy, or rely on the SQL dumps.

---

## Path B: App Platform

App Platform runs the Oficio container from the repository's `Dockerfile`, with these limits you should know before starting:

- **No UDP and no arbitrary TCP ports**: App Platform exposes HTTP(S) only. LiveKit cannot run there, so audio/video uses **LiveKit Cloud** (or a LiveKit on a Droplet; see [../livekit.md](../livekit.md)).
- **One instance**: `instance_count: 1`. The office state lives in memory; two instances would be two different offices.
- **No MySQL in the container**: the spec creates a **Managed MySQL** cluster and injects its connection string.

### B1. Prerequisites

- A LiveKit Cloud project: WebSocket URL (`wss://<project>.livekit.cloud`), API key and secret. Steps in [livekit-cloud.md](livekit-cloud.md).
- `doctl` installed and authenticated (`doctl auth init`), or use the control panel's spec editor.
- The GitHub source: App Platform builds from a GitHub repository that your DigitalOcean account is authorised to read (**Settings > Source Control** or during creation). The spec points at `thiagomorello/oficio`; if App Platform cannot access it from your account, **fork** the repository and change `github.repo` in the spec to your fork. Alternatively replace the `github` + `dockerfile_path` block with an image source pointing at the prebuilt `ghcr.io/thiagomorello/oficio:latest` (App Platform supports GitHub Container Registry as an image registry; check the current app spec reference for the exact `image:` fields).

### B2. Prepare the spec

Copy [`.do/app.yaml`](../../.do/app.yaml) and edit the placeholders:

```yaml
envs:
  - key: OFFICE_JWT_SECRET
    type: SECRET
    value: <openssl rand -hex 32>
  - key: LIVEKIT_URL
    value: wss://<project>.livekit.cloud
  - key: LIVEKIT_INTERNAL_URL
    value: wss://<project>.livekit.cloud
  - key: LIVEKIT_API_KEY
    type: SECRET
    value: <from LiveKit Cloud>
  - key: LIVEKIT_API_SECRET
    type: SECRET
    value: <from LiveKit Cloud>
```

What the rest of the spec already does: `http_port: 4747` (the port the image listens on), `health_check.http_path: /api/health`, `OFFICE_PUBLIC_URL: ${APP_URL}` and `OFFICE_ALLOWED_HOSTS: ${APP_DOMAIN}` (App Platform fills in the generated `ondigitalocean.app` URL), `DATABASE_URL: ${db.DATABASE_URL}` (filled from the `db` database component), `TRUST_PROXY=1`, `OFFICE_COOKIE_SECURE=1`. `region: nyc` and `instance_size_slug: basic-xs` can be changed; `databases[0].production: true` can be set to `false` for a cheaper development database while you evaluate.

### B3. Create the app

```sh
doctl apps create --spec .do/app.yaml
```

Expected: a table with the new app's ID and `Default Ingress` (something like `https://oficio-abcde.ondigitalocean.app`). The first build takes 5–10 minutes (it builds the Docker image, then creates the MySQL cluster). Follow it in the panel: **Apps > oficio > Activity**, or:

```sh
doctl apps list
doctl apps logs <app-id> --type build --follow
doctl apps logs <app-id> --type run --follow
```

Without `doctl`: **Create > App Platform**, pick the GitHub repo and branch, let it detect the Dockerfile, then on the review page choose **Edit App Spec** and paste your edited YAML.

### B4. Check and create the admin

```sh
curl -s https://oficio-abcde.ondigitalocean.app/api/health
```

Expected `{"ok":true,"db":"ok",...,"livekit":true}`.

Open the app in the panel, **Console** tab (a shell inside the running container), and run:

```sh
node dist/server/cli.js create-admin --email you@example.com --name "Your Name"
```

Copy the temporary password, open the app URL and sign in.

### B5. Custom domain

1. **Apps > oficio > Settings > Domains > Add Domain**, enter `office.example.com`. App Platform shows a CNAME target (or, if the domain is managed by DigitalOcean DNS, offers to create the record).
2. Create the CNAME at your DNS provider. Certificates are issued automatically once it resolves.
3. Update the env vars (Settings > app component > **Environment Variables**, or `doctl apps update <id> --spec`): `OFFICE_PUBLIC_URL=https://office.example.com` and `OFFICE_ALLOWED_HOSTS=oficio-abcde.ondigitalocean.app,office.example.com`. Saving redeploys the app.

### B6. Updates and limits

- `deploy_on_push: false` in the spec means you deploy on purpose: **Actions > Force Rebuild and Deploy** in the panel, or `doctl apps create-deployment <app-id>`. Set it to `true` for automatic deploys from `main`.
- Logs: **Runtime Logs** tab. Metrics: **Insights**.
- Every deploy restarts the single container: everybody is disconnected for a few seconds and reconnects automatically.
- The database's backups and maintenance window are in **Databases > oficio-db**.
- To delete everything: `doctl apps delete <app-id>` and then delete the database cluster under **Databases** (it is not removed with the app).

## Which path should I pick?

A Droplet costs less, keeps audio/video on your own machine, and is what the rest of the documentation assumes. App Platform removes server maintenance at the price of a managed database and LiveKit Cloud usage. Both are fine; for 50+ people or if you value having no server to patch, Path B is reasonable.
