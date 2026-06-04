/**
 * Маршрути керування відвідуваннями (фактичними візитами клієнтів).
 *
 * GET    /api/visits     — усі візити (admin, manager).
 * GET    /api/visits/me  — візити поточного клієнта.
 * POST   /api/visits     — зафіксувати візит (admin, trainer).
 * DELETE /api/visits/:id — видалити запис візиту (admin).
 */

import { Router } from 'express';

import { query } from '../db.js';
import { authRequired, requireRole } from '../middleware/auth.js';
import { getClientIdByUserId } from '../utils/identity.js';
import {
  HTTP_BAD_REQUEST,
  HTTP_CONFLICT,
  HTTP_CREATED,
  HTTP_NOT_FOUND,
  ROLE,
  SUBSCRIPTION_STATUS,
} from '../utils/constants.js';

const router = Router();

router.use(authRequired);

router.get('/', requireRole(ROLE.ADMIN, ROLE.MANAGER), async (req, res) => {
  const result = await query(
    `select v.id, v.client_id, v.subscription_id, v.visit_time,
            u.name as client_name, u.email as client_email
     from visits v
     join clients c on c.id = v.client_id
     join users u on u.id = c.user_id
     order by v.visit_time desc`
  );
  return res.json(result.rows);
});

router.get('/me', requireRole(ROLE.CLIENT), async (req, res) => {
  const clientId = await getClientIdByUserId(req.user.id);
  if (!clientId) {
    return res.status(HTTP_NOT_FOUND).json({ error: 'Client not found' });
  }

  const result = await query(
    `select id, client_id, subscription_id, visit_time
     from visits
     where client_id = $1
     order by visit_time desc`,
    [clientId]
  );

  return res.json(result.rows);
});

router.post('/', requireRole(ROLE.ADMIN, ROLE.TRAINER), async (req, res) => {
  const {
    client_id: clientId,
    subscription_id: subscriptionId,
  } = req.body || {};

  if (!clientId) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Missing client_id' });
  }

  // Шукаємо активний абонемент: візит не може відбутися без оплаченої підписки.
  const activeSub = await query(
    `select id from subscriptions
     where client_id = $1
       and status = $2
       and end_date >= CURRENT_DATE
     order by end_date desc
     limit 1`,
    [clientId, SUBSCRIPTION_STATUS.ACTIVE]
  );

  if (activeSub.rows.length === 0) {
    return res.status(HTTP_CONFLICT).json({ error: 'No active subscription' });
  }

  const resolvedSubscriptionId = subscriptionId || activeSub.rows[0].id;
  const result = await query(
    `insert into visits (client_id, subscription_id)
     values ($1, $2)
     returning id, client_id, subscription_id, visit_time`,
    [clientId, resolvedSubscriptionId]
  );

  return res.status(HTTP_CREATED).json(result.rows[0]);
});

router.delete('/:id', requireRole(ROLE.ADMIN), async (req, res) => {
  const { id } = req.params;
  await query('delete from visits where id = $1', [id]);
  return res.json({ ok: true });
});

export default router;
