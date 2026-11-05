#!/usr/bin/env sh
# Creates .env from .env.example (if missing) and fills every empty secret with a random value.
# Safe to re-run: existing non-empty values are kept. Usage: ./scripts/gen-secrets.sh [path/to/.env]
set -eu

ENV_FILE="${1:-.env}"
EXAMPLE="$(dirname "$0")/../.env.example"

if [ ! -f "$ENV_FILE" ]; then
  cp "$EXAMPLE" "$ENV_FILE"
  echo "created $ENV_FILE from .env.example"
fi

rand_hex() { openssl rand -hex "$1"; }

# set_if_empty VAR VALUE: fills VAR only when it is empty or still a placeholder.
set_if_empty() {
  var="$1"; val="$2"
  cur="$(grep -E "^${var}=" "$ENV_FILE" | head -n1 | cut -d= -f2- || true)"
  case "$cur" in
    ""|change-me|change-me-root)
      if grep -qE "^${var}=" "$ENV_FILE"; then
        # portable in-place edit (GNU and BSD sed)
        tmp="$(mktemp)"; sed "s|^${var}=.*|${var}=${val}|" "$ENV_FILE" > "$tmp" && mv "$tmp" "$ENV_FILE"
      else
        printf '%s=%s\n' "$var" "$val" >> "$ENV_FILE"
      fi
      echo "set $var"
      ;;
    *) echo "kept $var" ;;
  esac
}

set_if_empty OFFICE_JWT_SECRET "$(rand_hex 32)"
set_if_empty MYSQL_ROOT_PASSWORD "$(rand_hex 24)"
set_if_empty MYSQL_PASSWORD "$(rand_hex 24)"
set_if_empty LIVEKIT_API_KEY "API$(rand_hex 6)"
set_if_empty LIVEKIT_API_SECRET "$(rand_hex 24)"
set_if_empty METRICS_TOKEN "$(rand_hex 24)"

# DATABASE_URL must match MYSQL_PASSWORD (docker-compose.yml builds it from MYSQL_* anyway).
pw="$(grep -E '^MYSQL_PASSWORD=' "$ENV_FILE" | head -n1 | cut -d= -f2-)"
tmp="$(mktemp)"; sed "s|^DATABASE_URL=.*|DATABASE_URL=mysql://oficio:${pw}@mysql:3306/oficio|" "$ENV_FILE" > "$tmp" && mv "$tmp" "$ENV_FILE"

chmod 600 "$ENV_FILE" 2>/dev/null || true
echo
echo "Done. Now edit $ENV_FILE and set: OFFICE_DOMAIN, LIVEKIT_DOMAIN, ACME_EMAIL, OFFICE_PUBLIC_URL, OFFICE_ALLOWED_HOSTS, LIVEKIT_URL (and LIVEKIT_NODE_IP if you know the public IP)."
