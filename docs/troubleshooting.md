# Troubleshooting

Symptoms you may meet while installing or running Oficio, each with its usual cause and the fix. Start with the three tools at the top (logs, the health endpoint and the browser console); most problems are visible in one of them within a minute. If you get stuck, the end of the page tells you what to include when asking for help.

## First three things to check

**1. Logs.**

```sh
docker compose logs -f --tail=100 app livekit caddy
```

The app logs configuration warnings at boot (missing secrets, invalid colour, LiveKit not configured), every migration it applies, and one warning line per failed request handler. Caddy logs certificate issuance and proxy errors. LiveKit logs joins and ICE problems.

**2. Health.**

```sh
curl -s https://office.example.com/api/health
# {"ok":true,"db":"ok","version":"0.1.0","uptime":1234,"online":7,"livekit":true}
```

| Field | Meaning |
|---|---|
| `ok` | `false` (HTTP 503) when the database check failed |
| `db` | `ok`, `error` (cannot run `SELECT 1` within 2 s), or `fake` (dev mode without a database) |
| `version` | app version; include it in bug reports |
| `uptime` | seconds since the process started; a small number means it just restarted |
| `online` | people connected right now |
| `livekit` | whether `LIVEKIT_API_KEY` is configured (not whether the SFU is reachable) |

**3. Browser console** (F12 → Console and Network). Failed `fetch` calls show the HTTP status and the JSON error; the WebSocket appears under Network → WS; LiveKit problems log with a `livekit` prefix.

## Symptoms

### Microphone or camera button does nothing

**Cause:** the page is not served over HTTPS. Browsers only allow `getUserMedia` on `https://` origins or on `localhost`; on plain HTTP the API is simply absent and the buttons stay inert. A second cause is a permission denied earlier.

**Fix:** open the office through `https://office.example.com` (never through the raw IP or `http://`). Check the padlock in the address bar. If the permission was denied, click the padlock → Site settings → allow Microphone and Camera, then reload. For development, use `http://localhost:4747`, which browsers treat as secure.

### People cannot hear or see each other, but chat works

**Cause:** signaling (`wss://livekit…`) works but media (UDP 7882, fallback TCP 7881) does not reach the LiveKit host, or LiveKit announces the wrong IP. Typical: firewall rule missing on the provider's panel, `LIVEKIT_NODE_IP` empty on a host where STUN discovery picks a private address (Swarm/overlay, hosts with several interfaces), or Cloudflare proxy (orange cloud) in front of the LiveKit name.

**Fix:**

1. Open 7881/tcp and 7882/udp on **both** the host firewall and the cloud firewall; `sudo ss -lunp | grep 7882` confirms LiveKit listens.
2. Set `LIVEKIT_NODE_IP=<public IP>` in `.env` and `docker compose up -d livekit`.
3. Make sure `livekit.example.com` is DNS-only in Cloudflare.
4. Test with <https://livekit.io/connection-test> using a token generated as in [LiveKit → Testing](livekit.md#testing-a-deployment). It tells you whether UDP, TCP or neither works. If only TCP works, audio works with higher latency and your UDP rule is wrong; if neither, the announced IP is wrong or ports are closed.
5. In `chrome://webrtc-internals`, look at the selected ICE candidate pair for the LiveKit connection.
6. If everything above is right and only people on one locked-down network (corporate proxy, hotel Wi-Fi) are affected, their network blocks UDP and non-standard ports. Enable TURN over TLS with the `docker-compose.turn.yml` overlay and open 5349/tcp + 3478/udp; see [LiveKit → TURN](livekit.md#turn-when-and-how). The tester's **TURN** step must then pass from that network.

### Login returns `503`

**Cause:** `OFFICE_JWT_SECRET` is not set. The app logs `OFFICE_JWT_SECRET not set: login will respond 503` at boot and every `/api/*` request answers `503 authentication not configured`.

**Fix:** run `./scripts/gen-secrets.sh` (fills the empty secrets in `.env`) or set `OFFICE_JWT_SECRET=$(openssl rand -hex 32)`, then `docker compose up -d app`. In Portainer or a PaaS, add the variable in the environment settings. Note the compose file refuses to start at all when the variable is empty (`:?run ./scripts/gen-secrets.sh`), so this mostly happens with custom stacks.

### `403 Host not allowed`, or the WebSocket closes immediately

**Cause:** the host name in the browser's address bar is not in `OFFICE_ALLOWED_HOSTS`. The guard accepts `localhost`, `*.localhost`, literal IPs and the listed names; everything else is rejected with `403 Host not allowed: <host>`, and WebSocket upgrades whose `Origin` is not allowed are closed before the handshake. A proxy that rewrites `Host` to the backend address or strips `Origin` triggers the same.

**Fix:** set `OFFICE_ALLOWED_HOSTS=office.example.com` (comma-separate several names; ports are ignored) and restart the app. In your proxy, pass the original `Host` (`proxy_set_header Host $host` in nginx, `passHostHeader=true` in Traefik; Caddy does it by default) and do not strip `Origin`/`Upgrade`. See [Reverse proxy](reverse-proxy.md).

### Redirected to the login page in a loop / cookie not kept

**Cause:** the browser is discarding the session cookie. Almost always `OFFICE_COOKIE_SECURE=1` (the default) while the page is reached over plain HTTP: the `Secure` flag makes the browser drop the cookie, so the login `POST` succeeds (`200` in the Network tab) but the next request carries no cookie and the page gate sends you back to `/login`. A proxy that switches host names between the login and the next page has the same effect. While you are there, also check `TRUST_PROXY`: with `0` behind a proxy, every user shares the proxy's IP for rate limiting and a few wrong passwords lock everybody out with `429 Too many attempts`.

**Fix:** serve the site over HTTPS and open it by its canonical name (`https://office.example.com`). For local tests over HTTP set `OFFICE_COOKIE_SECURE=0`. Behind Caddy, Traefik, nginx or a tunnel, set `TRUST_PROXY=1`.

### LiveKit `401` / "invalid token" / `could not establish signal connection`

**Cause:** the API key/secret the app signs tokens with differs from the pair the LiveKit server knows (`LIVEKIT_KEYS`), or `LIVEKIT_URL` points at another LiveKit. With LiveKit Cloud: wrong project credentials.

**Fix:** compare the values:

```sh
docker compose exec app env | grep -E 'LIVEKIT_(URL|API_KEY)'
docker compose exec livekit env | grep LIVEKIT_KEYS
```

The key in both must match and the secret must be the same string. Edit `.env`, then `docker compose up -d` (both containers are recreated because their environment changed). Tokens are valid 12 hours; after the fix, reload the office.

### LiveKit says `token is not valid yet` (audio stuck on "Reconnecting")

**Cause:** the clock of the machine (or VM) running LiveKit is behind the clock of the machine running the app. The app mints tokens that become valid "now"; a LiveKit server whose clock is even one minute behind rejects them with `invalid authorization token: token has invalid claims: token is not valid yet` in its log, and the app logs `LiveKit: failed to update permissions`.

**Fix:** sync the clocks. On a VPS, enable NTP (`timedatectl set-ntp true`). On Docker Desktop (Windows/macOS) the VM clock drifts after the computer sleeps: restart Docker Desktop (or `wsl --shutdown` on Windows) and start the containers again. Compare with `date -u` on the host and `docker run --rm alpine date -u`.

### `/api/health` shows `db: error`

**Cause:** the app cannot run `SELECT 1` within two seconds. On first boot MySQL needs ~30 s to initialise (the app waits for the health check in compose, but not in custom stacks). Otherwise: wrong `DATABASE_URL` or `MYSQL_*` values, special characters in the password not URL-encoded, the database host not reachable from the app's network, or a managed database that enforces TLS while the URL has no `?ssl=true` (see [Database → TLS](database.md#tls)).

**Fix:** `docker compose logs mysql` for the database side, `docker compose logs app` for the connection error (`ECONNREFUSED`, `ER_ACCESS_DENIED_ERROR`, `ETIMEDOUT`). Check the URL character by character; test from the app container:

```sh
docker compose exec app node -e 'const u=new URL(process.env.DATABASE_URL);console.log(u.hostname,u.port,u.username,u.pathname)'
docker compose exec mysql mysql -u oficio -p oficio -e 'SELECT 1'
```

The password used by the app must match the one MySQL was initialised with; if you changed `MYSQL_PASSWORD` after the first boot, change it inside MySQL too (`ALTER USER`) or recreate the volume (which deletes all data).

### Caddy cannot get a certificate

**Cause:** Let's Encrypt could not reach `http://office.example.com/.well-known/acme-challenge/…`. DNS not propagated or pointing elsewhere, port 80 blocked, Cloudflare proxy (orange cloud) on, or another process already bound to 80/443 on the host. Caddy logs `could not get certificate from issuer` and retries with backoff.

**Fix:** `dig +short office.example.com` must return the host's public IP from the host itself and from outside; `sudo ss -ltnp | grep -E ':80|:443'` must show only Caddy; switch Cloudflare records to DNS-only; open 80 and 443 in the provider firewall. Then `docker compose restart caddy`. After several failed attempts you may hit Let's Encrypt rate limits; wait an hour before retrying rather than restarting in a loop.

### E-mails are not sent

**Cause:** `SENDGRID_API_KEY` missing (the admin UI then shows temporary passwords instead; that is the designed fallback), or set without `MAIL_FROM` (boot warning: `SENDGRID_API_KEY definido sem MAIL_FROM`), or SendGrid refusing the request: `SendGrid responded 401` (bad key), `403` (sender not verified), `400` (malformed address).

**Fix:** set both variables, verify the sender address or domain in SendGrid, restart the app and watch `docker compose logs -f app` while inviting a test user. The mailer never throws: a failed send falls back to showing the password on screen, so nothing is lost.

### `503 Client not built` when running from source

**Cause:** `node dist/server/index.js` found no `dist/client/index.html`. The production server serves the Vite build; it does not compile the client.

**Fix:** `npm run build` (runs `vite build` and the server bundle), then start again. For development use `npm run dev`, which serves the client through Vite with hot reload.

### Port 4747 already in use

**Cause:** another process (or a previous instance) listens on the port. The app logs `Port 4747 is already in use (set OFFICE_PORT to use another one)` and exits.

**Fix:** find it with `sudo ss -ltnp | grep 4747` and stop it, or set `OFFICE_PORT=4748` (and update your proxy). In compose the port is internal, so a conflict only occurs with host-mode networking or a second stack.

### `429 Too many attempts` on login

**Cause:** ten failed attempts for the same IP and e-mail within ten minutes. Behind a proxy with `TRUST_PROXY=0`, every user shares the proxy's IP and the limit becomes global.

**Fix:** wait the number of seconds in `Retry-After`, and set `TRUST_PROXY=1` when behind a proxy.

### `409` when saving in the map editor

**Cause:** another administrator saved the shared draft since you loaded it (optimistic concurrency on `updated_at`).

**Fix:** reload the draft in the editor and redo your change; there is a single draft per instance.

### The default map came back / my map is gone after a restart

**Cause:** the published map failed validation at boot (`Mapa publicado #N inválido`), typically after a manual database edit, so the app fell back to the in-memory default map. Nothing was deleted.

**Fix:** open `/admin/mapa`, pick the version in the versions panel, restore it to the draft, run **Validate**, fix the listed errors and publish again.

### Everyone disconnects every N seconds / "reconnecting" badge

**Cause:** a proxy with a short idle or total timeout on WebSockets (nginx default `proxy_read_timeout 60s` without the long timeout in the shipped config; some load balancers cap connections at 60 s), or the host is swapping and ticks stall (`office_tick_duration_ms` in `/metrics`).

**Fix:** raise `proxy_read_timeout`/`proxy_send_timeout` to 3600 s on the `/` location (see [Reverse proxy](reverse-proxy.md)), check free memory, check `/admin/telemetria` for `ws_drop` events clustered in time.

### People appear to "teleport" or lag

**Cause:** high round-trip time or packet loss on the user's network; the server rejects or corrects client positions (`moved_reject`, `pos_jump` telemetry).

**Fix:** per-user problem in most cases; the telemetry summary shows RTT p95 per person. If everyone is affected at once, check server CPU and `office_tick_duration_ms`.

### `npm run dev` works but a colleague on the LAN cannot sign in

**Cause:** the dev server binds to `127.0.0.1` by default and, when reached through a LAN name, the host guard refuses the name.

**Fix:** `OFFICE_HOST=0.0.0.0`, `OFFICE_ALLOWED_HOSTS=<your-lan-name>`, `OFFICE_COOKIE_SECURE=0` (plain HTTP). Reaching it by IP works without the allow-list entry (IPs are always accepted), but microphone and camera require HTTPS or `localhost`, so use it for presence/chat testing only.

## Collecting information for a bug report or a deployment question

Use the issue templates in the repository: **Bug report** for something broken, **Deployment help** when a `docs/deploy/*.md` step fails (the template includes a checklist of the usual suspects: DNS, firewall, health endpoint, secrets). Questions and ideas go to GitHub Discussions.

Include:

- Oficio version (`/api/health` → `version`) and how it is installed (compose, Portainer, PaaS, source).
- `docker compose logs --tail=200 app` (plus `livekit` for audio/video issues, `caddy` for TLS issues), with secrets removed.
- The output of `curl -s https://office.example.com/api/health` and, for A/V, the result of the LiveKit connection test.
- Browser and OS, and any red line from the browser console.
- Which step of which guide you were following when it went wrong.

Never paste `.env`, tokens or passwords; redact them before posting.
