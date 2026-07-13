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
  // Пробуємо з image_url (після міграції 009), fallback без нього
  let workouts;
  try {
    workouts = await query(`
      select w.id, w.name, w.description, w.max_clients, w.status, w.image_url,
             (select count(*)
              from schedules s
              where s.workout_id = w.id and s.date >= current_date) as upcoming_count
      from workouts w
      where w.status = 'active'
      order by w.id desc
    `);
  } catch {
    workouts = await query(`
      select w.id, w.name, w.description, w.max_clients, w.status, null as image_url,
             (select count(*)
              from schedules s
              where s.workout_id = w.id and s.date >= current_date) as upcoming_count
      from workouts w
      where w.status = 'active'
      order by w.id desc
    `);
  }

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

router.get('/schedules', async (req, res) => {
  try {
    const result = await query(`
      select s.id, s.date, s.time,
             w.name as workout_name,
             u.name as trainer_name,
             w.max_clients,
             coalesce(b.cnt, 0) as booked
      from schedules s
      join workouts w on w.id = s.workout_id
      left join trainers t on t.id = s.trainer_id
      left join users u on u.id = t.user_id
      left join (
        select schedule_id, count(*) as cnt
        from bookings where status = 'active' group by schedule_id
      ) b on b.schedule_id = s.id
      where s.date >= current_date and w.status = 'active'
      order by s.date, s.time
      limit 80
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json([]);
  }
});

export default router;