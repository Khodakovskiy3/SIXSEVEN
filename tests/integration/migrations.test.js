import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import pg from 'pg';

import { TEST_DATABASE_URL, skipReason } from './helpers.js';

describe('migrations (integration)', { skip: skipReason }, () => {
  const dbName = `cluvyra_mig_${randomBytes(4).toString('hex')}`;
  let migrate;
  let db;

  before(async () => {
    const admin = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await admin.connect();
    await admin.query(`create database ${dbName}`);
    await admin.end();
    const url = new URL(TEST_DATABASE_URL);
    url.pathname = `/${dbName}`;
    process.env.DATABASE_URL = url.toString();
    process.env.NODE_ENV = 'test';
    migrate = await import('../../server/migrate.js');
    db = await import('../../server/db.js');
  });

  after(async () => {
    await db?.closePool();
    const admin = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await admin.connect();
    await admin.query(`drop database if exists ${dbName} with (force)`);
    await admin.end();
  });

  test('empty database: baseline + all migrations, concurrently safe', async () => {
    const runs = await Promise.all([1, 2, 3].map(() => migrate.runMigrations({ log: () => {} })));
    const totalApplied = runs.reduce((sum, run) => sum + run.applied.length, 0);
    const files = migrate.listMigrations();
    assert.equal(totalApplied, files.length, 'each migration applied exactly once across 3 concurrent runners');
    assert.ok(runs.some((run) => run.mode === 'fresh'));

    const { rows } = await db.query('select filename from schema_migrations order by filename');
    assert.equal(rows[0].filename, migrate.BASELINE_NAME);
    assert.equal(rows.length, files.length + 1);
  });

  test('re-running is a no-op', async () => {
    const run = await migrate.runMigrations({ log: () => {} });
    assert.equal(run.mode, 'incremental');
    assert.deepEqual(run.applied, []);
  });

  test('schema contains core and Cluvyra tables/columns', async () => {
    const { rows } = await db.query(
      `select table_name from information_schema.tables where table_schema = 'public'`
    );
    const tables = new Set(rows.map((r) => r.table_name));
    for (const table of ['users', 'clients', 'trainers', 'workouts', 'schedules', 'bookings', 'subscriptions',
      'payments', 'visits', 'messages', 'chat_conversations', 'push_subscriptions',
      'ai_booking_confirmations', 'ai_usage_events', 'app_meta', 'schema_migrations']) {
      assert.ok(tables.has(table), `missing table ${table}`);
    }
    const cols = await db.query(
      `select column_name from information_schema.columns where table_name = 'users' and column_name = 'token_version'`
    );
    assert.equal(cols.rows.length, 1);
  });

  test('verifyMigrationsApplied passes when everything is applied', async () => {
    await migrate.verifyMigrationsApplied();
    assert.equal(migrate.areMigrationsComplete(), true);
  });
});
