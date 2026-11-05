#!/usr/bin/env sh
# Restores a dump produced by scripts/backup.sh into the docker compose stack. STOPS the app while restoring.
# Usage: ./scripts/restore.sh backups/oficio-2026-01-01T03-00-00.sql.gz
set -eu
FILE="${1:?usage: restore.sh <file.sql.gz>}"
[ -f "$FILE" ] || { echo "file not found: $FILE" >&2; exit 1; }

echo "This will REPLACE the database 'oficio' with $FILE. Press Ctrl+C within 5 s to abort."
sleep 5

docker compose stop app
# The first line written by recent mariadb-dump ("enable the sandbox mode") is not understood by the MySQL 8 client.
gzip -dc "$FILE" | sed '1{/enable the sandbox mode/d}' | docker compose exec -T \
  -e MYSQL_PWD="$(grep -E '^MYSQL_ROOT_PASSWORD=' .env | cut -d= -f2-)" mysql mysql -u root oficio
docker compose start app
echo "[restore] done. Sessions stay valid; users whose password changed in the dump must sign in again."
