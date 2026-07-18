#!/bin/sh
# Резервне копіювання БД зсередини контейнера db-backup (docker compose).
# Кросплатформенний варіант: працює скрізь, де запущено Docker.
# Розклад задається у docker-compose.yml (crond), не тут.
set -eu
# pipefail не входить у POSIX, але підтримується busybox ash в alpine
set -o pipefail 2>/dev/null || true

# ─── Константи ────────────────────────────────────────────────────────────────
BACKUP_DIR="/backups"
KEEP_DAYS=30
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
BACKUP_FILE="$BACKUP_DIR/sports_club_db_$TIMESTAMP.sql.gz"
LOG_FILE="$BACKUP_DIR/db-backup.log"

log() {
  message="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
  echo "$message"
  echo "$message" >> "$LOG_FILE"
}

die() {
  log "ПОМИЛКА: $1"
  exit 1
}

mkdir -p "$BACKUP_DIR"
log "Початок резервного копіювання бази $PGDATABASE (хост $PGHOST)"

# PGPASSWORD передається через середовище контейнера.
# --clean --if-exists: дамп сам видаляє наявні об'єкти перед створенням,
# тому відновлення працює і в непорожню базу (без «already exists»).
pg_dump --clean --if-exists -h "$PGHOST" -U "$PGUSER" "$PGDATABASE" \
  | gzip > "$BACKUP_FILE" \
  || { rm -f "$BACKUP_FILE"; die "pg_dump завершився з помилкою"; }

# Обірваний дамп — теж валідний gzip, тому перевіряємо фінальний маркер pg_dump
gunzip -c "$BACKUP_FILE" | tail -5 | grep -q "PostgreSQL database dump complete" \
  || { rm -f "$BACKUP_FILE"; die "дамп неповний — маркер завершення відсутній"; }

BACKUP_SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
log "Резервну копію збережено: $BACKUP_FILE ($BACKUP_SIZE)"

DELETED=$(find "$BACKUP_DIR" -maxdepth 1 -name "*.sql.gz" \
  -mtime +"$KEEP_DAYS" -print -delete | wc -l | tr -d ' ')
[ "$DELETED" -gt 0 ] && log "Видалено старих копій: $DELETED (старіші $KEEP_DAYS днів)"

log "Резервне копіювання завершено успішно"
