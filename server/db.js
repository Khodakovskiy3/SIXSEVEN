/**
 * Модуль доступу до бази даних PostgreSQL.
 *
 * Параметри підключення (див. server/config.js):
 *  • DATABASE_URL — пріоритетне джерело (Railway, керований Postgres);
 *  • PGHOST / PGPORT / PGDATABASE / PGUSER / PGPASSWORD — локальна розробка.
 *
 * Базові операції:
 *  • query()           — виконати окремий SQL-запит;
 *  • withClient()      — кілька запитів в одному з’єднанні;
 *  • withTransaction() — те саме, але в межах BEGIN/COMMIT.
 */

import pg from 'pg';

import { config } from './config.js';
import { logError } from './utils/logger.js';

const { Pool } = pg;

// Тип PostgreSQL date (OID 1082) за замовчуванням парситься у Date-обʼєкт
// у локальній півночі, що при серіалізації в JSON (UTC) зсуває дату на день
// назад. Повертаємо колонки date як рядок 'YYYY-MM-DD'.
const PG_DATE_TYPE_OID = 1082;
pg.types.setTypeParser(PG_DATE_TYPE_OID, (value) => value);

/**
 * Формує параметри пулу з конфігурації.
 *
 * @param {typeof config.db} db
 * @returns {import('pg').PoolConfig}
 */
export function buildPoolConfig(db = config.db) {
  const base = db.url
    ? { connectionString: db.url }
    : {
        host: db.host,
        port: db.port,
        database: db.database,
        user: db.user,
        password: db.password,
      };

  return {
    ...base,
    ssl: db.ssl ? { rejectUnauthorized: db.sslRejectUnauthorized } : undefined,
    max: db.poolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: db.connectTimeoutMs,
    statement_timeout: db.statementTimeoutMs,
    application_name: 'cluvyra',
    // Бізнес-логіка оперує локальними датами клубу (current_date, ::date у
    // звітах), тому сесія БД працює в часовому поясі організації, а не в UTC
    // сервера (Railway). timestamptz лишаються абсолютними моментами.
    // Передається стартовим параметром з'єднання — без додаткового запиту.
    options: `-c TimeZone=${config.timezone}`,
  };
}

const pool = new Pool(buildPoolConfig());

// Якщо простоюче з’єднання обірвалося (рестарт БД, мережа), пул генерує
// 'error'. Без обробника Node вважає це необробленою помилкою і завершує
// процес; з обробником пул просто відкидає зламане з’єднання.
pool.on('error', (error) => {
  logError('Помилка простоюючого з’єднання PostgreSQL', error);
});

/**
 * Виконує SQL-запит через пул з’єднань.
 *
 * @param {string} text — текст SQL-запиту з параметрами $1, $2, …
 * @param {Array<unknown>} [params] — значення для підстановки.
 * @returns {Promise<import('pg').QueryResult>}
 */
export async function query(text, params) {
  return pool.query(text, params);
}

/**
 * Виконує функцію в межах одного з’єднання з пулу.
 * У разі винятку виконує ROLLBACK (безпечно, навіть якщо транзакції немає)
 * і прокидає помилку далі.
 *
 * @template T
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withClient(fn) {
  const client = await pool.connect();
  try {
    return await fn(client);
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      // Помилку відкату ігноруємо, щоб не приховати оригінальний виняток.
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Виконує функцію всередині BEGIN/COMMIT на одному з’єднанні.
 *
 * @template T
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withTransaction(fn) {
  return withClient(async (client) => {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  });
}

/** Перевірка доступності БД для health-check. */
export async function pingDatabase() {
  await pool.query('select 1');
}

/** Закриває пул (graceful shutdown, скрипти, тести). */
export async function closePool() {
  await pool.end();
}

export default pool;
