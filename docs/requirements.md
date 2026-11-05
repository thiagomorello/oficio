# Requirements

What you need before installing Oficio: a Linux host sized for your team, Docker (or Node.js and MySQL to run from source), a handful of open ports, two DNS names with HTTPS, and a modern browser on every desk. This page lists all of it and ends with a checklist you can tick off before running `docker compose up -d`.

## Hardware

Oficio has four moving parts: the **app** (Node.js, keeps the office state in memory), **MySQL**, the **LiveKit** media server (audio, video, screen sharing) and **Caddy** (reverse proxy with automatic TLS). On a single VPS they all share the same machine. The numbers below are estimates for the whole stack; your mileage depends on how many cameras are on at the same time.

| Concurrent people | vCPU | RAM | Disk | Notes |
|---|---|---|---|---|
| up to ~15 | 1 | 2 GB | 20 GB SSD | The smallest VPS most providers sell. Fine for a small team. |
| up to ~50 | 2 | 4 GB | 40 GB SSD | Comfortable headroom for LiveKit when several cameras are on. |
| up to ~150 | 4 | 8 GB | 80 GB SSD | Run LiveKit on its own host, or use LiveKit Cloud, so media load does not compete with the app. |

Where the memory goes, roughly:

| Component | Idle | Growth |
|---|---|---|
| app | 150–300 MB | small; the office state is tiny compared with Node's baseline |
| MySQL 8 | 400–800 MB | bounded by `innodb-buffer-pool-size` (256 MB in the compose file, `MYSQL_BUFFER_POOL`) |
| LiveKit | ~200 MB | about 5 MB per connected participant |
| Caddy | ~30 MB | negligible |

The compose file sets memory limits (app 1 GB, LiveKit 2 GB, MySQL 1 GB) so a runaway process cannot take the host down.

### What actually costs CPU and bandwidth

The app itself is cheap: it runs a 20 Hz simulation of a few dozen avatars and sends position deltas at 10 Hz over WebSocket. The expensive part is media. LiveKit is an SFU: every publisher sends one stream up, and the server forwards it to everyone who is subscribed. CPU and egress therefore scale with the **number of subscriptions**, not with the number of people online.

Proximity keeps that number small. A person only subscribes to the people nearby or in the same meeting room; in practice this is at most 8–10 streams per client. Per stream, budget 300 kbps–1.5 Mbps for video and about 40 kbps for audio. The server's outbound bandwidth is approximately the sum of all active subscriptions. A 50-person office with, say, six meetings of four people on camera needs on the order of 20–30 Mbps of egress, which any VPS provides.

## Software

### Running with Docker (recommended)

- **Docker 24+** with **Docker Compose v2.23 or newer**. The compose files use `configs: content:` (inline configuration), which older Compose versions do not understand. Check with `docker compose version`.
- A 64-bit Linux host. **Ubuntu 22.04 / 24.04** or **Debian 12** are the tested baselines. The image is multi-arch (linux/amd64 and linux/arm64), so ARM machines work too.
- `git` and `openssl` (used by `scripts/gen-secrets.sh`).

### Running from source

- **Node.js 22+** (`engines.node >= 22` in `../package.json`).
- **MySQL 8** reachable from the app (`DATABASE_URL`).
- A LiveKit server (self-hosted or LiveKit Cloud) if you want audio and video.
- A reverse proxy for TLS: the Node process serves plain HTTP on port 4747.

See [Configuration](configuration.md) and [CONTRIBUTING.md](../CONTRIBUTING.md) for the development setup, which runs with in-memory data and no MySQL.

## Network and ports

| Port | Protocol | Who listens | Exposed to the internet? | Purpose |
|---|---|---|---|---|
| 80 | TCP | Caddy | yes | HTTP to HTTPS redirect and Let's Encrypt HTTP-01 challenges |
| 443 | TCP | Caddy | yes | HTTPS for the app and `wss://` for the WebSocket at `/ws`; HTTPS for LiveKit signaling |
| 443 | UDP | Caddy | optional | HTTP/3 (QUIC). Nice to have, not required |
| 7880 | TCP | LiveKit | no | LiveKit signaling (HTTP/WebSocket). Caddy proxies `https://livekit.example.com` to it |
| 7881 | TCP | LiveKit | yes | ICE over TCP: media fallback when UDP is blocked |
| 7882 | UDP | LiveKit | yes | All WebRTC media (audio, video, screen) on a single UDP port |
| 4747 | TCP | app | no | HTTP + WebSocket of the app. Only Caddy talks to it |
| 3306 | TCP | MySQL | no | Database. Never expose it |

`7881` and `7882` are the defaults; change them with `LIVEKIT_TCP_PORT` / `LIVEKIT_UDP_PORT` in `.env`. As an alternative to one UDP port, LiveKit can use a range such as `50000-60000/udp` (see [`deploy/livekit/livekit.yaml`](../deploy/livekit/livekit.yaml) and [LiveKit](livekit.md)); the single port is simpler to firewall and is what the compose file uses.

A minimal firewall with `ufw`:

```sh
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw allow 7881/tcp
sudo ufw allow 7882/udp
sudo ufw enable
```

Cloud providers often have a second firewall in their control panel (security groups); open the same ports there.

### What happens when UDP is blocked

WebRTC prefers UDP. If a participant sits behind a corporate firewall that drops UDP, the browser falls back to **ICE over TCP on port 7881**. Calls still work, but with higher latency and more jitter, because TCP retransmits lost packets instead of skipping them. If a network blocks everything except 443, even the TCP fallback fails; that is the one case where you need a TURN server, which is disabled by default. [LiveKit](livekit.md) explains when and how to enable it.

Presence and chat never depend on UDP: they travel over the WebSocket on 443.

## Domains, DNS and TLS

You need **two host names** pointing to the same public IP:

| Name | Example | Used for |
|---|---|---|
| `OFFICE_DOMAIN` | `office.example.com` | the app: pages, API, WebSocket |
| `LIVEKIT_DOMAIN` | `livekit.example.com` | LiveKit signaling (`wss://livekit.example.com`) |

Create two **A records** (and AAAA if you have IPv6) and wait until they resolve from the host itself (`dig +short office.example.com`). Caddy requests certificates from Let's Encrypt on first start; if DNS is not ready yet it retries, but the first minutes are smoother when DNS already works.

**HTTPS is mandatory.** Browsers only grant `getUserMedia` (microphone and camera) on `https://` origins or on `localhost`. Without TLS the microphone and camera buttons silently do nothing, and the session cookie (`OFFICE_COOKIE_SECURE=1`) is never stored.

**Cloudflare users:** keep both records **DNS only** (grey cloud). Behind the orange-cloud proxy, WebRTC media (UDP 7882 / TCP 7881) cannot reach your host and Let's Encrypt HTTP-01 validation fails. A Cloudflare Tunnel can front the app, but LiveKit media still needs a direct path or LiveKit Cloud; see [Reverse proxy and TLS](reverse-proxy.md).

## Browsers

Any current browser with WebRTC and WebSocket support:

- Chrome, Edge, Firefox and Safari, current and previous major versions.
- Mobile browsers (Safari on iOS, Chrome on Android) work for presence and chat. Audio and video depend on the device and on the browser's autoplay and background policies; treat mobile as "good enough to check who is around", not as the primary client.
- The office is drawn on an HTML canvas with pixel art, so it is light on the GPU. Old laptops run it fine.

Each person needs to allow microphone and camera access when the browser asks; a denied permission has to be reset in the browser's site settings.

## Optional services

| Service | Needed for | Without it |
|---|---|---|
| **SendGrid** (`SENDGRID_API_KEY` + `MAIL_FROM`) | invitation e-mails with the temporary password and "forgot password" links | the admin sees the temporary password on screen and passes it on; "forgot password" tells the user to ask an admin |
| **S3-compatible storage** (`S3_BUCKET`, `S3_ENDPOINT`, `AWS_*` for `scripts/backup.sh`) | off-site copies of database dumps | dumps stay on the host's disk |
| **Prometheus** (scrapes `GET /metrics`, protected by `METRICS_TOKEN`) | dashboards and alerts | the endpoint still exists; nobody reads it |
| **LiveKit Cloud** | audio/video without running the media server yourself | you run the bundled LiveKit container |
| **Managed MySQL** | not running the database yourself | you run the bundled `mysql:8.0` container |

## Pre-install checklist

- [ ] A Linux host (Ubuntu 22.04/24.04 or Debian 12) with a **public IPv4** and at least 1 vCPU / 2 GB RAM.
- [ ] `docker compose version` prints 2.23 or newer.
- [ ] Two DNS A records (`office.…` and `livekit.…`) resolve to the host. Cloudflare proxy **off**.
- [ ] Firewall (host and provider) allows 80/tcp, 443/tcp, 7881/tcp, 7882/udp inbound.
- [ ] You know the host's public IP (`curl -4 ifconfig.me`) to set `LIVEKIT_NODE_IP`.
- [ ] An e-mail address for Let's Encrypt expiry notices (`ACME_EMAIL`).
- [ ] Optional: a SendGrid API key and a verified sender address.
- [ ] Optional: an S3 bucket for off-site backups.
- [ ] You have read the hardening notes in [SECURITY.md](../SECURITY.md).

Next: [Quickstart](quickstart.md).
