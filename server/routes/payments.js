/**
 * Маршрути керування оплатами.
 *
 * GET    /api/payments     — список усіх оплат (admin, manager).
 * GET    /api/payments/me  — оплати поточного клієнта.
 * POST   /api/payments     — внести оплату вручну (admin, manager).
 * DELETE /api/payments/:id — видалити оплату (admin).
 */

import { Router } from 'express';

import { query } from '../db.js';
import { authRequired, requireRole } from '../middleware/auth.js';
import { getClientIdByUserId } from '../utils/identity.js';
import {
  HTTP_BAD_REQUEST,
  HTTP_CREATED,
  HTTP_NOT_FOUND,
  PAYMENT_STATUS_COMPLETED,
  ROLE,
} from '../utils/constants.js';

const router = Router();

/** Допустимі статуси оплати (відповідають payments_status_check). */
const PAYMENT_STATUSES = ['completed', 'pending', 'refunded'];

/** Верхня межа суми однієї оплати — захист від одруків. */
const MAX_PAYMENT_AMOUNT = 1_000_000;

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

// Ручне внесення оплати — лише персонал. Клієнти оплачують абонемент
// через POST /api/subscriptions/purchase, а не створюють записи оплат
// напряму (інакше клієнт міг би внести «completed»-оплату з довільною
// сумою і спотворити фінансову аналітику).
router.post('/', requireRole(ROLE.ADMIN, ROLE.MANAGER), async (req, res) => {
  const {
    client_id: clientId,
    subscription_id: subscriptionId,
    amount,
    status,
  } = req.body || {};

  const numericAmount = Number(amount);
  if (!Number.isInteger(Number(clientId)) || !Number.isFinite(numericAmount)) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Missing required fields' });
  }
  if (numericAmount <= 0 || numericAmount > MAX_PAYMENT_AMOUNT) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Invalid amount' });
  }
  const resolvedStatus = status || PAYMENT_STATUS_COMPLETED;
  if (!PAYMENT_STATUSES.includes(resolvedStatus)) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Invalid status' });
  }

  const result = await query(
    `insert into payments (client_id, subscription_id, amount, status)
     values ($1, $2, $3, $4)
     returning id, client_id, subscription_id, amount, date, status`,
    [Number(clientId), subscriptionId || null, numericAmount, resolvedStatus]
  );

  return res.status(HTTP_CREATED).json(result.rows[0]);
});

router.delete('/:id', requireRole(ROLE.ADMIN), async (req, res) => {
  const { id } = req.params;
  await query('delete from payments where id = $1', [id]);
  return res.json({ ok: true });
});

export default router;
