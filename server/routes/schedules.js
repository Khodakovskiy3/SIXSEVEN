/**
 * Маршрути керування розкладом занять.
 *
 * GET    /api/schedules     — список занять, опційно фільтр за trainer_id.
 * POST   /api/schedules     — створити запис розкладу (admin).
 * PUT    /api/schedules/:id — оновити запис (admin).
 * DELETE /api/schedules/:id — видалити запис (admin).
 *
 * До кожного запису додається підрахунок зайнятих та вільних місць,
 * щоб клієнти бачили доступність без додаткових запитів.
 */

import { Router } from 'express';

import { query } from '../db.js';
import { authRequired, requireRole } from '../middleware/auth.js';
import {
  BOOKING_STATUS,
  HTTP_BAD_REQUEST,
  HTTP_CREATED,
  HTTP_NOT_FOUND,
  ROLE,
} from '../utils/constants.js';

const router = Router();

router.use(authRequired);

router.get('/', async (req, res) => {
  const { trainer_id: trainerId } = req.query;
  const params = [];
  let whereClause = '';

  if (trainerId) {
    params.push(trainerId);
    whereClause = 'where s.trainer_id = $1';
  }

  const result = await query(
    `select s.id, s.date, s.time, s.workout_id, w.name as workout_name,
            s.trainer_id, u.name as trainer_name, w.max_clients,
            coalesce(b.booked, 0) as booked
     from schedules s
     join workouts w on w.id = s.workout_id
     left join trainers t on t.id = s.trainer_id
     left join users u on u.id = t.user_id
     left join (
        select schedule_id, count(*) as booked
        from bookings
        where status = '${BOOKING_STATUS.ACTIVE}'
        group by schedule_id
     ) b on b.schedule_id = s.id
     ${whereClause}
     order by s.date asc, s.time asc`,
    params
  );

  // Розраховуємо available на сервері, щоб не дублювати логіку у клієнтів.
  const rows = result.rows.map((row) => ({
    ...row,
    available: Math.max(row.max_clients - row.booked, 0),
  }));

  return res.json(rows);
});

router.post('/', requireRole(ROLE.ADMIN), async (req, res) => {
  const {
    workout_id: workoutId,
    trainer_id: trainerId,
    date,
    time,
  } = req.body || {};

  if (!workoutId || !date || !time) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Missing required fields' });
  }

  const result = await query(
    `insert into schedules (workout_id, trainer_id, date, time)
     values ($1, $2, $3, $4)
     returning id, workout_id, trainer_id, date, time`,
    [workoutId, trainerId || null, date, time]
  );

  return res.status(HTTP_CREATED).json(result.rows[0]);
});

router.put('/:id', requireRole(ROLE.ADMIN), async (req, res) => {
  const { id } = req.params;
  const {
    workout_id: workoutId,
    trainer_id: trainerId,
    date,
    time,
  } = req.body || {};

  const result = await query(
    `update schedules
     set workout_id = coalesce($1, workout_id),
         trainer_id = coalesce($2, trainer_id),
         date = coalesce($3, date),
         time = coalesce($4, time)
     where id = $5
     returning id, workout_id, trainer_id, date, time`,
    [workoutId || null, trainerId || null, date || null, time || null, id]
  );

  if (result.rows.length === 0) {
    return res.status(HTTP_NOT_FOUND).json({ error: 'Not found' });
  }
  return res.json(result.rows[0]);
});

router.delete('/:id', requireRole(ROLE.ADMIN), async (req, res) => {
  const { id } = req.params;
  await query('delete from schedules where id = $1', [id]);
  return res.json({ ok: true });
});

export default router;
