# Security policy

## Supported versions

Only the latest minor release receives security fixes. Upgrade by changing the image tag and running
`docker compose pull && docker compose up -d` (see `docs/upgrading.md`).

## Reporting a vulnerability

Please do **not** open a public issue for security problems. Use GitHub's private vulnerability reporting on this
repository ("Security" tab > "Report a vulnerability"). You will get an acknowledgement within 72 hours and a fix or
mitigation plan as soon as possible, usually within two weeks for confirmed issues.

## Hardening checklist for operators

- Always run behind HTTPS (the compose file ships Caddy with automatic certificates). Browsers refuse camera and
  microphone access on plain HTTP anyway.
- Keep `OFFICE_JWT_SECRET`, `LIVEKIT_API_SECRET` and the MySQL passwords random (`scripts/gen-secrets.sh`) and out of
  version control (`.env` is gitignored).
- Set `OFFICE_ALLOWED_HOSTS` to your real host names: the server rejects requests and WebSocket upgrades from other
  `Host`/`Origin` values.
- Expose only ports 80, 443, 7881/tcp and 7882/udp. MySQL must never be reachable from the internet.
- Set `METRICS_TOKEN` if `/metrics` should not be public.
- Disable `LOGIN_MASTER_PASSWORD` outside development (it is ignored in production, but keep it empty).
- The app container runs as a non-root user with a read-only filesystem and no capabilities; keep it that way in
  custom stacks.
