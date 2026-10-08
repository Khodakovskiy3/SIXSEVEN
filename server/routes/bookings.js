/**
 * Маршрути керування бронюваннями тренувань.
 *
 * GET    /api/bookings              — усі бронювання (admin, manager).
 * GET    /api/bookings/me           — бронювання поточного клієнта.
 * GET    /api/bookings/schedule/:id — список клієнтів конкретного заняття.
 * POST   /api/bookings              — створити бронювання (client).
 * DELETE /api/bookings/:id          — скасувати бронювання.
 */

import { Router } from 'express';

import { query } from '../db.js';
import { logError } from '../utils/logger.js';
import { authRequired, requireRole } from '../middleware/auth.js';
import { createBooking, BookingError, BOOKING_ERROR } from '../services/booking-service.js';
import { notifyClientBookingConfirmed, notifyTrainerIfClassFull } from '../services/booking-notifications.js';
import { getClientIdByUserId } from '../utils/identity.js';
import { notifyUsers } from '../utils/notify.js';
import {
  BOOKING_STATUS,
  CLUB_TIMEZONE,
  HTTP_BAD_REQUEST,
  HTTP_CONFLICT,
  HTTP_CREATED,
  HTTP_FORBIDDEN,
  HTTP_NOT_FOUND,
  HTTP_SERVER_ERROR,
  ROLE,
  SUBSCRIPTION_STATUS,
} from '../utils/constants.js';

const router = Router();

router.use(authRequired);

router.get('/', requireRole(ROLE.ADMIN, ROLE.MANAGER), async (req, res) => {
  const result = await query(
    `select b.id, b.status, b.schedule_id, b.client_id,
            u.name as client_name, u.email as client_email,
            s.date, s.time, w.name as workout_name
     from bookings b
     join clients c on c.id = b.client_id
     join users u on u.id = c.user_id
     join schedules s on s.id = b.schedule_id
     join workouts w on w.id = s.workout_id
     order by s.date desc, s.time desc`
  );
  return res.json(result.rows);
});

router.get('/me', requireRole(ROLE.CLIENT), async (req, res) => {
  const clientId = await getClientIdByUserId(req.user.id);
  if (!clientId) {
    return res.status(HTTP_NOT_FOUND).json({ error: 'Client not found' });
  }

  const result = await query(
    `select b.id, b.status, b.schedule_id,
            s.date, s.time, w.name as workout_name,
            w.description as workout_description,
            w.duration_minutes,
            u.name as trainer_name
     from bookings b
     join schedules s on s.id = b.schedule_id
     join workouts w on w.id = s.workout_id
     left join trainers t on t.id = s.trainer_id
     left join users u on u.id = t.user_id
     where b.client_id = $1
     order by s.date desc, s.time desc`,
    [clientId]
  );
  return res.json(result.rows);
});

router.get(
  '/schedule/:id',
  requireRole(ROLE.ADMIN, ROLE.MANAGER, ROLE.TRAINER),
  async (req, res) => {
    const { id } = req.params;

    if (req.user.role === ROLE.TRAINER) {
      const access = await query(
        `select s.id
         from schedules s
         join trainers t on t.id = s.trainer_id
         where s.id = $1 and t.user_id = $2`,
        [id, req.user.id]
      );

      if (access.rows.length === 0) {
        return res.status(HTTP_FORBIDDEN).json({ error: 'Forbidden' });
      }
    }

    // «Присутній» не зберігається окремо: скасування бронювання видаляє рядок,
    // тож наявний запис = не скасований. Клієнт вважається присутнім, якщо час
    // початку заняття вже минув. Настінний час заняття інтерпретуємо в зоні клубу.
    const result = await query(
      `select b.id, b.status, b.client_id, u.name as client_name,
              ((s.date + s.time) at time zone $2 <= now()) as attended
       from bookings b
       join clients c on c.id = b.client_id
       join users u on u.id = c.user_id
       join schedules s on s.id = b.schedule_id
       where b.schedule_id = $1
       order by u.name asc`,
      [id, CLUB_TIMEZONE]
    );
    return res.json(result.rows);
  }
);

router.post('/', requireRole(ROLE.CLIENT), async (req, res) => {
  const scheduleId = Number(req.body?.schedule_id);
  if (!Number.isInteger(scheduleId) || scheduleId <= 0) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Missing schedule_id' });
  }

  const clientId = await getClientIdByUserId(req.user.id);
  if (!clientId) {
    return res.status(HTTP_NOT_FOUND).json({ error: 'Client not found' });
  }

  try {
    // Уся бізнес-логіка (абонемент, категорія, місткість, дата в часовому
    // поясі клубу) — у booking-service, у транзакції з блокуванням рядків
    // заняття й абонемента: паралельні запити на останнє місце серіалізуються.
    const { booking } = await createBooking({ clientId, scheduleId });

    notifyClientBookingConfirmed(req.user.id, scheduleId).catch(() => {});
    notifyTrainerIfClassFull(scheduleId).catch(() => {});

    return res.status(HTTP_CREATED).json(booking);
  } catch (error) {
    if (error instanceof BookingError) {
      const status = error.code === BOOKING_ERROR.SCHEDULE_NOT_FOUND ? HTTP_NOT_FOUND : HTTP_CONFLICT;
      return res.status(status).json({ error: error.message, code: error.code });
    }
    logError('Помилка створення бронювання', error, { userId: req.user?.id });
    return res.status(HTTP_SERVER_ERROR).json({ error: 'Booking failed' });
  }
});

/**
 * Якщо клієнт скасував запис, перевіряємо чи треба відновити разовий абонемент.
 * Абонемент повертається в 'active' якщо:
 *  - він ще в межах терміну дії (end_date >= сьогодні),
 *  - тип плану = 'single',
 *  - кількість активних бронювань після видачі абонемента стала < ліміту.
 */
async function restoreSingleSubscriptionIfNeeded(clientId) {
  const subs = await query(
    `select sub.id, sub.created_at, sp.usage_count
     from subscriptions sub
     join subscription_plans sp on sp.id = sub.plan_id
     where sub.client_id = $1
       and sub.status = $2
       and sub.end_date >= current_date
       and sp.plan_type = 'single'
       and sp.usage_count is not null
     order by sub.created_at desc
     limit 1`,
    [clientId, SUBSCRIPTION_STATUS.EXPIRED]
  );
  if (subs.rows.length === 0) return;

  const sub = subs.rows[0];
  const usedResult = await query(
    `select count(*) as used
     from bookings b
     where b.client_id = $1 and b.status = $2 and b.created_at >= $3`,
    [clientId, BOOKING_STATUS.ACTIVE, sub.created_at]
  );
  if (Number(usedResult.rows[0].used) < Number(sub.usage_count)) {
    await query(
      `update subscriptions set status = $1 where id = $2`,
      [SUBSCRIPTION_STATUS.ACTIVE, sub.id]
    );
  }
}

router.delete('/:id', authRequired, async (req, res) => {
  const { id } = req.params;

  // Клієнт може скасовувати лише власні бронювання, тому обмежуємо умовою
  // client_id = свій. Скасування переводить статус у 'cancelled' замість
  // фізичного видалення — зберігає історію (хто записувався й скасовував)
  // і не заважає повторному запису: частковий унікальний індекс
  // bookings_active_unique діє лише на status='active'.
  if (req.user.role === ROLE.CLIENT) {
    const clientId = await getClientIdByUserId(req.user.id);
    const result = await query(
      `update bookings
       set status = $1, cancelled_at = now()
       where id = $2 and client_id = $3 and status = $4`,
      [BOOKING_STATUS.CANCELLED, id, clientId, BOOKING_STATUS.ACTIVE]
    );
    if (result.rowCount === 0) {
      return res.status(HTTP_NOT_FOUND).json({ error: 'Not found' });
    }
    restoreSingleSubscriptionIfNeeded(clientId).catch(() => {});
    return res.json({ ok: true });
  }

  if (![ROLE.ADMIN, ROLE.MANAGER].includes(req.user.role)) {
    return res.status(HTTP_FORBIDDEN).json({ error: 'Forbidden' });
  }

  const bookingInfo = await query(
    `select b.client_id, u.id as client_user_id, w.name as workout_name, s.id as schedule_id, s.date, s.time
     from bookings b
     join clients c on c.id = b.client_id
     join users u on u.id = c.user_id
     join schedules s on s.id = b.schedule_id
     join workouts w on w.id = s.workout_id
     where b.id = $1`,
    [id]
  );

  await query('delete from bookings where id = $1', [id]);

  if (bookingInfo.rows[0]?.client_id) {
    restoreSingleSubscriptionIfNeeded(bookingInfo.rows[0].client_id).catch(() => {});
  }

  if (bookingInfo.rows.length) {
    const {
      client_user_id: clientUserId,
      workout_name: workoutName,
      date,
      time,
    } = bookingInfo.rows[0];
    const slot = `${new Date(date).toLocaleDateString('uk-UA')} о ${String(time).slice(0, 5)}`;
    notifyUsers(
      [clientUserId],
      `Запис скасовано`,
      `Ваш запис на «${workoutName}» ${slot} скасовано адміністратором.`,
      { category: 'training', link: `/pages/client/schedule.html?schedule=${bookingInfo.rows[0].schedule_id || ''}` }
    ).catch(() => {});
  }

  return res.json({ ok: true });
});

export default router;
