import { Router } from 'express';
import { query } from '../db.js';

const router = Router();

router.get('/plans', async (req, res) => {
  const result = await query(`
    select id, name, description, plan_type, access_type,
           duration_days, usage_count, price, status
    from subscription_plans
    where status = 'active'
    order by price
  `);

  res.json(result.rows);
});

router.get('/home-data', async (req, res) => {
  const workouts = await query(`
    select w.id, w.name, w.description, w.max_clients, w.status,
           (select count(*)
            from schedules s
            where s.workout_id = w.id and s.date >= current_date) as upcoming_count
    from workouts w
    where w.status = 'active'
    order by w.id desc
  `);

  const schedules = await query(`
    select s.id, s.date, s.time,
           w.name as workout_name,
           u.name as trainer_name,
           w.max_clients,
           (select count(*)
            from bookings b
            where b.schedule_id = s.id and b.status = 'active') as booked
    from schedules s
    join workouts w on w.id = s.workout_id
    left join trainers t on t.id = s.trainer_id
    left join users u on u.id = t.user_id
    where s.date >= current_date
    order by s.date, s.time
    limit 10
  `);

  const plans = await query(`
    select id, name, description, plan_type, access_type,
           price, duration_days, usage_count
    from subscription_plans
    where status = 'active'
    order by price
  `);

  res.json({
    workouts: workouts.rows,
    schedules: schedules.rows,
    plans: plans.rows,
  });
});

export default router;