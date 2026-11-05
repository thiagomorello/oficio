# LiveKit (audio, video and screen sharing)

Oficio does not relay media itself: browsers exchange audio and video through a [LiveKit](https://livekit.io) SFU, either the container bundled in `docker-compose.yml` or LiveKit Cloud. This page explains how the two options differ, how the API key pair ties the app to the server, which ports and NAT settings matter, the difference between `node_ip` and `use_external_ip`, single port versus port range, when you need TURN and how to enable it, how to test a deployment, and how LiveKit scales.

## How Oficio uses LiveKit

- The whole office is **one room** (`LIVEKIT_ROOM`, default `oficio`). Privacy comes from subscriptions: the Oficio server computes who can hear whom from positions and meeting rooms and the browser subscribes only to those people (and tells the SFU who may subscribe to it). See [Architecture → LiveKit token flow](architecture.md#livekit-token-flow-and-proximity).
- The server **mints the access tokens** (12 h, identity `u<userId>`) with `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`. Browsers receive the token in the WebSocket `welcome` message or from `GET /api/livekit/token`.
- The browser connects to **`LIVEKIT_URL`** (`wss://…`) for signaling, then negotiates WebRTC media directly with the SFU over UDP (or TCP as fallback).
- The server talks to the LiveKit **room-service API** at `LIVEKIT_INTERNAL_URL` (HTTP) to adjust participant permissions.

Without the three LiveKit variables the office still works: presence, movement, rooms, desks and chat are independent of LiveKit. `/api/health` reports `"livekit": false` and the A/V buttons are disabled.

## Self-hosted (compose) vs LiveKit Cloud

| | Self-hosted (`docker-compose.yml`) | LiveKit Cloud |
|---|---|---|
| Runs where | a `livekit/livekit-server` container next to the app | LiveKit's infrastructure |
| Ports to open | 7881/tcp, 7882/udp (plus 443 via Caddy for signaling) | none |
| DNS | a second name, `livekit.example.com` | none |
| `LIVEKIT_URL` | `wss://livekit.example.com` | `wss://<project>.livekit.cloud` |
| `LIVEKIT_INTERNAL_URL` | `http://livekit:7880` | same as `LIVEKIT_URL` |
| Keys | you generate them (`gen-secrets.sh`) | the project's API key and secret from the Cloud dashboard |
| TURN | opt-in overlay `docker-compose.turn.yml` (TLS on 5349, UDP on 3478, Caddy's certificate) | included, on 443 |
| Cost | your VPS bandwidth | per-minute pricing with a free tier |
| Good for | teams up to ~150 on one well-sized host, data sovereignty | no ops, global presence, teams spread over continents |

### Switching to LiveKit Cloud

1. Create a project in LiveKit Cloud and copy its WebSocket URL, API key and secret.
2. In `.env`:

   ```ini
   LIVEKIT_URL=wss://your-project.livekit.cloud
   LIVEKIT_INTERNAL_URL=wss://your-project.livekit.cloud
   LIVEKIT_API_KEY=<project key>
   LIVEKIT_API_SECRET=<project secret>
   ```

3. Remove the `livekit` service from your compose file (or scale it to zero), the `{$LIVEKIT_DOMAIN}` block from the Caddy config, and close 7881/7882 on the firewall.
4. `docker compose up -d`. Platform guides that have no UDP at all (Railway, Render, Fly, DigitalOcean App Platform) always use this path; see `deploy/livekit-cloud.md`.

## Keys: how the pair works

LiveKit authenticates every token with an **API key → secret** map. The same pair must be known to both sides:

- In the LiveKit container it arrives through `LIVEKIT_KEYS: "<key>: <secret>"` (compose) or a `keys:` block in `livekit.yaml`.
- In the app it arrives through `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`, which `docker-compose.yml` passes to both services from the same `.env` lines, so they cannot drift.

`scripts/gen-secrets.sh` creates them as `API` + 12 hex characters and a 48-hex-character secret (LiveKit requires at least 32 characters). If you ever see `401` or "invalid token" in the browser console while `/api/livekit/token` returns `200`, the pairs differ: compare `docker compose exec app env | grep LIVEKIT_API` with `docker compose exec livekit env | grep LIVEKIT_KEYS`.

## Ports and NAT

The compose file publishes two media ports on the host and keeps signaling behind Caddy:

| Port | Role |
|---|---|
| 7880/tcp (internal) | signaling + health. Caddy terminates TLS for `https://livekit.example.com` and proxies here. `curl https://livekit.example.com/` answers `OK`. |
| 7881/tcp (public) | ICE over TCP. Fallback when UDP is blocked; works, with more latency. |
| 7882/udp (public) | all media. One port for every participant (LiveKit multiplexes). |

Media ports are published **directly on the host**, not through the proxy: WebRTC needs the browser to reach the SFU on the IP:port announced in ICE candidates. This is why the announced IP matters so much.

### `use_external_ip` vs `node_ip`

The bundled config says:

```yaml
rtc:
  use_external_ip: true
  node_ip: ${LIVEKIT_NODE_IP:-}
```

- **`use_external_ip: true`** makes LiveKit discover its public IP through STUN at start and advertise that. It works for the common VPS case (public IP on the interface, or a cloud 1:1 NAT) without configuration.
- **`node_ip`** pins the announced address. Set `LIVEKIT_NODE_IP=203.0.113.10` in `.env` whenever you know the public IP. It is **required** on Docker Swarm / overlay networks (the Swarm stack sets `use_external_ip: false` and restricts UDP to the `docker_gwbridge` range), on hosts with several public addresses, and whenever the symptom is "signaling works, chat works, but no audio".

If the host is behind a NAT you do not control (home server, some office networks), forward 7881/tcp and 7882/udp to it and set `node_ip` to the NAT's public address.

### Single UDP port vs range

The compose config uses `udp_port: 7882`: one UDP port for everybody, the simplest firewall rule. The alternative in [`deploy/livekit/livekit.yaml`](../deploy/livekit/livekit.yaml) is a range:

```yaml
rtc:
  tcp_port: 7881
  # udp_port: 7882
  port_range_start: 50000
  port_range_end: 60000
```

A range gives each participant its own ports, which some very old NATs handle better and which spreads load across sockets. It requires publishing the whole range in Docker (`"50000-60000:50000-60000/udp"`), which Docker handles slowly at container start for thousands of ports. Stay with the single port unless you have a concrete reason.

### Running LiveKit on its own host

For 100+ people, or to keep media off the app host, run LiveKit elsewhere:

1. Install `livekit-server` (binary or container) with [`deploy/livekit/livekit.yaml`](../deploy/livekit/livekit.yaml), set `keys:` (or `LIVEKIT_KEYS`), `node_ip` to that host's public IP, and open 7881/tcp + 7882/udp there.
2. Put TLS in front of 7880 on that host (Caddy: `livekit.example.com { reverse_proxy 127.0.0.1:7880 }`), or terminate TLS on the app host and proxy to the LiveKit host over a private network.
3. In the app's `.env`: `LIVEKIT_URL=wss://livekit.example.com`, `LIVEKIT_INTERNAL_URL=http://<private-ip>:7880` (or the public `https://` URL), and the same key/secret.
4. Remove the `livekit` service from the app's compose file.

## TURN: when and how

Normally a browser reaches the SFU directly over UDP 7882, or over TCP 7881 when UDP is blocked. Both fail on networks that block UDP **and** every non-standard port (strict corporate proxies, some hotel and airport Wi-Fi). For those users you need a TURN relay: the browser opens a TLS connection to the TURN server, which hands the media to the SFU. Browsers only use the relay when the direct paths fail, so enabling it changes nothing for everybody else.

LiveKit has a built-in TURN server, disabled in the bundled config. The compose stack ships an opt-in overlay, [`docker-compose.turn.yml`](../docker-compose.turn.yml), that turns it on using the certificate Caddy already issues for `LIVEKIT_DOMAIN`: no extra host name, certificate or ACME client.

### Enabling TURN with the overlay (recommended)

1. Open two more ports on the host firewall and on the provider's firewall: `5349/tcp` (TURN over TLS) and `3478/udp` (TURN over UDP), in addition to 80, 443, 7881/tcp and 7882/udp.

   ```sh
   sudo ufw allow 5349/tcp
   sudo ufw allow 3478/udp
   ```

2. Start the stack with the overlay. From now on pass both `-f` flags to every `docker compose` command, or put `COMPOSE_FILE=docker-compose.yml:docker-compose.turn.yml` in `.env` so plain `docker compose` picks both up:

   ```sh
   docker compose -f docker-compose.yml -f docker-compose.turn.yml up -d
   docker compose -f docker-compose.yml -f docker-compose.turn.yml logs -f livekit
   ```

   Expect `[turn-cert-wait] certificate found, starting livekit-server with TURN`, then LiveKit's own `Starting TURN server` line with `"turn.portTLS": 5349, "turn.portUDP": 3478`. On a brand-new install the wait lines appear first: the certificate only exists after Caddy has obtained it (DNS pointing at the host, port 80 reachable), and the wrapper polls for it for up to `TURN_CERT_WAIT_SECONDS` (default 600) before exiting and letting Docker restart the wait. The container shows as *starting* in `docker compose ps` meanwhile.

3. Choose how certificate renewals reach LiveKit (next section).

What the overlay does, so you can audit it:

- Mounts the `caddy-data` volume read-only into the `livekit` container at `/caddy`. Caddy stores certificates under `/data/caddy/certificates/<issuer>/<domain>/<domain>.crt` and `.key`; the base Caddyfile pins the issuer to Let's Encrypt (`acme_ca`) so the directory name is predictable (`acme-v02.api.letsencrypt.org-directory`). If you change the issuer in the Caddyfile, change the paths in the overlay too.
- Replaces the LiveKit config with a copy of the base one plus a `turn:` block: `domain: ${LIVEKIT_DOMAIN}`, `tls_port: 5349`, `udp_port: 3478`, `external_tls: false`, `cert_file`/`key_file` pointing at Caddy's files. The two configs are kept in sync by hand; both files say so in a comment.
- Publishes `${TURN_TLS_PORT:-5349}/tcp` and `${TURN_UDP_PORT:-3478}/udp`. The same number is used on the host and in the container because LiveKit announces the port to browsers; change both through the `.env` variables, not in the compose file.
- Wraps the image entrypoint in a small `sh` loop that waits for the certificate and key before `exec`ing `/livekit-server`.

Clients discover the TURN server from the join response; nothing changes in Oficio. The relay port range LiveKit logs (`turn.relay_range_start` 30000–40000) is internal between the TURN server and the SFU in the same process and does not need to be published or opened.

### Certificate renewal

Let's Encrypt certificates are valid for 90 days and Caddy renews them in place, inside the `caddy-data` volume, about 30 days before expiry. LiveKit reads the files only at startup, so it must be restarted after a renewal; otherwise, roughly three months after the first start, TURN/TLS would present an expired certificate (direct UDP/TCP media is unaffected). Two ways to automate the restart; pick one:

| | Host cron: [`scripts/turn-restart-on-renew.sh`](../scripts/turn-restart-on-renew.sh) | Sidecar: `--profile turn-reloader` |
|---|---|---|
| How | cron runs the script every 6 h; it reads the certificate's modification time inside the `caddy` container, compares it with the value saved in `./.turn-cert.mtime` and runs `docker compose restart livekit` when it changed | a `docker:cli` container (`turn-cert-reloader`) does the same loop with the certificate volume and the Docker socket mounted read-only, restarting the `livekit` container of the same compose project |
| Privileges | nothing beyond the docker CLI you already use on the host | access to the Docker socket, which is equivalent to root on the host. The container runs read-only, without network and with every capability dropped, but a compromise of the image or the script would control Docker |
| Setup | one crontab line | one extra flag on `up`; nothing on the host |

Cron:

```sh
# every 6 hours, from the directory with docker-compose.yml and .env
0 */6 * * * cd /opt/oficio && ./scripts/turn-restart-on-renew.sh >> turn-renew.log 2>&1
```

Sidecar:

```sh
docker compose -f docker-compose.yml -f docker-compose.turn.yml --profile turn-reloader up -d
docker compose -f docker-compose.yml -f docker-compose.turn.yml --profile turn-reloader logs turn-cert-reloader
```

Take the sidecar if you prefer not to touch the host's crontab and accept the socket access; take cron otherwise. Either way the restart interrupts audio and video for a few seconds once every ~60 days; browsers reconnect on their own. `TURN_RELOADER_INTERVAL` (seconds, default 21600) changes the sidecar's cadence.

### Testing TURN

1. The TLS port presents Caddy's certificate: `openssl s_client -connect livekit.example.com:5349 -servername livekit.example.com </dev/null 2>/dev/null | openssl x509 -noout -issuer -dates` prints a Let's Encrypt issuer and the current validity.
2. LiveKit's connection tester at <https://livekit.io/connection-test> (token as in [Testing a deployment](#testing-a-deployment)) has a dedicated **TURN** step that connects with ICE restricted to relay candidates. Without the overlay it fails; with it, it must pass from any network.
3. From a browser in the office, `chrome://webrtc-internals` shows the selected candidate pair: `relay` means media goes through TURN, `udp`/`tcp` the direct paths. `docker compose logs livekit` shows the allocations.

### Limitations

- **TURN/TLS listens on 5349, not 443.** Caddy owns 443 on the host's IP for the app and the signaling. Networks that permit *only* 443 still cannot reach the relay. Serving TURN on 443 needs a second public IP on the host or a separate TURN host (with its own host name and certificate), or LiveKit Cloud, which includes TURN on 443. Networks that block UDP and allow a handful of TCP ports (the common case) are covered by 5349.
- An instance has a single `LIVEKIT_URL`: you cannot keep the self-hosted SFU for most people and send only the affected team to Cloud; it is one or the other.
- The overlay is for `docker-compose.yml`; the Portainer stacks keep TURN disabled and need the manual configuration below.

### Manual configuration (LiveKit elsewhere)

When LiveKit runs on its own host, or you want a different layout, configure the `turn:` block yourself (see [`deploy/livekit/livekit.yaml`](../deploy/livekit/livekit.yaml)):

```yaml
turn:
  enabled: true
  domain: livekit.example.com   # the name browsers connect to; must match the certificate
  tls_port: 5349                # or 443 if nothing else uses it on that host
  udp_port: 3478
  external_tls: false           # LiveKit terminates TLS with the files below
  cert_file: /certs/fullchain.pem
  key_file: /certs/privkey.pem
```

Mount the certificate and key read-only, publish `tls_port/tcp` and `udp_port/udp`, and restart LiveKit after every renewal. With `external_tls: true` a TLS-terminating proxy (Caddy `layer4`/SNI, nginx `stream` with `ssl_preread`, HAProxy) forwards the TURN host name's SNI to LiveKit's `tls_port`; that is also how 443 can be shared with a web server on the same IP, at the price of running that proxy.

## Testing a deployment

1. **Signaling is reachable with TLS:**

   ```sh
   curl -i https://livekit.example.com/
   ```

   Expect `HTTP/2 200` and the body `OK`. A certificate error means Caddy has not obtained the cert; a `502` means Caddy cannot reach the container.

2. **Oficio can mint tokens:** sign in and open `https://office.example.com/api/livekit/token` in the same browser. Expect `{"url":"wss://livekit.example.com","token":"eyJ…","room":"oficio"}`. A `503` means the three `LIVEKIT_*` variables are not all set in the app.

3. **A browser can actually join and send media:** generate a test token and paste it, together with the `wss://` URL, into LiveKit's connection tester at <https://livekit.io/connection-test>. It reports signaling, ICE (UDP/TCP) and publish/subscribe results, and tells you precisely whether UDP is blocked.

   Token with Node and the SDK already installed in the app image:

   ```sh
   docker compose exec app node --input-type=module -e '
   import { AccessToken } from "livekit-server-sdk";
   const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, { identity: "connection-test", ttl: "1h" });
   at.addGrant({ roomJoin: true, room: process.env.LIVEKIT_ROOM ?? "oficio" });
   console.log(await at.toJwt());'
   ```

   Or with the LiveKit CLI (`lk`):

   ```sh
   lk token create --api-key "$LIVEKIT_API_KEY" --api-secret "$LIVEKIT_API_SECRET" \
     --join --room oficio --identity connection-test --valid-for 1h
   ```

4. **End-to-end:** two people in two browsers (or one browser and one incognito window with a second account) walk up to each other in the lobby. Check `chrome://webrtc-internals` for the selected candidate pair: `udp` means the normal path, `tcp` means UDP is blocked for that client.

5. **Logs:** `docker compose logs -f livekit`. Participants appear with their Oficio identity (`u12`); repeated ICE failure lines point at the announced IP or the firewall.

## Scaling notes

- A single LiveKit node handles an office of ~150 people comfortably on 4 vCPU, because proximity keeps each client at 8–10 subscriptions. CPU grows with the number of forwarded streams, not with room size; LiveKit does no transcoding.
- Bandwidth: per subscribed stream, 300 kbps–1.5 Mbps video and ~40 kbps audio; server egress is the sum of all subscriptions.
- Set `LIVEKIT_NODE_IP`, give the container headroom (`memory: 2g` in compose), and consider a dedicated host before adding more CPU to the app host.
- Multi-node LiveKit (several SFUs sharing rooms through Redis) is possible but outside the scope of the compose stack; at that size LiveKit Cloud is usually the cheaper path.
- Upgrading LiveKit: the compose file pins `livekit/livekit-server:v1.13.11`. Bump the tag deliberately and read LiveKit's release notes; the client SDK in the app (`livekit-client` 2.x) is compatible across the 1.x server line. See [Upgrading](upgrading.md).

## Related

- [Requirements → Network and ports](requirements.md#network-and-ports)
- [Reverse proxy and TLS](reverse-proxy.md) for Traefik/nginx in front of signaling
- [Troubleshooting](troubleshooting.md) for "no audio", `401` and ICE failures
