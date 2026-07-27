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
import { logError } from '../utils/logger.js';
import { authRequired, requireRole } from '../middleware/auth.js';
import {
  hasAvailableSlot,
  isBookingAllowedForAccessType,
  bookingDeniedMessage,
} from '../utils/booking-logic.js';
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

async function notifyClientBookingConfirmed(userId, scheduleId) {
  const result = await query(
    `select w.name as workout_name, s.date, s.time
     from schedules s
     join workouts w on w.id = s.workout_id
     where s.id = $1`,
    [scheduleId]
  );
  if (!result.rows.length) {
    return;
  }
  const { workout_name: workoutName, date, time } = result.rows[0];
  const slot = `${new Date(date).toLocaleDateString('uk-UA')} о ${String(time).slice(0, 5)}`;
  await notifyUsers(
    [userId],
    `Запис підтверджено`,
    `Ви записані на «${workoutName}» ${slot}.`,
    { category: 'training', link: `/pages/client/schedule.html?schedule=${scheduleId}` }
  );
}

async function notifyTrainerIfClassFull(scheduleId) {
  const result = await query(
    `select u.id as user_id, w.name as workout_name, s.date, s.time,
            w.max_clients,
            (select count(*) from bookings b
             where b.schedule_id = s.id and b.status = 'active') as booked
     from schedules s
     join workouts w on w.id = s.workout_id
     join trainers t on t.id = s.trainer_id
     join users u on u.id = t.user_id
     where s.id = $1`,
    [scheduleId]
  );
  if (!result.rows.length) {
    return;
  }
  const {
    user_id: trainerUserId,
    workout_name: workoutName,
    date,
    time,
    max_clients: maxClients,
    booked,
  } = result.rows[0];
  if (Number(booked) >= Number(maxClients)) {
    const slot = `${new Date(date).toLocaleDateString('uk-UA')} о ${String(time).slice(0, 5)}`;
    await notifyUsers(
      [trainerUserId],
      `Заняття «${workoutName}» заповнено`,
      `Усі місця на ${slot} зайняті.`,
      { category: 'training', link: `/pages/trainer/schedule.html?schedule=${scheduleId}` }
    );
  }
}

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

      // 1. Шукаємо активний абонемент клієнта, який ще не закінчився,
      // разом з access_type його тарифного плану (визначає, на які
      // заняття він дозволяє записуватися — див. isBookingAllowedForAccessType).
      const subscription = await client.query(
        `select s.id, s.created_at, sp.access_type, sp.plan_type, sp.usage_count
         from subscriptions s
         left join subscription_plans sp on sp.id = s.plan_id
         where s.client_id = $1
           and s.status = $2
           and s.end_date >= $3
         order by s.end_date desc
         limit 1`,
        [clientId, SUBSCRIPTION_STATUS.ACTIVE, today]
      );

      if (subscription.rows.length === 0) {
        await client.query('rollback');
        return { error: 'Немає активного абонемента. Зверніться до адміністратора.' };
      }

      const {
        id: subscriptionId,
        created_at: subscriptionCreatedAt,
        access_type: accessType,
        plan_type: planType,
        usage_count: usageCount,
      } = subscription.rows[0];

      // Для разових абонементів перевіряємо ліміт використань.
      // Рахуємо лише активні бронювання, зроблені після видачі цього абонемента
      // (b.created_at >= sub.created_at), щоб бронювання з попередніх абонементів
      // не впливали на ліміт нового.
      if (planType === 'single' && usageCount != null) {
        const usedResult = await client.query(
          `select count(*) as used
           from bookings b
           where b.client_id = $1 and b.status = $2 and b.created_at >= $3`,
          [clientId, BOOKING_STATUS.ACTIVE, subscriptionCreatedAt]
        );
        const used = Number(usedResult.rows[0].used);
        if (used >= Number(usageCount)) {
          await client.query('rollback');
          return { error: 'Разовий абонемент вичерпано. Зверніться до адміністратора для оформлення нового.' };
        }
      }

      // 2. Перевіряємо, чи залишилися вільні місця у групі, і категорію заняття.
      const scheduleInfo = await client.query(
        `select s.id, w.max_clients, w.category,
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

      const { max_clients: maxClients, booked, category } = scheduleInfo.rows[0];

      // 3. Абонемент повинен відповідати категорії заняття (group/personal).
      if (!isBookingAllowedForAccessType(accessType, category)) {
        await client.query('rollback');
        return { error: bookingDeniedMessage(accessType, category) };
      }

      if (!hasAvailableSlot(booked, maxClients)) {
        await client.query('rollback');
        return { error: 'No available slots' };
      }

      // 4. Створюємо саме бронювання.
      const result = await client.query(
        `insert into bookings (client_id, schedule_id)
         values ($1, $2)
         returning id, client_id, schedule_id, status`,
        [clientId, scheduleId]
      );

      // Після успішного бронювання: якщо разовий абонемент вичерпав ліміт —
      // одразу переводимо його в 'expired', щоб клієнт не міг записатися ще раз.
      if (planType === 'single' && usageCount != null) {
        const usedAfter = await client.query(
          `select count(*) as used
           from bookings b
           where b.client_id = $1 and b.status = $2 and b.created_at >= $3`,
          [clientId, BOOKING_STATUS.ACTIVE, subscriptionCreatedAt]
        );
        if (Number(usedAfter.rows[0].used) >= Number(usageCount)) {
          await client.query(
            `update subscriptions set status = $1 where id = $2`,
            [SUBSCRIPTION_STATUS.EXPIRED, subscriptionId]
          );
        }
      }

      await client.query('commit');
      return { booking: result.rows[0] };
    });

    if (bookingResult.error) {
      return res.status(HTTP_CONFLICT).json({ error: bookingResult.error });
    }

    notifyClientBookingConfirmed(req.user.id, scheduleId).catch(() => {});
    notifyTrainerIfClassFull(scheduleId).catch(() => {});

    return res.status(HTTP_CREATED).json(bookingResult.booking);
  } catch (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return res.status(HTTP_CONFLICT).json({ error: 'Already booked' });
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
