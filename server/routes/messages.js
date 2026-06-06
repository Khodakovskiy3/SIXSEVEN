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
const VALID_AUDIENCES = ['clients', 'trainers', 'all'];
const VALID_STATUSES = ['sent', 'planned'];

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
  const result = await query(
    `select id, subject, body, audience, status, send_date, created_at
     from messages
     order by created_at desc`
  );
  return res.json(result.rows);
});

router.post('/', requireRole(ROLE.ADMIN), async (req, res) => {
  const { subject, body, audience, status, send_date: sendDate } = req.body || {};
  if (!subject) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Missing subject' });
  }

  const result = await query(
    `insert into messages (subject, body, audience, status, send_date)
     values ($1, $2, $3, $4, $5)
     returning id, subject, body, audience, status, send_date, created_at`,
    [subject, body || null, normalizeAudience(audience), normalizeStatus(status), sendDate || null]
  );
  return res.status(HTTP_CREATED).json(result.rows[0]);
});

router.put('/:id', requireRole(ROLE.ADMIN), async (req, res) => {
  const { id } = req.params;
  const { subject, body, audience, status, send_date: sendDate } = req.body || {};

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
      audience ? normalizeAudience(audience) : null,
      status ? normalizeStatus(status) : null,
      sendDate || null,
      id,
    ]
  );

  if (result.rows.length === 0) {
    return res.status(HTTP_NOT_FOUND).json({ error: 'Not found' });
  }
  return res.json(result.rows[0]);
});

router.delete('/:id', requireRole(ROLE.ADMIN), async (req, res) => {
  const { id } = req.params;
  await query('delete from messages where id = $1', [id]);
  return res.json({ ok: true });
});

export default router;
