/**
 * Системні сповіщення користувачам через загальну систему повідомлень.
 *
 * Створює запис у messages з audience='custom' і прив'язує отримувачів
 * через message_recipients. Дзвіночок на фронтенді підхоплює такі
 * повідомлення звичайним полінгом /api/notifications і сам грає звук —
 * окремого механізму доставки не потрібно.
 */

import { query } from '../db.js';

/**
 * Надсилає сповіщення переліченим користувачам.
 * Помилки лише логуються: збій сповіщення не повинен ламати основну
 * дію (призначення абонемента, зміну розкладу тощо).
 *
 * @param {number[]} userIds Ідентифікатори користувачів-отримувачів.
 * @param {string} subject Тема сповіщення (обов'язкова).
 * @param {string} [body] Текст сповіщення.
 * @returns {Promise<void>}
 */
export async function notifyUsers(userIds, subject, body = '') {
  const ids = [...new Set(userIds)]
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0);
  if (ids.length === 0 || !subject) {
    return;
  }

  try {
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
  } catch (error) {
    console.error('Не вдалося створити системне сповіщення:', error.message);
  }
}
