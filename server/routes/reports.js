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
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

import { query } from '../db.js';
import { logError } from '../utils/logger.js';
import { authRequired, requireRole } from '../middleware/auth.js';
import {
  BOOKING_STATUS,
  REPORT_MAX_DATE,
  REPORT_MIN_DATE,
  ROLE,
  SUBSCRIPTION_STATUS,
} from '../utils/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PDF_SCRIPT = path.resolve(__dirname, '../../scripts/gen_pdf_report.py');

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
        u.name  as trainer_name,
        u.email as trainer_email,
        u.phone as trainer_phone,
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

      group by u.name, u.email, u.phone
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
    // 7. Попередній період (для порівняння трендів)
    // ------------------------------------------------------
    const periodDays = Math.max(1,
      Math.round((new Date(endDate) - new Date(startDate)) / 86400000)
    );
    const prevEnd   = new Date(new Date(startDate) - 86400000).toISOString().slice(0, 10);
    const prevStart = new Date(new Date(prevEnd)   - (periodDays - 1) * 86400000).toISOString().slice(0, 10);

    const prevSummary = await query(
      `select
         coalesce(sum(amount), 0)  as revenue,
         count(*)                  as payments_count,
         (select count(*) from visits where visit_time::date between $1 and $2) as visits_count
       from payments where date between $1 and $2`,
      [prevStart, prevEnd]
    );

    // ------------------------------------------------------
    // 8. Завантаженість по днях тижня
    // ------------------------------------------------------
    const DOW_UA = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    const visitsByDow = await query(
      `select extract(dow from visit_time)::int as dow, count(*) as visits_count
       from visits
       where visit_time::date between $1 and $2
       group by dow order by dow`,
      [startDate, endDate]
    );
    const dowMap = Object.fromEntries(visitsByDow.rows.map(r => [r.dow, Number(r.visits_count)]));
    const visitsByDayOfWeek = [1,2,3,4,5,6,0].map(d => ({
      day: DOW_UA[d], visits_count: dowMap[d] || 0,
    }));

    // ------------------------------------------------------
    // 9. Скасування та пропуски
    // ------------------------------------------------------
    const cancellations = await query(
      `select
         count(*) filter (where b.status = 'cancelled') as cancelled_count,
         count(*) filter (where b.status = $3)          as active_count
       from bookings b
       join schedules s on s.id = b.schedule_id
       where s.date between $1 and $2`,
      [startDate, endDate, BOOKING_STATUS.ACTIVE]
    );
    const cancRow = cancellations.rows[0];
    const totalBookings = Number(cancRow.active_count || 0) + Number(cancRow.cancelled_count || 0);
    const cancellationStats = {
      cancelled_count: Number(cancRow.cancelled_count || 0),
      active_count:    Number(cancRow.active_count    || 0),
      total:           totalBookings,
      cancel_rate:     totalBookings > 0
        ? Math.round((Number(cancRow.cancelled_count || 0) / totalBookings) * 100)
        : 0,
    };

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
        trainer_name:     item.trainer_name,
        trainer_email:    item.trainer_email || '',
        trainer_phone:    item.trainer_phone || '',
        sessions_count:   Number(item.sessions_count || 0),
        bookings_count:   Number(item.bookings_count || 0),
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

      prevPeriod: {
        start: prevStart,
        end:   prevEnd,
        revenue:        Number(prevSummary.rows[0].revenue        || 0),
        payments_count: Number(prevSummary.rows[0].payments_count || 0),
        visits_count:   Number(prevSummary.rows[0].visits_count   || 0),
      },

      visitsByDayOfWeek,
      cancellationStats,
    });

  } catch (error) {
    logError('Помилка формування звіту', error, { path: req.originalUrl });

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
    logError('Помилка формування звіту', error, { path: req.originalUrl });

    res.status(500).json({
      error: 'Помилка отримання списку оплат',
    });
  }
});

// ======================================================
// GET /api/reports/pdf?start=YYYY-MM-DD&end=YYYY-MM-DD
// Генерує PDF-звіт через Python-скрипт
// ======================================================

router.get('/pdf', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const dfltStart = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const { start, end } = req.query;
    let startDate = start || dfltStart;
    let endDate   = end   || today;
    // Обмеження: не більше 365 днів (щоб generate_series не повертав тисячі рядків)
    const MS_PER_DAY = 86400000;
    const MAX_DAYS   = 365;
    const sMs = new Date(startDate).getTime();
    const eMs = new Date(endDate).getTime();
    if (!isNaN(sMs) && !isNaN(eMs) && (eMs - sMs) / MS_PER_DAY > MAX_DAYS) {
      const nowMs = Date.now();
      endDate   = new Date(nowMs).toISOString().slice(0, 10);
      startDate = new Date(nowMs - MAX_DAYS * MS_PER_DAY).toISOString().slice(0, 10);
    }

    // Збираємо ті самі дані, що й /manager
    const [summary, revenueByDay, visitsByDay, trainerLoad, workoutStats, planStats] =
      await Promise.all([
        query(
          `select
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
              where date between $1 and $2) as average_payment`,
          [startDate, endDate, SUBSCRIPTION_STATUS.ACTIVE]
        ),
        query(
          `select d.date::date as date, coalesce(sum(p.amount), 0) as revenue,
                  count(p.id) as payments_count
           from generate_series($1::date, $2::date, '1 day') as d(date)
           left join payments p on p.date = d.date
           group by d.date order by d.date`,
          [startDate, endDate]
        ),
        query(
          `select d.date::date as date, count(v.id) as visits_count
           from generate_series($1::date, $2::date, '1 day') as d(date)
           left join visits v on v.visit_time::date = d.date
           group by d.date order by d.date`,
          [startDate, endDate]
        ),
        query(
          `select u.name as trainer_name,
                  count(distinct s.id) as sessions_count,
                  count(b.id) as bookings_count
           from trainers t
           join users u on u.id = t.user_id
           left join schedules s on s.trainer_id = t.id and s.date between $1 and $2
           left join bookings b on b.schedule_id = s.id and b.status = $3
           group by u.name order by sessions_count desc`,
          [startDate, endDate, BOOKING_STATUS.ACTIVE]
        ),
        query(
          `select w.name as workout_name,
                  count(distinct s.id) as sessions_count,
                  count(b.id) as bookings_count
           from workouts w
           left join schedules s on s.workout_id = w.id and s.date between $1 and $2
           left join bookings b on b.schedule_id = s.id and b.status = $3
           group by w.name order by bookings_count desc`,
          [startDate, endDate, BOOKING_STATUS.ACTIVE]
        ),
        query(
          `select sp.name as plan_name, sp.price, sp.plan_type,
                  count(distinct sub.id) as subscriptions_count,
                  count(p.id) as payments_count,
                  coalesce(sum(p.amount), 0) as revenue
           from subscription_plans sp
           left join subscriptions sub on sub.plan_id = sp.id
           left join payments p on p.subscription_id = sub.id and p.date between $1 and $2
           where sp.status = 'active'
           group by sp.id, sp.name, sp.price, sp.plan_type
           order by payments_count desc`,
          [startDate, endDate]
        ),
      ]);

    const payload = JSON.stringify({
      period: { start: startDate, end: endDate },
      summary: {
        total_users:          Number(summary.rows[0].total_users || 0),
        total_clients:        Number(summary.rows[0].total_clients || 0),
        total_trainers:       Number(summary.rows[0].total_trainers || 0),
        active_subscriptions: Number(summary.rows[0].active_subscriptions || 0),
        visits_count:         Number(summary.rows[0].visits_count || 0),
        payments_count:       Number(summary.rows[0].payments_count || 0),
        revenue:              Number(summary.rows[0].revenue || 0),
        average_payment:      Number(summary.rows[0].average_payment || 0),
      },
      revenueByDay: revenueByDay.rows.map((r) => ({
        date: r.date, revenue: Number(r.revenue || 0),
      })),
      visitsByDay: visitsByDay.rows.map((r) => ({
        date: r.date, visits_count: Number(r.visits_count || 0),
      })),
      trainerLoad: trainerLoad.rows.map((r) => ({
        trainer_name:   r.trainer_name,
        sessions_count: Number(r.sessions_count || 0),
        bookings_count: Number(r.bookings_count || 0),
      })),
      workoutStats: workoutStats.rows.map((r) => ({
        workout_name:   r.workout_name,
        sessions_count: Number(r.sessions_count || 0),
        bookings_count: Number(r.bookings_count || 0),
      })),
      planStats: planStats.rows.map((r) => ({
        plan_name:           r.plan_name,
        price:               Number(r.price || 0),
        subscriptions_count: Number(r.subscriptions_count || 0),
        payments_count:      Number(r.payments_count || 0),
        revenue:             Number(r.revenue || 0),
      })),
    });

    // Запускаємо Python-скрипт
    const py = spawn('python3', [PDF_SCRIPT]);
    const chunks = [];
    let errBuf = '';

    py.stdout.on('data', (chunk) => chunks.push(chunk));
    py.stderr.on('data', (d) => { errBuf += d.toString(); });

    py.on('close', (code) => {
      if (code !== 0) {
        console.error('PDF script error:', errBuf);
        if (!res.headersSent) {
          res.status(500).json({ error: 'PDF generation failed', detail: errBuf });
        }
        return;
      }
      const pdf = Buffer.concat(chunks);
      const now = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="olimp-analytics-${now}.pdf"`);
      res.setHeader('Content-Length', pdf.length);
      res.end(pdf);
    });

    py.on('error', (err) => {
      console.error('Failed to spawn python3:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'python3 not available' });
      }
    });

    py.stdin.write(payload);
    py.stdin.end();

  } catch (err) {
    console.error('/reports/pdf error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Report error' });
  }
});

export default router;
