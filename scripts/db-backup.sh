#!/usr/bin/env bash
# Щоденне резервне копіювання PostgreSQL.
# Запуск: ./scripts/db-backup.sh
# Автоматичний запуск через cron — дивіться README або crontab.
set -euo pipefail

# ─── Константи ────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="$PROJECT_DIR/backups"
KEEP_DAYS=30
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
BACKUP_FILE="$BACKUP_DIR/sports_club_db_$TIMESTAMP.sql.gz"
LOG_FILE="$PROJECT_DIR/logs/db-backup.log"

# ─── Зчитування змінних середовища ────────────────────────────────────────────
ENV_FILE="$PROJECT_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a; source "$ENV_FILE"; set +a
fi

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGDATABASE="${PGDATABASE:-sports_club_db}"
PGUSER="${PGUSER:-postgres}"
PGPASSWORD="${PGPASSWORD:-}"

# ─── Допоміжні функції ────────────────────────────────────────────────────────
log() {
  local message="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
  echo "$message"
  echo "$message" >> "$LOG_FILE"
}

die() {
  log "ПОМИЛКА: $1"
  exit 1
}

# ─── Підготовка директорій ────────────────────────────────────────────────────
mkdir -p "$BACKUP_DIR"
mkdir -p "$(dirname "$LOG_FILE")"

log "Початок резервного копіювання бази $PGDATABASE"

# ─── Визначення способу підключення ──────────────────────────────────────────
# Якщо PostgreSQL запущено в Docker — використовуємо docker exec,
# інакше звертаємося напряму через pg_dump.
DOCKER_CONTAINER=""
if command -v docker &>/dev/null; then
  # «|| true» — щоб зупинений Docker-демон не завершував скрипт через set -e
  DOCKER_CONTAINER=$(docker ps --filter "name=67-db-1" --filter "name=67_db_1" \
    --format "{{.Names}}" 2>/dev/null | head -1 || true)
fi

if [[ -n "$DOCKER_CONTAINER" ]]; then
  log "Знайдено Docker-контейнер: $DOCKER_CONTAINER"
  docker exec -e PGPASSWORD="$PGPASSWORD" "$DOCKER_CONTAINER" \
    pg_dump -U "$PGUSER" "$PGDATABASE" \
    | gzip > "$BACKUP_FILE" \
    || die "pg_dump через Docker завершився з помилкою"
else
  log "Docker-контейнер не знайдено — підключення напряму до $PGHOST:$PGPORT"
  command -v pg_dump &>/dev/null || die "pg_dump не встановлено"
  PGPASSWORD="$PGPASSWORD" pg_dump \
    -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$PGDATABASE" \
    | gzip > "$BACKUP_FILE" \
    || die "pg_dump завершився з помилкою"
fi

# ─── Перевірка результату ─────────────────────────────────────────────────────
BACKUP_SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
log "Резервну копію збережено: $BACKUP_FILE ($BACKUP_SIZE)"

# ─── Ротація старих копій ─────────────────────────────────────────────────────
DELETED=$(find "$BACKUP_DIR" -maxdepth 1 -name "*.sql.gz" \
  -mtime +"$KEEP_DAYS" -print -delete | wc -l | tr -d ' ')
[[ "$DELETED" -gt 0 ]] && log "Видалено старих копій: $DELETED (старіші $KEEP_DAYS днів)"

log "Резервне копіювання завершено успішно"
