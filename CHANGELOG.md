# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.1] - 2026-11-04

### Added
- Helm chart in `deploy/helm/oficio` (#14): single-replica app with `Recreate`, optional bundled MySQL StatefulSet or external database (`MYSQL_SSL`, `MYSQL_SSL_CA`), optional bundled LiveKit (host network or NodePort/LoadBalancer media ports, config in a ConfigMap) or LiveKit Cloud, Ingress presets for ingress-nginx and Traefik, cert-manager annotations, secrets generated and kept across upgrades or `existingSecret`, optional PDB and ServiceMonitor; example values files, a `helm` CI job and a rewritten Kubernetes guide in both languages.
- `MYSQL_SSL_CA` (or `?sslca=` in `DATABASE_URL`): validate the database certificate against a private or corporate CA bundle instead of using `skip-verify`.
- Spanish (`es`) interface language: every message of every area translated, selectable on the login page and in settings, honoured by `Accept-Language` (`es-*`), e-mails and the default map; `OFFICE_DEFAULT_LOCALE=es` accepted. `defineMessages` now takes a map of locales so adding a language is one more entry per file. ([#15](https://github.com/thiagomorello/oficio/issues/15))
- Single sign-on with OpenID Connect (`OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_SCOPES`, `OIDC_BUTTON_LABEL`,
  `OIDC_AUTO_CREATE`, `OIDC_ALLOWED_DOMAINS`, `OIDC_ADMIN_CLAIM`/`OIDC_ADMIN_VALUES`, `OIDC_PASSWORD_LOGIN`): authorization code
  flow with PKCE via `openid-client`, routes `GET /api/auth/oidc/start` and `/callback`, accounts created or linked by e-mail on
  first sign-in, admin mapping from a group claim, optional password-form shutdown, `oidc` block in `GET /api/config`, `SSO`
  source badge in the admin user list, and the guide `docs/sso.md` (Google Workspace, Entra ID, Keycloak, Authentik). Closes #13.
- `AGENTS.md` (and `CLAUDE.md`) with a production deployment runbook and coding rules for AI coding agents; README section explaining how to use it.
- Opt-in TURN for the compose stack (#17): `docker-compose.turn.yml` enables LiveKit's embedded TURN server (TLS on 5349/tcp, UDP on 3478/udp) with the certificate Caddy already issues for `LIVEKIT_DOMAIN`, waits for that certificate on the first boot, and offers two ways to restart LiveKit after renewals: `scripts/turn-restart-on-renew.sh` for host cron or the `turn-cert-reloader` sidecar (`--profile turn-reloader`, Docker socket). New variables `TURN_TLS_PORT`, `TURN_UDP_PORT`, `TURN_CERT_WAIT_SECONDS`, `TURN_RELOADER_INTERVAL`; docs for ports, firewall, testing and limitations in both languages; CI validates the overlay.

### Changed
- Dependencies: zod 4, cookie 2, ws 8.22.1, livekit-server-sdk 2.19.2, vite 8.3.5, vitest 5.1; Docker image and CI on Node 26 (Node 22 remains the minimum for source installs); GitHub Actions bumped to current majors.
- `docker-compose.yml`: Caddy is pinned to Let's Encrypt (`acme_ca`) so the certificate files have a predictable path for the TURN overlay; the ZeroSSL fallback issuer is no longer used.

### Fixed
- CI: the Docker smoke test now loads the built image into the daemon before running it.
- `docker-compose.yml` and `deploy/portainer/stack.yml`: the Caddyfile placeholders `{$OFFICE_DOMAIN}`, `{$LIVEKIT_DOMAIN}` and `{$ACME_EMAIL}` were interpolated by Compose into `{office.example.com}`, which Caddy rejects as a site address (`subject does not qualify for certificate`). They are now escaped (`{$$VAR}`) so Caddy resolves them from its own environment.

## [0.1.0] - 2026-11-04

First public release.

### Added
- Shared pixel-art office with real-time presence (WebSocket, server-authoritative 20 Hz simulation).
- Proximity audio, video and screen sharing through LiveKit (self-hosted or LiveKit Cloud).
- Chat with scopes (everyone, room, nearby), desks you can claim and decorate, meeting rooms with doors and knocking.
- Avatar editor with presets, randomizer and dozens of options.
- Admin panel: users (invite, disable, promote, reset password), map editor with versions and publishing, telemetry.
- Whitelabel branding through environment variables (`OFFICE_APP_NAME`, `OFFICE_LOGO_URL`, `OFFICE_ACCENT_COLOR`,
  `OFFICE_SIGN_TEXT`) exposed on `GET /api/config`.
- Interface in English and Brazilian Portuguese (`OFFICE_DEFAULT_LOCALE`, per-user choice).
- Health (`/api/health`) and Prometheus metrics (`/metrics`).
- CLI: migrations, create-admin, reset-password, import-json.
- Deployment: `docker-compose.yml` (Caddy + LiveKit + MySQL), Portainer stacks (standalone and Swarm/Traefik),
  Railway, Render, Fly.io and DigitalOcean App Platform templates, multi-arch image on GHCR.

[Unreleased]: https://github.com/thiagomorello/oficio/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/thiagomorello/oficio/releases/tag/v0.1.0
