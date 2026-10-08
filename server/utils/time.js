/**
 * Date/time helpers in the organisation's timezone (APP_TIMEZONE).
 *
 * Class times are stored as local wall-clock date + time. "Today",
 * "tomorrow" and "after 18:00" must therefore be computed in the club's
 * timezone, never from the server's UTC clock. Intl handles DST transitions.
 */

import { config } from '../config.js';

const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Local calendar parts of an instant in a timezone.
 *
 * @param {Date} [instant]
 * @param {string} [timeZone]
 * @returns {{ date: string, time: string, weekday: string }}
 */
export function zonedNow(instant = new Date(), timeZone = config.timezone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value])
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return { date, time: `${parts.hour}:${parts.minute}`, weekday: weekdayOf(date) };
}

/** Today's date (YYYY-MM-DD) in the organisation's timezone. */
export function todayInZone(instant = new Date(), timeZone = config.timezone) {
  return zonedNow(instant, timeZone).date;
}

/** Adds whole days to a YYYY-MM-DD date (pure calendar arithmetic). */
export function addDays(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const result = new Date(Date.UTC(y, m - 1, d + days));
  return result.toISOString().slice(0, 10);
}

/** English weekday name of a YYYY-MM-DD date. */
export function weekdayOf(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return WEEKDAYS_EN[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** Strict YYYY-MM-DD validation (real calendar date). */
export function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Strict HH:MM (24h) validation. */
export function isHhMm(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
