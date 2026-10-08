/**
 * Раннер міграцій бази даних (той самий механізм, що й при старті сервера).
 *
 * Застосовує лише нові файли з db/migrations і фіксує їх у schema_migrations.
 * Порожню базу ініціалізує з db/schema.sql. Безпечно запускати повторно та
 * паралельно (pg_advisory_lock). Railway: використовується як pre-deploy команда.
 *
 * Запуск:  npm run db:migrate
 */

import { closePool } from '../server/db.js';
import { runMigrations } from '../server/migrate.js';

runMigrations()
  .catch((error) => {
    console.error(`\n✗ ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => closePool());
