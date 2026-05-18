/**
 * Модуль доступу до бази даних PostgreSQL.
 *
 * Інкапсулює пул з’єднань та надає дві базові операції:
 *  • query()      — виконати окремий SQL-запит;
 *  • withClient() — виконати кілька запитів у межах одного з’єднання
 *                   (для транзакцій із BEGIN/COMMIT/ROLLBACK).
 */

import pg from 'pg';
import dotenv from 'dotenv';

import {
  DB_POOL_MAX,
  DB_IDLE_TIMEOUT_MS,
  DEFAULT_DB_PORT,
} from './utils/constants.js';

dotenv.config();

const { Pool } = pg;

// Пул з’єднань створюється один раз при імпорті модуля.
// Параметри підключення беруться зі змінних оточення (.env),
// а за відсутності — з безпечних значень за замовчуванням.
const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || DEFAULT_DB_PORT),
  database: process.env.PGDATABASE || 'sports_club_db',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || undefined,
  max: DB_POOL_MAX,
  idleTimeoutMillis: DB_IDLE_TIMEOUT_MS,
});

/**
 * Виконує SQL-запит через пул з’єднань.
 *
 * @param {string} text — текст SQL-запиту з параметрами $1, $2, …
 * @param {Array<unknown>} [params] — значення для підстановки.
 * @returns {Promise<import('pg').QueryResult>} результат виконання.
 */
export async function query(text, params) {
  return pool.query(text, params);
}

/**
 * Виконує функцію в межах одного з’єднання з пулу.
 * Використовується для транзакцій: можна викликати BEGIN/COMMIT
 * і бути впевненим, що всі команди пройдуть через одне з’єднання.
 *
 * У разі винятку автоматично виконує ROLLBACK і прокидає помилку далі.
 *
 * @template T
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn — колбек із транзакційною логікою.
 * @returns {Promise<T>} значення, повернене колбеком.
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

export default pool;
