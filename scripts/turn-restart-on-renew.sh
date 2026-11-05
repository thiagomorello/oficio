#!/usr/bin/env sh
# Restarts the `livekit` container of the docker compose stack when Caddy has renewed the certificate for LIVEKIT_DOMAIN,
# so LiveKit's embedded TURN/TLS (docker-compose.turn.yml) starts serving the new one. LiveKit does not reload
# certificates by itself. This is the host-side alternative to the `turn-cert-reloader` sidecar: no Docker socket
# inside a container, only the docker CLI you already have on the host.
#
# Run it from the directory that holds docker-compose.yml and .env. Cron, every 6 hours:
#   0 */6 * * * cd /opt/oficio && ./scripts/turn-restart-on-renew.sh >> turn-renew.log 2>&1
#
# The last seen modification time is kept in ./.turn-cert.mtime (override with TURN_STATE_FILE). The first run only
# records it; later runs restart livekit when it changed. `docker compose restart` does not recreate the container, so
# the overlay files do not need to be passed here.
set -eu
STATE="${TURN_STATE_FILE:-./.turn-cert.mtime}"
DOMAIN="${LIVEKIT_DOMAIN:-}"
if [ -z "$DOMAIN" ] && [ -f .env ]; then
  DOMAIN="$(grep -E '^LIVEKIT_DOMAIN=' .env | cut -d= -f2- | tr -d '"' || true)"
fi
if [ -z "$DOMAIN" ]; then
  echo "[turn-renew] LIVEKIT_DOMAIN not set and not found in ./.env" >&2
  exit 1
fi
CERT="/data/caddy/certificates/acme-v02.api.letsencrypt.org-directory/$DOMAIN/$DOMAIN.crt"

cur="$(docker compose exec -T caddy stat -c %Y "$CERT" 2>/dev/null || true)"
if [ -z "$cur" ]; then
  echo "[turn-renew] certificate for $DOMAIN not found yet in the caddy container ($CERT); nothing to do"
  exit 0
fi

last="$(cat "$STATE" 2>/dev/null || true)"
if [ -n "$last" ] && [ "$cur" != "$last" ]; then
  echo "[turn-renew] certificate for $DOMAIN changed ($last -> $cur), restarting livekit"
  docker compose restart livekit
elif [ -z "$last" ]; then
  echo "[turn-renew] recorded current certificate mtime ($cur); livekit will be restarted when it changes"
fi
printf '%s\n' "$cur" > "$STATE"
