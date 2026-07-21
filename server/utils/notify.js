/**
 * Системні сповіщення користувачам через загальну систему повідомлень.
 *
 * Створює запис у messages + надсилає Web Push тим, хто підписаний.
 */

import webpush from 'web-push';
import dotenv from 'dotenv';
import { query } from '../db.js';
import { logError } from './logger.js';

dotenv.config();

// ── VAPID ──────────────────────────────────────────────────────────────────────
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT     || 'mailto:admin@example.com';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

/**
 * Надсилає Web Push підписникам зі списку userIds.
 * Прострочені підписки видаляються автоматично.
 *
 * @param {number[]} userIds
 * @param {string} title
 * @param {string} body
 */
export async function sendPush(userIds, title, body) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE || userIds.length === 0) {
    return;
  }

  try {
    const result = await query(
      `select ps.id, ps.endpoint, ps.p256dh, ps.auth
       from push_subscriptions ps
       join users u on u.id = ps.user_id
       where ps.user_id = any($1::int[])
         and u.notif_push = true`,
      [userIds]
    );

    const payload = JSON.stringify({ title, body });
    const expired = [];

    await Promise.allSettled(
      result.rows.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
            { TTL: 86400 }
          );
        } catch (err) {
          // 410 Gone / 404 = підписка протерміна, видалити
          if (err.statusCode === 410 || err.statusCode === 404) {
            expired.push(sub.id);
          }
        }
      })
    );

    if (expired.length > 0) {
      await query(
        `delete from push_subscriptions where id = any($1::int[])`,
        [expired]
      );
    }
  } catch (err) {
    logError('sendPush помилка', err);
  }
}

/**
 * Колонка налаштувань користувача, що вимикає категорію сповіщень.
 * Білий список: значення підставляється в SQL як ідентифікатор.
 */
const CATEGORY_PREF_COLUMN = Object.freeze({
  training: 'notif_training',
  reminder: 'notif_hour_reminder',
});

/**
 * Надсилає сповіщення переліченим користувачам:
 * 1. Запис у messages + message_recipients (для дзвіночка в UI)
 * 2. Web Push для підписаних користувачів
 *
 * @param {number[]} userIds
 * @param {string} subject
 * @param {string} [body]
 * @param {object} [options]
 * @param {'training'|'reminder'|'system'} [options.category] — категорія
 *   сповіщення. Для 'training' і 'reminder' одержувачі фільтруються за
 *   налаштуваннями профілю; 'system' (типово) надсилається завжди.
 * @param {boolean} [options.onceToday] — не надсилати повторно, якщо
 *   користувач уже отримав сьогодні сповіщення з таким самим subject.
 */
export async function notifyUsers(
  userIds,
  subject,
  body = '',
  { category = 'system', onceToday = false } = {}
) {
  let ids = [...new Set(userIds)]
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0);
  if (ids.length === 0 || !subject) {
    return;
  }

  try {
    // Налаштування «Сповіщення про тренування» / «Нагадування за годину»
    // мають вимикати і дзвіночок у UI, а не лише Web Push — інакше вимкнений
    // перемикач нічого не змінює для користувача.
    const prefColumn = CATEGORY_PREF_COLUMN[category];
    if (prefColumn) {
      const allowed = await query(
        `select id from users where id = any($1::int[]) and ${prefColumn} = true`,
        [ids]
      );
      ids = allowed.rows.map((row) => row.id);
      if (ids.length === 0) {
        return;
      }
    }

    const message = await query(
      `insert into messages (subject, body, audience, status)
       values ($1, $2, 'custom', 'sent')
       returning id`,
      [subject, body || null]
    );

    await query(
      `insert into message_recipients (message_id, user_id)
       select $1, unnest($2::int[])
       on conflict do nothing`,
      [message.rows[0].id, ids]
    );

    // Асинхронно надсилаємо push (не блокуємо відповідь)
    sendPush(ids, subject, body).catch(() => {});
  } catch (error) {
    logError('Не вдалося створити системне сповіщення', error);
  }
}
