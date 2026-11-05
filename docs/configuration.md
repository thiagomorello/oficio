# Configuration

Oficio is configured entirely through environment variables, read once at boot by `server/config.ts`. This page lists every variable in the same groups as [`.env.example`](../.env.example), with type, default, whether it is required, and what it does; then it explains branding, languages, LiveKit, e-mail, metrics, development-only settings, and how `docker-compose.yml` derives `DATABASE_URL` and the public URLs from `OFFICE_DOMAIN` and `LIVEKIT_DOMAIN`.

## How values are read

- Empty strings count as "not set". Whitespace is trimmed.
- Boolean variables accept `1`, `true`, `yes`, `sim`, `on` (case-insensitive) as true; anything else is false.
- At boot the server logs a **warning** for every missing or invalid value it can live without (for example an invalid accent color falls back to the default). Missing values it cannot live without are logged as errors: without `DATABASE_URL` the process exits (except in `--dev`), and without `OFFICE_JWT_SECRET` every `/api/*` call answers `503` and the login page cannot sign anyone in.
- `GET /api/config` (public, no secrets) shows the branding and language values the server actually applied, plus the version. Use it to confirm a change landed.
- Restart the app after changing `.env`: `docker compose up -d` recreates only the containers whose environment changed.

## HTTP server

| Variable | Type | Default | Required | Description |
|---|---|---|---|---|
| `OFFICE_PORT` | integer | `4747` | no | Port the Node process listens on. Values outside 1–65535 fall back to 4747. |
| `OFFICE_HOST` | address | `0.0.0.0` in Docker, `127.0.0.1` otherwise | no | Bind address. Outside Docker the default is loopback so a reverse proxy on the same host is the only way in. |
| `OFFICE_IN_DOCKER` | boolean | unset (the image sets `1`) | no | Switches the default bind address to `0.0.0.0`. The Dockerfile already sets it. |
| `OFFICE_IN_MEMORY` | `0`/`1` | `0` | no | Demo mode: in-memory repositories instead of MySQL, a `dev@oficio.local` / `dev12345` admin and an ephemeral JWT secret when `OFFICE_JWT_SECRET` is empty. Everything is lost on restart. Never in production. |
| `OFFICE_DEV` | boolean | unset | no | Development mode: Vite middleware with hot reload, in-memory repositories when `DATABASE_URL` is empty, `LOGIN_MASTER_PASSWORD` honoured. Same as the `--dev` flag. **Never set it in production.** |
| `OFFICE_PUBLIC_URL` | URL | unset | recommended | Public base URL, used to build links in e-mails (`/login?reset=…`, `/login?lang=…`). Without it, reset e-mails fall back to the request's `Host` header. |
| `OFFICE_ALLOWED_HOSTS` | comma-separated host names | empty | **yes in production** | Host names the server accepts in the `Host` and `Origin` headers (port is ignored). `localhost`, `*.localhost` and literal IPs are always accepted. Any other host gets `403 Host not allowed`, and WebSocket upgrades from other origins are refused. Protects against DNS rebinding and CSRF. |
| `TRUST_PROXY` | boolean | `0` | yes behind a proxy | When `1`, the first address in `X-Forwarded-For` is used as the client IP for login rate limiting and session logs. Set it whenever Caddy, Traefik, nginx or a tunnel sits in front of the app; leave it `0` when browsers connect directly, otherwise clients could spoof their IP. |

## Branding (whitelabel)

| Variable | Type | Default | Required | Description |
|---|---|---|---|---|
| `OFFICE_APP_NAME` | string, max 40 chars | `Oficio` | no | Name shown in page titles, the login page, the admin header, e-mails (subject and sender name) and the PWA manifest. Longer values are truncated. |
| `OFFICE_LOGO_URL` | absolute URL or path starting with `/` | `/assets/brand/logo.svg` | no | Logo in the top bar, login and admin pages. Anything that is not `http(s)://…` or `/…` falls back to the default. |
| `OFFICE_ACCENT_COLOR` | `#rrggbb` | `#7c9cff` | no | Accent color for buttons, highlights, the in-world sign and the e-mail header. Invalid values log a warning and use the default. |
| `OFFICE_SIGN_TEXT` | string, max 14 chars | value of `OFFICE_APP_NAME` (truncated) | no | Text on the reception sign in the map. Rendered in an uppercase 5x7 pixel font; accents are stripped. |
| `OFFICE_DEFAULT_LOCALE` | `en` \| `pt-BR` | `en` | no | Default language for visitors who have not chosen one, for server messages and for e-mails. Unknown values log a warning and use `en`. |

Details and tips in [Branding](#branding-details) below.

## Session and login

| Variable | Type | Default | Required | Description |
|---|---|---|---|---|
| `OFFICE_JWT_SECRET` | random string (hex, 64 chars recommended) | unset | **yes** | Signs the session cookie (`office_session`, HS256, 30 days). Without it the login endpoint answers `503`. In `--dev` an ephemeral secret is generated, so sessions are lost on restart. Generate with `openssl rand -hex 32`. Changing it signs everyone out. |
| `OFFICE_COOKIE_SECURE` | boolean | `1` | no | Sets the `Secure` flag on the session cookie, so browsers only send it over HTTPS. Set `0` **only** for local development over plain HTTP; on HTTP with `1` the browser drops the cookie and you loop back to the login page. |
| `LOGIN_MASTER_PASSWORD` | string | unset | no | A password that logs into any account. **Only honoured in `--dev`**; outside dev mode it is ignored and a warning is logged. Keep it empty in production. |

## MySQL database

| Variable | Type | Default | Required | Description |
|---|---|---|---|---|
| `DATABASE_URL` | `mysql://user:password@host:3306/database` | unset | **yes** (except `--dev`) | Connection URL. The server reads only scheme, user, password, host, port and database name; query parameters are ignored (see [Database](database.md)). URL-encode special characters in the password (`@` → `%40`, `#` → `%23`, …). |
| `MYSQL_HOST` | host | unset | alternative | Used with the other `MYSQL_*` parts **only when `DATABASE_URL` is empty**; the server assembles a URL from them (user and password are URL-encoded for you). |
| `MYSQL_PORT` | integer | `3306` | no | Part of the alternative form. |
| `MYSQL_USER` | string | `root` (server) / `oficio` (compose) | no | Part of the alternative form; also the user `docker-compose.yml` creates in the MySQL container. |
| `MYSQL_PASSWORD` | string | empty | yes with compose | Part of the alternative form; also the password of the compose MySQL user and the one baked into the compose `DATABASE_URL`. Keep it URL-safe (hex) because it goes into a URL. |
| `MYSQL_DATABASE` | string | `oficio` | no | Part of the alternative form; also the database the compose MySQL container creates. |
| `MYSQL_SSL` | `required` \| `skip-verify` \| empty | empty | no | TLS to the database (works with both forms). `required` validates the server certificate; `skip-verify` encrypts without validating. Same as `?ssl=true` / `?ssl=skip-verify` in `DATABASE_URL`. |
| `MYSQL_ROOT_PASSWORD` | string | — | yes with compose | Root password of the bundled MySQL container, used on first boot and by `scripts/backup.sh` / `restore.sh`. Not read by the app. |
| `MYSQL_BUFFER_POOL` | size | `256M` | no | compose only: `innodb-buffer-pool-size` of the bundled MySQL. Raise to `512M`–`1G` on hosts with 8 GB or more. |

With `docker-compose.yml` you normally never write `DATABASE_URL` by hand: the compose file builds it as `mysql://${MYSQL_USER:-oficio}:${MYSQL_PASSWORD}@mysql:3306/${MYSQL_DATABASE:-oficio}`. `gen-secrets.sh` also rewrites the `DATABASE_URL` line in `.env` to match, which matters when you run the CLI from source against the same database.

## LiveKit (audio and video)

| Variable | Type | Default | Required | Description |
|---|---|---|---|---|
| `LIVEKIT_URL` | `wss://host` | unset | yes for A/V | Public signaling URL browsers connect to. Self-hosted: `wss://livekit.example.com` (Caddy in front of port 7880). LiveKit Cloud: `wss://<project>.livekit.cloud`. Also returned in `GET /api/livekit/token`. |
| `LIVEKIT_INTERNAL_URL` | `http://host:7880` or `wss://…` | falls back to `LIVEKIT_URL` | no | URL the **server** uses for the LiveKit room-service API (updating participant permissions). Inside compose: `http://livekit:7880`. `ws(s)://` is converted to `http(s)://` automatically. For LiveKit Cloud use the same value as `LIVEKIT_URL`. |
| `LIVEKIT_API_KEY` | string | unset | yes for A/V | API key, identical to the one configured in the LiveKit server (`LIVEKIT_KEYS`). Convention: `API` + 12 hex chars. |
| `LIVEKIT_API_SECRET` | string, 32+ chars | unset | yes for A/V | Matching secret. Generate with `openssl rand -hex 24`. A mismatch between app and server shows up as `401`/token errors in the browser console. |
| `LIVEKIT_ROOM` | string | `oficio` | no | Name of the single LiveKit room the whole office uses. Change it only if several Oficio instances share one LiveKit server. |
| `LIVEKIT_NODE_IP` | IPv4 | empty | recommended | compose only: public IP announced in ICE candidates (`rtc.node_ip`). Empty means LiveKit discovers it via STUN (`use_external_ip: true`). **Required** in Docker Swarm / overlay networks, where discovery is unreliable. |
| `LIVEKIT_TCP_PORT` | integer | `7881` | no | compose only: host port published for ICE-TCP. |
| `LIVEKIT_UDP_PORT` | integer | `7882` | no | compose only: host port published for media over UDP. |

When any of `LIVEKIT_URL`, `LIVEKIT_API_KEY` or `LIVEKIT_API_SECRET` is missing, the server logs `LiveKit não configurado`, `/api/health` reports `"livekit": false`, and the office runs without audio/video (presence and chat still work). More in [LiveKit](livekit.md).

## Domains (docker-compose.yml with Caddy)

| Variable | Type | Default | Required | Description |
|---|---|---|---|---|
| `OFFICE_DOMAIN` | host name | — | **yes with compose** | Caddy serves the app at `https://$OFFICE_DOMAIN`. Also the fallback for `OFFICE_PUBLIC_URL` and `OFFICE_ALLOWED_HOSTS`. |
| `LIVEKIT_DOMAIN` | host name | — | **yes with compose** | Caddy proxies `https://$LIVEKIT_DOMAIN` to `livekit:7880`. Also the fallback for `LIVEKIT_URL`. |
| `ACME_EMAIL` | e-mail | empty | recommended | Contact e-mail Caddy gives Let's Encrypt (expiry notices). |
| `OFICIO_VERSION` | image tag | `latest` | no | Tag of `ghcr.io/thiagomorello/oficio` to run. Pin it (`0.1.0`) in production; see [Upgrading](upgrading.md). |
| `TZ` | time zone | `UTC` | no | Time zone of the app and MySQL containers (affects log timestamps and the "logins today" counter in the admin panel). |

These are not read by the Node process; they exist for `docker-compose.yml`, Caddy and the Portainer stacks.

### How compose derives the public URLs

```yaml
OFFICE_PUBLIC_URL:    ${OFFICE_PUBLIC_URL:-https://${OFFICE_DOMAIN}}
OFFICE_ALLOWED_HOSTS: ${OFFICE_ALLOWED_HOSTS:-${OFFICE_DOMAIN}}
LIVEKIT_URL:          ${LIVEKIT_URL:-wss://${LIVEKIT_DOMAIN}}
LIVEKIT_INTERNAL_URL: ${LIVEKIT_INTERNAL_URL:-http://livekit:7880}
DATABASE_URL:         mysql://${MYSQL_USER:-oficio}:${MYSQL_PASSWORD}@mysql:3306/${MYSQL_DATABASE:-oficio}
```

`${VAR:-default}` means "use `VAR` if it is set and non-empty, otherwise the default". So the minimum `.env` for compose is the two domains plus the secrets. If you set `OFFICE_PUBLIC_URL`, `OFFICE_ALLOWED_HOSTS` or `LIVEKIT_URL` explicitly, they win; `.env.example` ships them pre-filled with `example.com` values, which you must change or remove.

Variables marked `:?` in the compose file (`OFFICE_JWT_SECRET`, `MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `OFFICE_DOMAIN`, `LIVEKIT_DOMAIN`) make `docker compose up` refuse to start with a clear message when they are empty.

## E-mail (optional)

| Variable | Type | Default | Required | Description |
|---|---|---|---|---|
| `SENDGRID_API_KEY` | string | unset | no | SendGrid API key. Enables invitation e-mails (temporary password) and password-reset links. |
| `MAIL_FROM` | e-mail | unset | yes when the key is set | Sender address; must be verified in SendGrid. The sender name is `OFFICE_APP_NAME`. Setting the key without `MAIL_FROM` logs a warning and sends nothing. |

The mailer never throws: if SendGrid answers an error, the app logs `SendGrid responded 4xx` and the admin UI falls back to showing the temporary password on screen. E-mails are sent in the recipient's saved language, or the requester's language for brand-new accounts; see [i18n](i18n.md).

## Observability (optional)

| Variable | Type | Default | Required | Description |
|---|---|---|---|---|
| `METRICS_TOKEN` | string | unset | no | When set, `GET /metrics` requires `Authorization: Bearer <token>`; otherwise the endpoint is public (aggregate counters only, no personal data). `gen-secrets.sh` fills it. |

Metrics exposed (Prometheus text format): `office_online_users`, `office_ws_connections`, `office_tick_duration_ms{stat="last"|"max"}`, `office_chat_messages_total`, `office_logins_total`, `process_uptime_seconds`, `nodejs_heap_used_bytes`. Example scrape config:

```yaml
scrape_configs:
  - job_name: oficio
    scheme: https
    static_configs: [{ targets: ['office.example.com'] }]
    authorization: { credentials: '<METRICS_TOKEN>' }
```

`GET /api/health` is always public and returns `{ ok, db, version, uptime, online, livekit }`; `db` is `ok`, `error` (status 503) or `fake` (dev mode without a database).

## Local development

| Variable | Type | Default | Required | Description |
|---|---|---|---|---|
| `VITE_PORT` | integer | `5173` | no | Port of the standalone Vite dev server (`npm run dev:client`), which proxies `/api` and `/ws` to `OFFICE_PORT`. Not needed with `npm run dev`, which embeds Vite in the Node server. |

`npm run dev` (= `--dev`) without `DATABASE_URL` uses in-memory repositories and creates the account `dev@oficio.local` / `dev12345` (admin). `docker-compose.dev.yml` provides a local MySQL (`mysql://oficio:oficio@127.0.0.1:3306/oficio`) and a LiveKit on `ws://127.0.0.1:7880` with key `devkey` / secret `devsecretdevsecretdevsecret12345`. Camera and microphone work on `localhost` without HTTPS; set `OFFICE_COOKIE_SECURE=0` if you log in over plain HTTP from another host name.

## Branding details

Everything about the look of an instance comes from the five `OFFICE_*` branding variables; no files need to be edited.

- **Name** (`OFFICE_APP_NAME`): shows in `<title>`, login, admin, e-mails and the PWA manifest (`/manifest.webmanifest`, generated at runtime; `short_name` is the first 12 characters).
- **Logo** (`OFFICE_LOGO_URL`): point it at a file on your CDN or at a path served by the app. The default `/assets/brand/logo.svg` and the PWA icons (`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`) can be regenerated in your colours and text with the bundled generator, which draws the same 5x7 pixel font the in-world sign uses:

  ```sh
  pip install pillow
  python scripts/assets/make-brand.py --text ACME --accent "#ff6600"
  ```

  The files land in `client/public/assets/brand/`; rebuild the image (or mount the folder) to ship them. For a custom logo you already have, just set `OFFICE_LOGO_URL` instead.
- **Accent color** (`OFFICE_ACCENT_COLOR`): the UI derives a whole palette from it (`accentPalette` in `shared/branding.ts`): a slightly darker **strong** shade for hover and active states, a **dark** shade for borders and discreet highlights, a **light** shade for soft backgrounds, and the text color **on** the accent, which is chosen automatically (near-black on light accents, white on dark ones, by WCAG luminance). The same palette styles the HTML e-mails.
- **Sign** (`OFFICE_SIGN_TEXT`): the reception sign in the default map carries the special label `{brand}`, which the renderer replaces with this text in the pixel font. Keep it short (14 characters max) and ASCII; accents are stripped. Maps you draw yourself can use `{brand}` on any sign.

Clients read these values from `GET /api/config` at load time, so a change plus a container restart is enough; no rebuild.

## Language

`OFFICE_DEFAULT_LOCALE` is the instance default, not a lock. Resolution order in the browser is: the person's saved choice (settings or the login-page selector, stored in `localStorage` and in the user profile) → the browser's `navigator.languages` → `OFFICE_DEFAULT_LOCALE`. The server picks the language of API error messages and e-mails from `?lang=` (used in e-mail links) → `Accept-Language` → the default. Supported values: `en`, `pt-BR`. Full explanation and how to add a language: [i18n](i18n.md).

## Full example `.env` for a VPS

```ini
OFFICE_PORT=4747
OFFICE_PUBLIC_URL=https://office.example.com
OFFICE_ALLOWED_HOSTS=office.example.com
TRUST_PROXY=1

OFFICE_APP_NAME=Acme Office
OFFICE_ACCENT_COLOR=#ff6600
OFFICE_SIGN_TEXT=ACME
OFFICE_DEFAULT_LOCALE=en

OFFICE_JWT_SECRET=<openssl rand -hex 32>
OFFICE_COOKIE_SECURE=1
LOGIN_MASTER_PASSWORD=

DATABASE_URL=mysql://oficio:<hex>@mysql:3306/oficio
MYSQL_ROOT_PASSWORD=<hex>
MYSQL_USER=oficio
MYSQL_PASSWORD=<hex>
MYSQL_DATABASE=oficio

LIVEKIT_URL=wss://livekit.example.com
LIVEKIT_INTERNAL_URL=http://livekit:7880
LIVEKIT_API_KEY=API<12 hex>
LIVEKIT_API_SECRET=<openssl rand -hex 24>
LIVEKIT_ROOM=oficio
LIVEKIT_NODE_IP=203.0.113.10
LIVEKIT_TCP_PORT=7881
LIVEKIT_UDP_PORT=7882

OFFICE_DOMAIN=office.example.com
LIVEKIT_DOMAIN=livekit.example.com
ACME_EMAIL=admin@example.com
OFICIO_VERSION=0.1.0
TZ=UTC

SENDGRID_API_KEY=
MAIL_FROM=
METRICS_TOKEN=<openssl rand -hex 24>
```

Keep `.env` out of version control (it is gitignored) and readable only by the deploying user (`chmod 600 .env`, which `gen-secrets.sh` does for you).
