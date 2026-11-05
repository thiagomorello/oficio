# Deploy on Fly.io

Fly.io runs the Oficio container as a single Machine close to your team, with HTTPS and WebSockets handled by Fly's proxy. The repository ships a [`fly.toml`](../../fly.toml). The database is an external MySQL 8 and audio/video goes through **LiveKit Cloud** (recommended). An advanced section covers running LiveKit on Fly with UDP, which Fly does support but which we have not validated end to end.

| | |
|---|---|
| **What you get** | Oficio on one always-on Fly Machine (shared 1 vCPU, 1 GB RAM by default), automatic TLS, custom domain, `fly` CLI for logs and shell. |
| **Monthly cost** | The default `shared-cpu-1x` 1 GB machine is a few US dollars per month (Fly bills per second of usage) plus a little for bandwidth; a dedicated IPv4 (needed only for the advanced UDP section) costs about US$ 2/month. External MySQL and LiveKit Cloud extra. Prices change: check fly.io/docs/about/pricing. |
| **Time needed** | 25 minutes. |
| **Audio/video** | LiveKit Cloud (recommended). Self-hosted LiveKit on Fly: advanced, community-supported. |
| **Database** | External MySQL 8 (Fly has announced a managed MySQL in private beta; until it is generally available use an external provider or self-host MySQL as a Fly app, see [../database.md](../database.md)). |

Commands use `fly` (the `flyctl` CLI), as of late 2026.

## Before you start

1. Install the CLI (`curl -L https://fly.io/install.sh | sh` on macOS/Linux; `pwsh -Command "iwr https://fly.io/install.ps1 -useb | iex"` on Windows) and sign in: `fly auth login`.
2. A MySQL 8 database reachable from the internet with TLS (PlanetScale, TiDB Cloud, Aiven, Railway with Public Access, or your own). Database `oficio`, a user with full rights, connection string `mysql://user:password@host:3306/oficio?ssl=true` ([../database.md](../database.md) for provider-specific TLS parameters).
3. A LiveKit Cloud project: WebSocket URL, API key and secret ([livekit-cloud.md](livekit-cloud.md)).
4. A clone of the repository on your computer: `git clone https://github.com/thiagomorello/oficio.git && cd oficio`.

## 1. Create the app

`fly.toml` already contains the build (Dockerfile), the HTTP service on internal port 4747 with `force_https`, a health check on `/api/health`, `auto_stop_machines = "off"` with `min_machines_running = 1` (the office must stay up), and the non-secret environment. Create the app from it without deploying yet:

```sh
fly launch --copy-config --no-deploy --name my-oficio --region gru
```

- `--copy-config` uses the repository's `fly.toml` instead of generating one.
- `--name` must be globally unique on Fly (it becomes `my-oficio.fly.dev`). Skip it to let Fly pick a name.
- `--region`: pick the closest to your team (`fly platform regions` lists them; `gru` is São Paulo, `iad` Virginia, `ams` Amsterdam...).

Answer **No** if the wizard offers to create a Postgres or Redis database (Oficio uses MySQL). Expected: `Created app 'my-oficio' in organization ...` and an updated `fly.toml` with your app name and region.

Edit `fly.toml` so the two public-facing variables match the real host name:

```toml
[env]
  OFFICE_PUBLIC_URL = "https://my-oficio.fly.dev"
  OFFICE_ALLOWED_HOSTS = "my-oficio.fly.dev"
```

Add `LIVEKIT_URL` and `LIVEKIT_INTERNAL_URL` to the same `[env]` block (they are not secret):

```toml
  LIVEKIT_URL = "wss://<project>.livekit.cloud"
  LIVEKIT_INTERNAL_URL = "wss://<project>.livekit.cloud"
```

## 2. Secrets

```sh
fly secrets set \
  OFFICE_JWT_SECRET="$(openssl rand -hex 32)" \
  DATABASE_URL="mysql://user:password@host:3306/oficio?ssl=true" \
  LIVEKIT_API_KEY="API..." \
  LIVEKIT_API_SECRET="..." \
  METRICS_TOKEN="$(openssl rand -hex 24)"
```

Expected: `Secrets are staged for the first deployment`. Optional secrets: `SENDGRID_API_KEY` and `MAIL_FROM` for invite e-mails.

## 3. Deploy

```sh
fly deploy
```

Fly builds the image remotely (3–6 minutes the first time), creates one Machine and waits for the health check. Expected at the end: `1 desired, 1 placed, 1 healthy`. Then:

```sh
fly status                 # one machine, state "started", checks passing
fly logs                   # migrations applied, listening on 4747 (Ctrl+C to leave)
curl -s https://my-oficio.fly.dev/api/health
```

Expected `{"ok":true,"db":"ok",...,"livekit":true}`. If `db` is `error`, check the MySQL URL and whether the provider restricts source IPs (Fly Machines have no fixed outbound IPv4 unless you allocate one: `fly ips allocate-v4` and `fly ips list`).

Keep exactly **one** Machine: `fly scale count 1` if you ever changed it. Two Machines would be two separate offices. `fly deploy` uses a rolling strategy by default that briefly starts the new Machine before stopping the old; with one Machine this means a few seconds where clients reconnect, which is fine.

## 4. First admin

```sh
fly ssh console -C "node dist/server/cli.js create-admin --email you@example.com --name 'Your Name'"
```

Expected: `admin created: you@example.com` and a temporary password shown once. Open `https://my-oficio.fly.dev`, sign in, set a new password. Invite colleagues in **Admin > Users**.

## 5. Custom domain

```sh
fly certs add office.example.com
```

Fly prints the DNS records to create: a CNAME `office` → `my-oficio.fly.dev` (or A/AAAA records to the app's IPs, `fly ips list`). With Cloudflare keep the record **DNS only**. Check with `fly certs show office.example.com` until the certificate is issued. Then update `fly.toml`:

```toml
  OFFICE_PUBLIC_URL = "https://office.example.com"
  OFFICE_ALLOWED_HOSTS = "my-oficio.fly.dev,office.example.com"
```

and `fly deploy`.

## 6. Operating

- **Resources**: `[[vm]]` in `fly.toml` sets `shared-cpu-1x`, 1 GB. For ~50 people: `fly scale vm shared-cpu-2x --memory 2048` (or edit the file and deploy).
- **Updates**: `git pull` in your clone and `fly deploy`. To deploy the published image instead of building: `fly deploy --image ghcr.io/thiagomorello/oficio:1.2.3`. Migrations run at start.
- **Logs and metrics**: `fly logs`, `fly dashboard` (opens the web dashboard with Machine metrics). `/metrics` is protected by `METRICS_TOKEN`.
- **Backups**: your MySQL provider's snapshots. Keep the secrets in your password manager (`fly secrets list` shows names and digests, never values).
- **Delete**: `fly apps destroy my-oficio`.

## Advanced: self-hosted LiveKit on Fly (community, not validated)

Fly does support UDP services, so running LiveKit on a second Fly app is possible in principle. We have **not** validated this end to end and do not support it; it is documented here as a starting point for people who want to try. If you need predictable audio, use LiveKit Cloud or a LiveKit on a VPS ([../livekit.md](../livekit.md)).

What Fly's documentation says about UDP (verify against the current page "Running apps on UDP and TCP"):

- UDP needs a **dedicated IPv4** on the app (`fly ips allocate-v4`, about US$ 2/month); UDP over IPv6 is not supported.
- The process must **bind the UDP socket to the special address `fly-global-services`** (resolved from `/etc/hosts` inside the Machine), not to `0.0.0.0`, otherwise replies leave with the wrong source address and never reach the client. TCP services must still bind to `0.0.0.0`.
- The UDP **internal port must equal the external port**; Fly does not rewrite UDP ports.

A sketch of a `fly.toml` for a `livekit` app:

```toml
app = "my-oficio-livekit"
primary_region = "gru"

[build]
  image = "livekit/livekit-server:v1.13.11"

[env]
  LIVEKIT_CONFIG = """
port: 7880
rtc:
  tcp_port: 7881
  udp_port: 7882
  use_external_ip: false
  node_ip: 203.0.113.10        # the dedicated IPv4 of this Fly app
turn:
  enabled: false
room:
  auto_create: true
"""

[http_service]                   # signaling: wss://my-oficio-livekit.fly.dev
  internal_port = 7880
  force_https = true
  auto_stop_machines = "off"
  min_machines_running = 1

[[services]]                     # media over TCP
  internal_port = 7881
  protocol = "tcp"
  [[services.ports]]
    port = 7881

[[services]]                     # media over UDP
  internal_port = 7882
  protocol = "udp"
  [[services.ports]]
    port = 7882
```

Then `fly secrets set LIVEKIT_KEYS="APIxxx: secret"` and, in the Oficio app, `LIVEKIT_URL=wss://my-oficio-livekit.fly.dev`, `LIVEKIT_INTERNAL_URL=http://my-oficio-livekit.internal:7880` (Fly private networking) and the same key/secret.

The open question is the `fly-global-services` bind: LiveKit's `rtc` section offers `interfaces` / `ips` include lists to restrict which addresses it uses, but whether that makes its UDP replies originate from the right address on Fly is exactly what nobody has confirmed for this setup. Test with two browsers on different networks and the LiveKit connection tester (livekit.io/connection-test) before relying on it. Reports, good or bad, are welcome as GitHub issues.

## Limitations

- One Machine only; Fly's auto-stop must stay off (it is, in the shipped `fly.toml`).
- No managed MySQL yet (private beta at the time of writing); external MySQL or a self-hosted MySQL Fly app with a volume.
- The app's outbound IPv4 is shared unless you allocate a dedicated one; database providers with IP allow lists need that.

Troubleshooting Oficio: [../troubleshooting.md](../troubleshooting.md).
