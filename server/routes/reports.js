import { Router } from 'express';
import { query } from '../db.js';
import { authRequired, requireRole } from '../middleware/auth.js';

const router = Router();

router.use(authRequired);
router.use(requireRole('admin', 'manager'));

router.get('/summary', async (req, res) => {
  const { start, end } = req.query;
  const startDate = start || '2000-01-01';
  const endDate = end || '2100-01-01';

  const totalClients = await query('select count(*) as count from clients');
  const activeSubs = await query(
    `select count(*) as count from subscriptions
     where status = 'active' and end_date >= CURRENT_DATE`
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
  const { start, end } = req.query;
  const startDate = start || '2000-01-01';
  const endDate = end || '2100-01-01';

  const result = await query(
    `select w.name as workout_name, s.date,
            count(b.id) as attendees,
            w.max_clients
     from schedules s
     join workouts w on w.id = s.workout_id
     left join bookings b on b.schedule_id = s.id and b.status = 'active'
     where s.date between $1 and $2
     group by w.name, s.date, w.max_clients
     order by s.date desc`,
    [startDate, endDate]
  );

  return res.json(result.rows);
});

router.get('/staff', async (req, res) => {
  const { start, end } = req.query;
  const startDate = start || '2000-01-01';
  const endDate = end || '2100-01-01';

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
