/**
 * Маршрути сповіщень для кінцевих користувачів (клієнти, тренери, адмін, керівник).
 *
 * GET  /api/notifications          — список оголошень для поточного юзера + кількість непрочитаних.
 * POST /api/notifications/read-all — позначити всі оголошення цього юзера як прочитані.
 */

import { Router } from 'express';

import { query } from '../db.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();

router.use(authRequired);

/**
 * Повертає масив аудиторій, які бачить користувач залежно від ролі.
 *
 * @param {string} role
 * @returns {string[]}
 */
function audiencesForRole(role) {
  if (role === 'client') return ['clients', 'all'];
  if (role === 'trainer') return ['trainers', 'all'];
  return ['clients', 'trainers', 'all']; // admin, manager
}

/**
 * GET /api/notifications
 * Повертає { items: [...], unread: number }
 */
router.get('/', async (req, res) => {
  const { id: userId, role } = req.user;
  const audiences = audiencesForRole(role);

  // Крім широких аудиторій користувач бачить адресні повідомлення
  // (audience='custom'), де він перелічений у message_recipients.
  const result = await query(
    `select
       m.id,
       m.subject,
       m.body,
       m.audience,
       m.created_at,
       exists(
         select 1 from notification_reads nr
         where nr.message_id = m.id and nr.user_id = $1
       ) as is_read
     from messages m
     where m.status = 'sent'
       and (
         m.audience = any($2::text[])
         or exists(
           select 1 from message_recipients mr
           where mr.message_id = m.id and mr.user_id = $1
         )
       )
     order by m.created_at desc
     limit 30`,
    [userId, audiences]
  );

  const items = result.rows;
  const unread = items.filter((i) => !i.is_read).length;

  return res.json({ items, unread });
});

/**
 * POST /api/notifications/:id/read
 * Позначає одне оголошення прочитаним для поточного юзера.
 */
router.post('/:id/read', async (req, res) => {
  const { id: userId } = req.user;
  const messageId = Number(req.params.id);

  if (!Number.isInteger(messageId)) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  await query(
    `insert into notification_reads (message_id, user_id)
     values ($1, $2)
     on conflict do nothing`,
    [messageId, userId]
  );

  return res.json({ ok: true });
});

/**
 * POST /api/notifications/read-all
 * Вставляє записи в notification_reads для всіх непрочитаних оголошень юзера.
 */
router.post('/read-all', async (req, res) => {
  const { id: userId, role } = req.user;
  const audiences = audiencesForRole(role);

  await query(
    `insert into notification_reads (message_id, user_id)
     select m.id, $1
     from messages m
     where m.status = 'sent'
       and (
         m.audience = any($2::text[])
         or exists (
           select 1 from message_recipients mr
           where mr.message_id = m.id and mr.user_id = $1
         )
       )
       and not exists (
         select 1 from notification_reads nr
         where nr.message_id = m.id and nr.user_id = $1
       )
     on conflict do nothing`,
    [userId, audiences]
  );

  return res.json({ ok: true });
});

export default router;
