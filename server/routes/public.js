import { Router } from 'express';
import { query } from '../db.js';
import { logError } from '../utils/logger.js';
import { sendDemoRequestNotification } from '../utils/mailer.js';
import { publicConfig } from '../config.js';
import { authRequired, requireRole } from '../middleware/auth.js';
import { ROLE } from '../utils/constants.js';

const router = Router();

// Публічна (несекретна) конфігурація бренду для фронтенда.
router.get('/config', (req, res) => {
  res.json(publicConfig());
});

const EARLY_ACCESS_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STUDIO_TYPES = new Set(['fitness', 'yoga', 'pilates', 'gym', 'personal', 'wellness', 'other']);

/** Обрізає рядок до межі; порожні значення → null. */
function clip(value, max) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, max) : null;
}

// Заявка на демо з лендингу. Honeypot-поле `website` має лишатися порожнім
// (боти його заповнюють) — тоді відповідаємо успіхом, але нічого не зберігаємо.
router.post('/early-access', async (req, res) => {
  const body = req.body || {};
  if (clip(body.website, 200)) {
    return res.status(202).json({ ok: true });
  }
  const name = clip(body.name, 100);
  const email = clip(body.email, 150)?.toLowerCase();
  if (!name || !email || !EARLY_ACCESS_EMAIL.test(email)) {
    return res.status(400).json({ error: 'Please provide your name and a valid email.' });
  }
  const studioType = STUDIO_TYPES.has(body.studio_type) ? body.studio_type : null;
  // Повторне надсилання (подвійний клік, refresh) не створює дубль: та сама
  // адреса за останні 24 години вважається тією самою заявкою.
  const duplicate = await query(
    `select 1 from early_access_requests
     where lower(email) = $1 and created_at > now() - interval '24 hours' limit 1`,
    [email]
  );
  if (duplicate.rowCount > 0) {
    return res.status(200).json({ ok: true, duplicate: true });
  }
  const lead = {
    name,
    email,
    studio_name: clip(body.studio_name, 150),
    studio_type: studioType,
    message: clip(body.message, 2000),
  };
  await query(
    `insert into early_access_requests (name, email, studio_name, studio_type, message)
     values ($1, $2, $3, $4, $5)`,
    [lead.name, lead.email, lead.studio_name, lead.studio_type, lead.message]
  );
  // Лист власнику — best effort: збій пошти не ламає збереження заявки.
  sendDemoRequestNotification(lead).catch((err) => logError('Demo request email failed', err));
  return res.status(201).json({ ok: true });
});

// Перегляд заявок — лише керівник/адміністратор.
router.get('/early-access', authRequired, requireRole(ROLE.MANAGER, ROLE.ADMIN), async (req, res) => {
  const result = await query(
    `select id, name, email, studio_name, studio_type, message, created_at
     from early_access_requests order by created_at desc limit 500`
  );
  return res.json(result.rows);
});

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
    logError('Помилка публічного маршруту', err, { path: req.originalUrl });
    res.status(500).json([]);
  }
});

export default router;