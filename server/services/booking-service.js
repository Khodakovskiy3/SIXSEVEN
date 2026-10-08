/**
 * Booking domain service — the single place where a client booking is
 * validated and created. Used by the REST API (POST /api/bookings) and by the
 * AI booking assistant, so both paths enforce exactly the same rules:
 *
 *  • the class exists, its service is active, it starts in the future
 *    (wall-clock time interpreted in the organisation's timezone, DST-safe in
 *    PostgreSQL) and within the booking horizon;
 *  • the client has an active subscription that is still valid on the class
 *    date, whose access type allows the class category;
 *  • single-visit passes are not exhausted;
 *  • the client is not already booked;
 *  • the class is not full.
 *
 * Concurrency: createBooking() locks the schedule row and the subscription row
 * (SELECT … FOR UPDATE) inside one transaction, so two clients racing for the
 * last seat — or one client spending the last visit of a single pass twice —
 * are serialised and the second one sees the updated counts.
 */

import { query, withTransaction } from '../db.js';
import { config } from '../config.js';
import {
  hasAvailableSlot,
  isBookingAllowedForAccessType,
  bookingDeniedMessage,
} from '../utils/booking-logic.js';
import {
  BOOKING_STATUS,
  PG_UNIQUE_VIOLATION,
  SUBSCRIPTION_STATUS,
} from '../utils/constants.js';

export const BOOKING_ERROR = Object.freeze({
  SCHEDULE_NOT_FOUND: 'SCHEDULE_NOT_FOUND',
  CLASS_INACTIVE: 'CLASS_INACTIVE',
  CLASS_STARTED: 'CLASS_STARTED',
  BEYOND_HORIZON: 'BEYOND_HORIZON',
  NO_SUBSCRIPTION: 'NO_SUBSCRIPTION',
  SUBSCRIPTION_ENDS_BEFORE_CLASS: 'SUBSCRIPTION_ENDS_BEFORE_CLASS',
  SINGLE_PASS_EXHAUSTED: 'SINGLE_PASS_EXHAUSTED',
  ACCESS_DENIED: 'ACCESS_DENIED',
  CLASS_FULL: 'CLASS_FULL',
  ALREADY_BOOKED: 'ALREADY_BOOKED',
});

const MESSAGES = {
  [BOOKING_ERROR.SCHEDULE_NOT_FOUND]: 'Заняття не знайдено',
  [BOOKING_ERROR.CLASS_INACTIVE]: 'Ця послуга зараз недоступна для запису',
  [BOOKING_ERROR.CLASS_STARTED]: 'Заняття вже розпочалося або минуло',
  [BOOKING_ERROR.BEYOND_HORIZON]: 'Запис на таку далеку дату ще не відкрито',
  [BOOKING_ERROR.NO_SUBSCRIPTION]: 'Немає активного абонемента. Зверніться до адміністратора.',
  [BOOKING_ERROR.SUBSCRIPTION_ENDS_BEFORE_CLASS]: 'Ваш абонемент закінчується раніше за дату заняття',
  [BOOKING_ERROR.SINGLE_PASS_EXHAUSTED]: 'Разовий абонемент вичерпано. Зверніться до адміністратора для оформлення нового.',
  [BOOKING_ERROR.CLASS_FULL]: 'На це заняття вже немає вільних місць',
  [BOOKING_ERROR.ALREADY_BOOKED]: 'Ви вже записані на це заняття',
};

export class BookingError extends Error {
  /**
   * @param {string} code — BOOKING_ERROR.*
   * @param {string} [message]
   */
  constructor(code, message) {
    super(message || MESSAGES[code] || 'Бронювання неможливе');
    this.name = 'BookingError';
    this.code = code;
  }
}

/**
 * Loads a schedule with everything needed for the booking decision.
 *
 * @param {import('pg').PoolClient|{query: Function}} db
 * @param {number} scheduleId
 * @param {boolean} lock — take a row lock on the schedule (inside a transaction).
 */
async function loadSchedule(db, scheduleId, lock) {
  const result = await db.query(
    `select s.id, s.date, to_char(s.time, 'HH24:MI') as time,
            w.id as workout_id, w.name as workout_name, w.category, w.status as workout_status,
            w.max_clients, w.duration_minutes,
            u.name as trainer_name,
            ((s.date + s.time) at time zone $2) > now() as is_future,
            s.date <= ((now() at time zone $2)::date + $3::int) as within_horizon
     from schedules s
     join workouts w on w.id = s.workout_id
     left join trainers t on t.id = s.trainer_id
     left join users u on u.id = t.user_id
     where s.id = $1
     ${lock ? 'for update of s' : ''}`,
    [scheduleId, config.timezone, config.ai.bookingHorizonDays]
  );
  return result.rows[0] || null;
}

async function loadSubscription(db, clientId, lock) {
  const result = await db.query(
    `select s.id, s.created_at, s.end_date, sp.access_type, sp.plan_type, sp.usage_count,
            coalesce(sp.name, s.type) as plan_name
     from subscriptions s
     left join subscription_plans sp on sp.id = s.plan_id
     where s.client_id = $1
       and s.status = $2
       and s.end_date >= (now() at time zone $3)::date
     order by s.end_date desc
     limit 1
     ${lock ? 'for update of s' : ''}`,
    [clientId, SUBSCRIPTION_STATUS.ACTIVE, config.timezone]
  );
  return result.rows[0] || null;
}

async function countSingleUsage(db, clientId, since) {
  const result = await db.query(
    `select count(*)::int as used
     from bookings
     where client_id = $1 and status = $2 and created_at >= $3`,
    [clientId, BOOKING_STATUS.ACTIVE, since]
  );
  return result.rows[0].used;
}

/**
 * Runs every booking rule. Throws BookingError on the first violation.
 *
 * @returns {Promise<{ schedule: object, subscription: object, booked: number }>}
 */
async function evaluate(db, { clientId, scheduleId, lock }) {
  const schedule = await loadSchedule(db, scheduleId, lock);
  if (!schedule) {
    throw new BookingError(BOOKING_ERROR.SCHEDULE_NOT_FOUND);
  }
  if (schedule.workout_status !== 'active') {
    throw new BookingError(BOOKING_ERROR.CLASS_INACTIVE);
  }
  if (!schedule.is_future) {
    throw new BookingError(BOOKING_ERROR.CLASS_STARTED);
  }
  if (!schedule.within_horizon) {
    throw new BookingError(BOOKING_ERROR.BEYOND_HORIZON);
  }

  const existing = await db.query(
    'select 1 from bookings where client_id = $1 and schedule_id = $2 and status = $3',
    [clientId, scheduleId, BOOKING_STATUS.ACTIVE]
  );
  if (existing.rows.length > 0) {
    throw new BookingError(BOOKING_ERROR.ALREADY_BOOKED);
  }

  const subscription = await loadSubscription(db, clientId, lock);
  if (!subscription) {
    throw new BookingError(BOOKING_ERROR.NO_SUBSCRIPTION);
  }
  if (String(subscription.end_date) < String(schedule.date)) {
    throw new BookingError(BOOKING_ERROR.SUBSCRIPTION_ENDS_BEFORE_CLASS);
  }

  if (subscription.plan_type === 'single' && subscription.usage_count != null) {
    const used = await countSingleUsage(db, clientId, subscription.created_at);
    if (used >= Number(subscription.usage_count)) {
      throw new BookingError(BOOKING_ERROR.SINGLE_PASS_EXHAUSTED);
    }
  }

  if (!isBookingAllowedForAccessType(subscription.access_type, schedule.category)) {
    throw new BookingError(
      BOOKING_ERROR.ACCESS_DENIED,
      bookingDeniedMessage(subscription.access_type, schedule.category)
    );
  }

  const bookedResult = await db.query(
    'select count(*)::int as booked from bookings where schedule_id = $1 and status = $2',
    [scheduleId, BOOKING_STATUS.ACTIVE]
  );
  const { booked } = bookedResult.rows[0];
  if (!hasAvailableSlot(booked, schedule.max_clients)) {
    throw new BookingError(BOOKING_ERROR.CLASS_FULL);
  }

  return { schedule, subscription, booked };
}

/** Public, client-safe view of a schedule slot. */
export function describeSlot(schedule, booked) {
  return {
    schedule_id: schedule.id,
    workout: schedule.workout_name,
    category: schedule.category,
    date: schedule.date,
    time: schedule.time,
    duration_minutes: schedule.duration_minutes,
    trainer: schedule.trainer_name || null,
    capacity: Number(schedule.max_clients),
    spots_left: Math.max(0, Number(schedule.max_clients) - Number(booked)),
  };
}

/**
 * Read-only eligibility check (no locks, no writes). Used to prepare an AI
 * booking before asking the user to confirm.
 *
 * @param {{ clientId: number, scheduleId: number }} params
 * @returns {Promise<{ ok: true, slot: object, subscription: object } | { ok: false, code: string, message: string }>}
 */
export async function checkBookingEligibility({ clientId, scheduleId }) {
  try {
    const { schedule, subscription, booked } = await evaluate({ query }, { clientId, scheduleId, lock: false });
    return {
      ok: true,
      slot: describeSlot(schedule, booked),
      subscription: { plan_name: subscription.plan_name, end_date: subscription.end_date },
    };
  } catch (error) {
    if (error instanceof BookingError) {
      return { ok: false, code: error.code, message: error.message };
    }
    throw error;
  }
}

/**
 * Creates a booking atomically. Throws BookingError when a rule is violated.
 *
 * @param {{ clientId: number, scheduleId: number, beforeCommit?: (client: import('pg').PoolClient, booking: object) => Promise<void> }} params
 * @returns {Promise<{ booking: object, slot: object }>}
 */
export async function createBooking({ clientId, scheduleId, beforeCommit }) {
  try {
    return await withTransaction(async (client) => {
      const { schedule, subscription, booked } = await evaluate(client, {
        clientId,
        scheduleId,
        lock: true,
      });

      const inserted = await client.query(
        `insert into bookings (client_id, schedule_id)
         values ($1, $2)
         returning id, client_id, schedule_id, status, created_at`,
        [clientId, scheduleId]
      );
      const booking = inserted.rows[0];

      // Single-visit pass used up → expire it right away so the client
      // cannot book again on the same pass.
      if (subscription.plan_type === 'single' && subscription.usage_count != null) {
        const used = await countSingleUsage(client, clientId, subscription.created_at);
        if (used >= Number(subscription.usage_count)) {
          await client.query('update subscriptions set status = $1 where id = $2', [
            SUBSCRIPTION_STATUS.EXPIRED,
            subscription.id,
          ]);
        }
      }

      if (beforeCommit) {
        await beforeCommit(client, booking);
      }

      return { booking, slot: describeSlot(schedule, Number(booked) + 1) };
    });
  } catch (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      throw new BookingError(BOOKING_ERROR.ALREADY_BOOKED);
    }
    throw error;
  }
}
