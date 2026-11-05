# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
