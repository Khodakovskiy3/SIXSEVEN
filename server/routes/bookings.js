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

import { query, withClient } from '../db.js';
import { authRequired, requireRole } from '../middleware/auth.js';
import { getClientIdByUserId } from '../utils/identity.js';
import {
  BOOKING_STATUS,
  HTTP_BAD_REQUEST,
  HTTP_CONFLICT,
  HTTP_CREATED,
  HTTP_FORBIDDEN,
  HTTP_NOT_FOUND,
  HTTP_SERVER_ERROR,
  PG_UNIQUE_VIOLATION,
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
    const result = await query(
      `select b.id, b.status, b.client_id, u.name as client_name,
              v.id as visit_id
       from bookings b
       join clients c on c.id = b.client_id
       join users u on u.id = c.user_id
       left join visits v on v.client_id = b.client_id and v.schedule_id = b.schedule_id
       where b.schedule_id = $1
       order by u.name asc`,
      [id]
    );
    return res.json(result.rows);
  }
);

router.post('/', requireRole(ROLE.CLIENT), async (req, res) => {
  const { schedule_id: scheduleId } = req.body || {};
  if (!scheduleId) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Missing schedule_id' });
  }

  const clientId = await getClientIdByUserId(req.user.id);
  if (!clientId) {
    return res.status(HTTP_NOT_FOUND).json({ error: 'Client not found' });
  }

  const today = new Date().toISOString().slice(0, 10);

  try {
    // Уся бізнес-логіка бронювання: перевірка абонемента, перевірка вільних місць,
    // створення запису — виконується в одній транзакції, щоб уникнути
    // race condition при одночасних запитах від різних клієнтів.
    const bookingResult = await withClient(async (client) => {
      await client.query('begin');

      // 1. Шукаємо активний абонемент клієнта, який ще не закінчився.
      const subscription = await client.query(
        `select id from subscriptions
         where client_id = $1
           and status = $2
           and end_date >= $3
         order by end_date desc
         limit 1`,
        [clientId, SUBSCRIPTION_STATUS.ACTIVE, today]
      );

      if (subscription.rows.length === 0) {
        await client.query('rollback');
        return { error: 'No active subscription' };
      }

      // 2. Перевіряємо, чи залишилися вільні місця у групі.
      const scheduleInfo = await client.query(
        `select s.id, w.max_clients,
                (select count(*) from bookings b
                 where b.schedule_id = s.id and b.status = $2) as booked
         from schedules s
         join workouts w on w.id = s.workout_id
         where s.id = $1`,
        [scheduleId, BOOKING_STATUS.ACTIVE]
      );

      if (scheduleInfo.rows.length === 0) {
        await client.query('rollback');
        return { error: 'Schedule not found' };
      }

      const { max_clients: maxClients, booked } = scheduleInfo.rows[0];
      if (Number(booked) >= Number(maxClients)) {
        await client.query('rollback');
        return { error: 'No available slots' };
      }

      // 3. Створюємо саме бронювання.
      const result = await client.query(
        `insert into bookings (client_id, schedule_id)
         values ($1, $2)
         returning id, client_id, schedule_id, status`,
        [clientId, scheduleId]
      );

      await client.query('commit');
      return { booking: result.rows[0] };
    });

    if (bookingResult.error) {
      return res.status(HTTP_CONFLICT).json({ error: bookingResult.error });
    }

    return res.status(HTTP_CREATED).json(bookingResult.booking);
  } catch (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return res.status(HTTP_CONFLICT).json({ error: 'Already booked' });
    }
    return res.status(HTTP_SERVER_ERROR).json({ error: 'Booking failed' });
  }
});

router.delete('/:id', authRequired, async (req, res) => {
  const { id } = req.params;

  // Клієнт може скасовувати лише власні бронювання,
  // тому обмежуємо умовою client_id = свій.
  if (req.user.role === ROLE.CLIENT) {
    const clientId = await getClientIdByUserId(req.user.id);
    const result = await query(
      `delete from bookings
       where id = $1 and client_id = $2`,
      [id, clientId]
    );
    if (result.rowCount === 0) {
      return res.status(HTTP_NOT_FOUND).json({ error: 'Not found' });
    }
    return res.json({ ok: true });
  }

  if (![ROLE.ADMIN, ROLE.MANAGER].includes(req.user.role)) {
    return res.status(HTTP_FORBIDDEN).json({ error: 'Forbidden' });
  }

  await query('delete from bookings where id = $1', [id]);
  return res.json({ ok: true });
});

export default router;
