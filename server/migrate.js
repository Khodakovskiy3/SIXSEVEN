/**
 * Застосування SQL-міграцій із журналом schema_migrations.
 *
 * Правила:
 *  • кожен файл db/migrations/*.sql застосовується РІВНО ОДИН раз і
 *    фіксується в schema_migrations (filename, checksum, applied_at) у тій
 *    самій транзакції, що й сама міграція: або обидва, або нічого;
 *  • одночасний запуск кількох інстансів/pre-deploy команди безпечний —
 *    увесь процес виконується під pg_advisory_lock;
 *  • порожня база (новий Railway Postgres): спершу db/schema.sql (базова
 *    схема, раніше її застосовував лише docker initdb), далі всі міграції;
 *  • наявна база без журналу (розгортання до впровадження Cluvyra): усі
 *    міграції, які історично були ідемпотентними й виконувалися на кожному
 *    старті, проганяються ще раз і записуються в журнал;
 *  • змінений після застосування файл не виконується повторно — лише
 *    попередження про розбіжність контрольної суми;
 *  • нічого не видаляється й не скидається автоматично.
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { withClient } from './db.js';
import { logError } from './utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_DIR = join(__dirname, '..', 'db');
const MIGRATIONS_DIR = join(DB_DIR, 'migrations');
const BASELINE_FILE = join(DB_DIR, 'schema.sql');

/** Запис базової схеми в журналі. */
export const BASELINE_NAME = '000_baseline_schema.sql';

/** Довільна, але стабільна константа для pg_advisory_lock. */
const MIGRATION_LOCK_KEY = 726_481_903;

let migrationsComplete = false;

/** Чи завершилися міграції в цьому процесі (для health-check). */
export function areMigrationsComplete() {
  return migrationsComplete;
}

function checksum(sql) {
  return createHash('sha256').update(sql).digest('hex');
}

/**
 * Перелік файлів міграцій у порядку застосування.
 *
 * @param {string} [dir]
 * @returns {Array<{ name: string, sql: string, checksum: string }>}
 */
export function listMigrations(dir = MIGRATIONS_DIR) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => {
      const sql = readFileSync(join(dir, name), 'utf8');
      return { name, sql, checksum: checksum(sql) };
    });
}

async function tableExists(client, table) {
  const result = await client.query('select to_regclass($1) as oid', [`public.${table}`]);
  return result.rows[0].oid !== null;
}

async function applyInTransaction(client, name, sql, sum) {
  await client.query('begin');
  try {
    await client.query(sql);
    await client.query(
      `insert into schema_migrations (filename, checksum) values ($1, $2)
       on conflict (filename) do nothing`,
      [name, sum]
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  }
}

/**
 * Застосовує нові міграції. Повертає перелік застосованих файлів.
 *
 * @param {{ log?: (line: string) => void, migrationsDir?: string }} [options]
 * @returns {Promise<{ applied: string[], mode: 'fresh'|'legacy'|'incremental' }>}
 */
export async function runMigrations(options = {}) {
  const log = options.log || ((line) => console.log(line));
  const migrations = listMigrations(options.migrationsDir);

  const outcome = await withClient(async (client) => {
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      await client.query(
        `create table if not exists schema_migrations (
           filename   varchar(255) primary key,
           checksum   char(64)     not null,
           applied_at timestamptz  not null default now()
         )`
      );

      const appliedResult = await client.query('select filename, checksum from schema_migrations');
      const applied = new Map(appliedResult.rows.map((row) => [row.filename, row.checksum]));

      let mode = 'incremental';
      if (applied.size === 0) {
        const hasSchema = await tableExists(client, 'users');
        mode = hasSchema ? 'legacy' : 'fresh';

        if (mode === 'fresh') {
          const baselineSql = readFileSync(BASELINE_FILE, 'utf8');
          log(`▶ ${BASELINE_NAME} (порожня база — базова схема)`);
          await applyInTransaction(client, BASELINE_NAME, baselineSql, checksum(baselineSql));
        } else {
          log('▶ Наявна база без журналу міграцій — реєструю історичні міграції');
        }
      }

      const newlyApplied = [];
      for (const migration of migrations) {
        const knownChecksum = applied.get(migration.name);
        if (knownChecksum) {
          if (knownChecksum.trim() !== migration.checksum) {
            log(`⚠ ${migration.name} змінено після застосування — повторно не виконується`);
          }
          continue;
        }
        log(`▶ ${migration.name}`);
        try {
          await applyInTransaction(client, migration.name, migration.sql, migration.checksum);
        } catch (error) {
          error.message = `Міграція ${migration.name} не вдалася: ${error.message}`;
          throw error;
        }
        newlyApplied.push(migration.name);
      }

      return { applied: newlyApplied, mode };
    } finally {
      await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => {});
    }
  });

  migrationsComplete = true;
  log(`✓ Міграції: режим ${outcome.mode}, нових застосовано — ${outcome.applied.length}`);
  return outcome;
}

/**
 * Позначає, що процес не запускав міграції сам (їх виконала pre-deploy
 * команда) — health-check тоді перевіряє журнал у БД.
 */
export async function verifyMigrationsApplied() {
  const migrations = listMigrations();
  const pending = await withClient(async (client) => {
    if (!(await tableExists(client, 'schema_migrations'))) {
      return migrations.map((m) => m.name);
    }
    const result = await client.query('select filename from schema_migrations');
    const done = new Set(result.rows.map((row) => row.filename));
    return migrations.filter((m) => !done.has(m.name)).map((m) => m.name);
  });

  if (pending.length > 0) {
    const error = new Error(`Не застосовано міграції: ${pending.join(', ')}. Запустіть npm run db:migrate.`);
    logError('Перевірка міграцій', error);
    throw error;
  }
  migrationsComplete = true;
}
