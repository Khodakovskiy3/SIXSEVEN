/** Одноразові нагадування клієнтам приблизно за годину до заняття. */
import { query } from '../db.js';
import { notifyUsers } from './notify.js';
import { CLUB_TIMEZONE } from './constants.js';
import { logError } from './logger.js';

export async function runTrainingHourReminders() {
  try {
    // Вікно 55–60 хвилин дозволяє запускати процес кожні 5 хвилин.
    const result = await query(
      `select s.id, s.date, s.time, w.name as workout_name, u.id as user_id
       from bookings b
       join schedules s on s.id = b.schedule_id
       join workouts w on w.id = s.workout_id
       join clients c on c.id = b.client_id
       join users u on u.id = c.user_id
       where b.status = 'active'
         and (s.date + s.time) at time zone $1 between now() + interval '55 minutes'
                                               and now() + interval '60 minutes'`,
      [CLUB_TIMEZONE]
    );
    for (const row of result.rows) {
      const slot = `${new Date(row.date).toLocaleDateString('uk-UA')} о ${String(row.time).slice(0, 5)}`;
      await notifyUsers(
        [row.user_id],
        `Нагадування: «${row.workout_name}» за годину`,
        `Ваше заняття розпочнеться ${slot}.`,
        {
          category: 'reminder',
          optional: true,
          onceToday: true,
          link: `/pages/client/schedule.html?schedule=${row.id}`,
        }
      );
    }
  } catch (error) {
    logError('[training-reminders] помилка', error);
  }
}
