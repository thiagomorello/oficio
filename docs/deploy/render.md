# Deploy on Render

Render runs the Oficio container as a **Web Service** built from the repository's `Dockerfile`. Render has no managed MySQL and no UDP ingress, so the database lives at an external MySQL provider and audio/video goes through **LiveKit Cloud**. The repository ships a Blueprint, [`render.yaml`](../../render.yaml), that describes the service and its variables.

| | |
|---|---|
| **What you get** | Oficio as a managed container with HTTPS, auto-deploys from Git, logs and a shell in Render's dashboard. |
| **Monthly cost** | Render **Starter** web service about US$ 7/month (the free tier is not suitable, see below); external MySQL from US$ 0 (free tiers of serverless MySQL providers) to ~US$ 15–30 for a small dedicated instance; LiveKit Cloud free tier or paid. Prices change: check render.com/pricing. |
| **Time needed** | 25 minutes, plus the external database signup. |
| **Audio/video** | LiveKit Cloud (required). |
| **Database** | External MySQL 8 (any provider reachable from the internet with TLS). |

Dashboard labels are from Render as of late 2026.

## Why not the free tier

Free web services on Render spin down after about 15 minutes without inbound HTTP traffic and take tens of seconds to wake up. For Oficio that means: everybody's WebSocket drops, the in-memory office state is lost, and the first person back waits for a cold start. Use at least the **Starter** instance. Also note the free tier's monthly hour quota and lack of persistent instances.

## Before you start

1. **External MySQL 8**. Options: a serverless MySQL provider with a free or hobby tier (PlanetScale, TiDB Cloud, Aiven for MySQL...), a Railway MySQL with Public Access enabled, or MySQL on a small VPS. Create a database `oficio` and a user with full rights on it, and note the connection string. Most providers require TLS; the URL form Oficio expects is `mysql://user:password@host:3306/oficio?ssl=true` (URL-encode special characters in the password; TLS parameters per provider are in [../database.md](../database.md)).
2. **LiveKit Cloud** project: WebSocket URL, API key and secret ([livekit-cloud.md](livekit-cloud.md)).
3. A Render account connected to GitHub, and a **fork** of `thiagomorello/oficio` in your account (Render deploys repositories you have access to).

## Option A: Blueprint (`render.yaml`)

1. Dashboard: **New + > Blueprint**.
2. Connect your fork. Render reads `render.yaml` and shows one web service `oficio` (runtime Docker, plan Starter, 1 instance, health check `/api/health`).
3. The Blueprint lists variables with `sync: false`, which Render asks you to fill now:

   | Variable | Value |
   |---|---|
   | `OFFICE_PUBLIC_URL` | `https://oficio.onrender.com` (you can change the service name; the URL is `<name>.onrender.com`) |
   | `OFFICE_ALLOWED_HOSTS` | `oficio.onrender.com` (add your custom domain later, comma-separated) |
   | `DATABASE_URL` | the MySQL URL from your provider |
   | `LIVEKIT_URL` | `wss://<project>.livekit.cloud` |
   | `LIVEKIT_INTERNAL_URL` | same `wss://` URL |
   | `LIVEKIT_API_KEY` | from LiveKit Cloud |
   | `LIVEKIT_API_SECRET` | from LiveKit Cloud |

   `OFFICE_JWT_SECRET` and `METRICS_TOKEN` are marked `generateValue: true`: Render creates random values for you. `NODE_ENV`, `TRUST_PROXY=1`, `OFFICE_COOKIE_SECURE=1`, `LIVEKIT_ROOM=oficio`, `OFFICE_APP_NAME`, `OFFICE_DEFAULT_LOCALE` have fixed values in the file.
4. **Apply**. Render builds the image (3–6 minutes) and deploys.

## Option B: Manual Web Service

1. **New + > Web Service**, connect the fork.
2. **Language**: Docker. **Region**: closest to your team. **Instance type**: Starter or above. Leave **Dockerfile path** as `./Dockerfile`.
3. **Environment Variables > Add from .env** and paste:

   ```
   NODE_ENV=production
   PORT=4747
   OFFICE_PUBLIC_URL=https://oficio.onrender.com
   OFFICE_ALLOWED_HOSTS=oficio.onrender.com
   TRUST_PROXY=1
   OFFICE_COOKIE_SECURE=1
   OFFICE_JWT_SECRET=<openssl rand -hex 32>
   DATABASE_URL=mysql://user:password@host:3306/oficio?ssl=true
   LIVEKIT_URL=wss://<project>.livekit.cloud
   LIVEKIT_INTERNAL_URL=wss://<project>.livekit.cloud
   LIVEKIT_API_KEY=API...
   LIVEKIT_API_SECRET=...
   LIVEKIT_ROOM=oficio
   OFFICE_APP_NAME=Oficio
   OFFICE_DEFAULT_LOCALE=en
   ```

4. **Advanced > Health Check Path**: `/api/health`. **Create Web Service**.

### About the port

The image listens on `OFFICE_PORT=4747` (set in the Dockerfile) and ignores Render's `PORT`. Render's Docker runtime detects the port your process opens and routes HTTPS traffic to it; setting `PORT=4747` is not required but makes detection immediate and documents the intent, which is why Option B includes it. Render does not read the Dockerfile's `EXPOSE`.

## Verify

**Events** tab: the deploy should reach **Live**. **Logs** tab: migrations applied, then the listening message. From your computer:

```sh
curl -s https://oficio.onrender.com/api/health
```

Expected `{"ok":true,"db":"ok",...,"livekit":true}`. `db: "error"` means the MySQL URL or TLS parameter is wrong, or the provider blocks Render's outbound IPs (check **Settings > Outbound IP addresses** and allow-list them at the database provider if it has an IP allow list).

## First admin

**Shell** tab of the service (opens a terminal inside the running container; available on paid instances). Run:

```sh
node dist/server/cli.js create-admin --email you@example.com --name "Your Name"
```

Copy the temporary password (shown once), open `https://oficio.onrender.com`, sign in and set a new password. Invite colleagues in **Admin > Users** (with `SENDGRID_API_KEY` + `MAIL_FROM` set they receive an e-mail; otherwise you pass along the temporary password shown to you).

## Custom domain

1. **Settings > Custom Domains > Add Custom Domain**: `office.example.com`.
2. Create the CNAME Render shows at your DNS provider (`office` → `oficio.onrender.com`). Cloudflare: **DNS only** is the simplest.
3. Render issues the certificate once DNS resolves. Then update **Environment**: `OFFICE_PUBLIC_URL=https://office.example.com`, `OFFICE_ALLOWED_HOSTS=oficio.onrender.com,office.example.com`. Save; Render redeploys.

## Operating

- **One instance**: `numInstances: 1` in the Blueprint; never scale the service horizontally (**Settings > Scaling** stays at 1). The office state is in memory.
- **Deploys**: by default Render auto-deploys on every push to the fork's branch (**Settings > Build & Deploy > Auto-Deploy**). To follow upstream releases, sync your fork and push. Each deploy restarts the container; users reconnect in a few seconds. Migrations run on start.
- **Zero-downtime deploys** on Render briefly run the new instance alongside the old one while the health check passes; both connect to the same database, which is fine for Oficio (the old instance stops serving once the new one is live and clients reconnect to it).
- **Backups**: your MySQL provider's responsibility; most offer daily snapshots. Also keep `OFFICE_JWT_SECRET` and the other variables somewhere safe (**Environment > Export** in some Render plans, or copy them).
- **Metrics/logs**: **Metrics** and **Logs** tabs. `/metrics` (Prometheus) is protected by the generated `METRICS_TOKEN`.

## Limitations

- No UDP: LiveKit cannot run on Render. LiveKit Cloud or a LiveKit on a VPS ([../livekit.md](../livekit.md)).
- No managed MySQL: Render offers Postgres and key-value stores only; Oficio needs MySQL 8.
- Free instances spin down and lose presence; use Starter or above.

Troubleshooting Oficio: [../troubleshooting.md](../troubleshooting.md).
