/**
 * Щоденні нагадування про стан абонементів клієнтів.
 *
 * runSubscriptionReminders() викликається раз на добу при старті сервера.
 * Виконує два кроки:
 *  1. Знаходить абонементи, що закінчуються рівно через 3 дні → надсилає попередження.
 *  2. Переводить прострочені активні абонементи в статус 'expired' → надсилає сповіщення.
 */

import { query } from '../db.js';
import { notifyUsers } from './notify.js';
import { logError } from './logger.js';

export async function runSubscriptionReminders() {
  try {
    await notifyExpiringIn3Days();
    await markAndNotifyExpired();
  } catch (err) {
    logError('[subscription-reminders] помилка', err);
  }
}

async function notifyExpiringIn3Days() {
  const result = await query(
    `select s.id, u.id as user_id, p.name as plan_name, s.end_date
     from subscriptions s
     join clients c on c.id = s.client_id
     join users u on u.id = c.user_id
     left join subscription_plans p on p.id = s.plan_id
     where s.status = 'active'
       and s.end_date = (current_date + interval '3 days')::date`
  );

  for (const row of result.rows) {
    const until = new Date(row.end_date).toLocaleDateString('uk-UA');
    await notifyUsers(
      [row.user_id],
      `Абонемент закінчується`,
      `Ваш абонемент${row.plan_name ? ` «${row.plan_name}»` : ''} діє до ${until}. Продовжіть вчасно!`
    );
  }
}

async function markAndNotifyExpired() {
  const result = await query(
    `update subscriptions
     set status = 'expired'
     where status = 'active'
       and end_date < current_date
     returning id, client_id, plan_id`
  );

  if (!result.rows.length) return;

  for (const row of result.rows) {
    const userResult = await query(
      `select u.id as user_id, p.name as plan_name
       from clients c
       join users u on u.id = c.user_id
       left join subscription_plans p on p.id = $2
       where c.id = $1`,
      [row.client_id, row.plan_id]
    );
    if (!userResult.rows.length) continue;
    const { user_id: userId, plan_name: planName } = userResult.rows[0];
    await notifyUsers(
      [userId],
      `Абонемент закінчився`,
      `Ваш абонемент${planName ? ` «${planName}»` : ''} більше не активний. Зверніться до адміністратора для продовження.`
    );
  }
}
