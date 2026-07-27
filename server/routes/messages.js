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
import { sendPush } from '../utils/notify.js';
import {
  HTTP_BAD_REQUEST,
  HTTP_CREATED,
  HTTP_NOT_FOUND,
  ROLE,
} from '../utils/constants.js';
import {
  normalizeRecipientIds,
  normalizeAudience,
  normalizeStatus,
  resolveAudience,
  audienceToRoleFilter,
  validateMessageFields,
} from '../utils/message-logic.js';

const router = Router();

router.use(authRequired);

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
 * Надсилає Web Push підписникам відповідно до аудиторії повідомлення.
 * @param {string}   audience    — 'clients' | 'trainers' | 'all' | 'custom'
 * @param {number[]} customIds   — конкретні user_id (тільки для audience='custom')
 * @param {string}   title
 * @param {string}   body
 */
export async function sendPushForMessage(audience, customIds, title, body, link = '') {
  let userIds = [];

  const roleFilter = audienceToRoleFilter(audience);
  if (roleFilter === null) {
    userIds = customIds;
  } else {
    const result = await query(`select id from users where ${roleFilter}`);
    userIds = result.rows.map((r) => r.id);
  }

  if (userIds.length > 0) {
    await sendPush(userIds, title, body, link);
  }
}

/**
 * Активує заплановані оголошення, дата й час яких настали: 'planned' → 'sent'.
 * Виконується лазиво при кожному запиті — так само, як протермінування
 * абонементів у subscriptions.js — щоб не тримати окремого cron-job.
 *
 * @returns {Promise<number>}
 */
export async function activatePlannedMessages() {
  const activated = await query(
    `update messages
     set status = 'sent'
     where status = 'planned'
       and send_date is not null
       and ((send_date + coalesce(send_time, '00:00'::time)) at time zone 'Europe/Kyiv') <= now()
     returning id, subject, body, audience, link`
  );
  for (const message of activated.rows) {
    const recipients = await query(
      'select user_id from message_recipients where message_id = $1',
      [message.id]
    );
    await sendPushForMessage(
      message.audience,
      recipients.rows.map((row) => row.user_id),
      message.subject,
      message.body || '',
      message.link || ''
    );
  }
  return activated.rows.length;
}

router.get('/', requireRole(ROLE.ADMIN, ROLE.MANAGER), async (req, res) => {
  await activatePlannedMessages();
  const result = await query(
    `select m.id, m.subject, m.body, m.audience, m.status, m.send_date, m.send_time, m.created_at,
            m.created_by, cu.name as created_by_name,
            coalesce(
              (select json_agg(json_build_object('id', u.id, 'name', u.name) order by u.name)
               from message_recipients mr
               join users u on u.id = mr.user_id
               where mr.message_id = m.id),
              '[]'::json
            ) as recipients
     from messages m
     left join users cu on cu.id = m.created_by
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
    send_time: sendTime,
    recipient_ids: rawRecipientIds,
  } = req.body || {};

  const validationError = validateMessageFields({ subject, status, send_date: sendDate, send_time: sendTime });
  if (validationError) {
    return res.status(HTTP_BAD_REQUEST).json({ error: validationError });
  }

  const recipientIds = normalizeRecipientIds(rawRecipientIds);
  const effectiveAudience = resolveAudience(recipientIds, audience);

  const result = await query(
    `insert into messages (subject, body, audience, status, send_date, send_time, created_by)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id, subject, body, audience, status, send_date, send_time, created_at, created_by`,
    [
      subject,
      body || null,
      effectiveAudience,
      normalizeStatus(status),
      sendDate || null,
      sendTime || null,
      req.user.id,
    ]
  );

  if (recipientIds.length > 0) {
    await replaceRecipients(result.rows[0].id, recipientIds);
  }

  if (normalizeStatus(status) === 'sent') {
    sendPushForMessage(
      effectiveAudience,
      recipientIds,
      subject,
      body || '',
    ).catch(() => {});
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
    send_time: sendTime,
    recipient_ids: rawRecipientIds,
  } = req.body || {};

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
         send_date = coalesce($5, send_date),
         send_time = coalesce($6, send_time)
     where id = $7
     returning id, subject, body, audience, status, send_date, send_time, created_at`,
    [
      subject || null,
      body || null,
      effectiveAudience,
      status ? normalizeStatus(status) : null,
      sendDate || null,
      sendTime || null,
      id,
    ]
  );

  if (result.rows.length === 0) {
    return res.status(HTTP_NOT_FOUND).json({ error: 'Not found' });
  }

  if (recipientIds.length > 0) {
    await replaceRecipients(Number(id), recipientIds);
  } else if (effectiveAudience && effectiveAudience !== 'custom') {
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
