# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- `AGENTS.md` (and `CLAUDE.md`) with a production deployment runbook and coding rules for AI coding agents; README section explaining how to use it.

### Changed
- Dependencies: zod 4, cookie 2, ws 8.22.1, livekit-server-sdk 2.19.2, vite 8.3.5, vitest 5.1; Docker image and CI on Node 26 (Node 22 remains the minimum for source installs); GitHub Actions bumped to current majors.

### Fixed
- CI: the Docker smoke test now loads the built image into the daemon before running it.

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
