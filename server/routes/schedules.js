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
 *
 * Бізнес-правила розкладу:
 *  • тренер має відповідати спеціалізації типу тренування;
 *  • тренер не може проводити два заняття одночасно (один день і час).
 */

import { Router } from 'express';

import { query } from '../db.js';
import { authRequired, requireRole } from '../middleware/auth.js';
import { notifyUsers } from '../utils/notify.js';
import {
  BOOKING_STATUS,
  CLUB_TIMEZONE,
  HTTP_BAD_REQUEST,
  HTTP_CONFLICT,
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

async function getScheduleById(scheduleId) {
  const result = await query(
    'select id, workout_id, trainer_id, date, time from schedules where id = $1',
    [scheduleId]
  );
  return result.rows[0] || null;
}

/**
 * Перевіряє, чи нове заняття тренера перетинається за часом з іншим його заняттям.
 * Враховує тривалість обох занять: конфлікт є, якщо інтервали [start, start+duration)
 * перекриваються (а не лише збігаються на початку).
 *
 * @param {number|null} trainerId    — тренер, що призначається.
 * @param {string}      date         — дата заняття (YYYY-MM-DD).
 * @param {string}      time         — час початку нового заняття (HH:MM або HH:MM:SS).
 * @param {number|null} newWorkoutId — тип нового заняття (для визначення його тривалості).
 * @param {number|null} [excludeId]  — id запису, що редагується (виключити зі звірки).
 * @returns {Promise<boolean>} true, якщо є конфлікт.
 */
async function trainerHasTimeConflict(trainerId, date, time, newWorkoutId, excludeId = null) {
  if (!trainerId || !date || !time || !newWorkoutId) return false;

  // Інтервал нового заняття: [time, time + nw.duration_minutes)
  // Інтервал існуючого заняття: [s.time, s.time + w.duration_minutes)
  // Перекриття: existing_start < new_end AND existing_end > new_start
  const params = [trainerId, date, time, newWorkoutId];
  let sql = `
    select 1 from schedules s
    join workouts w  on w.id  = s.workout_id
    join workouts nw on nw.id = $4
    where s.trainer_id = $1
      and s.date = $2
      and s.time < ($3::time + (coalesce(nw.duration_minutes, 60) || ' minutes')::interval)
      and (s.time + (coalesce(w.duration_minutes, 60) || ' minutes')::interval) > $3::time
  `;

  if (excludeId) {
    params.push(excludeId);
    sql += ` and s.id <> $5`;
  }

  const result = await query(`${sql} limit 1`, params);
  return result.rows.length > 0;
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
            w.duration_minutes,
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

/**
 * Перевіряє, чи момент початку заняття вже минув. Настінний час заняття
 * (date + time) інтерпретуємо в зоні клубу й порівнюємо з поточним моментом —
 * так не можна поставити заняття на годину, що вже пройшла сьогодні.
 *
 * @param {string} date Дата заняття (YYYY-MM-DD).
 * @param {string} time Час початку (HH:MM або HH:MM:SS).
 * @returns {Promise<boolean>} true, якщо час у минулому.
 */
async function isSlotInPast(date, time) {
  if (!date || !time) return false;
  const result = await query(
    `select ($1::date + $2::time) at time zone $3 < now() as past`,
    [date, time, CLUB_TIMEZONE]
  );
  return result.rows[0]?.past === true;
}

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

  if (await isSlotInPast(date, time)) {
    return res.status(HTTP_BAD_REQUEST).json({
      error: 'Не можна створити заняття на час, що вже минув',
    });
  }

  if (!(await trainerCanTeachWorkout(trainerId, workoutId))) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Trainer does not match workout specialization' });
  }

  if (await trainerHasTimeConflict(trainerId, date, time, workoutId)) {
    return res.status(HTTP_CONFLICT).json({
      error: 'Тренер вже проводить інше заняття в цей проміжок часу',
    });
  }

  const result = await query(
    `insert into schedules (workout_id, trainer_id, date, time)
     values ($1, $2, $3, $4)
     returning id, workout_id, trainer_id, date, time`,
    [workoutId, trainerId || null, date, time]
  );

  return res.status(HTTP_CREATED).json(result.rows[0]);
});

/**
 * Повертає назву заняття та user_id клієнтів з активними бронюваннями —
 * саме їх треба сповіщати про зміни в розкладі.
 *
 * @param {string|number} scheduleId Ідентифікатор запису розкладу.
 * @returns {Promise<{workoutName: string, userIds: number[]}>}
 */
async function getBookedAudience(scheduleId) {
  const result = await query(
    `select u.id as user_id, w.name as workout_name
     from bookings b
     join clients c on c.id = b.client_id
     join users u on u.id = c.user_id
     join schedules s on s.id = b.schedule_id
     join workouts w on w.id = s.workout_id
     where b.schedule_id = $1 and b.status = 'active'`,
    [scheduleId]
  );

  return {
    workoutName: result.rows[0]?.workout_name || 'Тренування',
    userIds: result.rows.map((row) => row.user_id),
  };
}

/**
 * Форматує дату й час заняття для тексту сповіщення.
 *
 * @param {string|Date} date Дата заняття.
 * @param {string} time Час у форматі HH:MM:SS.
 * @returns {string} Наприклад, «14.07.2026 о 18:00».
 */
function formatSlot(date, time) {
  return `${new Date(date).toLocaleDateString('uk-UA')} о ${String(time).slice(0, 5)}`;
}

router.put('/:id', requireRole(ROLE.ADMIN), async (req, res) => {
  const { id } = req.params;
  const {
    workout_id: workoutId,
    trainer_id: trainerId,
    date,
    time,
  } = req.body || {};

  const existing = await getScheduleById(id);
  if (!existing) {
    return res.status(HTTP_NOT_FOUND).json({ error: 'Not found' });
  }

  const targetWorkoutId = await getTargetWorkoutId(workoutId, id);
  if (!(await trainerCanTeachWorkout(trainerId, targetWorkoutId))) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Trainer does not match workout specialization' });
  }

  // Фактичні дата й час після оновлення (якщо не передані — лишаються поточні).
  const effectiveDate = date || existing.date;
  const effectiveTime = time || existing.time;

  // Перенесення в минуле блокуємо лише коли дату/час реально змінюють:
  // існуючі заняття, які вже минули, можна редагувати (напр. змінити тренера).
  if ((date || time) && await isSlotInPast(effectiveDate, effectiveTime)) {
    return res.status(HTTP_BAD_REQUEST).json({
      error: 'Не можна перенести заняття на час, що вже минув',
    });
  }

  if (await trainerHasTimeConflict(trainerId, effectiveDate, effectiveTime, targetWorkoutId, id)) {
    return res.status(HTTP_CONFLICT).json({
      error: 'Тренер вже проводить інше заняття в цей проміжок часу',
    });
  }

  // Аудиторію збираємо ДО оновлення, а порівнюємо дату/час ПІСЛЯ —
  // сповіщаємо лише тоді, коли заняття реально перенесено.
  const audience = await getBookedAudience(id);

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

  const updated = result.rows[0];
  const wasSlotChanged = formatSlot(existing.date, existing.time)
    !== formatSlot(updated.date, updated.time);
  if (wasSlotChanged && audience.userIds.length > 0) {
    await notifyUsers(
      audience.userIds,
      `Заняття «${audience.workoutName}» перенесено`,
      `Було: ${formatSlot(existing.date, existing.time)}.\n`
        + `Нові дата і час: ${formatSlot(updated.date, updated.time)}.`
    );
  }

  return res.json(updated);
});

router.delete('/:id', requireRole(ROLE.ADMIN), async (req, res) => {
  const { id } = req.params;

  // Дані для сповіщення треба зібрати до видалення: каскад знищить
  // і бронювання, і сам запис розкладу.
  const existing = await getScheduleById(id);
  const audience = await getBookedAudience(id);

  await query('delete from schedules where id = $1', [id]);

  if (existing && audience.userIds.length > 0) {
    await notifyUsers(
      audience.userIds,
      `Заняття «${audience.workoutName}» скасовано`,
      `Заняття ${formatSlot(existing.date, existing.time)} не відбудеться. `
        + 'Перепрошуємо за незручності.'
    );
  }

  return res.json({ ok: true });
});

export default router;
