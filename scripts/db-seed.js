/**
 * Запуск seed-файлу через Node.js (без psql).
 *
 * Використовує той самий пул з'єднань, що й сервер.
 * Запуск:  npm run db:seed
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import pool from '../server/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const seedFile = join(__dirname, '..', 'db', 'seed-test.sql');

async function run() {
  // seed-test.sql містить відомі тестові паролі — лише для локальної розробки.
  // Для демо в production використовуйте `npm run demo:seed` (випадкові паролі).
  if (process.env.NODE_ENV === 'production') {
    console.error('✗ db:seed заборонено в production (відомі тестові паролі). Використайте npm run demo:seed.');
    process.exitCode = 1;
    return;
  }
  const sql = readFileSync(seedFile, 'utf8');
  const client = await pool.connect();

  try {
    console.log('▶ Виконую seed-test.sql …');
    await client.query(sql);
    console.log('✓ Seed виконано успішно.\n');
  } catch (error) {
    console.error('✗ Помилка seed:', error.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
