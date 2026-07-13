/**
 * Автоматичне застосування SQL-міграцій при старті сервера.
 * Безпечно запускати кілька разів — усі файли написані ідемпотентно
 * (CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS тощо).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withClient } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '..', 'db', 'migrations');

export async function runMigrations() {
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    try {
      await withClient(async (client) => {
        await client.query('begin');
        await client.query(sql);
        await client.query('commit');
      });
    } catch (error) {
      console.error(`Міграція ${file} не вдалася:`, error.message);
      throw error;
    }
  }

  console.log(`✓ Міграції застосовано (${files.length} файлів)`);
}
