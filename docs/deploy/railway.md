# Deploy on Railway

Railway builds the Oficio container from the repository's `Dockerfile`, runs it as a single always-on service, and provides a MySQL database as another service in the same project. Railway has no UDP ingress, so audio/video goes through **LiveKit Cloud**.

| | |
|---|---|
| **What you get** | Oficio as a managed container with a public HTTPS URL (and your own domain), MySQL managed by Railway, media by LiveKit Cloud. No server to maintain. |
| **Monthly cost** | Railway's Hobby plan is about US$ 5/month including US$ 5 of usage; a small Oficio service plus MySQL typically lands around US$ 5–15/month of usage depending on RAM and traffic. LiveKit Cloud has a free tier. Prices change: check railway.com/pricing. |
| **Time needed** | 20 minutes. |
| **Audio/video** | LiveKit Cloud (required; see [livekit-cloud.md](livekit-cloud.md)). |
| **Database** | Railway MySQL service, reached over Railway's private network. |

UI labels are from the Railway dashboard as of late 2026.

## Before you start

- A Railway account (GitHub login is simplest).
- A LiveKit Cloud project: WebSocket URL, API key and secret ([livekit-cloud.md](livekit-cloud.md), steps 1–2).
- Optional: the Railway CLI (`npm i -g @railway/cli`, then `railway login`) for logs and shell access from your terminal.

## 1. Create the project from GitHub

1. Dashboard: **+ New Project > Deploy from GitHub repo**.
2. If asked, **Configure GitHub App** and grant access. Railway deploys from repositories your GitHub account can see, so **fork** `thiagomorello/oficio` to your account first and pick the fork. (Alternative without a fork: **+ New > Docker Image**, image `ghcr.io/thiagomorello/oficio:latest`; then skip the build-related notes below.)
3. Select the repository. Railway detects `railway.json` in the root, which tells it to build with the `Dockerfile`, run 1 replica, check `/api/health` with a 60 s timeout and restart on failure (up to 10 times).
4. Click **Deploy Now**. The first build takes 3–5 minutes. It will deploy and immediately fail health checks: the variables are missing. That is expected; continue.

Rename the service to `oficio` (click the service, **Settings > Service name**).

## 2. Add MySQL

1. In the project canvas, **+ New > Database > Add MySQL**.
2. Wait for it to deploy (about a minute). Click the MySQL service, **Variables** tab: Railway provides `MYSQLHOST`, `MYSQLPORT`, `MYSQLUSER`, `MYSQLPASSWORD`, `MYSQLDATABASE` and a ready-made `MYSQL_URL`. The `MYSQL_URL` host should end in `.railway.internal`: that is the private network address. If your project also shows `MYSQL_PUBLIC_URL`, that one goes through a public TCP proxy and is billed as egress; do not use it from the app.

The default database name is `railway`; Oficio does not care about the name.

## 3. Variables on the Oficio service

Click the `oficio` service, **Variables** tab, **Raw Editor**, and paste (then **Update Variables**):

```
NODE_ENV=production
OFFICE_PORT=4747
OFFICE_PUBLIC_URL=https://oficio-production-xxxx.up.railway.app
OFFICE_ALLOWED_HOSTS=oficio-production-xxxx.up.railway.app
TRUST_PROXY=1
OFFICE_COOKIE_SECURE=1
OFFICE_JWT_SECRET=<openssl rand -hex 32>
DATABASE_URL=${{MySQL.MYSQL_URL}}
LIVEKIT_URL=wss://<project>.livekit.cloud
LIVEKIT_INTERNAL_URL=wss://<project>.livekit.cloud
LIVEKIT_API_KEY=API...
LIVEKIT_API_SECRET=...
LIVEKIT_ROOM=oficio
OFFICE_APP_NAME=Oficio
OFFICE_DEFAULT_LOCALE=en
```

Notes:

- `${{MySQL.MYSQL_URL}}` is a **reference variable**: Railway substitutes the MySQL service's value at deploy time, so you never copy the password. `MySQL` is the service's name on the canvas; adjust if you renamed it. Check in the MySQL service that the variable is really the private one (host `*.railway.internal`); Railway has renamed these over time.
- `OFFICE_PORT=4747` is already set by the image; it is repeated here so it is visible. Oficio reads `OFFICE_PORT`, not Railway's `PORT`; the public domain is pointed at 4747 in the next step.
- `OFFICE_PUBLIC_URL` / `OFFICE_ALLOWED_HOSTS`: you will know the exact domain after step 4; come back and fix them. `OFFICE_ALLOWED_HOSTS` is a comma-separated list; when you add a custom domain, list both.
- Optional: `OFFICE_LOGO_URL`, `OFFICE_ACCENT_COLOR`, `OFFICE_SIGN_TEXT`, `SENDGRID_API_KEY` + `MAIL_FROM` (invite e-mails), `METRICS_TOKEN`. Reference: [../configuration.md](../configuration.md).

Saving variables triggers a redeploy.

## 4. Public domain

1. `oficio` service, **Settings > Networking > Public Networking > Generate Domain**.
2. Railway asks which **port** the service listens on: enter `4747`. You get `oficio-production-xxxx.up.railway.app`.
3. Put that host in `OFFICE_PUBLIC_URL` (`https://...`) and `OFFICE_ALLOWED_HOSTS` (host only) in **Variables**. Redeploys.

Private networking (the MySQL connection) does not need any setting.

## 5. Check the deployment

**Deployments** tab: the latest should turn **Active** after the health check passes. **View Logs** shows migrations followed by the listening message; warnings about missing variables mean something above was not set.

```sh
curl -s https://oficio-production-xxxx.up.railway.app/api/health
```

Expected `{"ok":true,"db":"ok","version":"...","uptime":..,"online":0,"livekit":true}`. If `db` is `error`, open the MySQL service and compare the variable name you referenced.

## 6. Create the first admin

With the Railway CLI, from any folder:

```sh
railway login
railway link            # pick the project and the oficio service
railway ssh -- node dist/server/cli.js create-admin --email you@example.com --name "Your Name"
```

`railway ssh` opens a shell in the running container. Without it (older CLI), the alternative is not `railway run`: that executes on your computer, where the `*.railway.internal` database host is unreachable. Instead, temporarily enable **Public Access** on the MySQL service (**Settings > Networking**), run the command locally with `DATABASE_URL` set to the `MYSQL_PUBLIC_URL` value (`DATABASE_URL='mysql://...' node dist/server/cli.js create-admin ...` from a built checkout), then disable Public Access again. Or use the dashboard: the service's deployment view has no shell, so `ssh` really is the convenient path.

The command prints `admin created: you@example.com` and a temporary password, once. Open the app URL, sign in, set a password, build your avatar. Invite colleagues in **Admin > Users**.

## 7. Custom domain

1. **Settings > Networking > Public Networking > + Custom Domain**, enter `office.example.com`. Railway shows a CNAME target.
2. At your DNS provider, create the CNAME `office` → that target. With Cloudflare, keep it **DNS only** (Railway's docs explain the proxied alternative; DNS only is simpler).
3. When Railway shows the domain as verified (certificate issued), update variables: `OFFICE_PUBLIC_URL=https://office.example.com`, `OFFICE_ALLOWED_HOSTS=oficio-production-xxxx.up.railway.app,office.example.com`.

## 8. Operating

- **Single replica**: `railway.json` sets `numReplicas: 1`. Do not raise it in **Settings > Deploy > Replicas**; the office state is in memory and a second replica would be a second, separate office.
- **Region**: **Settings > Deploy > Region**. Pick the one closest to your team.
- **Resources**: usage-based. Oficio idles around 150–250 MB RAM; MySQL around 400 MB. Check **Metrics**.
- **Sleep**: Railway can put services to sleep when there is no traffic (**Settings > Deploy > App Sleeping**). Keep it **off**: a sleeping office drops everyone's presence.
- **Updates**: every push to your fork's default branch triggers a build and deploy (you can disable that in **Settings > Source**). To follow upstream, sync your fork from `thiagomorello/oficio` and push. Migrations run at start.
- **Backups**: Railway offers volume backups for database services in the service's **Backups** tab on paid plans (check availability). Additionally, dump from your machine while **Public Access** is enabled: `mysqldump --single-transaction -h <host> -P <port> -u root -p railway | gzip > oficio.sql.gz`, then disable Public Access.
- **Logs**: service **Deployments > View Logs**, or `railway logs`.

## Limitations to know

- No UDP ingress: LiveKit cannot run on Railway. LiveKit Cloud or a LiveKit on a VPS ([../livekit.md](../livekit.md)).
- Deploys restart the container; people reconnect automatically after a few seconds.
- Railway's egress pricing applies to all traffic; Oficio's own traffic (WebSocket state updates) is light, media never touches Railway.

Troubleshooting Oficio itself: [../troubleshooting.md](../troubleshooting.md).
