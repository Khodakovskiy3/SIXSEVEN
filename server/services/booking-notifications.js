/**
 * Сповіщення, пов'язані зі створенням бронювання (клієнту — підтвердження,
 * тренеру — заповнена група). Спільні для REST-маршруту й AI-підтвердження.
 */

import { query } from '../db.js';
import { notifyUsers } from '../utils/notify.js';

export async function notifyClientBookingConfirmed(userId, scheduleId) {
  const result = await query(
    `select w.name as workout_name, s.date, s.time
     from schedules s
     join workouts w on w.id = s.workout_id
     where s.id = $1`,
    [scheduleId]
  );
  if (!result.rows.length) {
    return;
  }
  const { workout_name: workoutName, date, time } = result.rows[0];
  const slot = `${new Date(date).toLocaleDateString('uk-UA')} о ${String(time).slice(0, 5)}`;
  await notifyUsers(
    [userId],
    `Запис підтверджено`,
    `Ви записані на «${workoutName}» ${slot}.`,
    { category: 'training', link: `/pages/client/schedule.html?schedule=${scheduleId}` }
  );
}

export async function notifyTrainerIfClassFull(scheduleId) {
  const result = await query(
    `select u.id as user_id, w.name as workout_name, s.date, s.time,
            w.max_clients,
            (select count(*) from bookings b
             where b.schedule_id = s.id and b.status = 'active') as booked
     from schedules s
     join workouts w on w.id = s.workout_id
     join trainers t on t.id = s.trainer_id
     join users u on u.id = t.user_id
     where s.id = $1`,
    [scheduleId]
  );
  if (!result.rows.length) {
    return;
  }
  const {
    user_id: trainerUserId,
    workout_name: workoutName,
    date,
    time,
    max_clients: maxClients,
    booked,
  } = result.rows[0];
  if (Number(booked) >= Number(maxClients)) {
    const slot = `${new Date(date).toLocaleDateString('uk-UA')} о ${String(time).slice(0, 5)}`;
    await notifyUsers(
      [trainerUserId],
      `Заняття «${workoutName}» заповнено`,
      `Усі місця на ${slot} зайняті.`,
      { category: 'training', link: `/pages/trainer/schedule.html?schedule=${scheduleId}` }
    );
  }
}
