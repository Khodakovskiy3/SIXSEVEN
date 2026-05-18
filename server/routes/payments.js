/**
 * Маршрути керування оплатами.
 *
 * GET    /api/payments     — список усіх оплат (admin, manager).
 * GET    /api/payments/me  — оплати поточного клієнта.
 * POST   /api/payments     — створити оплату (admin, manager, client).
 * DELETE /api/payments/:id — видалити оплату (admin).
 */

import { Router } from 'express';

import { query } from '../db.js';
import { authRequired, requireRole } from '../middleware/auth.js';
import { getClientIdByUserId } from '../utils/identity.js';
import {
  HTTP_BAD_REQUEST,
  HTTP_CREATED,
  HTTP_FORBIDDEN,
  HTTP_NOT_FOUND,
  PAYMENT_STATUS_COMPLETED,
  ROLE,
} from '../utils/constants.js';

const router = Router();

router.use(authRequired);

router.get('/', requireRole(ROLE.ADMIN, ROLE.MANAGER), async (req, res) => {
  const result = await query(
    `select p.id, p.client_id, p.subscription_id, p.amount, p.date, p.status,
            u.name as client_name, u.email as client_email
     from payments p
     join clients c on c.id = p.client_id
     join users u on u.id = c.user_id
     order by p.date desc`
  );
  return res.json(result.rows);
});

router.get('/me', requireRole(ROLE.CLIENT), async (req, res) => {
  const clientId = await getClientIdByUserId(req.user.id);
  if (!clientId) {
    return res.status(HTTP_NOT_FOUND).json({ error: 'Client not found' });
  }

  const result = await query(
    `select id, client_id, subscription_id, amount, date, status
     from payments
     where client_id = $1
     order by date desc`,
    [clientId]
  );

  return res.json(result.rows);
});

router.post('/', authRequired, async (req, res) => {
  const {
    client_id: clientIdFromBody,
    subscription_id: subscriptionId,
    amount,
    status,
  } = req.body || {};

  // Для клієнта ігноруємо client_id з тіла запиту — використовуємо ID
  // власного облікового запису, щоб не дати оплатити за чужий рахунок.
  let resolvedClientId = clientIdFromBody || null;
  if (req.user.role === ROLE.CLIENT) {
    resolvedClientId = await getClientIdByUserId(req.user.id);
  }

  if (!resolvedClientId || !amount) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Missing required fields' });
  }

  const allowedRoles = [ROLE.ADMIN, ROLE.MANAGER, ROLE.CLIENT];
  if (!allowedRoles.includes(req.user.role)) {
    return res.status(HTTP_FORBIDDEN).json({ error: 'Forbidden' });
  }

  const result = await query(
    `insert into payments (client_id, subscription_id, amount, status)
     values ($1, $2, $3, $4)
     returning id, client_id, subscription_id, amount, date, status`,
    [resolvedClientId, subscriptionId || null, amount, status || PAYMENT_STATUS_COMPLETED]
  );

  return res.status(HTTP_CREATED).json(result.rows[0]);
});

router.delete('/:id', requireRole(ROLE.ADMIN), async (req, res) => {
  const { id } = req.params;
  await query('delete from payments where id = $1', [id]);
  return res.json({ ok: true });
});

export default router;
