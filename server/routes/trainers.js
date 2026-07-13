/**
 * Маршрути керування тренерами.
 *
 * GET    /api/trainers      — список тренерів (admin, manager).
 * GET    /api/trainers/me   — профіль поточного тренера.
 * POST   /api/trainers      — створити тренера (admin).
 * PUT    /api/trainers/:id  — оновити дані тренера (admin).
 * DELETE /api/trainers/:id  — видалити тренера (admin).
 */

import { Router } from 'express';
import bcrypt from 'bcryptjs';

import { query, withClient } from '../db.js';
import { authRequired, requireRole } from '../middleware/auth.js';
import {
  BCRYPT_SALT_ROUNDS,
  HTTP_BAD_REQUEST,
  HTTP_CONFLICT,
  HTTP_CREATED,
  HTTP_NOT_FOUND,
  HTTP_SERVER_ERROR,
  PG_UNIQUE_VIOLATION,
  ROLE,
} from '../utils/constants.js';

const router = Router();

router.use(authRequired);

function normalizePhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  const normalized = digits.startsWith('380') ? digits : `380${digits.replace(/^0+/, '')}`;
  return `+${normalized.slice(0, 12)}`;
}

function isValidPhone(phone) {
  return !phone || /^\+380\d{9}$/.test(phone);
}

router.get('/me', requireRole(ROLE.TRAINER), async (req, res) => {
  const result = await query(
    `select t.id, u.name, u.email, t.phone, t.specialization
     from trainers t
     join users u on u.id = t.user_id
     where t.user_id = $1`,
    [req.user.id]
  );

  if (result.rows.length === 0) {
    return res.status(HTTP_NOT_FOUND).json({ error: 'Trainer not found' });
  }
  return res.json(result.rows[0]);
});

router.get('/', requireRole(ROLE.ADMIN, ROLE.MANAGER), async (req, res) => {
  const result = await query(
    `select t.id, u.id as user_id, u.name, u.email, t.phone, t.specialization,
            case
              when exists (
                select 1
                from schedules s
                where s.trainer_id = t.id and s.date >= current_date
              ) then 'active'
              else 'inactive'
            end as status
     from trainers t
     join users u on u.id = t.user_id
     where u.role = $1
     order by t.id desc`,
    [ROLE.TRAINER]
  );
  return res.json(result.rows);
});

router.get('/:id', requireRole(ROLE.ADMIN, ROLE.MANAGER), async (req, res) => {
  const { id } = req.params;
  const trainerResult = await query(
    `select t.id, u.id as user_id, u.name, u.email, t.phone, t.specialization,
            case
              when exists (
                select 1
                from schedules s
                where s.trainer_id = t.id and s.date >= current_date
              ) then 'active'
              else 'inactive'
            end as status
     from trainers t
     join users u on u.id = t.user_id
     where t.id = $1`,
    [id]
  );

  if (trainerResult.rows.length === 0) {
    return res.status(HTTP_NOT_FOUND).json({ error: 'Trainer not found' });
  }

  const schedulesResult = await query(
    `select s.id, s.date, s.time, w.name as workout_name
     from schedules s
     join workouts w on w.id = s.workout_id
     where s.trainer_id = $1 and s.date >= current_date
     order by s.date, s.time
     limit 8`,
    [id]
  );

  return res.json({
    trainer: trainerResult.rows[0],
    schedules: schedulesResult.rows,
  });
});

router.post('/from-client', requireRole(ROLE.ADMIN), async (req, res) => {
  const {
    client_id: clientId,
    specialization,
  } = req.body || {};

  if (!clientId) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Missing client_id' });
  }

  try {
    const promoted = await withClient(async (client) => {
      await client.query('begin');
      const current = await client.query(
        `select c.id, c.user_id, c.phone, u.name, u.email
         from clients c
         join users u on u.id = c.user_id
         where c.id = $1`,
        [clientId]
      );

      if (current.rows.length === 0) {
        await client.query('rollback');
        return null;
      }

      const user = current.rows[0];
      await client.query(
        'update users set role = $1 where id = $2',
        [ROLE.TRAINER, user.user_id]
      );

      const trainerResult = await client.query(
        `insert into trainers (user_id, phone, specialization)
         values ($1, $2, $3)
         on conflict (user_id) do update
         set phone = coalesce(excluded.phone, trainers.phone),
             specialization = coalesce(excluded.specialization, trainers.specialization)
         returning id, phone, specialization`,
        [user.user_id, user.phone || null, specialization || null]
      );

      await client.query('commit');
      return {
        id: trainerResult.rows[0].id,
        user_id: user.user_id,
        name: user.name,
        email: user.email,
        role: ROLE.TRAINER,
        phone: trainerResult.rows[0].phone,
        specialization: trainerResult.rows[0].specialization,
      };
    });

    if (!promoted) {
      return res.status(HTTP_NOT_FOUND).json({ error: 'Client not found' });
    }

    return res.status(HTTP_CREATED).json(promoted);
  } catch {
    return res.status(HTTP_SERVER_ERROR).json({ error: 'Trainer promotion failed' });
  }
});

router.post('/', requireRole(ROLE.ADMIN), async (req, res) => {
  const { name, email, password, phone, specialization } = req.body || {};
  if (!name || !email || !password) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Missing required fields' });
  }

  const normalizedPhone = normalizePhone(phone);
  if (!isValidPhone(normalizedPhone)) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Invalid phone format' });
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

  try {
    // Створюємо users і trainers разом, у транзакції.
    const created = await withClient(async (client) => {
      await client.query('begin');
      const userResult = await client.query(
        `insert into users (name, email, password, role)
         values ($1, $2, $3, 'trainer')
         returning id, name, email, role`,
        [name, email.toLowerCase(), passwordHash]
      );

      const user = userResult.rows[0];
      const trainerResult = await client.query(
        `insert into trainers (user_id, phone, specialization)
         values ($1, $2, $3)
         returning id, phone, specialization`,
        [user.id, normalizedPhone, specialization || null]
      );

      await client.query('commit');
      return {
        ...user,
        trainer_id: trainerResult.rows[0].id,
        phone: trainerResult.rows[0].phone,
        specialization: trainerResult.rows[0].specialization,
      };
    });

    return res.status(HTTP_CREATED).json(created);
  } catch (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return res.status(HTTP_CONFLICT).json({ error: 'Email already registered' });
    }
    return res.status(HTTP_SERVER_ERROR).json({ error: 'Trainer creation failed' });
  }
});

router.put('/:id', requireRole(ROLE.ADMIN), async (req, res) => {
  const { id } = req.params;
  const { name, phone, specialization } = req.body || {};
  const normalizedPhone = normalizePhone(phone);
  if (!isValidPhone(normalizedPhone)) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Invalid phone format' });
  }

  const updated = await withClient(async (client) => {
    await client.query('begin');
    const current = await client.query(
      'select user_id from trainers where id = $1',
      [id]
    );

    if (current.rows.length === 0) {
      await client.query('rollback');
      return null;
    }

    const userId = current.rows[0].user_id;

    await client.query(
      `update users
       set name = coalesce($1, name)
       where id = $2`,
      [name || null, userId]
    );

    const trainerResult = await client.query(
      `update trainers
       set phone = coalesce($1, phone),
           specialization = coalesce($2, specialization)
       where id = $3
       returning id, phone, specialization`,
      [normalizedPhone, specialization || null, id]
    );

    const userResult = await client.query(
      'select id, name, email, role from users where id = $1',
      [userId]
    );

    await client.query('commit');
    return {
      ...userResult.rows[0],
      trainer_id: trainerResult.rows[0].id,
      phone: trainerResult.rows[0].phone,
      specialization: trainerResult.rows[0].specialization,
    };
  });

  if (!updated) {
    return res.status(HTTP_NOT_FOUND).json({ error: 'Not found' });
  }
  return res.json(updated);
});

router.delete('/:id', requireRole(ROLE.ADMIN), async (req, res) => {
  const { id } = req.params;
  const current = await query('select user_id, phone from trainers where id = $1', [id]);
  if (current.rows.length === 0) {
    return res.status(HTTP_NOT_FOUND).json({ error: 'Not found' });
  }

  await withClient(async (client) => {
    await client.query('begin');
    await client.query('delete from trainers where id = $1', [id]);
    await client.query(
      `insert into clients (user_id, phone)
       values ($1, $2)
       on conflict (user_id) do update
       set phone = coalesce(excluded.phone, clients.phone)`,
      [current.rows[0].user_id, current.rows[0].phone || null]
    );
    await client.query(
      'update users set role = $1 where id = $2',
      [ROLE.CLIENT, current.rows[0].user_id]
    );
    await client.query('commit');
  });
  return res.json({ ok: true });
});

// ======================================================
// GET /api/trainers/me
// Отримати поточного тренера
// ======================================================

router.get('/me', authRequired, requireRole(ROLE.TRAINER), async (req, res) => {
  try {
    const result = await query(
      `
      select
        t.id,
        t.user_id,
        t.phone,
        t.specialization,
        u.name,
        u.email
      from trainers t
      join users u on u.id = t.user_id
      where t.user_id = $1
      `,
      [req.user.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        error: 'Тренера не знайдено',
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: 'Помилка отримання тренера',
    });
  }
});


// ======================================================
// GET /api/trainers/me/schedule
// Розклад тренувань поточного тренера
// ======================================================

router.get('/me/schedule', authRequired, requireRole(ROLE.TRAINER), async (req, res) => {
  try {
    const result = await query(
      `
      select
        s.id,
        s.date,
        s.time,
        w.name as workout_name,
        w.description as workout_description,
        w.max_clients,

        count(b.id) as booked_count

      from schedules s

      join trainers t
        on t.id = s.trainer_id

      join workouts w
        on w.id = s.workout_id

      left join bookings b
        on b.schedule_id = s.id
        and b.status = 'active'

      where t.user_id = $1

      group by
        s.id,
        s.date,
        s.time,
        w.name,
        w.description,
        w.max_clients

      order by s.date, s.time
      `,
      [req.user.id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: 'Помилка отримання розкладу тренера',
    });
  }
});


// ======================================================
// GET /api/trainers/me/schedule/:id/clients
// Список клієнтів, записаних на тренування
// ======================================================

router.get('/me/schedule/:id/clients', authRequired, requireRole(ROLE.TRAINER), async (req, res) => {
  try {
    const scheduleId = Number(req.params.id);

    const access = await query(
      `
      select s.id
      from schedules s
      join trainers t on t.id = s.trainer_id
      where s.id = $1
        and t.user_id = $2
      `,
      [scheduleId, req.user.id]
    );

    if (!access.rows.length) {
      return res.status(403).json({
        error: 'Немає доступу до цього тренування',
      });
    }

    const result = await query(
      `
      select
        b.id as booking_id,
        b.status,
        c.id as client_id,
        u.name as client_name,
        u.email as client_email,
        c.phone as client_phone
      from bookings b
      join clients c on c.id = b.client_id
      join users u on u.id = c.user_id
      where b.schedule_id = $1
      order by u.name
      `,
      [scheduleId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: 'Помилка отримання клієнтів заняття',
    });
  }
});


// ======================================================
// GET /api/trainers/me/visits
// Історія відвідувань занять тренера
// ======================================================

router.get('/me/visits', authRequired, requireRole(ROLE.TRAINER), async (req, res) => {
  try {
    const result = await query(
      `
      select
        v.id,
        v.visit_time,
        u.name as client_name,
        w.name as workout_name,
        s.date,
        s.time
      from visits v
      join clients c on c.id = v.client_id
      join users u on u.id = c.user_id
      left join schedules s on s.id = v.schedule_id
      left join workouts w on w.id = s.workout_id
      left join trainers t on t.id = s.trainer_id
      where t.user_id = $1
      order by v.visit_time desc
      limit 30
      `,
      [req.user.id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: 'Помилка отримання історії відвідувань',
    });
  }
});


// ======================================================
// GET /api/trainers/me/notifications
// Сповіщення тренера
// ======================================================

router.get('/me/notifications', authRequired, requireRole(ROLE.TRAINER), async (req, res) => {
  try {
    const newBookings = await query(
      `
      select
        b.id,
        b.created_at,
        u.name as client_name,
        w.name as workout_name,
        s.date,
        s.time
      from bookings b
      join schedules s on s.id = b.schedule_id
      join workouts w on w.id = s.workout_id
      join clients c on c.id = b.client_id
      join users u on u.id = c.user_id
      join trainers t on t.id = s.trainer_id
      where t.user_id = $1
      order by b.created_at desc
      limit 10
      `,
      [req.user.id]
    );

    const notifications = newBookings.rows.map((item) => ({
      id: item.id,
      type: 'booking',
      title: 'Новий запис клієнта',
      message: `${item.client_name} записався на тренування "${item.workout_name}"`,
      date: item.created_at,
    }));

    res.json(notifications);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: 'Помилка отримання сповіщень',
    });
  }
});

// ======================================================
// GET  /api/trainers/me/client-notes
// Всі нотатки тренера по клієнтах
// ======================================================

router.get('/me/client-notes', requireRole(ROLE.TRAINER), async (req, res) => {
  try {
    const trainerRow = await query(
      'select id from trainers where user_id = $1',
      [req.user.id]
    );
    if (!trainerRow.rows.length) {
      return res.status(HTTP_NOT_FOUND).json({ error: 'Trainer not found' });
    }
    const trainerId = trainerRow.rows[0].id;
    const result = await query(
      `select client_id, note, exercises, updated_at
       from trainer_client_notes
       where trainer_id = $1`,
      [trainerId]
    );
    return res.json(result.rows);
  } catch (error) {
    console.error(error);
    return res.status(HTTP_SERVER_ERROR).json({ error: 'Failed to load notes' });
  }
});

// ======================================================
// PUT /api/trainers/me/client-notes/:clientId
// Зберегти (upsert) нотатку по клієнту
// ======================================================

router.put('/me/client-notes/:clientId', requireRole(ROLE.TRAINER), async (req, res) => {
  const clientId = Number(req.params.clientId);
  const { note = '', exercises = '' } = req.body || {};

  if (!clientId) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Invalid clientId' });
  }

  try {
    const trainerRow = await query(
      'select id from trainers where user_id = $1',
      [req.user.id]
    );
    if (!trainerRow.rows.length) {
      return res.status(HTTP_NOT_FOUND).json({ error: 'Trainer not found' });
    }
    const trainerId = trainerRow.rows[0].id;

    const result = await query(
      `insert into trainer_client_notes (trainer_id, client_id, note, exercises, updated_at)
       values ($1, $2, $3, $4, now())
       on conflict (trainer_id, client_id)
       do update set note = excluded.note, exercises = excluded.exercises, updated_at = now()
       returning client_id, note, exercises, updated_at`,
      [trainerId, clientId, String(note).trim(), String(exercises).trim()]
    );
    return res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    return res.status(HTTP_SERVER_ERROR).json({ error: 'Failed to save note' });
  }
});

export default router;
