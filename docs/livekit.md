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
| TURN | disabled by default; you add it if needed | included |
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

Normally a browser reaches the SFU directly over UDP 7882, or over TCP 7881 when UDP is blocked. Both fail only on networks that allow **nothing but 443** (strict corporate proxies, some hotel and airport Wi-Fi). For those users you need a TURN relay that listens on 443 (TLS) and relays media to the SFU.

LiveKit has a built-in TURN server, disabled in the bundled config:

```yaml
turn:
  enabled: false
```

To enable it:

1. Pick a **separate host name** for TURN, e.g. `turn.example.com`, pointing at the same host. TURN/TLS needs its own certificate; it cannot share Caddy's 443 for the office domain unless you use SNI routing.
2. Configure LiveKit (in the compose `livekit_config` block or `livekit.yaml`):

   ```yaml
   turn:
     enabled: true
     domain: turn.example.com
     tls_port: 5349      # or 443 if nothing else uses it on this host
     udp_port: 3478
     # external_tls: true   # when a proxy (Caddy/nginx with SNI) terminates TLS in front of LiveKit
   ```

   With `external_tls: false` (default), LiveKit needs the certificate and key files for `turn.example.com` itself (`cert_file`/`key_file` under `turn:`); mount them read-only into the container and renew them with your ACME tool. With `external_tls: true`, a TLS-terminating proxy (Caddy layer4/SNI, nginx `stream` with `ssl_preread`, HAProxy) forwards the `turn.example.com` SNI to LiveKit's `tls_port`.
3. Publish the ports on the host: `5349/tcp` (or `443/tcp` if dedicated) and `3478/udp`.
4. Restart LiveKit. Clients discover the TURN server automatically from the join response; nothing changes in Oficio.

Using **443/tcp for TURN** on the same host as Caddy requires SNI-based routing in front of both (Caddy's `layer4` module or nginx `stream`), because only one process can own the port. If that is more infrastructure than you want, LiveKit Cloud includes TURN on 443 out of the box. Note that an instance has a single `LIVEKIT_URL`, so you cannot keep the self-hosted SFU for most people and send only the affected team to Cloud; it is one or the other.

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
