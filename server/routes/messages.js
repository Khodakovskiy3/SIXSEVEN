/**
 * Маршрути оголошень (розсилок) адміністратора клієнтам або тренерам.
 *
 * GET    /api/messages     — список оголошень (admin, manager).
 * POST   /api/messages     — створити оголошення (admin).
 * PUT    /api/messages/:id — оновити оголошення (admin).
 * DELETE /api/messages/:id — видалити оголошення (admin).
 */

import { Router } from 'express';

import { query } from '../db.js';
import { authRequired, requireRole } from '../middleware/auth.js';
import {
  HTTP_BAD_REQUEST,
  HTTP_CREATED,
  HTTP_NOT_FOUND,
  ROLE,
} from '../utils/constants.js';

const router = Router();

router.use(authRequired);

// Допустимі значення для аудиторії та статусу оголошення (білий список).
// 'custom' — адресне повідомлення конкретним користувачам (message_recipients);
// напряму з форми не приймається, а виводиться з наявності recipient_ids.
const VALID_AUDIENCES = ['clients', 'trainers', 'all'];
const VALID_STATUSES = ['sent', 'planned'];

/**
 * Зводить перелік отримувачів до масиву додатних цілих id користувачів.
 *
 * @param {unknown} value Сирі дані з тіла запиту.
 * @returns {number[]} Порожній масив, якщо отримувачів не передано.
 */
function normalizeRecipientIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.map(Number))].filter((id) => Number.isInteger(id) && id > 0);
}

/**
 * Повністю замінює перелік отримувачів повідомлення.
 *
 * @param {number} messageId Ідентифікатор повідомлення.
 * @param {number[]} recipientIds Нові отримувачі.
 * @returns {Promise<void>}
 */
async function replaceRecipients(messageId, recipientIds) {
  await query('delete from message_recipients where message_id = $1', [messageId]);
  if (recipientIds.length === 0) {
    return;
  }
  await query(
    `insert into message_recipients (message_id, user_id)
     select $1, unnest($2::int[])
     on conflict do nothing`,
    [messageId, recipientIds]
  );
}

/**
 * Зводить аудиторію до допустимого значення, інакше повертає 'clients'.
 *
 * @param {string} value
 * @returns {string}
 */
function normalizeAudience(value) {
  return VALID_AUDIENCES.includes(value) ? value : 'clients';
}

/**
 * Зводить статус до допустимого значення, інакше повертає 'sent'.
 *
 * @param {string} value
 * @returns {string}
 */
function normalizeStatus(value) {
  return VALID_STATUSES.includes(value) ? value : 'sent';
}

router.get('/', requireRole(ROLE.ADMIN, ROLE.MANAGER), async (req, res) => {
  // recipients потрібні формі редагування, щоб показати, кому саме
  // адресовано повідомлення з audience='custom'.
  const result = await query(
    `select m.id, m.subject, m.body, m.audience, m.status, m.send_date, m.created_at,
            coalesce(
              (select json_agg(json_build_object('id', u.id, 'name', u.name) order by u.name)
               from message_recipients mr
               join users u on u.id = mr.user_id
               where mr.message_id = m.id),
              '[]'::json
            ) as recipients
     from messages m
     order by m.created_at desc`
  );
  return res.json(result.rows);
});

router.post('/', requireRole(ROLE.ADMIN), async (req, res) => {
  const {
    subject,
    body,
    audience,
    status,
    send_date: sendDate,
    recipient_ids: rawRecipientIds,
  } = req.body || {};
  if (!subject) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Missing subject' });
  }

  // Обрані конкретні отримувачі мають пріоритет над широкою аудиторією.
  const recipientIds = normalizeRecipientIds(rawRecipientIds);
  const effectiveAudience = recipientIds.length > 0 ? 'custom' : normalizeAudience(audience);

  const result = await query(
    `insert into messages (subject, body, audience, status, send_date)
     values ($1, $2, $3, $4, $5)
     returning id, subject, body, audience, status, send_date, created_at`,
    [subject, body || null, effectiveAudience, normalizeStatus(status), sendDate || null]
  );

  if (recipientIds.length > 0) {
    await replaceRecipients(result.rows[0].id, recipientIds);
  }

  return res.status(HTTP_CREATED).json(result.rows[0]);
});

router.put('/:id', requireRole(ROLE.ADMIN), async (req, res) => {
  const { id } = req.params;
  const {
    subject,
    body,
    audience,
    status,
    send_date: sendDate,
    recipient_ids: rawRecipientIds,
  } = req.body || {};

  // Передані отримувачі повністю замінюють попередній перелік і переводять
  // повідомлення в адресний режим; без них аудиторія редагується як раніше.
  const recipientIds = normalizeRecipientIds(rawRecipientIds);
  const effectiveAudience = recipientIds.length > 0
    ? 'custom'
    : (audience ? normalizeAudience(audience) : null);

  const result = await query(
    `update messages
     set subject = coalesce($1, subject),
         body = coalesce($2, body),
         audience = coalesce($3, audience),
         status = coalesce($4, status),
         send_date = coalesce($5, send_date)
     where id = $6
     returning id, subject, body, audience, status, send_date, created_at`,
    [
      subject || null,
      body || null,
      effectiveAudience,
      status ? normalizeStatus(status) : null,
      sendDate || null,
      id,
    ]
  );

  if (result.rows.length === 0) {
    return res.status(HTTP_NOT_FOUND).json({ error: 'Not found' });
  }

  if (recipientIds.length > 0) {
    await replaceRecipients(Number(id), recipientIds);
  } else if (effectiveAudience && effectiveAudience !== 'custom') {
    // Повернення до широкої аудиторії — адресний перелік більше не актуальний.
    await query('delete from message_recipients where message_id = $1', [id]);
  }

  return res.json(result.rows[0]);
});

router.delete('/:id', requireRole(ROLE.ADMIN), async (req, res) => {
  const { id } = req.params;
  await query('delete from messages where id = $1', [id]);
  return res.json({ ok: true });
});

export default router;
