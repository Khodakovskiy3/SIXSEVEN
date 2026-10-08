/**
 * Integration test harness.
 *
 * Requires a disposable PostgreSQL server: TEST_DATABASE_URL must point to a
 * maintenance database on it (e.g. postgres://postgres:pass@localhost:55432/postgres).
 * Each test file creates its own database `cluvyra_it_<random>`, runs the real
 * migrations, and drops it at the end. Production databases are never used.
 *
 * If TEST_DATABASE_URL is not set, integration tests are skipped (reported
 * as skipped, not as passed).
 */

import { randomBytes } from 'node:crypto';
import pg from 'pg';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || '';
export const skipReason = TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL is not set — integration tests skipped';

/**
 * Creates a fresh database, configures env for the app and imports it.
 *
 * @param {Record<string, string>} [envOverrides]
 */
export async function setupIntegration(envOverrides = {}) {
  const dbName = `cluvyra_it_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  await admin.end();

  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${dbName}`;

  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: url.toString(),
    JWT_SECRET: randomBytes(32).toString('hex'),
    DEBUG_OTP: '1',
    SMTP_HOST: '',
    AI_ENABLED: 'true',
    AI_PROVIDER: 'anthropic',
    ANTHROPIC_API_KEY: '',
    AI_REQUESTS_PER_MINUTE: '1000',
    AI_DAILY_REQUEST_LIMIT: '1000',
    JOBS_ENABLED: 'false',
    LOG_DIR: '',
    ...envOverrides,
  });

  const { runMigrations } = await import('../../server/migrate.js');
  await runMigrations({ log: () => {} });

  const db = await import('../../server/db.js');
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  async function teardown() {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    await db.closePool();
    const cleanup = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await cleanup.connect();
    await cleanup.query(`drop database if exists ${dbName} with (force)`);
    await cleanup.end();
  }

  return { baseUrl, query: db.query, teardown, dbName };
}

/** Small fetch wrapper returning { status, body }. */
export function makeApi(baseUrl) {
  return async function api(method, path, { token, body } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: response.status, body: parsed, headers: response.headers };
  };
}

let counter = 0;

/**
 * Inserts a user (+ client/trainer row) directly and returns a signed token.
 *
 * @param {Function} query
 * @param {{ role?: string, name?: string, twofa?: boolean }} [options]
 */
export async function createUser(query, { role = 'client', name, twofa = false } = {}) {
  counter += 1;
  const bcrypt = (await import('bcryptjs')).default;
  const email = `${role}${counter}.${randomBytes(3).toString('hex')}@test.local`;
  const password = 'Passw0rd!' + counter;
  const hash = await bcrypt.hash(password, 4);
  const { rows } = await query(
    `insert into users (name, email, password, role, twofa_enabled)
     values ($1, $2, $3, $4, $5)
     returning id, name, email, role, token_version`,
    [name || `Test ${role} ${counter}`, email, hash, role, twofa]
  );
  const user = rows[0];
  let clientId = null;
  let trainerId = null;
  if (role === 'client') {
    clientId = (await query('insert into clients (user_id) values ($1) returning id', [user.id])).rows[0].id;
  }
  if (role === 'trainer') {
    trainerId = (await query('insert into trainers (user_id, specialization) values ($1, $2) returning id', [user.id, 'Yoga'])).rows[0].id;
  }
  const { signToken } = await import('../../server/middleware/auth.js');
  return { ...user, password, clientId, trainerId, token: signToken(user) };
}

/** Creates a plan + active subscription for a client. */
export async function giveSubscription(query, clientId, {
  accessType = 'gym_group',
  planType = 'subscription',
  usageCount = null,
  endOffsetDays = 30,
  status = 'active',
} = {}) {
  counter += 1;
  const plan = (await query(
    `insert into subscription_plans (name, plan_type, access_type, duration_days, usage_count, price)
     values ($1, $2, $3, $4, $5, 500) returning id, name`,
    [`Plan ${counter}`, planType, accessType, planType === 'subscription' ? 30 : null, usageCount]
  )).rows[0];
  const sub = (await query(
    `insert into subscriptions (client_id, plan_id, type, start_date, end_date, status)
     values ($1, $2, $3, current_date + $4::int - 30, current_date + $4::int, $5) returning id`,
    [clientId, plan.id, plan.name, endOffsetDays, status]
  )).rows[0];
  return { planId: plan.id, subscriptionId: sub.id };
}

/**
 * Creates a workout and a schedule slot `dayOffset` days from today (local)
 * at `time`.
 */
export async function createClass(query, {
  name,
  capacity = 10,
  category = 'group',
  dayOffset = 1,
  time = '18:30',
  trainerId = null,
  status = 'active',
} = {}) {
  counter += 1;
  const workout = (await query(
    `insert into workouts (name, max_clients, category, status, duration_minutes)
     values ($1, $2, $3, $4, 60) returning id`,
    [name || `Class ${counter}`, capacity, category, status]
  )).rows[0];
  const schedule = (await query(
    `insert into schedules (workout_id, trainer_id, date, time)
     values ($1, $2, current_date + $3::int, $4::time) returning id, date`,
    [workout.id, trainerId, dayOffset, time]
  )).rows[0];
  return { workoutId: workout.id, scheduleId: schedule.id, date: schedule.date };
}
