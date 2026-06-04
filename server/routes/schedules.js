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

function normalizeSpecialization(value = '') {
  return String(value).trim().toLowerCase();
}

async function getTargetWorkoutId(workoutId, scheduleId = null) {
  if (workoutId) return workoutId;
  if (!scheduleId) return null;

  const result = await query('select workout_id from schedules where id = $1', [scheduleId]);
  return result.rows[0]?.workout_id || null;
}

async function trainerCanTeachWorkout(trainerId, workoutId) {
  if (!trainerId) return true;
  if (!workoutId) return false;

  const result = await query(
    `select w.name as workout_name, t.specialization
     from workouts w
     cross join trainers t
     where w.id = $1 and t.id = $2`,
    [workoutId, trainerId]
  );

  const row = result.rows[0];
  if (!row) return false;

  const workoutName = normalizeSpecialization(row.workout_name);
  return String(row.specialization || '')
    .split(',')
    .map(normalizeSpecialization)
    .some((item) => item === workoutName);
}

router.get('/', async (req, res) => {
  const { trainer_id: trainerId } = req.query;
  const params = [];
  let whereClause = '';

  if (trainerId) {
    params.push(trainerId);
    whereClause = 'where s.trainer_id = $1 and w.status = \'active\'';
  } else {
    whereClause = 'where w.status = \'active\'';
  }

  const result = await query(
    `select s.id, s.date, s.time, s.workout_id, w.name as workout_name,
            w.description as workout_description,
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

  if (!(await trainerCanTeachWorkout(trainerId, workoutId))) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Trainer does not match workout specialization' });
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

  const targetWorkoutId = await getTargetWorkoutId(workoutId, id);
  if (!(await trainerCanTeachWorkout(trainerId, targetWorkoutId))) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Trainer does not match workout specialization' });
  }

  const result = await query(
    `update schedules
     set workout_id = coalesce($1, workout_id),
         trainer_id = $2,
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
