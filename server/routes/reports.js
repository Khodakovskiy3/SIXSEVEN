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

export default router;
