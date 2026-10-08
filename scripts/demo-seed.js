/**
 * Creates a synthetic demo organisation for Cluvyra (services, plans, trainers,
 * members, a 4-week schedule, bookings, payments and visits).
 *
 * Safety:
 *  • synthetic data only — invented initials-style names, @example.com emails;
 *  • passwords are random (printed ONCE to this terminal) or supplied by the
 *    owner via DEMO_ADMIN_PASSWORD / DEMO_MANAGER_PASSWORD /
 *    DEMO_TRAINER_PASSWORD / DEMO_CLIENT_PASSWORD;
 *  • production requires DEMO_MODE=true AND the --confirm flag;
 *  • refuses to run twice (app_meta marker) and refuses to mix demo data into
 *    a database that already has users, unless --allow-existing is passed;
 *  • --reset-passwords rotates only the demo accounts' passwords.
 *
 * Admin/manager sign-in requires an emailed 2FA code (mandatory for staff):
 * set DEMO_ADMIN_EMAIL / DEMO_MANAGER_EMAIL to real mailboxes and configure SMTP.
 *
 * Usage:
 *   npm run demo:seed -- --confirm
 *   npm run demo:seed -- --reset-passwords --confirm
 */

import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';

import { config } from '../server/config.js';
import { closePool, query, withTransaction } from '../server/db.js';
import { runMigrations } from '../server/migrate.js';
import { BCRYPT_SALT_ROUNDS } from '../server/utils/constants.js';

const MARKER_KEY = 'demo_seeded_at';
const args = new Set(process.argv.slice(2));

const ACCOUNTS = {
  admin: { name: 'Demo Admin', email: process.env.DEMO_ADMIN_EMAIL || 'admin@demo.example.com', env: 'DEMO_ADMIN_PASSWORD' },
  manager: { name: 'Demo Manager', email: process.env.DEMO_MANAGER_EMAIL || 'manager@demo.example.com', env: 'DEMO_MANAGER_PASSWORD' },
  trainer: { name: 'Iryna S. (demo)', email: process.env.DEMO_TRAINER_EMAIL || 'trainer@demo.example.com', env: 'DEMO_TRAINER_PASSWORD' },
  client: { name: 'Olena K. (demo)', email: process.env.DEMO_CLIENT_EMAIL || 'client@demo.example.com', env: 'DEMO_CLIENT_PASSWORD' },
};

const EXTRA_TRAINERS = [
  { name: 'Marko T. (demo)', email: 'marko.trainer@demo.example.com', specialization: 'HIIT, Functional Training, Personal Training' },
  { name: 'Sofia L. (demo)', email: 'sofia.trainer@demo.example.com', specialization: 'Pilates, Stretching' },
];
const MAIN_TRAINER_SPECIALIZATION = 'Yoga Flow, Stretching, Personal Training';

const EXTRA_CLIENTS = [
  'Andrii P.', 'Daria M.', 'Taras V.', 'Kateryna B.', 'Yurii H.', 'Natalia R.', 'Bohdan S.', 'Iva Z.',
].map((name, index) => ({ name: `${name} (demo)`, email: `member${index + 1}@demo.example.com` }));

const SERVICES = [
  { name: 'Yoga Flow', description: 'Dynamic vinyasa flow for mobility and balance.', capacity: 14, category: 'group', minutes: 60 },
  { name: 'HIIT', description: 'High-intensity interval training, 45 minutes.', capacity: 12, category: 'group', minutes: 45 },
  { name: 'Pilates', description: 'Core strength and posture on the mat.', capacity: 10, category: 'group', minutes: 55 },
  { name: 'Functional Training', description: 'Strength and conditioning in small groups.', capacity: 12, category: 'group', minutes: 60 },
  { name: 'Stretching', description: 'Gentle full-body stretching and recovery.', capacity: 16, category: 'group', minutes: 50 },
  { name: 'Personal Training', description: 'One-to-one session with a coach.', capacity: 1, category: 'personal', minutes: 60 },
];

const PLANS = [
  { name: 'Unlimited Monthly', description: 'Gym + all group classes for 30 days.', type: 'subscription', access: 'gym_group', days: 30, uses: null, price: 1500 },
  { name: 'Group Classes Monthly', description: 'All group classes for 30 days.', type: 'subscription', access: 'group', days: 30, uses: null, price: 1100 },
  { name: 'Gym Only Monthly', description: 'Gym floor access for 30 days.', type: 'subscription', access: 'gym', days: 30, uses: null, price: 800 },
  { name: 'Personal Pack (5)', description: 'Five personal training sessions.', type: 'single', access: 'personal', days: null, uses: 5, price: 2500 },
  { name: 'Drop-in Class', description: 'One group class.', type: 'single', access: 'group', days: null, uses: 1, price: 250 },
];

// [time, service, trainerIndex] — trainer 0 = main demo trainer.
const WEEKDAY_SLOTS = [
  ['07:30', 'Functional Training', 1],
  ['09:00', 'Pilates', 2],
  ['12:00', 'Stretching', 2],
  ['17:00', 'Personal Training', 0],
  ['18:30', 'Yoga Flow', 0],
  ['19:30', 'HIIT', 1],
];
const WEEKEND_SLOTS = [
  ['10:00', 'Yoga Flow', 0],
  ['11:30', 'Pilates', 2],
  ['13:00', 'Personal Training', 1],
];

/** Deterministic pseudo-random generator so the demo looks the same each time. */
function rng(seed) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function randomPassword() {
  return `${randomBytes(9).toString('base64url')}A1`;
}

function passwordFor(account) {
  return process.env[account.env] || randomPassword();
}

async function assertAllowed() {
  if (config.isProduction && !(config.demo.enabled && args.has('--confirm'))) {
    throw new Error('In production the demo seed requires DEMO_MODE=true and the --confirm flag.');
  }
}

async function resetPasswords() {
  const printed = [];
  for (const [role, account] of Object.entries(ACCOUNTS)) {
    const password = passwordFor(account);
    const hash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
    const result = await query(
      `update users set password = $1, token_version = token_version + 1
       where lower(email) = lower($2) and role = $3`,
      [hash, account.email, role]
    );
    if (result.rowCount > 0) {
      printed.push({ role, email: account.email, password: process.env[account.env] ? '(from env)' : password });
    }
  }
  return printed;
}

async function seed() {
  const marker = await query('select value from app_meta where key = $1', [MARKER_KEY]);
  if (marker.rows[0]) {
    throw new Error(`Demo data already exists (seeded at ${marker.rows[0].value}). Use --reset-passwords to rotate demo passwords.`);
  }
  const users = await query('select count(*)::int as n from users');
  if (users.rows[0].n > 0 && !args.has('--allow-existing')) {
    throw new Error('The database already contains users. Refusing to mix demo data into it (pass --allow-existing to override).');
  }

  const random = rng(42);
  const credentials = [];

  await withTransaction(async (db) => {
    await db.query(
      `insert into club_settings (id, name, address, phone, email, weekday_hours, weekend_hours)
       values (1, $1, 'Demo Street 1, Kyiv', '+380 00 000 0000', null, '07:00 - 22:00', '09:00 - 20:00')
       on conflict (id) do update set name = excluded.name, address = excluded.address,
         phone = excluded.phone`,
      [config.brand.organizationName]
    );

    // Migration 004 ships generic starter services; hide the unused ones so
    // the demo catalogue only shows the demo studio's services.
    await db.query(
      `update workouts w set status = 'inactive'
       where not exists (select 1 from schedules s where s.workout_id = w.id)`
    );

    const serviceIds = {};
    for (const service of SERVICES) {
      const { rows } = await db.query(
        `insert into workouts (name, description, max_clients, category, duration_minutes, status)
         values ($1, $2, $3, $4, $5, 'active') returning id`,
        [service.name, service.description, service.capacity, service.category, service.minutes]
      );
      serviceIds[service.name] = rows[0].id;
    }

    const planIds = {};
    for (const plan of PLANS) {
      const { rows } = await db.query(
        `insert into subscription_plans (name, description, plan_type, access_type, duration_days, usage_count, price, status)
         values ($1, $2, $3, $4, $5, $6, $7, 'active') returning id`,
        [plan.name, plan.description, plan.type, plan.access, plan.days, plan.uses, plan.price]
      );
      planIds[plan.name] = rows[0].id;
    }

    async function createUser(name, email, role, password) {
      const hash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
      const { rows } = await db.query(
        `insert into users (name, email, password, role, twofa_enabled)
         values ($1, lower($2), $3, $4, false) returning id`,
        [name, email, hash, role]
      );
      return rows[0].id;
    }

    // Login accounts
    for (const [role, account] of Object.entries(ACCOUNTS)) {
      const password = passwordFor(account);
      account.userId = await createUser(account.name, account.email, role, password);
      credentials.push({ role, email: account.email, password: process.env[account.env] ? '(from env)' : password });
    }

    const trainerIds = [];
    trainerIds.push((await db.query(
      'insert into trainers (user_id, specialization) values ($1, $2) returning id',
      [ACCOUNTS.trainer.userId, MAIN_TRAINER_SPECIALIZATION]
    )).rows[0].id);
    for (const trainer of EXTRA_TRAINERS) {
      const userId = await createUser(trainer.name, trainer.email, 'trainer', randomPassword());
      trainerIds.push((await db.query(
        'insert into trainers (user_id, specialization) values ($1, $2) returning id',
        [userId, trainer.specialization]
      )).rows[0].id);
    }

    const clientIds = [];
    clientIds.push((await db.query('insert into clients (user_id) values ($1) returning id', [ACCOUNTS.client.userId])).rows[0].id);
    for (const client of EXTRA_CLIENTS) {
      const userId = await createUser(client.name, client.email, 'client', randomPassword());
      clientIds.push((await db.query('insert into clients (user_id) values ($1) returning id', [userId])).rows[0].id);
    }

    // Memberships: the main demo client gets Unlimited Monthly.
    const planCycle = ['Unlimited Monthly', 'Group Classes Monthly', 'Unlimited Monthly', 'Gym Only Monthly', 'Personal Pack (5)'];
    for (const [index, clientId] of clientIds.entries()) {
      const planName = index === 0 ? 'Unlimited Monthly' : planCycle[index % planCycle.length];
      const plan = PLANS.find((p) => p.name === planName);
      const startOffset = -Math.floor(random() * 20) - 1;
      const sub = await db.query(
        `insert into subscriptions (client_id, plan_id, type, start_date, end_date, status)
         values ($1, $2, $3, current_date + $4::int, current_date + $4::int + $5::int, 'active') returning id`,
        [clientId, planIds[planName], planName, startOffset, plan.days || 60]
      );
      await db.query(
        `insert into payments (client_id, subscription_id, amount, date, status)
         values ($1, $2, $3, current_date + $4::int, 'completed')`,
        [clientId, sub.rows[0].id, plan.price, startOffset]
      );
    }

    // Schedule: 14 days back, 14 days ahead.
    const groupClients = clientIds.filter((_, index) => !['Gym Only Monthly', 'Personal Pack (5)'].includes(planCycle[index % planCycle.length]) || index === 0);
    for (let offset = -14; offset <= 14; offset += 1) {
      const dow = (await db.query('select extract(isodow from current_date + $1::int)::int as d', [offset])).rows[0].d;
      const slots = dow >= 6 ? WEEKEND_SLOTS : WEEKDAY_SLOTS;
      for (const [time, serviceName, trainerIndex] of slots) {
        const service = SERVICES.find((s) => s.name === serviceName);
        const { rows } = await db.query(
          `insert into schedules (workout_id, trainer_id, date, time)
           values ($1, $2, current_date + $3::int, $4::time) returning id`,
          [serviceIds[serviceName], trainerIds[trainerIndex], offset, time]
        );
        const scheduleId = rows[0].id;
        if (service.category === 'personal') continue;

        // Fill past classes well, future ones partially; tomorrow's evening
        // yoga is left with exactly one seat to demonstrate availability.
        const isTomorrowYoga = offset === 1 && serviceName === 'Yoga Flow';
        const target = isTomorrowYoga
          ? Math.min(service.capacity - 1, groupClients.length - 1)
          : Math.floor(random() * Math.min(service.capacity, groupClients.length) * (offset < 0 ? 0.9 : 0.5));
        // Never pre-book the main demo client into future classes.
        const pool = offset < 0 ? groupClients : groupClients.slice(1);
        for (const clientId of pool.slice(0, target)) {
          await db.query(
            `insert into bookings (client_id, schedule_id, status, created_at)
             values ($1, $2, 'active', now() - interval '1 day')`,
            [clientId, scheduleId]
          );
          if (offset < 0 && random() > 0.15) {
            await db.query(
              `insert into visits (client_id, schedule_id, visit_time)
               values ($1, $2, ((current_date + $3::int) + $4::time) at time zone $5)`,
              [clientId, scheduleId, offset, time, config.timezone]
            );
          }
        }
      }
    }

    await db.query(
      `insert into app_meta (key, value) values ($1, now()::text)
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [MARKER_KEY]
    );
  });

  return credentials;
}

function printCredentials(rows) {
  console.log('\nDemo accounts (shown once — store them in a password manager):');
  for (const row of rows) {
    console.log(`  ${row.role.padEnd(8)} ${row.email.padEnd(32)} ${row.password}`);
  }
  console.log('\nStaff (admin/manager) sign-in requires an emailed 2FA code — configure SMTP and real DEMO_*_EMAIL addresses.');
}

async function main() {
  await assertAllowed();
  await runMigrations({ log: () => {} });
  if (args.has('--reset-passwords')) {
    printCredentials(await resetPasswords());
    return;
  }
  printCredentials(await seed());
  console.log('\n✓ Demo organisation created.');
}

main()
  .catch((error) => {
    console.error(`✗ ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => closePool());
