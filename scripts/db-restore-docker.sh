#!/bin/sh
# Відновлення БД зсередини контейнера db-backup.
# Викликається з хоста (будь-яка ОС, будь-яка оболонка):
#   docker compose exec db-backup restore                  — найсвіжіша копія
#   docker compose exec db-backup restore <файл.sql.gz>    — конкретна копія
# Підключення (PGHOST/PGUSER/PGDATABASE/PGPASSWORD) — зі змінних контейнера.
set -eu

BACKUP_FILE="${1:-}"
if [ -z "$BACKUP_FILE" ]; then
  BACKUP_FILE=$(ls -t /backups/*.sql.gz 2>/dev/null | head -1) || true
fi
if [ -z "$BACKUP_FILE" ] || [ ! -f "$BACKUP_FILE" ]; then
  echo "ПОМИЛКА: копію не знайдено (${BACKUP_FILE:-/backups порожня})" >&2
  exit 1
fi

echo "Відновлення бази $PGDATABASE з $BACKUP_FILE …"
gunzip -c "$BACKUP_FILE" \
  | psql -q -v ON_ERROR_STOP=1 -h "$PGHOST" -U "$PGUSER" "$PGDATABASE" \
  > /dev/null

echo "✓ Базу $PGDATABASE відновлено"
