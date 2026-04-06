import { Router } from 'express';
import { query } from '../db.js';
import { authRequired, requireRole } from '../middleware/auth.js';
import { getClientIdByUserId } from '../utils/identity.js';

const router = Router();

router.use(authRequired);

router.get('/', requireRole('admin', 'manager'), async (req, res) => {
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

router.get('/me', requireRole('client'), async (req, res) => {
  const clientId = await getClientIdByUserId(req.user.id);
  if (!clientId) return res.status(404).json({ error: 'Client not found' });

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
  const { client_id, subscription_id, amount, status } = req.body || {};

  let resolvedClientId = client_id || null;
  if (req.user.role === 'client') {
    resolvedClientId = await getClientIdByUserId(req.user.id);
  }

  if (!resolvedClientId || !amount) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (!['admin', 'manager', 'client'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const result = await query(
    `insert into payments (client_id, subscription_id, amount, status)
     values ($1, $2, $3, $4)
     returning id, client_id, subscription_id, amount, date, status`,
    [resolvedClientId, subscription_id || null, amount, status || 'completed']
  );

  return res.status(201).json(result.rows[0]);
});

export default router;
