/**
 * Раннер міграцій бази даних.
 *
 * Послідовно виконує всі .sql-файли з теки db/migrations у порядку імен
 * (001_, 002_, …). Кожен файл запускається в окремій транзакції: якщо
 * усередині щось падає — зміни цього файлу відкочуються, а процес
 * зупиняється з ненульовим кодом виходу.
 *
 * Міграції написані ідемпотентно (IF NOT EXISTS / перевірки constraint),
 * тож повторний запуск безпечний.
 *
 * Запуск:  npm run db:migrate
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import pool, { withClient } from '../server/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '..', 'db', 'migrations');

async function run() {
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('Міграцій не знайдено.');
    return;
  }

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    process.stdout.write(`▶ ${file} … `);
    try {
      await withClient(async (client) => {
        await client.query('begin');
        await client.query(sql);
        await client.query('commit');
      });
      console.log('OK');
    } catch (error) {
      console.log('FAILED');
      console.error(`\nПомилка у ${file}:\n${error.message}\n`);
      process.exitCode = 1;
      return;
    }
  }

  console.log('\nУсі міграції застосовано.');
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
