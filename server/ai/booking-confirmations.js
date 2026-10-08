/**
 * Server-side confirmation of AI-prepared bookings.
 *
 * Why: the model may only *prepare* a booking. The booking is created only
 * when the signed-in user presses "Confirm" in the UI, which calls
 * POST /api/ai/bookings/confirm with a random token. The token
 *  • is never shown to the model (prompt injection cannot confirm anything);
 *  • is stored only as a SHA-256 hash;
 *  • is bound to one user, one client record and one schedule slot;
 *  • expires after AI_BOOKING_TOKEN_TTL_MIN minutes;
 *  • is single-use: the status flips from 'pending' atomically, so a replayed
 *    or double-clicked confirmation cannot create a second booking.
 * Every booking rule is re-checked at confirmation time by booking-service.
 */

import { createHash, randomBytes } from 'node:crypto';

import { query, withTransaction } from '../db.js';
import { config } from '../config.js';
import { checkBookingEligibility, createBooking } from '../services/booking-service.js';

export const CONFIRMATION_STATUS = Object.freeze({
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  DECLINED: 'declined',
  EXPIRED: 'expired',
  FAILED: 'failed',
});

export class ConfirmationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ConfirmationError';
    this.code = code;
  }
}

function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

/** Basic shape check before touching the database. */
export function isWellFormedToken(token) {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{32,64}$/.test(token);
}

/**
 * Validates eligibility and creates a pending confirmation.
 *
 * @param {{ userId: number, clientId: number, scheduleId: number }} params
 * @returns {Promise<{ ok: true, token: string, expiresAt: string, slot: object, subscription: object } | { ok: false, code: string, message: string }>}
 */
export async function prepareBookingConfirmation({ userId, clientId, scheduleId }) {
  const eligibility = await checkBookingEligibility({ clientId, scheduleId });
  if (!eligibility.ok) {
    return eligibility;
  }

  const token = randomBytes(24).toString('base64url');
  const ttlMinutes = config.ai.bookingTokenTtlMin;

  const inserted = await withTransaction(async (client) => {
    // One live proposal per user: older pending ones are superseded.
    await client.query(
      `update ai_booking_confirmations
       set status = $2, resolved_at = now()
       where user_id = $1 and status = $3`,
      [userId, CONFIRMATION_STATUS.EXPIRED, CONFIRMATION_STATUS.PENDING]
    );
    const result = await client.query(
      `insert into ai_booking_confirmations (token_hash, user_id, client_id, schedule_id, expires_at)
       values ($1, $2, $3, $4, now() + make_interval(mins => $5))
       returning expires_at`,
      [hashToken(token), userId, clientId, scheduleId, ttlMinutes]
    );
    return result.rows[0];
  });

  return {
    ok: true,
    token,
    expiresAt: new Date(inserted.expires_at).toISOString(),
    slot: eligibility.slot,
    subscription: eligibility.subscription,
  };
}

/**
 * Confirms a pending booking for the authenticated user.
 *
 * @param {{ userId: number, token: string }} params
 * @returns {Promise<{ booking: object, slot: object }>}
 * @throws {ConfirmationError|import('../services/booking-service.js').BookingError}
 */
export async function confirmBooking({ userId, token }) {
  if (!isWellFormedToken(token)) {
    throw new ConfirmationError('INVALID_TOKEN', 'Підтвердження недійсне');
  }
  const tokenHash = hashToken(token);

  // Atomically claim the confirmation: only one concurrent request can move
  // it out of 'pending'. Ownership and expiry are part of the same predicate.
  const claimed = await query(
    `update ai_booking_confirmations
     set status = $3, resolved_at = now()
     where token_hash = $1 and user_id = $2 and status = $4 and expires_at > now()
     returning id, client_id, schedule_id`,
    [tokenHash, userId, CONFIRMATION_STATUS.CONFIRMED, CONFIRMATION_STATUS.PENDING]
  );

  if (claimed.rows.length === 0) {
    const existing = await query(
      'select status, (expires_at <= now()) as is_expired from ai_booking_confirmations where token_hash = $1 and user_id = $2',
      [tokenHash, userId]
    );
    const row = existing.rows[0];
    if (!row) {
      throw new ConfirmationError('INVALID_TOKEN', 'Підтвердження недійсне');
    }
    if (row.status === CONFIRMATION_STATUS.CONFIRMED) {
      throw new ConfirmationError('ALREADY_CONFIRMED', 'Це бронювання вже підтверджено');
    }
    if (row.status === CONFIRMATION_STATUS.PENDING && row.is_expired) {
      await query(
        'update ai_booking_confirmations set status = $2, resolved_at = now() where token_hash = $1 and status = $3',
        [tokenHash, CONFIRMATION_STATUS.EXPIRED, CONFIRMATION_STATUS.PENDING]
      );
    }
    throw new ConfirmationError('EXPIRED', 'Час на підтвердження минув. Попросіть асистента запропонувати слот ще раз.');
  }

  const { id: confirmationId, client_id: clientId, schedule_id: scheduleId } = claimed.rows[0];

  try {
    return await createBooking({
      clientId,
      scheduleId,
      beforeCommit: (client, booking) => client.query(
        'update ai_booking_confirmations set booking_id = $2 where id = $1',
        [confirmationId, booking.id]
      ),
    });
  } catch (error) {
    await query(
      'update ai_booking_confirmations set status = $2 where id = $1',
      [confirmationId, CONFIRMATION_STATUS.FAILED]
    ).catch(() => {});
    throw error;
  }
}

/**
 * Declines a pending proposal (user pressed "Cancel").
 *
 * @returns {Promise<boolean>} true if a pending proposal was declined.
 */
export async function declineBooking({ userId, token }) {
  if (!isWellFormedToken(token)) {
    return false;
  }
  const result = await query(
    `update ai_booking_confirmations
     set status = $3, resolved_at = now()
     where token_hash = $1 and user_id = $2 and status = $4`,
    [hashToken(token), userId, CONFIRMATION_STATUS.DECLINED, CONFIRMATION_STATUS.PENDING]
  );
  return result.rowCount > 0;
}
