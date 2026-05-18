/**
 * Маршрути керування абонементами клієнтів.
 *
 * GET    /api/subscriptions     — список усіх абонементів (admin, manager).
 * GET    /api/subscriptions/me  — абонементи поточного клієнта.
 * POST   /api/subscriptions     — створити абонемент (admin, manager).
 * PUT    /api/subscriptions/:id — оновити абонемент.
 * DELETE /api/subscriptions/:id — видалити абонемент (admin).
 */

import { Router } from 'express';

import { query } from '../db.js';
import { authRequired, requireRole } from '../middleware/auth.js';
import { getClientIdByUserId } from '../utils/identity.js';
import {
  HTTP_BAD_REQUEST,
  HTTP_CREATED,
  HTTP_NOT_FOUND,
  ROLE,
  SUBSCRIPTION_STATUS,
} from '../utils/constants.js';

const router = Router();

router.use(authRequired);

/**
 * Перед видачею абонементів актуалізує їх статуси:
 * усі, що минули end_date, переводяться в 'expired'.
 * Виконується лазиво при кожному запиті, щоб не тримати окремого cron-job.
 *
 * @returns {Promise<void>}
 */
async function refreshSubscriptionStatuses() {
  await query(
    `update subscriptions
     set status = $1
     where end_date < CURRENT_DATE and status != $1`,
    [SUBSCRIPTION_STATUS.EXPIRED]
  );
}

router.get('/', requireRole(ROLE.ADMIN, ROLE.MANAGER), async (req, res) => {
  await refreshSubscriptionStatuses();
  const result = await query(
    `select s.id, s.client_id, s.type, s.start_date, s.end_date, s.status,
            u.name as client_name, u.email as client_email
     from subscriptions s
     join clients c on c.id = s.client_id
     join users u on u.id = c.user_id
     order by s.end_date desc`
  );
  return res.json(result.rows);
});

router.get('/me', requireRole(ROLE.CLIENT), async (req, res) => {
  await refreshSubscriptionStatuses();
  const clientId = await getClientIdByUserId(req.user.id);
  if (!clientId) {
    return res.status(HTTP_NOT_FOUND).json({ error: 'Client not found' });
  }

  const result = await query(
    `select id, type, start_date, end_date, status
     from subscriptions
     where client_id = $1
     order by end_date desc`,
    [clientId]
  );

  return res.json(result.rows);
});

router.post('/', requireRole(ROLE.ADMIN, ROLE.MANAGER), async (req, res) => {
  const {
    client_id: clientId,
    type,
    start_date: startDate,
    end_date: endDate,
    status,
  } = req.body || {};

  if (!clientId || !type || !startDate || !endDate) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Missing required fields' });
  }

  const result = await query(
    `insert into subscriptions (client_id, type, start_date, end_date, status)
     values ($1, $2, $3, $4, $5)
     returning id, client_id, type, start_date, end_date, status`,
    [clientId, type, startDate, endDate, status || SUBSCRIPTION_STATUS.ACTIVE]
  );

  return res.status(HTTP_CREATED).json(result.rows[0]);
});

router.put('/:id', requireRole(ROLE.ADMIN, ROLE.MANAGER), async (req, res) => {
  const { id } = req.params;
  const {
    type,
    start_date: startDate,
    end_date: endDate,
    status,
  } = req.body || {};

  const result = await query(
    `update subscriptions
     set type = coalesce($1, type),
         start_date = coalesce($2, start_date),
         end_date = coalesce($3, end_date),
         status = coalesce($4, status)
     where id = $5
     returning id, client_id, type, start_date, end_date, status`,
    [type || null, startDate || null, endDate || null, status || null, id]
  );

  if (result.rows.length === 0) {
    return res.status(HTTP_NOT_FOUND).json({ error: 'Not found' });
  }
  return res.json(result.rows[0]);
});

router.delete('/:id', requireRole(ROLE.ADMIN), async (req, res) => {
  const { id } = req.params;
  await query('delete from subscriptions where id = $1', [id]);
  return res.json({ ok: true });
});

export default router;
