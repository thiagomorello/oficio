#!/usr/bin/env sh
# Dumps the MySQL database of the docker compose stack to ./backups/oficio-<timestamp>.sql.gz and keeps the last N files.
# Usage: ./scripts/backup.sh [dir] [keep]      (defaults: ./backups, 14)
# Optional off-site copy: set S3_BUCKET (and AWS_* credentials / S3_ENDPOINT for S3-compatible storage) to upload with aws-cli.
# Schedule it with cron, e.g.:  0 3 * * * cd /opt/oficio && ./scripts/backup.sh >> backups/backup.log 2>&1
set -eu
DIR="${1:-./backups}"
KEEP="${2:-14}"
mkdir -p "$DIR"
ts="$(date +%Y-%m-%dT%H-%M-%S)"
file="$DIR/oficio-$ts.sql.gz"

# Password via MYSQL_PWD inside the container: it does not show up in `ps`.
docker compose exec -T -e MYSQL_PWD="$(grep -E '^MYSQL_ROOT_PASSWORD=' .env | cut -d= -f2-)" mysql \
  sh -c 'mysqldump -u root --single-transaction --quick --routines --triggers --events --hex-blob --default-character-set=utf8mb4 oficio' \
  | gzip -9 > "$file.partial"

size=$(wc -c < "$file.partial")
if [ "$size" -le 1024 ] || ! gzip -dc "$file.partial" | tail -n 3 | grep -q "Dump completed"; then
  rm -f "$file.partial"
  echo "[backup] FAILED: dump too small or truncated" >&2
  exit 1
fi
mv "$file.partial" "$file"
echo "[backup] OK $file ($size bytes)"

# retention
ls -1t "$DIR"/oficio-*.sql.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do rm -f "$old" && echo "[backup] removed $old"; done

if [ -n "${S3_BUCKET:-}" ]; then
  aws ${S3_ENDPOINT:+--endpoint-url "$S3_ENDPOINT"} s3 cp "$file" "s3://$S3_BUCKET/oficio/$(basename "$file")" --only-show-errors \
    && echo "[backup] uploaded to s3://$S3_BUCKET/oficio/"
fi
