/**
 * Маршрути звітності.
 *
 * Усі звіти доступні лише для admin та manager. Якщо період не заданий,
 * використовується умовний діапазон від REPORT_MIN_DATE до REPORT_MAX_DATE.
 *
 * GET /api/reports/summary    — зведена статистика клубу.
 * GET /api/reports/attendance — відвідуваність за заняттями.
 * GET /api/reports/staff      — кількість занять за тренерами.
 */

import { Router } from 'express';

import { query } from '../db.js';
import { authRequired, requireRole } from '../middleware/auth.js';
import {
  BOOKING_STATUS,
  REPORT_MAX_DATE,
  REPORT_MIN_DATE,
  ROLE,
  SUBSCRIPTION_STATUS,
} from '../utils/constants.js';

const router = Router();

router.use(authRequired);
router.use(requireRole(ROLE.ADMIN, ROLE.MANAGER));

/**
 * Розбирає діапазон дат із query-параметрів, підставляючи значення за замовчуванням.
 *
 * @param {object} query — req.query.
 * @returns {{ startDate: string, endDate: string }}
 */
function parseDateRange(query) {
  const { start, end } = query;
  return {
    startDate: start || REPORT_MIN_DATE,
    endDate: end || REPORT_MAX_DATE,
  };
}

router.get('/summary', async (req, res) => {
  const { startDate, endDate } = parseDateRange(req.query);

  // Чотири незалежні агрегати; виконуємо їх послідовно,
  // оскільки PG-пул і так обмежений, а кеш ОС зробить це швидко.
  const totalClients = await query('select count(*) as count from clients');
  const activeSubs = await query(
    `select count(*) as count from subscriptions
     where status = $1 and end_date >= CURRENT_DATE`,
    [SUBSCRIPTION_STATUS.ACTIVE]
  );
  const totalVisits = await query(
    `select count(*) as count from visits
     where visit_time::date between $1 and $2`,
    [startDate, endDate]
  );
  const totalRevenue = await query(
    `select coalesce(sum(amount), 0) as total from payments
     where date between $1 and $2`,
    [startDate, endDate]
  );

  return res.json({
    total_clients: Number(totalClients.rows[0].count || 0),
    active_subscriptions: Number(activeSubs.rows[0].count || 0),
    visits: Number(totalVisits.rows[0].count || 0),
    revenue: Number(totalRevenue.rows[0].total || 0),
  });
});

router.get('/attendance', async (req, res) => {
  const { startDate, endDate } = parseDateRange(req.query);

  const result = await query(
    `select w.name as workout_name, s.date,
            count(b.id) as attendees,
            w.max_clients
     from schedules s
     join workouts w on w.id = s.workout_id
     left join bookings b on b.schedule_id = s.id and b.status = $3
     where s.date between $1 and $2
     group by w.name, s.date, w.max_clients
     order by s.date desc`,
    [startDate, endDate, BOOKING_STATUS.ACTIVE]
  );

  return res.json(result.rows);
});

router.get('/staff', async (req, res) => {
  const { startDate, endDate } = parseDateRange(req.query);

  const result = await query(
    `select u.name as trainer_name,
            count(s.id) as sessions
     from schedules s
     join trainers t on t.id = s.trainer_id
     join users u on u.id = t.user_id
     where s.date between $1 and $2
     group by u.name
     order by sessions desc`,
    [startDate, endDate]
  );

  return res.json(result.rows);
});

// ======================================================
// GET /api/reports/manager
// Повний звіт для АРМ менеджера
// ======================================================

router.get('/manager', async (req, res) => {
  try {
    const { startDate, endDate } = parseDateRange(req.query);

    // ------------------------------------------------------
    // 1. Загальна статистика
    // ------------------------------------------------------

    const summary = await query(
      `
      select
        (select count(*) from users) as total_users,

        (select count(*) from clients) as total_clients,

        (select count(*) from trainers) as total_trainers,

        (select count(*) from subscriptions
         where status = $3 and end_date >= current_date) as active_subscriptions,

        (select count(*) from visits
         where visit_time::date between $1 and $2) as visits_count,

        (select count(*) from payments
         where date between $1 and $2) as payments_count,

        (select coalesce(sum(amount), 0) from payments
         where date between $1 and $2) as revenue,

        (select coalesce(avg(amount), 0) from payments
         where date between $1 and $2) as average_payment
      `,
      [
        startDate,
        endDate,
        SUBSCRIPTION_STATUS.ACTIVE,
      ]
    );


    // ------------------------------------------------------
    // 2. Дохід по днях
    // ------------------------------------------------------

    // generate_series fills gaps so every day in range appears (with 0 on days with no payments)
    const revenueByDay = await query(
      `
      select
        d.date::date                        as date,
        coalesce(sum(p.amount), 0)          as revenue,
        count(p.id)                         as payments_count
      from generate_series($1::date, $2::date, '1 day') as d(date)
      left join payments p on p.date = d.date
      group by d.date
      order by d.date
      `,
      [
        startDate,
        endDate,
      ]
    );


    // ------------------------------------------------------
    // 3. Відвідуваність по днях
    // ------------------------------------------------------

    const visitsByDay = await query(
      `
      select
        d.date::date               as date,
        count(v.id)                as visits_count
      from generate_series($1::date, $2::date, '1 day') as d(date)
      left join visits v on v.visit_time::date = d.date
      group by d.date
      order by d.date
      `,
      [
        startDate,
        endDate,
      ]
    );


    // ------------------------------------------------------
    // 4. Завантаженість тренерів
    // ------------------------------------------------------

    const trainerLoad = await query(
      `
      select
        u.name as trainer_name,
        count(distinct s.id) as sessions_count,
        count(b.id) as bookings_count,
        coalesce(avg(w.max_clients), 0) as average_capacity
      from trainers t

      join users u
        on u.id = t.user_id

      left join schedules s
        on s.trainer_id = t.id
        and s.date between $1 and $2

      left join workouts w
        on w.id = s.workout_id

      left join bookings b
        on b.schedule_id = s.id
        and b.status = $3

      group by u.name
      order by sessions_count desc, bookings_count desc
      `,
      [
        startDate,
        endDate,
        BOOKING_STATUS.ACTIVE,
      ]
    );


    // ------------------------------------------------------
    // 5. Популярність тренувань
    // ------------------------------------------------------

    const workoutStats = await query(
      `
      select
        w.name as workout_name,
        count(distinct s.id) as sessions_count,
        count(b.id) as bookings_count
      from workouts w

      left join schedules s
        on s.workout_id = w.id
        and s.date between $1 and $2

      left join bookings b
        on b.schedule_id = s.id
        and b.status = $3

      group by w.name
      order by bookings_count desc
      `,
      [
        startDate,
        endDate,
        BOOKING_STATUS.ACTIVE,
      ]
    );


    // ------------------------------------------------------
    // 6. Статистика по планах абонементів
    // ------------------------------------------------------

    const planStats = await query(
      `
      select
        sp.id,
        sp.name        as plan_name,
        sp.price,
        sp.plan_type,
        sp.access_type,
        count(distinct sub.id)          as subscriptions_count,
        count(p.id)                     as payments_count,
        coalesce(sum(p.amount), 0)      as revenue
      from subscription_plans sp

      left join subscriptions sub
        on sub.plan_id = sp.id

      left join payments p
        on p.subscription_id = sub.id
        and p.date between $1 and $2

      where sp.status = 'active'
      group by sp.id, sp.name, sp.price, sp.plan_type, sp.access_type
      order by payments_count desc, subscriptions_count desc
      `,
      [startDate, endDate]
    );


    // ------------------------------------------------------
    // Відповідь для frontend
    // ------------------------------------------------------

    res.json({
      period: {
        start: startDate,
        end: endDate,
      },

      summary: {
        total_users: Number(summary.rows[0].total_users || 0),
        total_clients: Number(summary.rows[0].total_clients || 0),
        total_trainers: Number(summary.rows[0].total_trainers || 0),
        active_subscriptions: Number(summary.rows[0].active_subscriptions || 0),
        visits_count: Number(summary.rows[0].visits_count || 0),
        payments_count: Number(summary.rows[0].payments_count || 0),
        revenue: Number(summary.rows[0].revenue || 0),
        average_payment: Number(summary.rows[0].average_payment || 0),
      },

      revenueByDay: revenueByDay.rows.map((item) => ({
        date: item.date,
        revenue: Number(item.revenue || 0),
        payments_count: Number(item.payments_count || 0),
      })),

      visitsByDay: visitsByDay.rows.map((item) => ({
        date: item.date,
        visits_count: Number(item.visits_count || 0),
      })),

      trainerLoad: trainerLoad.rows.map((item) => ({
        trainer_name: item.trainer_name,
        sessions_count: Number(item.sessions_count || 0),
        bookings_count: Number(item.bookings_count || 0),
        average_capacity: Number(item.average_capacity || 0),
      })),

      workoutStats: workoutStats.rows.map((item) => ({
        workout_name: item.workout_name,
        sessions_count: Number(item.sessions_count || 0),
        bookings_count: Number(item.bookings_count || 0),
      })),

      planStats: planStats.rows.map((item) => ({
        plan_name: item.plan_name,
        price: Number(item.price || 0),
        plan_type: item.plan_type,
        subscriptions_count: Number(item.subscriptions_count || 0),
        payments_count: Number(item.payments_count || 0),
        revenue: Number(item.revenue || 0),
      })),
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: 'Помилка формування звіту менеджера',
    });
  }
});


// ======================================================
// GET /api/reports/payments-list
// Список оплат для менеджера
// ======================================================

router.get('/payments-list', authRequired, requireRole(ROLE.MANAGER, ROLE.ADMIN), async (req, res) => {
  try {
    const result = await query(`
      select
        p.id,
        p.amount,
        p.date,
        p.status,
        u.name as client_name,
        u.email as client_email
      from payments p
      left join clients c on c.id = p.client_id
      left join users u on u.id = c.user_id
      order by p.date desc, p.id desc
    `);

    res.json(result.rows);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: 'Помилка отримання списку оплат',
    });
  }
});

export default router;
