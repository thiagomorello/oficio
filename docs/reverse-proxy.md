# Reverse proxy and TLS

The app speaks plain HTTP (and WebSocket on `/ws`) on port 4747, and LiveKit speaks plain HTTP/WebSocket on 7880. Something in front must terminate TLS for `office.example.com` and `livekit.example.com`, forward the `Upgrade` and `X-Forwarded-*` headers, and leave long-lived connections alone. `docker-compose.yml` ships Caddy for that, but Traefik, nginx, Nginx Proxy Manager and Cloudflare Tunnel all work. This page shows each, lists the headers Oficio needs, and explains `TRUST_PROXY`.

## What any proxy must do

| Requirement | Why |
|---|---|
| **TLS** on both host names | browsers only allow microphone/camera on HTTPS; the session cookie is `Secure` |
| **WebSocket upgrade** passthrough (`Upgrade`, `Connection` headers, HTTP/1.1 to the backend) | `/ws` carries presence; `wss://livekit…` carries LiveKit signaling |
| Preserve the **`Host`** header | the app's host guard compares it with `OFFICE_ALLOWED_HOSTS` and answers `403` otherwise |
| Send **`X-Forwarded-For`** (and `X-Forwarded-Proto`) | with `TRUST_PROXY=1` the app uses the first address for login rate limiting and session logs |
| **Long idle timeouts** (an hour or more) on the WebSocket location | the app pings every 20 s, but some proxies default to 60 s read timeouts and cut quiet sockets |
| Do **not** buffer or compress the WebSocket | standard; HTTP compression for pages is fine |
| Leave **7881/tcp and 7882/udp** alone | LiveKit media bypasses the proxy entirely and is published on the host |

Security headers (`Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`) are nice to add at the edge; the app also sets the important ones on its own responses.

### `TRUST_PROXY`

- `TRUST_PROXY=1` when **every** request reaches the app through your proxy (compose default). The app then reads the client IP from the first entry of `X-Forwarded-For`.
- `TRUST_PROXY=0` when browsers connect to port 4747 directly (development). With `1` in that situation, any client could forge `X-Forwarded-For` and dodge the login rate limiter.
- Port 4747 must not be reachable from outside when `TRUST_PROXY=1`; in the compose stack it is only on the Docker networks.

## Caddy (default)

The compose file embeds this Caddyfile (`configs.caddyfile`), parameterised by `OFFICE_DOMAIN`, `LIVEKIT_DOMAIN` and `ACME_EMAIL`:

```caddyfile
{
  email {$ACME_EMAIL}
}
{$OFFICE_DOMAIN} {
  encode zstd gzip
  header {
    Strict-Transport-Security "max-age=31536000"
    X-Content-Type-Options "nosniff"
    X-Frame-Options "DENY"
    Referrer-Policy "strict-origin-when-cross-origin"
  }
  reverse_proxy app:4747
}
{$LIVEKIT_DOMAIN} {
  reverse_proxy livekit:7880
}
```

Caddy obtains and renews Let's Encrypt certificates automatically (HTTP-01 on port 80, TLS-ALPN on 443), proxies WebSockets without extra directives, sets `X-Forwarded-For`/`X-Forwarded-Proto` by default, and keeps HTTP/1.1 upgrades open indefinitely. Certificates live in the `caddy-data` volume (`oficio_caddy-data`); keep it in your backups to avoid re-issuing on a rebuild (Let's Encrypt rate limits).

For a standalone install (app on the host, not in compose) use [`deploy/caddy/Caddyfile`](../deploy/caddy/Caddyfile), which is the same file pointing at `127.0.0.1:4747` and `127.0.0.1:7880`:

```sh
export OFFICE_DOMAIN=office.example.com LIVEKIT_DOMAIN=livekit.example.com ACME_EMAIL=admin@example.com
caddy run --config /etc/caddy/Caddyfile
```

## Traefik

If Traefik already owns ports 80/443 on the host (typical with Portainer), remove the `caddy` service and attach `app` and `livekit` to Traefik's network with labels. This is exactly what [`deploy/portainer/stack-swarm.yml`](../deploy/portainer/stack-swarm.yml) does; the labels, in compose (non-Swarm) form:

```yaml
services:
  app:
    # ...
    networks: [traefik_public, internal]
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=traefik_public"
      - "traefik.http.routers.oficio.rule=Host(`office.example.com`)"
      - "traefik.http.routers.oficio.entrypoints=websecure"
      - "traefik.http.routers.oficio.tls.certresolver=letsencryptresolver"
      - "traefik.http.routers.oficio.middlewares=oficio-headers"
      - "traefik.http.services.oficio.loadbalancer.server.port=4747"
      - "traefik.http.services.oficio.loadbalancer.passHostHeader=true"
      - "traefik.http.middlewares.oficio-headers.headers.stsSeconds=31536000"
      - "traefik.http.middlewares.oficio-headers.headers.frameDeny=true"
      - "traefik.http.middlewares.oficio-headers.headers.contentTypeNosniff=true"
      - "traefik.http.middlewares.oficio-headers.headers.referrerPolicy=strict-origin-when-cross-origin"

  livekit:
    # ...
    networks: [traefik_public, internal]
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=traefik_public"
      - "traefik.http.routers.oficio-livekit.rule=Host(`livekit.example.com`)"
      - "traefik.http.routers.oficio-livekit.entrypoints=websecure"
      - "traefik.http.routers.oficio-livekit.tls.certresolver=letsencryptresolver"
      - "traefik.http.services.oficio-livekit.loadbalancer.server.port=7880"
      - "traefik.http.services.oficio-livekit.loadbalancer.passHostHeader=true"

networks:
  traefik_public:
    external: true
  internal:
```

Adjust `websecure`, `letsencryptresolver` and `traefik_public` to the names in your Traefik installation (in Swarm the labels go under `deploy.labels`, as in the stack file). Traefik v2/v3 forwards WebSockets and `X-Forwarded-*` automatically and has no idle timeout on upgraded connections. Keep an HTTP→HTTPS redirect on the `web` entrypoint if you have one. LiveKit media ports are still published directly by the `livekit` service (`mode: host` in Swarm).

## nginx

[`deploy/nginx/oficio.conf`](../deploy/nginx/oficio.conf) is a complete configuration for a host-installed nginx with certbot certificates. The essential parts:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

upstream oficio_app     { server 127.0.0.1:4747; }
upstream oficio_livekit { server 127.0.0.1:7880; }

server {
    listen 443 ssl http2;
    server_name office.example.com;
    ssl_certificate     /etc/letsencrypt/live/office.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/office.example.com/privkey.pem;

    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    client_max_body_size 2m;

    location / {
        proxy_pass http://oficio_app;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}

server {
    listen 443 ssl http2;
    server_name livekit.example.com;
    # ssl_certificate ... for livekit.example.com
    location / {
        proxy_pass http://oficio_livekit;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

Plus a port-80 server that redirects to HTTPS. Certificates: `certbot --nginx -d office.example.com -d livekit.example.com`. The `client_max_body_size 2m` is enough for the map editor's largest documents (the server itself caps map uploads at 4 MiB; raise both if you see `413` while saving a huge map). If nginx runs in a container, replace `127.0.0.1` with the service names and share a network with `app` and `livekit`.

## Nginx Proxy Manager

With NPM already serving 80/443, remove the `caddy` service from the stack, make sure NPM's container and `app`/`livekit` share a Docker network, and add two proxy hosts in the UI:

1. **Hosts → Proxy Hosts → Add Proxy Host.**
2. *Details* tab: Domain Names `office.example.com`; Scheme `http`; Forward Hostname / IP `app` (the compose service name, or the host IP when the app is not in Docker); Forward Port `4747`; enable **Websockets Support** (this is the toggle that sets the `Upgrade` headers); **Block Common Exploits** can stay on.
3. *SSL* tab: Request a new SSL certificate (Let's Encrypt), **Force SSL**, **HTTP/2 Support**, **HSTS Enabled**.
4. *Advanced* tab (optional): raise idle timeouts for the WebSocket:

   ```nginx
   proxy_read_timeout 3600s;
   proxy_send_timeout 3600s;
   ```

5. Repeat for `livekit.example.com` → `livekit` port `7880`, again with **Websockets Support** and a certificate.

NPM sends `X-Forwarded-For` and `X-Forwarded-Proto` by default, so `TRUST_PROXY=1` is correct.

## Cloudflare Tunnel

A tunnel (`cloudflared`) lets the **app** be reached through Cloudflare without opening 80/443 on the host, and it carries WebSockets, so presence and chat work. LiveKit **signaling** can go through the tunnel too (it is just HTTPS/WebSocket), but **media cannot**: WebRTC needs UDP 7882 or TCP 7881 straight to the LiveKit host. Your options:

- Tunnel for `office.example.com`, and `livekit.example.com` as a **DNS-only** record pointing at the host with 443 (Caddy/nginx), 7881 and 7882 open; or
- Tunnel for the app and **LiveKit Cloud** for media, so the host exposes nothing at all.

Tunnel settings: public hostname `office.example.com` → service `http://app:4747` (or `http://localhost:4747`), no special flags needed for WebSockets. Cloudflare adds `X-Forwarded-For` and `CF-Connecting-IP`; keep `TRUST_PROXY=1`. Set `OFFICE_PUBLIC_URL=https://office.example.com` and `OFFICE_ALLOWED_HOSTS=office.example.com` as usual, and `OFFICE_COOKIE_SECURE=1` (the browser sees HTTPS). Cloudflare may close WebSockets it considers idle; Oficio's 20-second heartbeat keeps the socket active, so this is not a problem in practice.

Do not put the orange-cloud proxy in front of `livekit.example.com`: Let's Encrypt HTTP-01 on the origin fails and media would be unreachable.

## Checking a proxy

```sh
# TLS and headers
curl -sI https://office.example.com/api/health | head -20

# WebSocket upgrade (101 expected)
curl -sI -N -H "Connection: Upgrade" -H "Upgrade: websocket" \
     -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
     -H "Origin: https://office.example.com" https://office.example.com/ws
```

Without a session cookie the second request is refused by the app (it checks the cookie before upgrading), but seeing the app's refusal rather than a proxy error proves the upgrade headers passed through. A proxy that strips `Origin` or `Upgrade` produces an immediate close in the browser; see [Troubleshooting](troubleshooting.md#403-host-not-allowed-or-the-websocket-closes-immediately).
