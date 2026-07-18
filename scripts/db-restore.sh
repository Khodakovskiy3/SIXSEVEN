#!/usr/bin/env bash
# Відновлення БД з резервної копії.
#
# Використання:
#   ./scripts/db-restore.sh                  — найсвіжіша копія з backups/
#   ./scripts/db-restore.sh <файл.sql.gz>    — конкретна копія
#   ./scripts/db-restore.sh --yes [<файл>]   — без інтерактивного підтвердження
#
# Дампи створюються з --clean --if-exists, тому відновлення працює
# і в непорожню базу (наявні об'єкти видаляються й створюються заново).
set -euo pipefail

# ─── Константи ────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="$PROJECT_DIR/backups"

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

die() {
  echo "ПОМИЛКА: $1" >&2
  exit 1
}

# ─── Розбір аргументів ────────────────────────────────────────────────────────
IS_CONFIRMED=false
BACKUP_FILE=""
for arg in "$@"; do
  if [[ "$arg" == "--yes" || "$arg" == "-y" ]]; then
    IS_CONFIRMED=true
  else
    BACKUP_FILE="$arg"
  fi
done

# Без аргументу — беремо найсвіжішу копію
if [[ -z "$BACKUP_FILE" ]]; then
  BACKUP_FILE=$(ls -t "$BACKUP_DIR"/*.sql.gz 2>/dev/null | head -1) \
    || die "у $BACKUP_DIR немає жодної копії"
fi
[[ -f "$BACKUP_FILE" ]] || die "файл не знайдено: $BACKUP_FILE"

# ─── Підтвердження ────────────────────────────────────────────────────────────
echo "База:  $PGDATABASE"
echo "Копія: $BACKUP_FILE ($(du -sh "$BACKUP_FILE" | cut -f1), $(date -r "$BACKUP_FILE" '+%Y-%m-%d %H:%M'))"
if [[ "$IS_CONFIRMED" != true ]]; then
  read -r -p "Поточні дані буде замінено вмістом копії. Продовжити? [y/N] " answer
  [[ "$answer" == "y" || "$answer" == "Y" ]] || { echo "Скасовано."; exit 0; }
fi

# ─── Визначення способу підключення (як у db-backup.sh) ───────────────────────
DOCKER_CONTAINER=""
if command -v docker &>/dev/null; then
  DOCKER_CONTAINER=$(docker ps --filter "name=67-db-1" --filter "name=67_db_1" \
    --format "{{.Names}}" 2>/dev/null | head -1 || true)
fi

if [[ -n "$DOCKER_CONTAINER" ]]; then
  gunzip -c "$BACKUP_FILE" \
    | docker exec -i -e PGPASSWORD="$PGPASSWORD" "$DOCKER_CONTAINER" \
        psql -q -v ON_ERROR_STOP=1 -U "$PGUSER" "$PGDATABASE" >/dev/null \
    || die "відновлення завершилося з помилкою"
else
  command -v psql &>/dev/null || die "psql не встановлено і Docker-контейнер не знайдено"
  gunzip -c "$BACKUP_FILE" \
    | PGPASSWORD="$PGPASSWORD" psql -q -v ON_ERROR_STOP=1 \
        -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$PGDATABASE" >/dev/null \
    || die "відновлення завершилося з помилкою"
fi

echo "✓ Базу $PGDATABASE відновлено з $BACKUP_FILE"
