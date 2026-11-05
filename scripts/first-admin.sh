#!/usr/bin/env sh
# Creates the first administrator inside the running `app` container (docker compose).
# Usage: ./scripts/first-admin.sh admin@example.com "Admin Name" [password]
# Without a password a temporary one is printed once (must be changed at first login).
set -eu
EMAIL="${1:?usage: first-admin.sh <email> <name> [password]}"
NAME="${2:?usage: first-admin.sh <email> <name> [password]}"
if [ "${3:-}" != "" ]; then
  docker compose exec app node dist/server/cli.js create-admin --email "$EMAIL" --name "$NAME" --password "$3"
else
  docker compose exec app node dist/server/cli.js create-admin --email "$EMAIL" --name "$NAME"
fi
