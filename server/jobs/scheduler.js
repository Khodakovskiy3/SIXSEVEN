/**
 * In-process scheduler for periodic background jobs.
 *
 * Every tick runs under a PostgreSQL session advisory lock
 * (pg_try_advisory_lock), so if more than one application instance is running
 * only one of them executes a given job at a time; the others skip the tick.
 * The jobs themselves are idempotent (status updates, "once per day"
 * notifications), so a skipped or repeated tick does not duplicate effects.
 *
 * Set JOBS_ENABLED=false on extra replicas, or to move jobs to a separate
 * Railway cron service later.
 */

import { withClient } from '../db.js';
import { logError } from '../utils/logger.js';

const timers = new Set();

/** Stable 32-bit lock key derived from the job name. */
export function lockKeyFor(name) {
  let hash = 0;
  for (const char of `cluvyra-job:${name}`) {
    hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
  }
  return hash;
}

/**
 * Runs `fn` only if this process acquires the job lock.
 *
 * @param {string} name
 * @param {() => Promise<unknown>} fn
 * @returns {Promise<boolean>} true if the job ran.
 */
export async function runExclusive(name, fn) {
  const key = lockKeyFor(name);
  return withClient(async (client) => {
    const { rows } = await client.query('select pg_try_advisory_lock($1) as locked', [key]);
    if (!rows[0].locked) {
      return false;
    }
    try {
      await fn();
      return true;
    } finally {
      await client.query('select pg_advisory_unlock($1)', [key]).catch(() => {});
    }
  });
}

/**
 * Schedules a job: runs once immediately, then every `intervalMs`.
 *
 * @param {string} name
 * @param {number} intervalMs
 * @param {() => Promise<unknown>} fn
 */
export function scheduleJob(name, intervalMs, fn) {
  const tick = () => runExclusive(name, fn).catch((error) => logError(`Job ${name} failed`, error));
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  timers.add(timer);
}

/** Stops all scheduled jobs (graceful shutdown). */
export function stopAllJobs() {
  for (const timer of timers) {
    clearInterval(timer);
  }
  timers.clear();
}
