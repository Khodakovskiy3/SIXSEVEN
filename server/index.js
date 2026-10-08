/**
 * Точка входу серверної частини Cluvyra.
 *
 * Порядок запуску:
 *  1. перевірка конфігурації (у production небезпечна конфігурація = відмова);
 *  2. міграції БД (або перевірка, що їх уже застосувала pre-deploy команда);
 *  3. HTTP-сервер на PORT (Railway передає PORT автоматично);
 *  4. фонові задачі під advisory lock;
 *  5. коректне завершення за SIGTERM/SIGINT (редеплой Railway).
 */

import { config, validateConfig } from './config.js';
import { closePool } from './db.js';
import { createApp, notifyManagers } from './app.js';
import { runMigrations, verifyMigrationsApplied } from './migrate.js';
import { logError } from './utils/logger.js';
import { scheduleJob, stopAllJobs } from './jobs/scheduler.js';
import { runSubscriptionReminders } from './utils/subscription-reminders.js';
import { runTrainingHourReminders } from './utils/training-reminders.js';
import { activatePlannedMessages } from './routes/messages.js';

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const SHUTDOWN_TIMEOUT_MS = 10_000;

process.on('unhandledRejection', (reason) => {
  logError('Необроблений reject промісу', reason);
});

// Після uncaughtException стан процесу невизначений: логуємо й завершуємось,
// платформа (Railway / Docker restart policy) підніме чистий процес.
process.on('uncaughtException', (error) => {
  logError('Необроблений виняток — завершення процесу', error);
  notifyManagers('⚠️ Критичний виняток сервера', String(error?.message || error))
    .catch(() => {})
    .finally(() => process.exit(1));
  setTimeout(() => process.exit(1), 3000).unref();
});

function startJobs() {
  if (!config.server.jobsEnabled) {
    console.log('Фонові задачі вимкнено (JOBS_ENABLED=false)');
    return;
  }
  // Нагадування про абонементи ідемпотентні в межах доби, тож щогодинний
  // запуск не дублює сповіщень і переживає рестарти.
  scheduleJob('subscription-reminders', MS_PER_HOUR, runSubscriptionReminders);
  scheduleJob('planned-messages', MS_PER_MINUTE, activatePlannedMessages);
  scheduleJob('training-hour-reminders', 5 * MS_PER_MINUTE, runTrainingHourReminders);
}

async function main() {
  validateConfig();

  if (config.server.runMigrationsOnStart) {
    await runMigrations();
  } else {
    await verifyMigrationsApplied();
  }

  const app = createApp();
  const server = config.server.host
    ? app.listen(config.server.port, config.server.host)
    : app.listen(config.server.port);

  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  console.log(`${config.brand.productName} server listening on port ${config.server.port} (${config.env})`);

  startJobs();

  let isShuttingDown = false;
  const shutdown = (signal) => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;
    console.log(`${signal} отримано — завершуємо роботу`);
    stopAllJobs();
    setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
    server.close(() => {
      closePool().finally(() => process.exit(0));
    });
    // SSE-з'єднання (чат) тримаються довго — закриваємо їх примусово.
    server.closeIdleConnections?.();
    setTimeout(() => server.closeAllConnections?.(), 2000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  logError('Не вдалося запустити сервер', error);
  closePool().finally(() => process.exit(1));
});
